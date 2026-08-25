/**
 * Plain-English Markets structure copy — never expose "setup score N did not reach…".
 */

import type { Decision } from "../types/models";
import { plainReason, looksLikeReasonCode } from "./reasonCodePlain";

export function marketsStructurePlain(decision: Decision | null | undefined): string {
  if (!decision) return "Open Plan for the full decision context";

  const raw =
    (Array.isArray(decision.reasonSummary) ? decision.reasonSummary[0] : null) ||
    decision.explanation ||
    "";

  if (/setup score|did not reach|BUY\/SELL thresholds|BUY\/SELL threshold/i.test(raw)) {
    const bullishLean =
      decision.decision === "WAIT" &&
      (decision.bullishEvidence?.length ?? 0) > (decision.bearishEvidence?.length ?? 0);
    const bearishLean =
      decision.decision === "WAIT" &&
      (decision.bearishEvidence?.length ?? 0) > (decision.bullishEvidence?.length ?? 0);

    if (bullishLean) {
      return "No confirmed setup yet. Bullish conditions are present, but confirmation is not strong enough for an entry.";
    }
    if (bearishLean) {
      return "No confirmed setup yet. Bearish conditions are present, but confirmation is not strong enough for an entry.";
    }
    return "No confirmed setup yet";
  }

  if (!raw.trim()) {
    if (decision.decision === "WAIT") return "No confirmed setup yet";
    return "Open Plan for the full decision context";
  }

  if (looksLikeReasonCode(raw)) return plainReason(raw);
  return raw;
}
