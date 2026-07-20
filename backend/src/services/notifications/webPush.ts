import webpush from "web-push";
import { logger } from "../logging/logger";
import type { GoldMetaStore } from "../storage/types";

let configured = false;

const ensureVapid = (): boolean => {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:support@goldmeta.app";
  if (!publicKey || !privateKey) {
    return false;
  }
  if (!configured) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  }
  return true;
};

export const sendWebPushToUser = async (
  store: GoldMetaStore,
  userId: string,
  payload: { title: string; body: string; data?: Record<string, string> }
): Promise<number> => {
  if (!ensureVapid()) {
    logger.info("VAPID keys not configured — skipping Web Push delivery");
    return 0;
  }

  const subscriptions = await store.listWebPushSubscriptions(userId);
  if (subscriptions.length === 0) {
    return 0;
  }

  let sent = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth
          }
        },
        JSON.stringify(payload)
      );
      sent += 1;
    } catch (error) {
      const statusCode =
        typeof error === "object" && error !== null && "statusCode" in error
          ? Number((error as { statusCode?: number }).statusCode)
          : undefined;
      if (statusCode === 404 || statusCode === 410) {
        await store.deleteWebPushSubscription(userId, subscription.endpoint);
        logger.info("Removed expired Web Push subscription", { userId, endpoint: subscription.endpoint });
      } else {
        logger.warn("Web Push send failed", {
          userId,
          endpoint: subscription.endpoint,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
  return sent;
};
