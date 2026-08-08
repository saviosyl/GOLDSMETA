/**
 * Best-effort AutoTrade notification events — uses in-app notification log.
 * Never throws into the trading path.
 */

import { getFirestore } from "firebase-admin/firestore";
import { randomBytes } from "crypto";

export type AutoTradeNotifyKind =
  | "PREVIEW_PROGRESS"
  | "PREVIEWS_COMPLETE"
  | "CONTROLLED_TRADE_OPENED"
  | "CONTROLLED_TRADE_CLOSED"
  | "CONTROLLED_COMPLETE"
  | "DEMO_AUTO_READY"
  | "DEMO_AUTO_ENABLED"
  | "DAILY_TRADE_LIMIT"
  | "DAILY_LOSS_LIMIT"
  | "DAILY_PROFIT_TARGET"
  | "CONSECUTIVE_LOSS_PAUSE"
  | "COOLDOWN_STARTED"
  | "AUTOTRADE_PAUSED"
  | "EMERGENCY_STOP"
  | "BROKER_DISCONNECTED"
  | "LIVE_AUTO_ELIGIBLE"
  | "WEEKLY_REPORT_READY";

export async function notifyAutoTradeEvent(args: {
  uid: string;
  kind: AutoTradeNotifyKind;
  title: string;
  body: string;
  dedupeKey?: string;
}): Promise<void> {
  try {
    const id =
      args.dedupeKey?.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) ||
      `atn_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
    const ref = getFirestore().doc(`users/${args.uid}/notifications/${id}`);
    const existing = await ref.get();
    if (existing.exists) return;
    await ref.set({
      id,
      uid: args.uid,
      kind: args.kind,
      category: "autotrade",
      title: args.title,
      body: args.body,
      read: false,
      createdAt: new Date().toISOString(),
      source: "autotrade"
    });
  } catch {
    /* never block */
  }
}
