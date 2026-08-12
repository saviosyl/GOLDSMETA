/**
 * Irreversible stop rules + broker-safe buffer for Demo profit-lock ladder.
 * SL amendments must preserve broker hard TP = TP3 whenever TP3 exists.
 */

import type { ProfitLockProtectionLevel } from "./demoProfitLockTypes";
import { PROFIT_LOCK_PROTECTION_RANK } from "./demoProfitLockTypes";

export type StopBufferInputs = {
  /** Broker symbol min stop distance (price units). */
  minStopDistance: number | null | undefined;
  /** Current executable spread (price units). */
  spread: number | null | undefined;
  /** Symbol tick size. */
  tickSize: number | null | undefined;
  /** Symbol digits — used to derive tick when tickSize missing. */
  digits: number | null | undefined;
};

/**
 * Broker-derived safety buffer for placing SL near a TP level.
 * Never an arbitrary fixed XAUUSD dollar amount.
 */
export function computeBrokerSafeStopBuffer(input: StopBufferInputs): number | null {
  const candidates: number[] = [];
  if (
    typeof input.minStopDistance === "number" &&
    Number.isFinite(input.minStopDistance) &&
    input.minStopDistance > 0
  ) {
    candidates.push(input.minStopDistance);
  }
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
  if (candidates.length === 0) return null;
  // One full buffer unit past the level — enough for spread/min-stop rejection.
  return Math.max(...candidates);
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
 * Equal stops are treated as already protected (no amend / no worsen).
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
  if (!isStopImprovement(args as {
    side: "BUY" | "SELL";
    currentSl: number | null | undefined;
    proposedSl: number;
  })) {
    return null;
  }
  return args.proposedSl;
}

/**
 * Take-profit value to send on SL amendments when the ladder is active.
 * Always preserve TP3 when present — never accidentally rewrite to TP1.
 * Returns `undefined` to omit the field (leave broker TP unchanged) when TP3 missing.
 */
export function brokerHardTakeProfitForAmend(args: {
  tp3: number | null | undefined;
  brokerHardTakeProfit?: number | null | undefined;
}): number | undefined {
  const hard =
    args.brokerHardTakeProfit != null && Number.isFinite(args.brokerHardTakeProfit)
      ? args.brokerHardTakeProfit
      : args.tp3 != null && Number.isFinite(args.tp3)
        ? args.tp3
        : null;
  return hard != null ? hard : undefined;
}

export function protectionLevelForStopTarget(
  target: "BE" | "TP1" | "TP2"
): ProfitLockProtectionLevel {
  return target;
}

export function mayRaiseProtection(
  current: ProfitLockProtectionLevel,
  next: ProfitLockProtectionLevel
): boolean {
  return PROFIT_LOCK_PROTECTION_RANK[next] >= PROFIT_LOCK_PROTECTION_RANK[current];
}
