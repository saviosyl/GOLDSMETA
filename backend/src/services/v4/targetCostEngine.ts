import { v4Config } from "./config";
import type { V4CostEstimate, V4TargetSet, V4VolumeProfile } from "./types";

export function estimateCosts(input: {
  session: string;
  riskDistance: number;
  manualSpreadPoints?: number | null;
}): V4CostEstimate {
  const spread =
    input.manualSpreadPoints != null && input.manualSpreadPoints >= 0
      ? input.manualSpreadPoints
      : (v4Config.costs.defaultSpreadPointsBySession[input.session] ??
        v4Config.costs.defaultSpreadPointsBySession.UNKNOWN ??
        0.5);
  const slip = v4Config.costs.slippagePoints;
  const overnight = v4Config.costs.overnightFinancingPerDayPoints;
  const total = spread + slip + overnight;
  const totalCostR = input.riskDistance > 0 ? total / input.riskDistance : null;
  return {
    estimateOnly: true,
    spreadPoints: spread,
    slippagePoints: slip,
    overnightPoints: overnight,
    totalCostPoints: Math.round(total * 100) / 100,
    totalCostR: totalCostR != null ? Math.round(totalCostR * 100) / 100 : null,
    netRrTp1: null,
    netRrTp2: null,
    notes: [
      "Cost figures are estimates until an authenticated broker market-data feed exists.",
      "Never treat estimated spread as exact."
    ]
  };
}

export function computeTargets(input: {
  direction: "BUY" | "SELL";
  entry: number;
  stop: number;
  profile: V4VolumeProfile | null;
  opposingLevels: number[];
}): V4TargetSet {
  const risk = Math.abs(input.entry - input.stop);
  const theoretical = {
    tp1: input.direction === "BUY" ? input.entry + risk : input.entry - risk,
    tp2: input.direction === "BUY" ? input.entry + risk * 2 : input.entry - risk * 2,
    tp3: input.direction === "BUY" ? input.entry + risk * 3 : input.entry - risk * 3
  };

  const levels = [
    ...input.opposingLevels,
    input.profile?.poc,
    input.profile?.vah,
    input.profile?.val,
    input.profile?.priorDayHigh,
    input.profile?.priorDayLow,
    input.profile?.sessionHigh,
    input.profile?.sessionLow,
    ...(input.profile?.hvn ?? []),
    ...(input.profile?.lvn ?? [])
  ].filter((n): n is number => typeof n === "number" && Number.isFinite(n));

  const ahead =
    input.direction === "BUY"
      ? levels.filter((l) => l > input.entry).sort((a, b) => a - b)
      : levels.filter((l) => l < input.entry).sort((a, b) => b - a);

  const pick = (ideal: number, idx: number): number | null => {
    const near = ahead.find((l) => Math.abs(l - ideal) < risk * 0.35);
    if (near != null) return near;
    return ahead[idx] ?? null;
  };

  const structureAware = {
    tp1: pick(theoretical.tp1, 0),
    tp2: pick(theoretical.tp2, 1),
    tp3: pick(theoretical.tp3, 2)
  };

  // Reject if major opposing structure blocks first target path
  const firstObstacle = ahead[0];
  if (firstObstacle != null) {
    const toObstacle = Math.abs(firstObstacle - input.entry);
    if (toObstacle < risk * 0.5) {
      return {
        theoreticalR: theoretical,
        structureAware,
        selected: theoretical,
        rejected: true,
        rejectReason: "Major opposing structure prevents realistic first target"
      };
    }
  }

  const selected = {
    tp1: structureAware.tp1 ?? theoretical.tp1,
    tp2: structureAware.tp2 ?? theoretical.tp2,
    tp3: structureAware.tp3 ?? theoretical.tp3
  };

  return {
    theoreticalR: {
      tp1: Math.round(theoretical.tp1 * 100) / 100,
      tp2: Math.round(theoretical.tp2 * 100) / 100,
      tp3: Math.round(theoretical.tp3 * 100) / 100
    },
    structureAware: {
      tp1: structureAware.tp1 != null ? Math.round(structureAware.tp1 * 100) / 100 : null,
      tp2: structureAware.tp2 != null ? Math.round(structureAware.tp2 * 100) / 100 : null,
      tp3: structureAware.tp3 != null ? Math.round(structureAware.tp3 * 100) / 100 : null
    },
    selected: {
      tp1: Math.round(selected.tp1 * 100) / 100,
      tp2: Math.round(selected.tp2 * 100) / 100,
      tp3: Math.round(selected.tp3 * 100) / 100
    },
    rejected: false,
    rejectReason: null
  };
}

export function attachNetRr(costs: V4CostEstimate, riskDistance: number): V4CostEstimate {
  if (riskDistance <= 0) return costs;
  const costR = costs.totalCostPoints / riskDistance;
  return {
    ...costs,
    totalCostR: Math.round(costR * 100) / 100,
    netRrTp1: Math.round((1 - costR) * 100) / 100,
    netRrTp2: Math.round((2 - costR) * 100) / 100
  };
}
