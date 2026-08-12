/**
 * Irreversible stop rules + broker-safe buffer for Demo profit-lock ladder.
 * SL amendments must preserve broker hard TP = TP3 whenever TP3 exists.
 * Buffer consumes only normalized PRICE stop distance — never raw slDistance.
 */

import type { ProfitLockProtectionLevel } from "./demoProfitLockTypes";
import { PROFIT_LOCK_PROTECTION_RANK } from "./demoProfitLockTypes";
import { normalizeSlDistanceToPrice } from "./ctraderStopDistance";

export type StopBufferInputs = {
  /** Already-normalized price distance (preferred). */
  normalizedMinStopPriceDistance?: number | null;
  /** Raw ProtoOASymbol.slDistance + distanceSetIn when normalized not precomputed. */
  rawSlDistance?: number | null;
  distanceSetIn?: string | number | null;
  digits?: number | null | undefined;
  /** Reference price for PERCENTAGE distance mode. */
  referencePrice?: number | null;
  /** Current executable spread (price units). */
  spread: number | null | undefined;
  /** Symbol tick size. */
  tickSize: number | null | undefined;
};

export type StopBufferResult =
  | { ok: true; buffer: number }
  | { ok: false; reason: "STOP_DISTANCE_NORMALIZATION_UNAVAILABLE" };

/**
 * Broker-derived safety buffer for placing SL near a TP level.
 * Never an arbitrary fixed XAUUSD dollar amount.
 */
export function computeBrokerSafeStopBuffer(
  input: StopBufferInputs
): StopBufferResult {
  let normalizedStop: number | null = null;
  if (
    typeof input.normalizedMinStopPriceDistance === "number" &&
    Number.isFinite(input.normalizedMinStopPriceDistance) &&
    input.normalizedMinStopPriceDistance > 0
  ) {
    normalizedStop = input.normalizedMinStopPriceDistance;
  } else if (input.rawSlDistance != null) {
    const norm = normalizeSlDistanceToPrice({
      rawSlDistance: input.rawSlDistance,
      distanceSetIn: input.distanceSetIn,
      digits: input.digits,
      referencePrice: input.referencePrice
    });
    if (!norm.ok) {
      return { ok: false, reason: "STOP_DISTANCE_NORMALIZATION_UNAVAILABLE" };
    }
    normalizedStop = norm.normalizedMinStopPriceDistance;
  } else {
    // Without proven stop-distance metadata, fail closed (keep BE).
    return { ok: false, reason: "STOP_DISTANCE_NORMALIZATION_UNAVAILABLE" };
  }

  const candidates: number[] = [normalizedStop];
  if (
    typeof input.spread === "number" &&
    Number.isFinite(input.spread) &&
    input.spread > 0
  ) {
    candidates.push(input.spread);
  }
  if (
    typeof input.tickSize === "number" &&
    Number.isFinite(input.tickSize) &&
    input.tickSize > 0
  ) {
    candidates.push(input.tickSize);
  } else if (
    typeof input.digits === "number" &&
    Number.isFinite(input.digits) &&
    input.digits >= 0 &&
    input.digits <= 8
  ) {
    candidates.push(Math.pow(10, -input.digits));
  }
  return { ok: true, buffer: Math.max(...candidates) };
}

export function proposeProtectedStop(args: {
  side: "BUY" | "SELL";
  level: number;
  buffer: number;
}): number {
  return args.side === "BUY"
    ? Number((args.level - args.buffer).toFixed(8))
    : Number((args.level + args.buffer).toFixed(8));
}

/**
 * Irreversible SL rule (strict improvement for amendments):
 * BUY: newSL > currentSL
 * SELL: newSL < currentSL
 */
export function isStopImprovement(args: {
  side: "BUY" | "SELL";
  currentSl: number | null | undefined;
  proposedSl: number;
}): boolean {
  if (!Number.isFinite(args.proposedSl)) return false;
  if (args.currentSl == null || !Number.isFinite(args.currentSl)) return true;
  if (args.side === "BUY") {
    return args.proposedSl > args.currentSl + 1e-12;
  }
  return args.proposedSl < args.currentSl - 1e-12;
}

/** True when proposed does not loosen the stop (equal allowed). */
export function isStopNotWorse(args: {
  side: "BUY" | "SELL";
  currentSl: number | null | undefined;
  proposedSl: number;
}): boolean {
  if (!Number.isFinite(args.proposedSl)) return false;
  if (args.currentSl == null || !Number.isFinite(args.currentSl)) return true;
  if (args.side === "BUY") {
    return args.proposedSl + 1e-12 >= args.currentSl;
  }
  return args.proposedSl - 1e-12 <= args.currentSl;
}

export function selectStopIfImproved(args: {
  side: "BUY" | "SELL";
  currentSl: number | null | undefined;
  proposedSl: number | null;
}): number | null {
  if (args.proposedSl == null || !Number.isFinite(args.proposedSl)) return null;
  if (
    !isStopImprovement({
      side: args.side,
      currentSl: args.currentSl,
      proposedSl: args.proposedSl
    })
  ) {
    return null;
  }
  return args.proposedSl;
}

/**
 * Take-profit value to send on SL amendments when the ladder is active.
 * Always preserve TP3 when present — never accidentally rewrite to TP1.
 */
export function brokerHardTakeProfitForAmend(args: {
  tp3: number | null | undefined;
  brokerHardTakeProfit?: number | null | undefined;
}): number | undefined {
  const hard =
    args.brokerHardTakeProfit != null &&
    Number.isFinite(args.brokerHardTakeProfit)
      ? args.brokerHardTakeProfit
      : args.tp3 != null && Number.isFinite(args.tp3)
        ? args.tp3
        : null;
  return hard != null ? hard : undefined;
}

export function mayRaiseProtection(
  current: ProfitLockProtectionLevel,
  next: ProfitLockProtectionLevel
): boolean {
  return PROFIT_LOCK_PROTECTION_RANK[next] >= PROFIT_LOCK_PROTECTION_RANK[current];
}

/** Broker SL is at least as protective as requested. */
export function brokerSlConfirmsRequested(args: {
  side: "BUY" | "SELL";
  brokerSl: number | null | undefined;
  requestedSl: number;
}): boolean {
  if (args.brokerSl == null || !Number.isFinite(args.brokerSl)) return false;
  return isStopNotWorse({
    side: args.side,
    currentSl: args.requestedSl,
    proposedSl: args.brokerSl
  }) || Math.abs(args.brokerSl - args.requestedSl) < 1e-6;
}

/** Broker hard TP still equals expected TP3. */
export function brokerTp3Preserved(args: {
  brokerTp: number | null | undefined;
  expectedTp3: number | null | undefined;
}): boolean {
  if (args.expectedTp3 == null || !Number.isFinite(args.expectedTp3)) {
    return true;
  }
  if (args.brokerTp == null || !Number.isFinite(args.brokerTp)) return false;
  return Math.abs(args.brokerTp - args.expectedTp3) < 1e-6;
}
