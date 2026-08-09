import type { ApiClient } from "./api";
import type { WebPushSubscriptionPayload } from "../types/models";

export type PushSubscribeStatus =
  | "subscribed"
  | "denied"
  | "permission_required"
  | "unsupported"
  | "missing_vapid"
  | "needs_install"
  | "failed";

export type PushSubscribeResult = {
  status: PushSubscribeStatus;
  message: string;
};

const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
};

const applicationServerKeyMatches = (
  subscription: PushSubscription,
  publicKey: string
): boolean => {
  const existingKey = subscription.options?.applicationServerKey;
  if (!existingKey) return true;
  const existing = new Uint8Array(existingKey);
  const expected = urlBase64ToUint8Array(publicKey);
  if (existing.byteLength !== expected.byteLength) return false;
  return existing.every((byte, index) => byte === expected[index]);
};

export const isWebPushSupported = (): boolean =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

export const getNotificationPermission = (): NotificationPermission | "unsupported" => {
  if (!isWebPushSupported()) return "unsupported";
  return Notification.permission;
};

export const isProbablyInstalledPwa = (): boolean => {
  if (typeof window === "undefined") return false;
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  const iosStandalone =
    "standalone" in navigator &&
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return standalone || iosStandalone;
};

const toPayload = (subscription: PushSubscription): WebPushSubscriptionPayload => {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("Incomplete push subscription");
  }
  return {
    endpoint: json.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: {
      p256dh: json.keys.p256dh,
      auth: json.keys.auth
    },
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined
  };
};

export async function getLocalPushSubscription(): Promise<PushSubscription | null> {
  if (!isWebPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    return registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Request notification permission only after an explicit user gesture.
 * On iPhone, Web Push is only reliable for Home Screen-installed PWAs on compatible iOS versions.
 *
 * "subscribed" means a real PushSubscription exists AND was registered with the GoldMeta backend.
 * Notification.permission === "granted" alone is never enough.
 */
export async function subscribeWebPush(api: ApiClient): Promise<PushSubscribeResult> {
  if (!isWebPushSupported()) {
    return {
      status: "unsupported",
      message: "This browser does not support Web Push."
    };
  }

  if (!isProbablyInstalledPwa() && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
    return {
      status: "needs_install",
      message:
        "On iPhone, add GoldMeta to your Home Screen first, then enable notifications from the installed app."
    };
  }

  let publicKey: string | null = null;
  try {
    publicKey = await api.getVapidPublicKey();
  } catch (err) {
    return {
      status: "failed",
      message: err instanceof Error ? err.message : "Could not load server push configuration."
    };
  }
  if (!publicKey) {
    return {
      status: "missing_vapid",
      message: "Server configuration missing — Web Push is not configured yet."
    };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { status: "denied", message: "Notification permission was not granted." };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !applicationServerKeyMatches(subscription, publicKey)) {
      try {
        await api.deleteWebPushSubscription(subscription.endpoint);
      } catch {
        /* local unsubscribe still required */
      }
      await subscription.unsubscribe();
      subscription = null;
    }

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource
      });
    }

    await api.registerWebPushSubscription(toPayload(subscription));
    return {
      status: "subscribed",
      message: "Push subscription registered for this phone with GoldMeta."
    };
  } catch (err) {
    return {
      status: "failed",
      message: err instanceof Error ? err.message : "Push subscription failed."
    };
  }
}

/**
 * Confirm a local PushSubscription is still present and re-upsert it for the signed-in UID.
 * Permission alone never counts as active.
 */
export async function ensureWebPushRegistered(api: ApiClient): Promise<PushSubscribeResult> {
  if (!isWebPushSupported()) {
    return { status: "unsupported", message: "This browser does not support Web Push." };
  }
  if (!isProbablyInstalledPwa() && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
    return {
      status: "needs_install",
      message:
        "On iPhone, add GoldMeta to your Home Screen first, then enable notifications from the installed app."
    };
  }

  let publicKey: string | null = null;
  try {
    publicKey = await api.getVapidPublicKey();
  } catch (err) {
    return {
      status: "failed",
      message: err instanceof Error ? err.message : "Could not load server push configuration."
    };
  }
  if (!publicKey) {
    return {
      status: "missing_vapid",
      message: "Server configuration missing — Web Push is not configured yet."
    };
  }

  const permission = getNotificationPermission();
  if (permission === "denied") {
    return { status: "denied", message: "Notification permission was not granted." };
  }
  if (permission !== "granted") {
    return {
      status: "permission_required",
      message: "Notifications permission required."
    };
  }

  const subscription = await getLocalPushSubscription();
  if (!subscription) {
    return {
      status: "failed",
      message: "No push subscription on this phone yet. Tap Enable alerts."
    };
  }
  if (!applicationServerKeyMatches(subscription, publicKey)) {
    return {
      status: "failed",
      message: "Push subscription is outdated. Tap Enable alerts to re-register."
    };
  }

  try {
    await api.registerWebPushSubscription(toPayload(subscription));
    return {
      status: "subscribed",
      message: "Push subscription registered for this phone with GoldMeta."
    };
  } catch (err) {
    return {
      status: "failed",
      message: err instanceof Error ? err.message : "Push subscription failed."
    };
  }
}

export async function unsubscribeWebPush(api: ApiClient): Promise<void> {
  if (!isWebPushSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  try {
    await api.deleteWebPushSubscription(subscription.endpoint);
  } finally {
    await subscription.unsubscribe();
  }
}
