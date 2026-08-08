/**
 * Central trade-plan geometry validator.
 *
 * Hard blockers → not actionable (NO_VALID_PLAN / NO_TRADE).
 * Soft limitations → actionable levels preserved (WAITING / ARMED / etc.).
 *
 * Analysis only — never submits broker orders.
 */

import { planRiskConfig } from "../../config/planRiskConfig";
import { isPositivePrice, roundPrice } from "../../utils/money";

export type GeometryDirection = "BUY" | "SELL";

export type GeometryReasonCode =
  | "ENTRY_EQUALS_STOP"
  | "STOP_WRONG_SIDE"
  | "TP1_WRONG_SIDE"
  | "TP1_EQUALS_ENTRY"
  | "ZERO_RISK"
  | "INVALID_TARGET_ORDER"
  | "MISSING_REQUIRED_LEVEL"
  | "PRICE_ALREADY_AT_TARGET"
  | "INVALIDATION_STOP_MISMATCH"
  | "QUICK_TARGET_FAILED"
  | "STRUCTURE_INCOMPLETE"
  | "STRUCTURE_MISMATCH"
  | "ENTRY_ZONE_INVALID"
  | "DIRECTION_NOT_TRADEABLE"
  | "STOP_DISTANCE_OUT_OF_RANGE"
  | "TP1_ROOM_INSUFFICIENT"
  | "TP1_RR_INSUFFICIENT"
  | "STALE_REQUIRED_DATA";

/** Soft codes never erase an otherwise valid Entry/Stop/TP1 plan. */
export const SOFT_GEOMETRY_CODES: ReadonlySet<GeometryReasonCode> = new Set([
  "QUICK_TARGET_FAILED",
  "STRUCTURE_INCOMPLETE",
  "INVALID_TARGET_ORDER", // only when caused by optional TP2 — handled separately
  "TP1_ROOM_INSUFFICIENT",
  "TP1_RR_INSUFFICIENT"
]);

export const HARD_GEOMETRY_CODES: ReadonlySet<GeometryReasonCode> = new Set([
  "ENTRY_EQUALS_STOP",
  "STOP_WRONG_SIDE",
  "TP1_WRONG_SIDE",
  "TP1_EQUALS_ENTRY",
  "ZERO_RISK",
  "MISSING_REQUIRED_LEVEL",
  "PRICE_ALREADY_AT_TARGET",
  "INVALIDATION_STOP_MISMATCH",
  "STRUCTURE_MISMATCH",
  "ENTRY_ZONE_INVALID",
  "DIRECTION_NOT_TRADEABLE",
  "STOP_DISTANCE_OUT_OF_RANGE",
  "STALE_REQUIRED_DATA"
]);

export type GeometryInput = {
  direction: string | null | undefined;
  entryPrice?: number | null;
  entryZoneLow?: number | null;
  entryZoneHigh?: number | null;
  stop?: number | null;
  tp1?: number | null;
  tp2?: number | null;
  currentPrice?: number | null;
  /** Display invalidation sentence — must agree with numeric stop when both present. */
  invalidationText?: string | null;
  quickTargetOk?: boolean | null;
  marketStructureMode?: string | null;
  /** When true, confirmation already passed — late entry / past TP1 is fatal. */
  confirmed?: boolean;
  /** Absolute epsilon for near-equality (XAUUSD points). */
  epsilon?: number;
  /** When true, required market data is stale. */
  staleRequiredData?: boolean;
};

export type GeometryResult = {
  valid: boolean;
  /** True when hard geometry is safe — soft limitations may still be listed. */
  actionable: boolean;
  reasonCodes: GeometryReasonCode[];
  softReasonCodes: GeometryReasonCode[];
  hardReasonCodes: GeometryReasonCode[];
  primaryReason: GeometryReasonCode | null;
  message: string;
  normalized: {
    direction: GeometryDirection | null;
    entryPrice: number | null;
    entryZoneLow: number | null;
    entryZoneHigh: number | null;
    stop: number | null;
    tp1: number | null;
    tp2: number | null;
    riskDistance: number | null;
    rewardDistance: number | null;
    riskReward: number | null;
  };
};

const DEFAULT_EPS = planRiskConfig.geometryEpsilonPoints;

const pos = (n: unknown): number | null =>
  typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;

const near = (a: number, b: number, eps: number): boolean => Math.abs(a - b) <= eps;

/**
 * Extract a plausible XAU price from free text for invalidation/stop agreement checks.
 * Prefers the last number in typical gold range (1000–10000).
 */
export const extractPriceFromText = (text: string | null | undefined): number | null => {
  if (!text) return null;
  const matches = String(text).match(/\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+\.\d+/g);
  if (!matches?.length) return null;
  for (let i = matches.length - 1; i >= 0; i--) {
    const n = Number(String(matches[i]).replace(/,/g, ""));
    if (Number.isFinite(n) && n >= 1000 && n <= 10000) return roundPrice(n);
  }
  const last = Number(String(matches[matches.length - 1]).replace(/,/g, ""));
  return Number.isFinite(last) && last > 0 ? roundPrice(last) : null;
};

/** Format XAUUSD price for user-facing copy — always thousands separators, 2 dp. */
export const formatXauPrice = (price: number | null | undefined): string => {
  if (!isPositivePrice(price)) return "—";
  return roundPrice(price).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

/** Build invalidation sentence that always uses the exact numeric stop. */
export const buildInvalidationSentence = (
  direction: GeometryDirection | null,
  stop: number | null
): string | null => {
  if (stop == null || !direction) return null;
  const p = formatXauPrice(stop);
  if (direction === "BUY") {
    return `Break and hold below ${p} ends the immediate plan (stop / invalidation).`;
  }
  return `Break and hold above ${p} ends the immediate plan (stop / invalidation).`;
};

export const validateTradePlanGeometry = (input: GeometryInput): GeometryResult => {
  const eps = input.epsilon ?? DEFAULT_EPS;
  const reasons: GeometryReasonCode[] = [];
  const dirRaw = String(input.direction ?? "").toUpperCase();
  const direction: GeometryDirection | null =
    dirRaw === "BUY" || dirRaw === "SELL" ? dirRaw : null;

  const mode = String(input.marketStructureMode ?? "").toUpperCase();
  if (mode === "MISMATCH") reasons.push("STRUCTURE_MISMATCH");
  // Incomplete optional profile / live-range-only is a soft limitation when levels exist.
  if (mode === "UNAVAILABLE" || mode === "LIVE_RANGE_ONLY") {
    reasons.push("STRUCTURE_INCOMPLETE");
  }
  if (input.staleRequiredData) {
    reasons.push("STALE_REQUIRED_DATA");
  }

  if (!direction) {
    reasons.push("DIRECTION_NOT_TRADEABLE");
  }

  // Single-price entry: zoneLow/zoneHigh collapse to entryPrice.
  let entryPrice = pos(input.entryPrice);
  let zoneLow = pos(input.entryZoneLow);
  let zoneHigh = pos(input.entryZoneHigh);
  if (entryPrice != null && zoneLow == null && zoneHigh == null) {
    zoneLow = entryPrice;
    zoneHigh = entryPrice;
  }
  if (entryPrice == null && zoneLow != null && zoneHigh != null) {
    entryPrice = roundPrice((zoneLow + zoneHigh) / 2);
  }
  if (entryPrice == null && zoneLow != null) {
    entryPrice = zoneLow;
    zoneHigh = zoneHigh ?? zoneLow;
  }
  if (entryPrice == null && zoneHigh != null) {
    entryPrice = zoneHigh;
    zoneLow = zoneLow ?? zoneHigh;
  }
  if (zoneLow != null && zoneHigh != null && zoneLow > zoneHigh) {
    reasons.push("ENTRY_ZONE_INVALID");
    const tmp = zoneLow;
    zoneLow = zoneHigh;
    zoneHigh = tmp;
  }

  const stop = pos(input.stop);
  const tp1 = pos(input.tp1);
  const tp2 = pos(input.tp2);
  const current = pos(input.currentPrice);

  if (entryPrice == null || stop == null || tp1 == null) {
    reasons.push("MISSING_REQUIRED_LEVEL");
  }

  let riskDistance: number | null = null;
  let rewardDistance: number | null = null;
  let riskReward: number | null = null;
  if (entryPrice != null && stop != null) {
    riskDistance = Math.abs(entryPrice - stop);
    if (riskDistance <= eps) {
      reasons.push("ENTRY_EQUALS_STOP");
      reasons.push("ZERO_RISK");
    } else if (
      riskDistance < planRiskConfig.minStopDistancePoints ||
      riskDistance > planRiskConfig.maxStopDistancePoints
    ) {
      reasons.push("STOP_DISTANCE_OUT_OF_RANGE");
    }
  }
  if (entryPrice != null && tp1 != null) {
    rewardDistance = Math.abs(tp1 - entryPrice);
    if (rewardDistance + eps < planRiskConfig.minTp1DistancePoints) {
      reasons.push("TP1_ROOM_INSUFFICIENT");
    }
    if (riskDistance != null && riskDistance > eps) {
      riskReward = rewardDistance / riskDistance;
      if (riskReward + 1e-9 < planRiskConfig.minTp1RiskReward) {
        reasons.push("TP1_RR_INSUFFICIENT");
      }
    }
  }

  if (direction === "BUY" && entryPrice != null && stop != null && tp1 != null) {
    // BUY: stop < entryZoneLow <= entryPrice <= entryZoneHigh < TP1 ; TP2 optional and >= TP1
    const low = zoneLow ?? entryPrice;
    const high = zoneHigh ?? entryPrice;
    if (!(stop < low - eps / 2)) reasons.push("STOP_WRONG_SIDE");
    if (!(entryPrice + eps / 2 < tp1)) {
      if (near(entryPrice, tp1, eps)) reasons.push("TP1_EQUALS_ENTRY");
      else reasons.push("TP1_WRONG_SIDE");
    }
    if (!(low - eps <= entryPrice && entryPrice <= high + eps)) {
      reasons.push("ENTRY_ZONE_INVALID");
    }
    if (!(high + eps / 2 < tp1)) {
      if (!reasons.includes("TP1_WRONG_SIDE") && !reasons.includes("TP1_EQUALS_ENTRY")) {
        reasons.push("TP1_WRONG_SIDE");
      }
    }
    // Optional TP2: only validate order when present — never require TP2.
    if (tp2 != null && tp2 + eps < tp1) reasons.push("INVALID_TARGET_ORDER");
    if (!input.confirmed && current != null && current >= tp1 - eps) {
      reasons.push("PRICE_ALREADY_AT_TARGET");
    }
  }

  if (direction === "SELL" && entryPrice != null && stop != null && tp1 != null) {
    // SELL: TP1 < entryZoneLow <= entryPrice <= entryZoneHigh < stop ; TP2 optional and <= TP1
    const low = zoneLow ?? entryPrice;
    const high = zoneHigh ?? entryPrice;
    if (!(high + eps / 2 < stop)) reasons.push("STOP_WRONG_SIDE");
    if (!(tp1 + eps / 2 < low)) {
      if (near(entryPrice, tp1, eps)) reasons.push("TP1_EQUALS_ENTRY");
      else reasons.push("TP1_WRONG_SIDE");
    }
    if (!(low - eps <= entryPrice && entryPrice <= high + eps)) {
      reasons.push("ENTRY_ZONE_INVALID");
    }
    if (tp2 != null && tp2 - eps > tp1) reasons.push("INVALID_TARGET_ORDER");
    if (!input.confirmed && current != null && current <= tp1 + eps) {
      reasons.push("PRICE_ALREADY_AT_TARGET");
    }
  }

  // Soft: quick-target failure must not erase a valid engine TP1.
  if (input.quickTargetOk === false && direction) {
    reasons.push("QUICK_TARGET_FAILED");
  }

  if (stop != null && input.invalidationText) {
    const fromText = extractPriceFromText(input.invalidationText);
    if (fromText != null && !near(fromText, stop, Math.max(eps, 0.15))) {
      reasons.push("INVALIDATION_STOP_MISMATCH");
    }
  }

  const unique = [...new Set(reasons)];
  // Optional TP2 order issues are soft when TP1 geometry is otherwise valid.
  const hardReasonCodes = unique.filter((c) => {
    if (c === "INVALID_TARGET_ORDER" && tp1 != null && entryPrice != null && stop != null) {
      return false;
    }
    if (c === "TP1_ROOM_INSUFFICIENT" || c === "TP1_RR_INSUFFICIENT") {
      // Soft caution — do not wipe levels; UI can show cautious status.
      return false;
    }
    if (c === "STRUCTURE_INCOMPLETE" || c === "QUICK_TARGET_FAILED") return false;
    return HARD_GEOMETRY_CODES.has(c);
  });
  const softReasonCodes = unique.filter((c) => !hardReasonCodes.includes(c));

  const hasLevels =
    direction != null && entryPrice != null && stop != null && tp1 != null;
  const actionable = hasLevels && hardReasonCodes.length === 0;

  const primaryReason = hardReasonCodes[0] ?? softReasonCodes[0] ?? null;
  const message = !actionable
    ? "Trade levels failed safety validation."
    : softReasonCodes.length
      ? "Valid plan — waiting (soft limitations present)."
      : "Trade plan geometry is valid.";

  return {
    valid: actionable,
    actionable,
    reasonCodes: unique.length ? unique : [],
    softReasonCodes,
    hardReasonCodes,
    primaryReason: actionable ? softReasonCodes[0] ?? null : primaryReason,
    message,
    normalized: {
      direction,
      entryPrice: entryPrice != null ? roundPrice(entryPrice) : null,
      entryZoneLow: zoneLow != null ? roundPrice(zoneLow) : null,
      entryZoneHigh: zoneHigh != null ? roundPrice(zoneHigh) : null,
      stop: stop != null ? roundPrice(stop) : null,
      tp1: tp1 != null ? roundPrice(tp1) : null,
      tp2: tp2 != null ? roundPrice(tp2) : null,
      riskDistance: riskDistance != null ? roundPrice(riskDistance) : null,
      rewardDistance: rewardDistance != null ? roundPrice(rewardDistance) : null,
      riskReward: riskReward != null ? roundPrice(riskReward) : null
    }
  };
};

/**
 * Authoritative 5M confirmation for a plan direction.
 * A bearish rejection must not confirm a bullish long plan (and vice versa)
 * unless explicitly classified as a supportive rejection from verified support/resistance.
 */
export const resolveAuthoritativeConfirmation = (args: {
  confirmationState: string | null | undefined;
  direction: string | null | undefined;
  candleClassification?: string | null;
}): {
  state: string;
  label: string;
  meaningful: boolean;
  supportsPlan: boolean;
  detail: string;
} => {
  const raw = String(args.confirmationState ?? args.candleClassification ?? "NONE").toUpperCase();
  const direction = String(args.direction ?? "").toUpperCase();
  const state = raw.replace(/\s+/g, "_");

  const isRejection = state.includes("REJECTION");
  const isBreakout = state.includes("BREAKOUT");
  const isFailed = state.includes("FAILED") || state.includes("INVALID");
  const isHeld = state.includes("HELD") || state.includes("CONFIRMED");
  const isPending =
    !state ||
    state === "NONE" ||
    state === "OUTSIDE_ZONE" ||
    state === "APPROACHING_ZONE" ||
    state === "INSIDE_ZONE" ||
    state === "CANDLE_FORMING" ||
    state === "RETEST_PENDING";

  let supportsPlan = false;
  if (direction === "BUY") {
    supportsPlan =
      (isBreakout || (isHeld && !isRejection)) &&
      !isFailed &&
      !state.includes("BEARISH");
    if (state.includes("BULLISH") && isRejection && !isFailed) supportsPlan = true;
  } else if (direction === "SELL") {
    supportsPlan =
      (isRejection || (isHeld && !isBreakout) || state.includes("BEARISH")) &&
      !isFailed &&
      !state.includes("BULLISH_BREAKOUT");
  }

  if (isPending) {
    return {
      state: state || "NONE",
      label: "Pending",
      meaningful: false,
      supportsPlan: false,
      detail: "Waiting for a meaningful 5-minute confirmation state."
    };
  }

  if (isRejection && direction === "BUY" && !state.includes("BULLISH")) {
    return {
      state: "CONFIRMATION_FAILED",
      label: "Rejection — does not confirm long",
      meaningful: true,
      supportsPlan: false,
      detail:
        "Bearish rejection cannot confirm a bullish plan unless classified as bullish rejection from verified support."
    };
  }

  if (isBreakout && direction === "SELL" && !state.includes("BEARISH")) {
    return {
      state: "CONFIRMATION_FAILED",
      label: "Breakout — does not confirm short",
      meaningful: true,
      supportsPlan: false,
      detail: "Bullish breakout cannot confirm a bearish plan."
    };
  }

  return {
    state,
    label: state.replace(/_/g, " "),
    meaningful: true,
    supportsPlan,
    detail: supportsPlan
      ? `5M confirmation supports the ${direction || "current"} plan.`
      : `5M state ${state.replace(/_/g, " ")} does not confirm the plan.`
  };
};

/**
 * True when quality grade must not be shown as an actionable BUY/SELL plan.
 * Grade B with soft awaiting-confirmation / incomplete optional profile remains actionable.
 */
export const isNonActionableQuality = (
  grade: string | null | undefined,
  reasons: string[] = []
): boolean => {
  const g = String(grade ?? "").toUpperCase();
  if (g === "C") return true;
  if (g === "NO_PLAN") {
    // Only hard NO_PLAN reasons block; soft incompleteness is handled by grade B.
    const hard = reasons.some((r) =>
      /PRICE_SOURCE_MISMATCH|CHART_ROLE_MISMATCH|MISSING_REQUIRED_LEVEL|DIRECTION_NOT_TRADEABLE|NO_TRADE/i.test(
        r
      )
    );
    return hard || reasons.length === 0;
  }
  if (
    reasons.some((r) =>
      /PRICE_SOURCE_MISMATCH|CHART_ROLE_MISMATCH/i.test(r)
    )
  ) {
    return true;
  }
  return false;
};
