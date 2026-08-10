/**
 * Trusted AutoTrade trigger — loads immutable GoldMeta decisions server-side.
 * Never trusts browser-supplied execution fields.
 *
 * Also runs Pepperstone LIVE SHADOW evaluation (no Live order submission).
 */

import { logger } from "../logging/logger";
import type { AutoTradeService } from "./autoTradeService";
import type { GoldMetaStore } from "../storage/types";
import { processDecisionForLiveShadow } from "../broker/ctrader/liveShadowExecution";
import { isCTraderLiveShadowEnabled } from "../broker/ctrader/flags";

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
    } else if (status.locked) {
      logger.info("AutoTrade skip — locked", { userId, decisionId, reason: status.lockReason });
    } else {
      const result = await autoTrade.evaluateFromStoredDecision(userId, decisionId, store);
      logger.info("AutoTrade evaluateFromStoredDecision finished", {
        userId,
        decisionId,
        skipped: result.skipped,
        state: result.intent.state,
        message: result.message
      });
    }
  } catch (error) {
    logger.error("AutoTrade decision trigger failed", {
      userId,
      decisionId,
      error: error instanceof Error ? error.message : "unknown"
    });
  }

  // LIVE SHADOW — independent of IG AutoTrade mode. Never submits Live orders.
  if (isCTraderLiveShadowEnabled()) {
    try {
      const shadow = await processDecisionForLiveShadow({
        userId,
        decisionId,
        store
      });
      logger.info("LIVE SHADOW decision evaluation finished", {
        userId,
        decisionId,
        skipped: shadow.skipped,
        outcome: shadow.outcome,
        message: shadow.message,
        liveOrderEndpointCalled: false
      });
    } catch (error) {
      logger.error("LIVE SHADOW decision evaluation failed", {
        userId,
        decisionId,
        error: error instanceof Error ? error.message : "unknown"
      });
    }
  }
}
