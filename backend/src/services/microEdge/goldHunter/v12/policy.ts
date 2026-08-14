/**
 * V1.2 entry architectures + adaptive-rank policy config.
 */
import type { V12ArchitectureId, V12ExitArchitecture, V12ModelFamily } from "./versions";
import type { AdaptivePercentile, AdaptiveRankWindowSec } from "./adaptiveRank";
import type { V12Regime } from "./regimes";
import type { V12ExitConfig } from "./exits";

export type V12HorizonScores = {
  /** Primary microstructure horizon score (BUY). */
  buyPrimary: number;
  sellPrimary: number;
  buyContext: number;
  sellContext: number;
  pOpportunity: number;
  expectedAbsEdge: number;
};

export type V12PolicyConfig = {
  family: V12ModelFamily;
  architecture: V12ArchitectureId;
  primaryHorizonSec: number;
  contextHorizonSec: number;
  rankWindowSec: AdaptiveRankWindowSec;
  rankPercentile: AdaptivePercentile;
  /** Cold-start absolute floors when rolling window empty. */
  buyColdFloor: number;
  sellColdFloor: number;
  maxSpread: number;
  consecutiveEvals: number;
  minOpportunity: number;
  opposeVeto: number;
  allowedRegimes: V12Regime[] | null; // null = all except SPREAD_ABNORMAL/LOW_ACTIVITY hard blocks
  exit: V12ExitConfig;
};

export const V12_ARCHITECTURES: Array<{
  id: V12ArchitectureId;
  primaryHorizonSec: number;
  contextHorizonSec: number;
}> = [
  { id: "M1s_5s", primaryHorizonSec: 1, contextHorizonSec: 5 },
  { id: "M3s_15s", primaryHorizonSec: 3, contextHorizonSec: 15 },
  { id: "M5s_15s", primaryHorizonSec: 5, contextHorizonSec: 15 },
  { id: "E_5_15", primaryHorizonSec: 5, contextHorizonSec: 15 },
  { id: "BREAKOUT_M1", primaryHorizonSec: 5, contextHorizonSec: 15 },
  { id: "REVERSAL_M1_M5", primaryHorizonSec: 5, contextHorizonSec: 30 }
];

export function combineArchitectureScores(
  arch: V12ArchitectureId,
  s: V12HorizonScores
): { buy: number; sell: number } {
  if (arch === "E_5_15") {
    return {
      buy: 0.55 * s.buyPrimary + 0.45 * s.buyContext,
      sell: 0.55 * s.sellPrimary + 0.45 * s.sellContext
    };
  }
  if (arch === "BREAKOUT_M1") {
    return {
      buy: s.buyPrimary * (1 + 0.2 * s.pOpportunity),
      sell: s.sellPrimary * (1 + 0.2 * s.pOpportunity)
    };
  }
  if (arch === "REVERSAL_M1_M5") {
    // Context used as exhaustion confirm: prefer primary against mild context.
    return {
      buy: s.buyPrimary * 0.7 + (1 - s.sellContext) * 0.3,
      sell: s.sellPrimary * 0.7 + (1 - s.buyContext) * 0.3
    };
  }
  return {
    buy: 0.65 * s.buyPrimary + 0.35 * s.buyContext,
    sell: 0.65 * s.sellPrimary + 0.35 * s.sellContext
  };
}

export function decideV12Action(args: {
  scores: V12HorizonScores;
  policy: V12PolicyConfig;
  spread: number;
  regime: V12Regime;
  dataOk: boolean;
  buyRankOk: boolean;
  sellRankOk: boolean;
}): "BUY" | "SELL" | "WAIT" {
  if (!args.dataOk) return "WAIT";
  if (args.regime === "SPREAD_ABNORMAL" || args.regime === "LOW_ACTIVITY") {
    return "WAIT";
  }
  if (
    args.policy.allowedRegimes &&
    !args.policy.allowedRegimes.includes(args.regime)
  ) {
    return "WAIT";
  }
  if (args.spread > args.policy.maxSpread) return "WAIT";

  if (args.policy.family === "two_stage_opportunity") {
    if (args.scores.pOpportunity < args.policy.minOpportunity) return "WAIT";
  }

  const { buy, sell } = combineArchitectureScores(
    args.policy.architecture,
    args.scores
  );

  if (buy >= sell * args.policy.opposeVeto && args.buyRankOk && buy > sell) {
    return "BUY";
  }
  if (sell >= buy * args.policy.opposeVeto && args.sellRankOk && sell > buy) {
    return "SELL";
  }
  return "WAIT";
}

export function consecutiveV12(
  recent: Array<"BUY" | "SELL" | "WAIT">,
  n: number
): "BUY" | "SELL" | "WAIT" {
  if (n <= 1) return recent[recent.length - 1] ?? "WAIT";
  if (recent.length < n) return "WAIT";
  const slice = recent.slice(-n);
  if (slice.every((x) => x === "BUY")) return "BUY";
  if (slice.every((x) => x === "SELL")) return "SELL";
  return "WAIT";
}

export type V12ExitArchitectureId = V12ExitArchitecture;
