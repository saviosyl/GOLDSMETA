import type { ApiClient } from "./api";
import type { WebPushSubscriptionPayload } from "../types/models";

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
  const iosStandalone = "standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
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

/**
 * Request notification permission only after an explicit user gesture.
 * On iPhone, Web Push is only reliable for Home Screen-installed PWAs on compatible iOS versions.
 */
export async function subscribeWebPush(api: ApiClient): Promise<{
  status: "subscribed" | "denied" | "unsupported" | "missing_vapid" | "needs_install";
  message: string;
}> {
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

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { status: "denied", message: "Notification permission was not granted." };
  }

  const publicKey = await api.getVapidPublicKey();
  if (!publicKey) {
    return {
      status: "missing_vapid",
      message: "Server VAPID public key is not configured yet."
    };
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource
    }));

  await api.registerWebPushSubscription(toPayload(subscription));
  return { status: "subscribed", message: "Push subscription registered for this browser." };
}

export async function unsubscribeWebPush(api: ApiClient): Promise<void> {
  if (!isWebPushSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await api.deleteWebPushSubscription(subscription.endpoint);
  await subscription.unsubscribe();
}
