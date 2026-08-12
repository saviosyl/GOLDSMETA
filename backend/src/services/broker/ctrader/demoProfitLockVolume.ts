/**
 * Exact cumulative partial-size accounting for Demo profit-lock ladder.
 *
 * T1 = 50% of ORIGINAL lots (cumulative)
 * T2 = 80% of ORIGINAL lots (cumulative) → additional ~30%
 * T3 = close remaining (~20%)
 *
 * Never "half of remaining" (that yields 50/25/25).
 */

import {
  PROFIT_LOCK_T1_CUMULATIVE_FRACTION,
  PROFIT_LOCK_T2_CUMULATIVE_FRACTION
} from "./demoProfitLockTypes";
import {
  lotsToValidatedBrokerVolume,
  roundDownLotsToStep
} from "./volumeUnits";

export type VolumeRulesLots = {
  minLots: number;
  maxLots: number;
  stepLots: number;
};

export type CumulativeClosePlan =
  | {
      kind: "ALREADY_SATISFIED";
      desiredCumulativeLots: number;
      alreadyClosedLots: number;
      brokerRemainingLots: number;
    }
  | {
      kind: "CLOSE";
      desiredCumulativeLots: number;
      alreadyClosedLots: number;
      additionalLots: number;
      roundedLots: number;
      orderVolumeUnits: number;
      brokerRemainingLots: number;
    }
  | {
      kind: "SKIP_INVALID";
      reason: string;
      desiredCumulativeLots: number;
      alreadyClosedLots: number;
      additionalLots: number;
      brokerRemainingLots: number;
    };

const LOTS_EPS = 1e-8;

export function desiredCumulativeCloseLots(
  originalLots: number,
  cumulativeFraction: number
): number {
  if (!(originalLots > 0) || !(cumulativeFraction > 0)) return 0;
  return Number((originalLots * cumulativeFraction).toFixed(8));
}

export function brokerClosedLots(
  originalLots: number,
  brokerRemainingLots: number
): number {
  if (!(originalLots > 0)) return 0;
  const rem = Math.max(0, brokerRemainingLots);
  return Number(Math.max(0, originalLots - rem).toFixed(8));
}

/**
 * Plan a partial close against a cumulative target fraction of ORIGINAL size.
 * Uses broker remaining as authority for restart/crash safety.
 */
export function planCumulativePartialClose(args: {
  originalLots: number;
  brokerRemainingLots: number;
  cumulativeFraction: number;
  rules: VolumeRulesLots;
}): CumulativeClosePlan {
  const desired = desiredCumulativeCloseLots(
    args.originalLots,
    args.cumulativeFraction
  );
  const already = brokerClosedLots(
    args.originalLots,
    args.brokerRemainingLots
  );
  const remaining = Math.max(0, args.brokerRemainingLots);

  if (!(desired > 0)) {
    return {
      kind: "SKIP_INVALID",
      reason: "DESIRED_CUMULATIVE_ZERO",
      desiredCumulativeLots: desired,
      alreadyClosedLots: already,
      additionalLots: 0,
      brokerRemainingLots: remaining
    };
  }

  // Broker already closed enough for this cumulative target (restart-safe).
  if (already + LOTS_EPS >= desired || remaining <= LOTS_EPS) {
    return {
      kind: "ALREADY_SATISFIED",
      desiredCumulativeLots: desired,
      alreadyClosedLots: already,
      brokerRemainingLots: remaining
    };
  }

  let additional = Number((desired - already).toFixed(8));
  // Never request more than broker still has open.
  if (additional > remaining) additional = remaining;

  const converted = lotsToValidatedBrokerVolume({
    lots: additional,
    minLots: args.rules.minLots,
    maxLots: args.rules.maxLots,
    stepLots: args.rules.stepLots
  });

  if (!converted.ok || converted.roundedLots == null || converted.orderVolumeUnits == null) {
    return {
      kind: "SKIP_INVALID",
      reason: converted.rejectionReason ?? "VOLUME_INVALID",
      desiredCumulativeLots: desired,
      alreadyClosedLots: already,
      additionalLots: additional,
      brokerRemainingLots: remaining
    };
  }

  // After rounding, ensure we leave a valid remainder OR close all remaining.
  const leave = Number((remaining - converted.roundedLots).toFixed(8));
  if (leave > LOTS_EPS && leave < args.rules.minLots) {
    // Closing this slice would leave an untradeable stub — skip invalid request.
    return {
      kind: "SKIP_INVALID",
      reason: "REMAINDER_BELOW_MIN_VOLUME",
      desiredCumulativeLots: desired,
      alreadyClosedLots: already,
      additionalLots: additional,
      brokerRemainingLots: remaining
    };
  }

  return {
    kind: "CLOSE",
    desiredCumulativeLots: desired,
    alreadyClosedLots: already,
    additionalLots: additional,
    roundedLots: converted.roundedLots,
    orderVolumeUnits: converted.orderVolumeUnits,
    brokerRemainingLots: remaining
  };
}

export function planT1PartialClose(args: {
  originalLots: number;
  brokerRemainingLots: number;
  rules: VolumeRulesLots;
}): CumulativeClosePlan {
  return planCumulativePartialClose({
    ...args,
    cumulativeFraction: PROFIT_LOCK_T1_CUMULATIVE_FRACTION
  });
}

export function planT2PartialClose(args: {
  originalLots: number;
  brokerRemainingLots: number;
  rules: VolumeRulesLots;
}): CumulativeClosePlan {
  return planCumulativePartialClose({
    ...args,
    cumulativeFraction: PROFIT_LOCK_T2_CUMULATIVE_FRACTION
  });
}

/**
 * Close remaining volume for T3 fallback (when broker hard TP did not fill).
 */
export function planRemainderClose(args: {
  brokerRemainingLots: number;
  rules: VolumeRulesLots;
}):
  | { kind: "ALREADY_FLAT" }
  | {
      kind: "CLOSE";
      roundedLots: number;
      orderVolumeUnits: number;
    }
  | { kind: "SKIP_INVALID"; reason: string } {
  const remaining = Math.max(0, args.brokerRemainingLots);
  if (!(remaining > LOTS_EPS)) return { kind: "ALREADY_FLAT" };

  const converted = lotsToValidatedBrokerVolume({
    lots: remaining,
    minLots: args.rules.minLots,
    maxLots: args.rules.maxLots,
    stepLots: args.rules.stepLots
  });
  if (!converted.ok || converted.roundedLots == null || converted.orderVolumeUnits == null) {
    // If remaining is below min after round-down, try exact remaining if it is a valid step multiple.
    const stepped = roundDownLotsToStep(remaining, args.rules.stepLots);
    if (Math.abs(stepped - remaining) < LOTS_EPS && remaining >= args.rules.minLots) {
      const retry = lotsToValidatedBrokerVolume({
        lots: remaining,
        minLots: args.rules.minLots,
        maxLots: args.rules.maxLots,
        stepLots: args.rules.stepLots
      });
      if (retry.ok && retry.roundedLots != null && retry.orderVolumeUnits != null) {
        return {
          kind: "CLOSE",
          roundedLots: retry.roundedLots,
          orderVolumeUnits: retry.orderVolumeUnits
        };
      }
    }
    return {
      kind: "SKIP_INVALID",
      reason: converted.rejectionReason ?? "VOLUME_INVALID"
    };
  }
  return {
    kind: "CLOSE",
    roundedLots: converted.roundedLots,
    orderVolumeUnits: converted.orderVolumeUnits
  };
}
