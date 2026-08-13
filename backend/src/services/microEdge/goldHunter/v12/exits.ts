/**
 * Dynamic profit harvest / loser management for V1.2 shadow research.
 * Trailing protection never loosens once activated.
 */
import type { GhExitReason } from "../types";

export type V12ExitConfig = {
  architecture: import("./versions").V12ExitArchitecture;
  maxHoldSec: number;
  protectiveStop: number;
  /** MFE activation threshold (price units) from TRAIN quantiles. */
  trailActivateMfe: number;
  /** Initial trail distance; never increases (loosens) after activation. */
  trailDistance: number;
  /** Fraction of MFE to protect once activated (0–1). */
  profitLockFraction: number;
  edgeFadeFloor: number;
  edgeFlipMin: number;
  /** Rapid invalidation window (sec). */
  rapidInvalidationSec: number;
  friction: number;
};

export type OpenHarvestState = {
  side: "BUY" | "SELL";
  entryTs: number;
  entryPrice: number;
  /** Best executable exit since entry (Bid for BUY, Ask for SELL). */
  bestExit: number;
  mfe: number;
  mae: number;
  trailActive: boolean;
  /** Tightest (smallest) trail distance after activation. */
  trailDistance: number;
  /** Highest profit-lock floor (executable price). */
  lockFloor: number | null;
  harvestRunner: boolean;
};

export function createOpenState(args: {
  side: "BUY" | "SELL";
  entryTs: number;
  entryPrice: number;
  exitConfig: V12ExitConfig;
}): OpenHarvestState {
  return {
    side: args.side,
    entryTs: args.entryTs,
    entryPrice: args.entryPrice,
    bestExit: args.entryPrice,
    mfe: 0,
    mae: 0,
    trailActive: false,
    trailDistance: args.exitConfig.trailDistance,
    lockFloor: null,
    harvestRunner: false
  };
}

/**
 * Update MFE/MAE/bestExit and tighten trail — never loosen.
 * BUY trails on Bid; SELL trails on Ask.
 */
export function updateHarvestState(
  open: OpenHarvestState,
  args: {
    bid: number;
    ask: number;
    cfg: V12ExitConfig;
  }
): void {
  const exec = open.side === "BUY" ? args.bid : args.ask;
  if (open.side === "BUY") {
    open.bestExit = Math.max(open.bestExit, exec);
    const unreal = exec - open.entryPrice;
    open.mfe = Math.max(open.mfe, unreal);
    open.mae = Math.min(open.mae, unreal);
  } else {
    open.bestExit = Math.min(open.bestExit, exec);
    const unreal = open.entryPrice - exec;
    open.mfe = Math.max(open.mfe, unreal);
    open.mae = Math.min(open.mae, unreal);
  }

  if (!open.trailActive && open.mfe >= args.cfg.trailActivateMfe) {
    open.trailActive = true;
    open.harvestRunner = true;
    const lockMove = open.mfe * args.cfg.profitLockFraction;
    open.lockFloor =
      open.side === "BUY"
        ? open.entryPrice + lockMove
        : open.entryPrice - lockMove;
  }

  if (open.trailActive) {
    // Never loosen: trail distance may only shrink.
    open.trailDistance = Math.min(open.trailDistance, args.cfg.trailDistance);
    const trailFloor =
      open.side === "BUY"
        ? open.bestExit - open.trailDistance
        : open.bestExit + open.trailDistance;
    if (open.lockFloor == null) {
      open.lockFloor = trailFloor;
    } else if (open.side === "BUY") {
      open.lockFloor = Math.max(open.lockFloor, trailFloor);
    } else {
      open.lockFloor = Math.min(open.lockFloor, trailFloor);
    }
  }
}

export function evaluateV12Exit(args: {
  open: OpenHarvestState;
  nowMs: number;
  bid: number;
  ask: number;
  sideScore: number;
  opposeScore: number;
  velocity: number;
  spreadOverMedian: number;
  dataOk: boolean;
  cfg: V12ExitConfig;
}): GhExitReason | null {
  const { open, cfg } = args;
  const holdSec = (args.nowMs - open.entryTs) / 1000;
  const exec = open.side === "BUY" ? args.bid : args.ask;

  // Protective stop — mandatory
  const adverse =
    open.side === "BUY"
      ? open.entryPrice - args.bid
      : args.ask - open.entryPrice;
  if (adverse >= cfg.protectiveStop) return "PROTECTIVE_STOP";

  if (!args.dataOk || args.spreadOverMedian >= 2.5) return "DATA_STALE";

  // Rapid invalidation early
  if (holdSec <= cfg.rapidInvalidationSec) {
    if (args.opposeScore > args.sideScore && args.opposeScore >= cfg.edgeFlipMin) {
      return "EDGE_FLIPPED";
    }
    if (args.sideScore < cfg.edgeFadeFloor * 0.5) return "EDGE_GONE";
  }

  const arch = cfg.architecture;

  if (arch === "FIXED_MAX_HOLD" || arch === "EDGE_FADE" || arch === "HYBRID_TRAIL_FADE") {
    if (arch !== "FIXED_MAX_HOLD" && args.sideScore < cfg.edgeFadeFloor) {
      return "EDGE_GONE";
    }
  }

  if (arch === "EDGE_FLIP" || arch === "HYBRID_TRAIL_FADE") {
    if (
      args.opposeScore > args.sideScore &&
      args.opposeScore >= cfg.edgeFlipMin
    ) {
      return "EDGE_FLIPPED";
    }
  }

  if (arch === "DYNAMIC_TRAIL" || arch === "HYBRID_TRAIL_FADE") {
    if (open.trailActive && open.lockFloor != null) {
      if (open.side === "BUY" && exec <= open.lockFloor) {
        return "TAKE_PROFIT_SIGNAL";
      }
      if (open.side === "SELL" && exec >= open.lockFloor) {
        return "TAKE_PROFIT_SIGNAL";
      }
    }
  }

  // HARVEST_RUNNER: allow extended hold while edge/momentum strong
  const runnerOk =
    open.harvestRunner &&
    args.sideScore >= cfg.edgeFadeFloor &&
    (open.side === "BUY" ? args.velocity >= 0 : args.velocity <= 0);

  if (holdSec >= cfg.maxHoldSec && !runnerOk) return "MAX_HOLD";
  // Absolute safety cap = maxHold (validation-chosen); runner cannot exceed it.
  if (holdSec >= cfg.maxHoldSec) return "MAX_HOLD";

  return null;
}

/** Derive trail activation / distance from TRAIN MFE distribution (no hardcoded $). */
export function deriveTrailParamsFromTrain(mfes: number[]): {
  trailActivateMfe: number;
  trailDistance: number;
  profitLockFraction: number;
} {
  const pos = mfes.filter((x) => x > 0).sort((a, b) => a - b);
  if (pos.length < 20) {
    return {
      trailActivateMfe: 0.15,
      trailDistance: 0.1,
      profitLockFraction: 0.4
    };
  }
  const q = (p: number) =>
    pos[Math.min(pos.length - 1, Math.floor(p * (pos.length - 1)))]!;
  const activate = q(0.55);
  const dist = Math.max(0.05, q(0.35) * 0.5);
  return {
    trailActivateMfe: activate,
    trailDistance: dist,
    profitLockFraction: 0.45
  };
}
