/**
 * Split hard safety/data failures from normal confirmation delays.
 */

export type ConflictClass =
  | "HARD_CONFLICT"
  | "SOFT_DISAGREEMENT"
  | "MISSING_REQUIRED_DATA"
  | "MISSING_OPTIONAL_DATA"
  | "STALE_DATA"
  | "OUT_OF_ORDER_DATA"
  | "NONE";

export type ConflictClassification = {
  class: ConflictClass;
  /** May fully block READY. */
  hardBlock: boolean;
  /** Forming / PREPARE / WATCHING path. */
  formingAllowed: boolean;
  userFacing: string;
  diagnosticCode: string;
};

const HARD_CODES = new Set([
  "PRICE_SOURCE_MISMATCH",
  "TEST_FIXTURE_LEAK",
  "MALFORMED_PAYLOAD",
  "MISSING_PRICE",
  "MISSING_ENTRY",
  "WRONG_SIDE_STOP_LOSS",
  "WRONG_SIDE_TAKE_PROFIT",
  "INVALID_TARGET_ORDER",
  "DUPLICATE_PLAN",
  "NEWS_BLACKOUT",
  "DAILY_LOSS_LIMIT",
  "SPREAD_TOO_HIGH",
  "OUT_OF_ORDER_DATA",
  "CONFIRM_PLAN_SOURCE_KEY_MISMATCH",
  "HARD_CONFLICT"
]);

const REQUIRED_MISSING = new Set([
  "MISSING_REQUIRED_DATA",
  "MISSING_REQUIRED_LEVEL",
  "DIRECTION_NOT_TRADEABLE",
  "CANNOT_DETERMINE_SL"
]);

const STALE_CODES = new Set(["STALE_DATA", "STALE", "QUOTE_STALE", "PLAN_15M_STALE", "CONFIRM_5M_STALE"]);

const SOFT_CODES = new Set([
  "SOFT_DISAGREEMENT",
  "AWAITING_5M_CONFIRMATION",
  "MISSING_CONFIRMATION",
  "STRUCTURE_INCOMPLETE",
  "WEAK_OR_NEUTRAL_TREND",
  "INSUFFICIENT_EVIDENCE",
  "QUICK_TARGET_FAILED",
  "TP1_ROOM_INSUFFICIENT",
  "TP1_RR_INSUFFICIENT"
]);

const OPTIONAL_MISSING = new Set([
  "MISSING_VOLUME_PROFILE",
  "MISSING_OPTIONAL_DATA",
  "MISSING_4H_CONTEXT",
  "INCOMPLETE_DATA"
]);

export const classifyConflictCodes = (codes: string[]): ConflictClassification => {
  const upper = codes.map((c) => String(c).toUpperCase());
  const hit = (set: Set<string>) => upper.find((c) => set.has(c));

  if (hit(HARD_CODES)) {
    const code = hit(HARD_CODES)!;
    return {
      class: code === "CONFIRM_PLAN_SOURCE_KEY_MISMATCH" || code === "OUT_OF_ORDER_DATA"
        ? "OUT_OF_ORDER_DATA"
        : "HARD_CONFLICT",
      hardBlock: true,
      formingAllowed: false,
      userFacing:
        code === "CONFIRM_PLAN_SOURCE_KEY_MISMATCH"
          ? "15M and 5M data did not belong to the same decision window."
          : "A hard data or safety conflict is blocking this plan.",
      diagnosticCode: code
    };
  }
  if (hit(STALE_CODES)) {
    const code = hit(STALE_CODES)!;
    return {
      class: "STALE_DATA",
      hardBlock: code === "QUOTE_STALE" || code === "STALE_DATA",
      formingAllowed: code !== "QUOTE_STALE",
      userFacing: "Some market data is stale — waiting for a fresh update.",
      diagnosticCode: code
    };
  }
  if (hit(REQUIRED_MISSING)) {
    const code = hit(REQUIRED_MISSING)!;
    return {
      class: "MISSING_REQUIRED_DATA",
      hardBlock: true,
      formingAllowed: false,
      userFacing: "Required plan fields are missing, so entry is blocked.",
      diagnosticCode: code
    };
  }
  if (hit(SOFT_CODES)) {
    const code = hit(SOFT_CODES)!;
    return {
      class: "SOFT_DISAGREEMENT",
      hardBlock: false,
      formingAllowed: true,
      userFacing:
        code === "AWAITING_5M_CONFIRMATION" || code === "MISSING_CONFIRMATION"
          ? "The latest 5M candle has not confirmed the setup."
          : "Timeframes disagree softly — setup may still be forming.",
      diagnosticCode: code
    };
  }
  if (hit(OPTIONAL_MISSING)) {
    const code = hit(OPTIONAL_MISSING)!;
    return {
      class: "MISSING_OPTIONAL_DATA",
      hardBlock: false,
      formingAllowed: true,
      userFacing: "Optional context is incomplete — continuing with a freshness caution.",
      diagnosticCode: code
    };
  }
  return {
    class: "NONE",
    hardBlock: false,
    formingAllowed: true,
    userFacing: "No hard conflict detected.",
    diagnosticCode: "NONE"
  };
};
