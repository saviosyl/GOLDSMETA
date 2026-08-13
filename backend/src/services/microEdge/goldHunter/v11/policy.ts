/**
 * V1.1 primary-horizon edge-first policy.
 * Does NOT require 5s∧15s∧30s high probability floors.
 */
import type { GhHorizonSec } from "../config";
import type { GhAction, GhRegime } from "../types";
import type { V11ArchitectureId } from "./versions";

export type V11SideScores = {
  /** Edge score used for ranking / thresholding (higher = better for that side). */
  buyScore: number;
  sellScore: number;
  byHorizon: Partial<
    Record<
      GhHorizonSec,
      { buyScore: number; sellScore: number; pBuy?: number; pSell?: number }
    >
  >;
};

export type V11PolicyConfig = {
  architecture: V11ArchitectureId;
  primaryHorizon: GhHorizonSec;
  contextHorizons: GhHorizonSec[];
  /** Absolute calibrated edge threshold (USD/oz). */
  minEdge: number;
  /** Optional rank quantile (0-1): trade only if score >= validation quantile. */
  rankQuantile: number | null;
  /** Buy/sell score floors derived from train/val quantiles (set at freeze). */
  buyScoreFloor: number;
  sellScoreFloor: number;
  maxSpread: number;
  consecutiveEvals: number;
  maxHoldSec: number;
  protectiveStop: number;
  /** Opposing context veto: if opposite score on veto horizon exceeds this, WAIT. */
  opposeVetoScore: number;
  theta: number;
};

export const ARCHITECTURES: Array<{
  id: V11ArchitectureId;
  primary: GhHorizonSec;
  context: GhHorizonSec[];
}> = [
  { id: "A_5s_primary", primary: 5, context: [15, 30] },
  { id: "B_15s_primary", primary: 15, context: [5, 30] },
  { id: "C_30s_primary", primary: 30, context: [15, 60] },
  { id: "D_60s_primary", primary: 60, context: [15, 30] },
  { id: "E_5_15_ensemble", primary: 15, context: [5] },
  { id: "F_15_30_ensemble", primary: 15, context: [30] },
  { id: "G_5_15_30_ensemble", primary: 15, context: [5, 30] },
  { id: "H_15_30_60_ensemble", primary: 30, context: [15, 60] }
];

export function ensembleBuyScore(
  arch: V11ArchitectureId,
  byH: V11SideScores["byHorizon"]
): number {
  const g = (h: GhHorizonSec) => byH[h]?.buyScore ?? 0;
  switch (arch) {
    case "A_5s_primary":
      return g(5);
    case "B_15s_primary":
      return g(15);
    case "C_30s_primary":
      return g(30);
    case "D_60s_primary":
      return g(60);
    case "E_5_15_ensemble":
      return 0.4 * g(5) + 0.6 * g(15);
    case "F_15_30_ensemble":
      return 0.55 * g(15) + 0.45 * g(30);
    case "G_5_15_30_ensemble":
      return 0.25 * g(5) + 0.45 * g(15) + 0.3 * g(30);
    case "H_15_30_60_ensemble":
      return 0.35 * g(15) + 0.4 * g(30) + 0.25 * g(60);
  }
}

export function ensembleSellScore(
  arch: V11ArchitectureId,
  byH: V11SideScores["byHorizon"]
): number {
  const g = (h: GhHorizonSec) => byH[h]?.sellScore ?? 0;
  switch (arch) {
    case "A_5s_primary":
      return g(5);
    case "B_15s_primary":
      return g(15);
    case "C_30s_primary":
      return g(30);
    case "D_60s_primary":
      return g(60);
    case "E_5_15_ensemble":
      return 0.4 * g(5) + 0.6 * g(15);
    case "F_15_30_ensemble":
      return 0.55 * g(15) + 0.45 * g(30);
    case "G_5_15_30_ensemble":
      return 0.25 * g(5) + 0.45 * g(15) + 0.3 * g(30);
    case "H_15_30_60_ensemble":
      return 0.35 * g(15) + 0.4 * g(30) + 0.25 * g(60);
  }
}

export function decideV11Action(args: {
  scores: V11SideScores;
  policy: V11PolicyConfig;
  spread: number;
  regime: GhRegime;
  dataOk: boolean;
}): GhAction {
  if (!args.dataOk) return "WAIT";
  if (args.regime === "DANGER") return "WAIT";
  if (!(args.spread > 0) || args.spread > args.policy.maxSpread) return "WAIT";

  const buy = ensembleBuyScore(args.policy.architecture, args.scores.byHorizon);
  const sell = ensembleSellScore(
    args.policy.architecture,
    args.scores.byHorizon
  );

  // Context veto: strong opposite on context horizons
  for (const h of args.policy.contextHorizons) {
    const hs = args.scores.byHorizon[h];
    if (!hs) continue;
    if (buy >= sell && hs.sellScore >= args.policy.opposeVetoScore) {
      return "WAIT";
    }
    if (sell > buy && hs.buyScore >= args.policy.opposeVetoScore) {
      return "WAIT";
    }
  }

  const buyOk =
    buy >= args.policy.buyScoreFloor &&
    buy >= args.policy.minEdge &&
    buy > sell;
  const sellOk =
    sell >= args.policy.sellScoreFloor &&
    sell >= args.policy.minEdge &&
    sell > buy;

  if (buyOk && !sellOk) return "BUY";
  if (sellOk && !buyOk) return "SELL";
  return "WAIT";
}

export function consecutiveV11(
  actions: GhAction[],
  required: number
): GhAction {
  if (actions.length < required) return "WAIT";
  const slice = actions.slice(-required);
  if (slice.every((a) => a === "BUY")) return "BUY";
  if (slice.every((a) => a === "SELL")) return "SELL";
  return "WAIT";
}

/** EDGE_SCORE = calibratedExpectedNet / max(spread, eps) */
export function edgeScore(expectedNet: number, spread: number): number {
  return expectedNet / Math.max(spread, 1e-6);
}
