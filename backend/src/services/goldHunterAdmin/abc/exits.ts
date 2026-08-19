/**
 * FAST open-trade management — every spot/depth event can exit.
 * Profit lock / trail never loosen once activated.
 *
 * When cfg.smartPositionManagerEnabled: SMART_POSITION_MANAGER_V1 R-based
 * protection supersedes legacy early profit-lock / HARVEST_FADE.
 * Hard stop, RAPID_ABORT, DATA_STALE, SPREAD_UNSAFE always retained.
 */
import type {
  GhFastConfig,
  GhFastExitReason,
  GhFastOpenTrade,
  GhFastSetupId,
  GhFastSide
} from "./types";
import type { GhFastFeatureSnapshot } from "./features";
import {
  evaluateSmartPositionExit,
  isSmartPositionManagerEnabled,
  updateSmartPositionManager
} from "./smartPositionManager";
import { GOLD_HUNTER_SMART_POSITION_MANAGER_VERSION } from "./versions";
import { GOLD_HUNTER_BRAIN_VERSION } from "./versions";

export function openTrade(args: {
  tradeId: string;
  side: GhFastSide;
  setup: GhFastSetupId;
  entryTs: number;
  bid: number;
  ask: number;
  trailDistance: number;
  opportunityId?: string | null;
  signalId?: string | null;
  pnlScaleEurPerPrice?: number | null;
}): GhFastOpenTrade {
  const entryPrice = args.side === "BUY" ? args.ask : args.bid;
  return {
    tradeId: args.tradeId,
    side: args.side,
    setup: args.setup,
    entryTs: args.entryTs,
    entryBid: args.bid,
    entryAsk: args.ask,
    entryPrice,
    bestExit: entryPrice,
    mfe: 0,
    mae: 0,
    profitLockActive: false,
    lockFloor: null,
    trailDistance: args.trailDistance,
    harvestRunner: false,
    brainVersion: GOLD_HUNTER_BRAIN_VERSION,
    positionManagerVersion: GOLD_HUNTER_SMART_POSITION_MANAGER_VERSION,
    smartPmState: "UNPROTECTED",
    highestProtectionStage: "UNPROTECTED",
    protectedProfitR: 0,
    currentR: 0,
    maxFavourableR: 0,
    maxAdverseR: 0,
    opportunityId: args.opportunityId ?? null,
    signalId: args.signalId ?? null,
    pnlScaleEurPerPrice: args.pnlScaleEurPerPrice ?? null,
    lastStopAdjustReason: "NONE",
    lastHarvestAssessment: null
  };
}

function updateOpenTradeLegacy(
  trade: GhFastOpenTrade,
  bid: number,
  ask: number,
  cfg: GhFastConfig
): void {
  const exec = trade.side === "BUY" ? bid : ask;
  if (trade.side === "BUY") {
    trade.bestExit = Math.max(trade.bestExit, exec);
    const unreal = exec - trade.entryPrice;
    trade.mfe = Math.max(trade.mfe, unreal);
    trade.mae = Math.min(trade.mae, unreal);
  } else {
    trade.bestExit = Math.min(trade.bestExit, exec);
    const unreal = trade.entryPrice - exec;
    trade.mfe = Math.max(trade.mfe, unreal);
    trade.mae = Math.min(trade.mae, unreal);
  }

  if (!trade.profitLockActive && trade.mfe >= cfg.profitLockActivateMfe) {
    trade.profitLockActive = true;
    trade.harvestRunner = true;
    const lockMove = trade.mfe * cfg.profitLockFraction;
    trade.lockFloor =
      trade.side === "BUY"
        ? trade.entryPrice + lockMove
        : trade.entryPrice - lockMove;
    trade.lastStopAdjustReason = "LEGACY_PROFIT_LOCK";
  }

  if (trade.profitLockActive) {
    // Never loosen trail distance.
    trade.trailDistance = Math.min(trade.trailDistance, cfg.trailDistance);
    const trailFloor =
      trade.side === "BUY"
        ? trade.bestExit - trade.trailDistance
        : trade.bestExit + trade.trailDistance;
    if (trade.lockFloor == null) {
      trade.lockFloor = trailFloor;
    } else if (trade.side === "BUY") {
      trade.lockFloor = Math.max(trade.lockFloor, trailFloor);
    } else {
      trade.lockFloor = Math.min(trade.lockFloor, trailFloor);
    }
  }
}

export function updateOpenTrade(
  trade: GhFastOpenTrade,
  bid: number,
  ask: number,
  cfg: GhFastConfig
): void {
  if (isSmartPositionManagerEnabled(cfg)) {
    updateSmartPositionManager(trade, bid, ask, cfg);
    return;
  }
  updateOpenTradeLegacy(trade, bid, ask, cfg);
}

function evaluateOpenExitLegacy(args: {
  trade: GhFastOpenTrade;
  f: GhFastFeatureSnapshot;
  cfg: GhFastConfig;
  dataOk: boolean;
}): GhFastExitReason | null {
  const { trade, f, cfg } = args;
  const exec = trade.side === "BUY" ? f.bid : f.ask;

  if (!args.dataOk) return "DATA_STALE";
  if (f.spread > cfg.maxSpread * 1.25) return "SPREAD_UNSAFE";

  const adverse =
    trade.side === "BUY"
      ? trade.entryPrice - f.bid
      : f.ask - trade.entryPrice;
  if (adverse >= cfg.hardStop) return "HARD_PROTECTION";

  // Rapid abort — thesis failure
  if (trade.side === "BUY") {
    if (
      f.acceleration < -cfg.momentumVelMin &&
      f.signedImbalance1s < -0.2 &&
      f.depth.depthImbalance < -0.25
    ) {
      return "RAPID_ABORT";
    }
    if (f.midVel250 < -cfg.momentumVelMin && trade.mfe <= 0) {
      return "RAPID_ABORT";
    }
  } else {
    if (
      f.acceleration > cfg.momentumVelMin &&
      f.signedImbalance1s > 0.2 &&
      f.depth.depthImbalance > 0.25
    ) {
      return "RAPID_ABORT";
    }
    if (f.midVel250 > cfg.momentumVelMin && trade.mfe <= 0) {
      return "RAPID_ABORT";
    }
  }

  if (trade.profitLockActive && trade.lockFloor != null) {
    if (trade.side === "BUY" && exec <= trade.lockFloor) return "TRAIL_HIT";
    if (trade.side === "SELL" && exec >= trade.lockFloor) return "TRAIL_HIT";
  }

  // Harvest when profitable and momentum fades
  if (trade.mfe >= cfg.profitLockActivateMfe * 0.8) {
    const fade =
      trade.side === "BUY"
        ? f.acceleration < 0 && f.signedImbalance1s < 0
        : f.acceleration > 0 && f.signedImbalance1s > 0;
    if (fade && trade.profitLockActive) return "HARVEST_FADE";
  }

  // Runner continues — no mandatory tiny max-hold close here.
  return null;
}

export function evaluateOpenExit(args: {
  trade: GhFastOpenTrade;
  f: GhFastFeatureSnapshot;
  cfg: GhFastConfig;
  dataOk: boolean;
}): GhFastExitReason | null {
  if (isSmartPositionManagerEnabled(args.cfg)) {
    return evaluateSmartPositionExit(args);
  }
  return evaluateOpenExitLegacy(args);
}
