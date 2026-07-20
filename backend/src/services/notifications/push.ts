import type { Message } from "firebase-admin/messaging";
import type { DecisionRecord } from "../../models/types";
import { sendFirebaseMessages } from "../firebaseAdmin";
import { logger } from "../logging/logger";
import type { GoldMetaStore } from "../storage/types";
import { sendWebPushToUser } from "./webPush";

const notificationReason = (decision: DecisionRecord, previous: DecisionRecord | undefined): string | null => {
  if (!previous && decision.decision !== "WAIT") {
    return "initial_actionable_decision";
  }
  if (previous && previous.decision !== decision.decision) {
    return `direction_change_${previous.decision}_to_${decision.decision}`;
  }
  if (
    previous &&
    previous.decision !== "WAIT" &&
    decision.decision === "WAIT" &&
    decision.reasonCodes.some((code) => /INVALID|STALE|CONFLICT|GUARD|RR|SL/.test(code))
  ) {
    return "active_setup_invalidated";
  }
  return null;
};

const buildBody = (decision: DecisionRecord): string => {
  if (decision.decision === "WAIT") {
    return `WAIT for XAUUSD: ${decision.reasonSummary[0] ?? "setup does not meet safety rules"}`;
  }

  const entry = decision.entry.price === null ? "market" : decision.entry.price.toFixed(2);
  const sl = decision.stopLoss.price === null ? "n/a" : decision.stopLoss.price.toFixed(2);
  const tp2 = decision.takeProfits.find((target) => target.label === "TP2")?.price;
  const tp2Text = tp2 === undefined ? "n/a" : tp2.toFixed(2);
  return `${decision.decision} XAUUSD ${entry} | SL ${sl} | TP2 ${tp2Text} | confidence ${decision.confidenceLabel}`;
};

export const sendDecisionPushIfMeaningful = async (
  store: GoldMetaStore,
  decision: DecisionRecord,
  previous: DecisionRecord | undefined
): Promise<boolean> => {
  const reason = notificationReason(decision, previous);
  if (!reason) {
    return false;
  }

  const dedupeKey = `${decision.decisionId}:${reason}`;
  if (!(await store.markNotification(decision.userId, dedupeKey))) {
    return false;
  }

  const devices = await store.listDevices(decision.userId);
  const title = "GoldMeta Decision";
  const body = buildBody(decision);
  const data = {
    decisionId: decision.decisionId,
    decision: decision.decision,
    reason
  };

  let fcmSent = 0;
  if (devices.length > 0) {
    const messages: Message[] = devices.map((device) => ({
      token: device.fcmToken,
      notification: { title, body },
      data
    }));
    fcmSent = await sendFirebaseMessages(messages);
  } else {
    logger.info("No registered FCM devices for meaningful decision", {
      decisionId: decision.decisionId,
      reason
    });
  }

  const webSent = await sendWebPushToUser(store, decision.userId, { title, body, data });
  return fcmSent > 0 || webSent > 0;
};
