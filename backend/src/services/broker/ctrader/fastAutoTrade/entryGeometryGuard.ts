/**
 * Final pre-submit geometry check against the freshest executable quote.
 * Does not rebuild strategy SL/TP. Stale geometry is skipped, not "rescued".
 */

export type EntryGeometrySide = "BUY" | "SELL";

export type EntryGeometryInput = {
  side: EntryGeometrySide;
  strategyEntry: number;
  strategyStopLoss: number;
  strategyTakeProfit: number;
  freshExecutionPrice: number;
  /** Existing strategy/settings min R:R — not a newly invented floor. */
  minRiskReward: number;
};

export type EntryGeometryDiagnostics = {
  strategyEntry: number;
  freshExecutionPrice: number;
  entryDrift: number;
  entryDriftR: number | null;
  strategySL: number;
  strategyTP: number;
  actualRiskDistance: number | null;
  actualRewardDistance: number | null;
  actualRR: number | null;
};

export type EntryGeometryResult =
  | { ok: true; code: null; diagnostics: EntryGeometryDiagnostics }
  | {
      ok: false;
      code:
        | "BLOCK_ENTRY_TARGET_ALREADY_PASSED"
        | "BLOCK_ENTRY_DRIFT_EXCESS"
        | "BLOCK_ENTRY_RR_CONSUMED"
        | "BLOCK_ENTRY_GEOMETRY_INVALID"
        | "BLOCK_ENTRY_QUOTE_INVALID";
      diagnostics: EntryGeometryDiagnostics;
    };

function finitePositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function plannedStopDistance(args: {
  side: EntryGeometrySide;
  strategyEntry: number;
  strategyStopLoss: number;
}): number | null {
  if (!finitePositive(args.strategyEntry) || !finitePositive(args.strategyStopLoss)) {
    return null;
  }
  const dist =
    args.side === "BUY"
      ? args.strategyEntry - args.strategyStopLoss
      : args.strategyStopLoss - args.strategyEntry;
  return dist > 0 ? dist : null;
}

export function evaluateEntryGeometryGuard(
  input: EntryGeometryInput
): EntryGeometryResult {
  const plannedRisk = plannedStopDistance(input);
  const drift = input.freshExecutionPrice - input.strategyEntry;
  const entryDriftR =
    plannedRisk != null && plannedRisk > 0
      ? Math.abs(drift) / plannedRisk
      : null;

  const actualRiskDistance =
    input.side === "BUY"
      ? input.freshExecutionPrice - input.strategyStopLoss
      : input.strategyStopLoss - input.freshExecutionPrice;
  const actualRewardDistance =
    input.side === "BUY"
      ? input.strategyTakeProfit - input.freshExecutionPrice
      : input.freshExecutionPrice - input.strategyTakeProfit;
  const actualRR =
    actualRiskDistance > 0 && actualRewardDistance > 0
      ? actualRewardDistance / actualRiskDistance
      : null;

  const diagnostics: EntryGeometryDiagnostics = {
    strategyEntry: input.strategyEntry,
    freshExecutionPrice: input.freshExecutionPrice,
    entryDrift: drift,
    entryDriftR,
    strategySL: input.strategyStopLoss,
    strategyTP: input.strategyTakeProfit,
    actualRiskDistance: Number.isFinite(actualRiskDistance)
      ? actualRiskDistance
      : null,
    actualRewardDistance: Number.isFinite(actualRewardDistance)
      ? actualRewardDistance
      : null,
    actualRR
  };

  if (
    !finitePositive(input.strategyEntry) ||
    !finitePositive(input.strategyStopLoss) ||
    !finitePositive(input.strategyTakeProfit) ||
    !finitePositive(input.freshExecutionPrice)
  ) {
    return { ok: false, code: "BLOCK_ENTRY_QUOTE_INVALID", diagnostics };
  }

  if (input.side === "BUY" && input.freshExecutionPrice >= input.strategyTakeProfit) {
    return { ok: false, code: "BLOCK_ENTRY_TARGET_ALREADY_PASSED", diagnostics };
  }
  if (input.side === "SELL" && input.freshExecutionPrice <= input.strategyTakeProfit) {
    return { ok: false, code: "BLOCK_ENTRY_TARGET_ALREADY_PASSED", diagnostics };
  }

  const directionOk =
    input.side === "BUY"
      ? input.freshExecutionPrice > input.strategyStopLoss &&
        input.freshExecutionPrice < input.strategyTakeProfit
      : input.freshExecutionPrice < input.strategyStopLoss &&
        input.freshExecutionPrice > input.strategyTakeProfit;
  if (!directionOk) {
    return { ok: false, code: "BLOCK_ENTRY_GEOMETRY_INVALID", diagnostics };
  }

  // Drift that consumes a full planned stop (1R) is a stale chase, not a new signal.
  if (entryDriftR != null && entryDriftR >= 1) {
    return { ok: false, code: "BLOCK_ENTRY_DRIFT_EXCESS", diagnostics };
  }

  const minRr =
    Number.isFinite(input.minRiskReward) && input.minRiskReward > 0
      ? input.minRiskReward
      : 1;
  if (actualRR == null || actualRR < minRr) {
    return { ok: false, code: "BLOCK_ENTRY_RR_CONSUMED", diagnostics };
  }

  return { ok: true, code: null, diagnostics };
}

/** Lifecycle fail-closed: strategy TP is already on the wrong side of the fill. */
export function isPostFillTakeProfitInvalid(args: {
  side: EntryGeometrySide;
  actualFill: number;
  takeProfit: number | null | undefined;
}): boolean {
  if (!finitePositive(args.actualFill) || !finitePositive(args.takeProfit)) {
    return false;
  }
  return args.side === "BUY"
    ? args.takeProfit <= args.actualFill
    : args.takeProfit >= args.actualFill;
}
