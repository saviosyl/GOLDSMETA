/**
 * Initial protection geometry from frozen Gold Hunter FAST hardStop.
 * Do not invent a new stop strategy. Do not copy Fast AutoTrade geometry.
 */
import { frozenGhFastSoakConfig } from "./abc";

export type ProtectionGeometryResult =
  | {
      ok: true;
      source: "GH_FAST_FROZEN_HARD_STOP";
      hardStopDistance: number;
      stopPrice: number;
      entryPrice: number;
      side: "BUY" | "SELL";
    }
  | {
      ok: false;
      blocker: "PROTECTION_GEOMETRY_NOT_CONNECTED" | "ENTRY_INVALID";
    };

/**
 * Derive broker-safe initial absolute stop from frozen hardStop distance.
 */
export function deriveGoldHunterInitialProtection(args: {
  side: "BUY" | "SELL";
  entryPrice: number;
}): ProtectionGeometryResult {
  if (!(args.entryPrice > 0) || !Number.isFinite(args.entryPrice)) {
    return { ok: false, blocker: "ENTRY_INVALID" };
  }
  const cfg = frozenGhFastSoakConfig();
  const dist = cfg.hardStop;
  if (!(dist > 0) || !Number.isFinite(dist)) {
    return { ok: false, blocker: "PROTECTION_GEOMETRY_NOT_CONNECTED" };
  }
  const stopPrice =
    args.side === "BUY" ? args.entryPrice - dist : args.entryPrice + dist;
  if (!(stopPrice > 0) || !Number.isFinite(stopPrice)) {
    return { ok: false, blocker: "PROTECTION_GEOMETRY_NOT_CONNECTED" };
  }
  return {
    ok: true,
    source: "GH_FAST_FROZEN_HARD_STOP",
    hardStopDistance: dist,
    stopPrice,
    entryPrice: args.entryPrice,
    side: args.side
  };
}

export function isGoldHunterProtectionGeometryConnected(): boolean {
  const cfg = frozenGhFastSoakConfig();
  return Number.isFinite(cfg.hardStop) && cfg.hardStop > 0;
}
