/**
 * Periodic FAST_AUTOTRADE_V1 scan so evaluation is not limited to 15m decisions.
 * Reuses processDecisionForQualification with the latest stored decision + live quote.
 */

import { createStore } from "../../../storage/createStore";
import { processDecisionForQualification } from "../qualificationService";
import { listOwnersNeedingQuoteRefresh } from "../quoteStore";
import { resolveDemoAutoAuthorityForUser } from "../demoAutoExecutionAuthority";
import { isFastAutoTradeV1Enabled } from "./config";
import { logger } from "../../../logging/logger";

export async function runFastAutoTradeScanPass(opts?: {
  limit?: number;
}): Promise<{ scanned: number; handled: number }> {
  if (!isFastAutoTradeV1Enabled()) {
    return { scanned: 0, handled: 0 };
  }
  const store = createStore();
  let owners: string[] = [];
  try {
    owners = await listOwnersNeedingQuoteRefresh(opts?.limit ?? 40);
  } catch (err) {
    logger.warn("FAST_AUTOTRADE_V1 scan owner list failed", {
      error: err instanceof Error ? err.message : String(err)
    });
    return { scanned: 0, handled: 0 };
  }

  let scanned = 0;
  let handled = 0;
  for (const uid of owners) {
    try {
      const authority = await resolveDemoAutoAuthorityForUser(uid);
      if (!authority.submissionAuthorized || authority.label === "LOCKED_LIVE") {
        continue;
      }
      const latest = await store.latestDecision(uid);
      if (!latest) continue;
      scanned += 1;
      const result = await processDecisionForQualification({
        uid,
        decisionId: latest.decisionId,
        store
      });
      if (result.handled) handled += 1;
    } catch (err) {
      logger.warn("FAST_AUTOTRADE_V1 scan failed for owner", {
        uid,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  return { scanned, handled };
}
