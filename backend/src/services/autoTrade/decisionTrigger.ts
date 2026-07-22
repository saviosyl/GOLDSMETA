/**
 * Trusted AutoTrade trigger — loads immutable GoldMeta decisions server-side.
 * Never trusts browser-supplied execution fields.
 */

import { logger } from "../logging/logger";
import type { AutoTradeService } from "./autoTradeService";
import type { GoldMetaStore } from "../storage/types";

export async function processDecisionForAutoTrade(args: {
  userId: string;
  decisionId: string;
  autoTrade: AutoTradeService;
  store: GoldMetaStore;
}): Promise<void> {
  const { userId, decisionId, autoTrade, store } = args;
  try {
    const status = await autoTrade.getStatus(userId);
    if (status.mode === "OFF") {
      logger.info("AutoTrade skip — mode OFF", { userId, decisionId });
      return;
    }
    if (status.locked) {
      logger.info("AutoTrade skip — locked", { userId, decisionId, reason: status.lockReason });
      return;
    }
    const result = await autoTrade.evaluateFromStoredDecision(userId, decisionId, store);
    logger.info("AutoTrade evaluateFromStoredDecision finished", {
      userId,
      decisionId,
      skipped: result.skipped,
      state: result.intent.state,
      message: result.message
    });
  } catch (error) {
    logger.error("AutoTrade decision trigger failed", {
      userId,
      decisionId,
      error: error instanceof Error ? error.message : "unknown"
    });
  }
}
