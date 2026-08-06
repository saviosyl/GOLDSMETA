/**
 * Translate backend reason / geometry codes into plain English for the primary UI.
 * Raw codes belong only in Advanced Diagnostics.
 */

const MAP: Record<string, string> = {
  ENTRY_EQUALS_STOP: "Entry and stop are too close.",
  STOP_WRONG_SIDE: "Stop is on the wrong side of entry.",
  TP1_WRONG_SIDE: "TP1 is on the wrong side of entry.",
  TP1_EQUALS_ENTRY: "TP1 is too close to entry.",
  ZERO_RISK: "Risk distance is zero or invalid.",
  INVALID_TARGET_ORDER: "Targets are not in a valid order for this direction.",
  MISSING_REQUIRED_LEVEL: "Complete trade levels are not available yet.",
  PRICE_ALREADY_AT_TARGET: "Price has already reached TP1.",
  INVALIDATION_STOP_MISMATCH: "Displayed invalidation does not match the stop.",
  QUICK_TARGET_FAILED: "Quick-target checks did not pass.",
  STRUCTURE_INCOMPLETE: "Observation data only — structure is incomplete.",
  STRUCTURE_MISMATCH: "Price sources disagree.",
  LIVE_RANGE_ONLY: "Observation data only.",
  PRICE_SOURCE_MISMATCH: "Price sources disagree.",
  ENTRY_ZONE_INVALID: "Entry zone is invalid.",
  DIRECTION_NOT_TRADEABLE: "No tradeable direction yet.",
  STRUCTURE_ONLY_OR_INCOMPLETE_TRADE_PLAN: "Complete trade levels are not available yet.",
  TRADE_LEVELS_FAILED_SAFETY_VALIDATION: "Trade levels failed safety validation.",
  WAIT_NO_VALID_PLAN: "No valid plan. Wait for a complete 15-minute strategy signal.",
  NO_VALID_15M_PLAN: "No valid plan. Wait for a complete 15-minute strategy signal.",
  GEOMETRY_INVALID: "Trade levels failed safety validation.",
  DECISION_WAIT: "Waiting for a clearer setup.",
  MISSING_ENTRY: "Entry is missing.",
  MISSING_STOP: "Stop is missing.",
  MISSING_TP1: "TP1 is missing.",
  MISSING_4H_CONTEXT: "4H context is not available yet.",
  AWAITING_5M_CONFIRMATION: "Waiting for 5-minute confirmation.",
  WEAK_OR_NEUTRAL_TREND: "Trend is weak or neutral.",
  CONFLICTED_DATA: "15M and 5M data did not belong to the same decision window.",
  MISSING_CONFIRMATION: "The latest 5M candle has not confirmed the setup.",
  WAIT_ONLY: "No trade was opened because the setup remained incomplete.",
  STALE_DATA: "Some market data is stale — waiting for a fresh update.",
  STALE: "Some market data is stale — waiting for a fresh update.",
  HARD_CONFLICT: "A hard data or safety conflict is blocking this plan.",
  SOFT_DISAGREEMENT: "Timeframes disagree softly — setup may still be forming.",
  MISSING_REQUIRED_DATA: "Required plan fields are missing, so entry is blocked.",
  MISSING_OPTIONAL_DATA: "Optional context is incomplete — continuing with a freshness caution.",
  OUT_OF_ORDER_DATA: "15M and 5M data did not belong to the same decision window.",
  CONFIRM_PLAN_SOURCE_KEY_MISMATCH: "15M and 5M data did not belong to the same decision window.",
  STOP_TOO_TIGHT: "Stop is too tight for current volatility and spread."
};

export function plainReason(code: string | null | undefined): string {
  if (!code) return "Safety check did not pass.";
  const key = String(code).trim().toUpperCase().replace(/\s+/g, "_");
  if (MAP[key]) return MAP[key];
  // Already plain sentence
  if (/[a-z]/.test(code) && code.includes(" ")) return code;
  return code
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function plainReasons(codes: string[] | null | undefined): string[] {
  if (!codes?.length) return [];
  return [...new Set(codes.map(plainReason))];
}

/** True when a string looks like a developer enum / reason code. */
export function looksLikeReasonCode(text: string): boolean {
  return /^[A-Z][A-Z0-9_]{2,}$/.test(text.trim());
}
