import type { ManualRiskSettings, SetupRecord } from "../types/models";

export interface RiskPlanInput {
  currency: "EUR" | "USD" | "GBP";
  maxCashRisk: number;
  entryPrice: number | null;
  stopLossPrice: number | null;
  instrument: string;
  estimatedSpreadPoints: number | null;
  valuePerPoint: number | null;
  manualPositionSize: number | null;
  actualFillPrice: number | null;
}

export interface RiskPlanEstimate {
  stopDistance: number | null;
  intendedMaxLoss: number;
  estimatedPositionSize: number | null;
  estimatedSpreadCost: number | null;
  estimatedTotalRisk: number | null;
  exceedsMaxRisk: boolean;
  missingValuePerPoint: boolean;
  missingSpread: boolean;
  estimateOnly: true;
  warnings: string[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Pure calculator — never calls a broker. All sizes are estimates until user confirms in IG. */
export function estimateManualRisk(input: RiskPlanInput): RiskPlanEstimate {
  const warnings: string[] = [];
  const entry = input.actualFillPrice ?? input.entryPrice;
  const stop = input.stopLossPrice;
  const stopDistance =
    entry != null && stop != null && Number.isFinite(entry) && Number.isFinite(stop)
      ? Math.abs(entry - stop)
      : null;

  const missingValuePerPoint = input.valuePerPoint == null || input.valuePerPoint <= 0;
  const missingSpread = input.estimatedSpreadPoints == null;

  if (missingValuePerPoint) {
    warnings.push(
      "Value-per-point is not set. Enter your broker’s point value — GoldMeta does not guess IG contract specs."
    );
  }
  if (missingSpread) {
    warnings.push("Spread data unavailable — enter an estimated spread or confirm in the broker ticket.");
  }

  let estimatedPositionSize: number | null = null;
  if (input.manualPositionSize != null && input.manualPositionSize > 0) {
    estimatedPositionSize = input.manualPositionSize;
  } else if (
    !missingValuePerPoint &&
    stopDistance != null &&
    stopDistance > 0 &&
    input.valuePerPoint != null
  ) {
    estimatedPositionSize = round2(input.maxCashRisk / (stopDistance * input.valuePerPoint));
  }

  let estimatedSpreadCost: number | null = null;
  if (
    estimatedPositionSize != null &&
    !missingValuePerPoint &&
    input.estimatedSpreadPoints != null &&
    input.valuePerPoint != null
  ) {
    estimatedSpreadCost = round2(
      input.estimatedSpreadPoints * input.valuePerPoint * estimatedPositionSize
    );
  }

  let estimatedTotalRisk: number | null = null;
  if (
    estimatedPositionSize != null &&
    stopDistance != null &&
    !missingValuePerPoint &&
    input.valuePerPoint != null
  ) {
    const stopRisk = stopDistance * input.valuePerPoint * estimatedPositionSize;
    estimatedTotalRisk = round2(stopRisk + (estimatedSpreadCost ?? 0));
  }

  const exceedsMaxRisk =
    estimatedTotalRisk != null && estimatedTotalRisk > input.maxCashRisk + 0.01;

  if (exceedsMaxRisk) {
    warnings.push(
      `Estimated total risk exceeds your ${input.currency} ${input.maxCashRisk} maximum.`
    );
  }

  if (
    !missingValuePerPoint &&
    stopDistance != null &&
    stopDistance > 0 &&
    input.valuePerPoint != null &&
    estimatedPositionSize != null &&
    estimatedPositionSize < 0.01
  ) {
    warnings.push(
      "Broker minimum size may make your €20 (or configured) max risk impossible — confirm on the order ticket."
    );
  }

  return {
    stopDistance: stopDistance != null ? round2(stopDistance) : null,
    intendedMaxLoss: input.maxCashRisk,
    estimatedPositionSize,
    estimatedSpreadCost,
    estimatedTotalRisk,
    exceedsMaxRisk,
    missingValuePerPoint,
    missingSpread,
    estimateOnly: true,
    warnings
  };
}

export interface DailyManualRiskStatus {
  currency: string;
  maxCashRiskPerTrade: number;
  maxDailyRealisedLoss: number;
  stopAfterConsecutiveLosses: number;
  maxSimultaneousManualTrades: number;
  todayRealisedPnl: number;
  openManualTrades: number;
  consecutiveLosses: number;
  stopTradingToday: boolean;
  reasons: string[];
}

const startOfLocalDayIso = (d = new Date()): string => {
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return local.toISOString();
};

/** Derive daily manual-risk status from journaled setups (never mixes system R). */
export function computeDailyManualRiskStatus(
  setups: SetupRecord[],
  risk: ManualRiskSettings
): DailyManualRiskStatus {
  const dayStart = startOfLocalDayIso();
  const reasons: string[] = [];

  const withManual = setups.filter((s) => s.manualExecution != null);
  const todayClosed = withManual.filter((s) => {
    const at = s.manualExecution?.tradedAt ?? s.manualExecution?.updatedAt;
    return at != null && at >= dayStart && s.manualExecution?.actualPnl != null;
  });
  const todayRealisedPnl = todayClosed.reduce(
    (sum, s) => sum + (s.manualExecution?.actualPnl ?? 0),
    0
  );

  const openManualTrades = withManual.filter((s) => {
    const a = s.manualExecution?.action;
    return (
      (a === "ENTERED" || a === "ENTERED_LATE") &&
      s.manualExecution?.actualExitPrice == null &&
      s.manualExecution?.actualPnl == null
    );
  }).length;

  const ordered = [...withManual]
    .filter((s) => s.manualExecution?.actualPnl != null)
    .sort((a, b) =>
      (a.manualExecution?.tradedAt ?? a.manualExecution?.updatedAt ?? "").localeCompare(
        b.manualExecution?.tradedAt ?? b.manualExecution?.updatedAt ?? ""
      )
    );
  let consecutiveLosses = 0;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const pnl = ordered[i]?.manualExecution?.actualPnl ?? 0;
    if (pnl < 0) consecutiveLosses += 1;
    else break;
  }

  if (todayRealisedPnl <= -Math.abs(risk.maxDailyRealisedLoss)) {
    reasons.push(
      `Daily realised loss ${round2(todayRealisedPnl)} reached limit −${risk.maxDailyRealisedLoss}.`
    );
  }
  if (consecutiveLosses >= risk.stopAfterConsecutiveLosses) {
    reasons.push(
      `${consecutiveLosses} consecutive manual losses (stop after ${risk.stopAfterConsecutiveLosses}).`
    );
  }
  if (openManualTrades >= risk.maxSimultaneousManualTrades) {
    reasons.push(
      `${openManualTrades} open manual trade(s) — max simultaneous is ${risk.maxSimultaneousManualTrades}.`
    );
  }

  return {
    currency: risk.currency,
    maxCashRiskPerTrade: risk.maxCashRiskPerTrade,
    maxDailyRealisedLoss: risk.maxDailyRealisedLoss,
    stopAfterConsecutiveLosses: risk.stopAfterConsecutiveLosses,
    maxSimultaneousManualTrades: risk.maxSimultaneousManualTrades,
    todayRealisedPnl: round2(todayRealisedPnl),
    openManualTrades,
    consecutiveLosses,
    stopTradingToday: reasons.length > 0,
    reasons
  };
}
