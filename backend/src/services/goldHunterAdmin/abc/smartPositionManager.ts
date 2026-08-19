/**
 * SMART_POSITION_MANAGER_V1 — R-based profit protection on GOLD_HUNTER_BRAIN_V2.
 * Deterministic, monotonic floors. Easy disable via smartPositionManagerEnabled.
 * Does not change entry thresholds. Never loosens protection. Never removes hard stop.
 */
import type { GhFastFeatureSnapshot } from "./features";
import type {
  GhFastConfig,
  GhFastExitReason,
  GhFastOpenTrade,
  GhFastSide,
  SmartPmState,
  SmartPmStopAdjustReason
} from "./types";
// GhFastExitReason used by evaluateSmartPositionExit return type
import { GOLD_HUNTER_SMART_POSITION_MANAGER_VERSION } from "./versions";

export const SMART_PM_STATE_ORDER: Record<SmartPmState, number> = {
  UNPROTECTED: 0,
  PROTECTED: 1,
  LOCKED: 2,
  RUNNER: 3,
  HARVEST: 4
};

export function isSmartPositionManagerEnabled(cfg: GhFastConfig): boolean {
  return cfg.smartPositionManagerEnabled === true;
}

export function initialRiskPrice(cfg: GhFastConfig): number {
  return cfg.hardStop;
}

/** Favourable price move in account-price units (positive = in favour). */
export function favourableMove(
  side: GhFastSide,
  entryPrice: number,
  execExit: number
): number {
  return side === "BUY" ? execExit - entryPrice : entryPrice - execExit;
}

export function moveToR(move: number, riskPrice: number): number {
  if (!(riskPrice > 0) || !Number.isFinite(riskPrice)) return 0;
  return move / riskPrice;
}

export function rToPriceMove(r: number, riskPrice: number): number {
  return r * riskPrice;
}

/**
 * Round stop to tick; BUY rounds up (tighter), SELL rounds down (tighter).
 * Never loosens relative to the raw candidate before rounding when possible.
 */
export function roundStopToTick(
  side: GhFastSide,
  price: number,
  tickSize: number
): number {
  if (!(tickSize > 0) || !Number.isFinite(tickSize)) return price;
  const n = price / tickSize;
  const rounded = side === "BUY" ? Math.ceil(n - 1e-12) * tickSize : Math.floor(n + 1e-12) * tickSize;
  // Avoid float debris
  const decimals = Math.min(8, Math.max(0, Math.round(-Math.log10(tickSize))));
  const f = 10 ** decimals;
  return Math.round(rounded * f) / f;
}

/**
 * Break-even stop after spread/friction so closing at the stop does not
 * realise a loss from costs alone. BUY exit at bid; SELL exit at ask.
 */
export function breakEvenStopAfterCosts(args: {
  side: GhFastSide;
  entryPrice: number;
  spread: number;
  friction: number;
  tickSize: number;
  minStopDistance: number;
}): number {
  const costPad = Math.max(0, args.friction) + Math.max(0, args.spread);
  const raw =
    args.side === "BUY"
      ? args.entryPrice + costPad
      : args.entryPrice - costPad;
  let stop = roundStopToTick(args.side, raw, args.tickSize);
  const minDist = Math.max(0, args.minStopDistance);
  if (args.side === "BUY") {
    stop = Math.max(stop, args.entryPrice + minDist * 0); // BE may equal entry after round
    // Ensure stop is not below entry (would be a loss floor); nudge to entry+tick if needed
    if (stop < args.entryPrice) {
      stop = roundStopToTick("BUY", args.entryPrice + args.tickSize, args.tickSize);
    }
  } else {
    if (stop > args.entryPrice) {
      stop = roundStopToTick("SELL", args.entryPrice - args.tickSize, args.tickSize);
    }
  }
  return stop;
}

export function stopFromProtectedProfitR(args: {
  side: GhFastSide;
  entryPrice: number;
  protectedProfitR: number;
  riskPrice: number;
  tickSize: number;
}): number {
  const move = rToPriceMove(args.protectedProfitR, args.riskPrice);
  const raw =
    args.side === "BUY" ? args.entryPrice + move : args.entryPrice - move;
  return roundStopToTick(args.side, raw, args.tickSize);
}

export function advanceSmartPmState(
  current: SmartPmState,
  next: SmartPmState
): SmartPmState {
  return SMART_PM_STATE_ORDER[next] >= SMART_PM_STATE_ORDER[current]
    ? next
    : current;
}

/**
 * Target protected profit R from peak MFE R (before monotonic clamp / geometry).
 */
export function targetProtectedProfitR(args: {
  maxFavourableR: number;
  cfg: GhFastConfig;
  side: GhFastSide;
  entryPrice: number;
  spread: number;
  bestExit: number;
}): { targetR: number; state: SmartPmState; reason: SmartPmStopAdjustReason } {
  const { cfg } = args;
  const mfeR = args.maxFavourableR;

  if (mfeR < cfg.spmProtectMfeR) {
    return { targetR: 0, state: "UNPROTECTED", reason: "NONE" };
  }

  if (mfeR < cfg.spmProtect15MfeR) {
    // >= 1.0R: move toward cost-aware break-even (≈ 0R after costs)
    const beStop = breakEvenStopAfterCosts({
      side: args.side,
      entryPrice: args.entryPrice,
      spread: args.spread,
      friction: cfg.friction,
      tickSize: cfg.spmTickSize,
      minStopDistance: cfg.spmMinStopDistance
    });
    const beMove = favourableMove(args.side, args.entryPrice, beStop);
    const beR = Math.max(0, moveToR(beMove, cfg.hardStop));
    return {
      targetR: beR,
      state: "PROTECTED",
      reason: "SPM_BREAK_EVEN_AFTER_COSTS"
    };
  }

  if (mfeR < cfg.spmLockMfeR) {
    return {
      targetR: cfg.spmProtect15FloorR,
      state: "PROTECTED",
      reason: "SPM_PROTECT_0_4R"
    };
  }

  if (mfeR < cfg.spmRunnerMfeR) {
    return {
      targetR: cfg.spmLockFloorR,
      state: "LOCKED",
      reason: "SPM_LOCK_0_9R"
    };
  }

  // RUNNER: min floor then trail from best exit
  const minR = cfg.spmRunnerMinFloorR;
  const trailMove = rToPriceMove(cfg.spmRunnerTrailR, cfg.hardStop);
  const trailStop =
    args.side === "BUY"
      ? args.bestExit - trailMove
      : args.bestExit + trailMove;
  const trailProtectMove = favourableMove(
    args.side,
    args.entryPrice,
    trailStop
  );
  const trailR = moveToR(trailProtectMove, cfg.hardStop);
  const targetR = Math.max(minR, trailR);
  return {
    targetR,
    state: "RUNNER",
    reason: trailR > minR ? "SPM_RUNNER_TRAIL" : "SPM_RUNNER_MIN_FLOOR"
  };
}

/**
 * Monotonic clamp: never reduce protectedProfitR.
 */
export function applyMonotonicProtectedProfitR(
  previous: number,
  proposed: number
): number {
  const prev = Number.isFinite(previous) ? previous : 0;
  const next = Number.isFinite(proposed) ? proposed : 0;
  return Math.max(prev, next, 0);
}

export type SmartHarvestAssessment = {
  harvest: boolean;
  reason: "SMART_HARVEST_MOMENTUM_DEPTH_REVERSAL" | null;
  diagnostics: {
    mfeR: number;
    currentR: number;
    retraceR: number;
    momentumAgainst: boolean;
    depthAgainst: boolean;
    velocityAgainst: boolean;
  };
};

/**
 * Multi-confirm harvest — never from a single noisy tick.
 * Requires: significant MFE, material retrace, momentum AND depth against.
 */
export function assessSmartHarvest(args: {
  trade: GhFastOpenTrade;
  f: GhFastFeatureSnapshot;
  cfg: GhFastConfig;
}): SmartHarvestAssessment {
  const { trade, f, cfg } = args;
  const risk = cfg.hardStop;
  const mfeR = moveToR(trade.mfe, risk);
  const exec = trade.side === "BUY" ? f.bid : f.ask;
  const currentMove = favourableMove(trade.side, trade.entryPrice, exec);
  const currentR = moveToR(currentMove, risk);
  const retraceR = mfeR - currentR;

  const momentumAgainst =
    trade.side === "BUY"
      ? f.acceleration < -cfg.momentumVelMin && f.signedImbalance1s < -0.15
      : f.acceleration > cfg.momentumVelMin && f.signedImbalance1s > 0.15;
  const depthAgainst =
    trade.side === "BUY"
      ? f.depth.depthImbalance < -0.2
      : f.depth.depthImbalance > 0.2;
  const velocityAgainst =
    trade.side === "BUY"
      ? f.midVel250 < -cfg.momentumVelMin
      : f.midVel250 > cfg.momentumVelMin;

  const diagnostics = {
    mfeR,
    currentR,
    retraceR,
    momentumAgainst,
    depthAgainst,
    velocityAgainst
  };

  const state = trade.smartPmState ?? "UNPROTECTED";
  const eligibleState =
    SMART_PM_STATE_ORDER[state] >= SMART_PM_STATE_ORDER.LOCKED ||
    mfeR >= cfg.spmHarvestMinMfeR;

  if (
    eligibleState &&
    mfeR >= cfg.spmHarvestMinMfeR &&
    retraceR >= cfg.spmHarvestMinRetraceR &&
    momentumAgainst &&
    depthAgainst &&
    velocityAgainst
  ) {
    return {
      harvest: true,
      reason: "SMART_HARVEST_MOMENTUM_DEPTH_REVERSAL",
      diagnostics
    };
  }

  return { harvest: false, reason: null, diagnostics };
}

/**
 * Core SPM update — mutates trade. When disabled, caller must use legacy path.
 */
export function updateSmartPositionManager(
  trade: GhFastOpenTrade,
  bid: number,
  ask: number,
  cfg: GhFastConfig
): void {
  const exec = trade.side === "BUY" ? bid : ask;
  const spread = Math.max(0, ask - bid);
  trade.spread = spread;
  trade.currentPrice = exec;
  trade.positionManagerVersion =
    trade.positionManagerVersion ?? GOLD_HUNTER_SMART_POSITION_MANAGER_VERSION;
  trade.brainVersion = trade.brainVersion ?? "GOLD_HUNTER_BRAIN_V2";
  trade.initialStopPrice =
    trade.initialStopPrice ??
    (trade.side === "BUY"
      ? trade.entryPrice - cfg.hardStop
      : trade.entryPrice + cfg.hardStop);
  trade.initialRiskPrice = trade.initialRiskPrice ?? cfg.hardStop;
  trade.initialRiskR = 1;

  if (trade.side === "BUY") {
    trade.bestExit = Math.max(trade.bestExit, exec);
    const unreal = exec - trade.entryPrice;
    trade.mfe = Math.max(trade.mfe, unreal);
    trade.mae = Math.min(trade.mae, unreal);
    trade.maxFavourablePrice = trade.bestExit;
    trade.maxAdversePrice =
      trade.maxAdversePrice == null
        ? exec
        : Math.min(trade.maxAdversePrice, exec);
  } else {
    trade.bestExit = Math.min(trade.bestExit, exec);
    const unreal = trade.entryPrice - exec;
    trade.mfe = Math.max(trade.mfe, unreal);
    trade.mae = Math.min(trade.mae, unreal);
    trade.maxFavourablePrice = trade.bestExit;
    trade.maxAdversePrice =
      trade.maxAdversePrice == null
        ? exec
        : Math.max(trade.maxAdversePrice, exec);
  }

  const risk = cfg.hardStop;
  trade.currentR = moveToR(
    favourableMove(trade.side, trade.entryPrice, exec),
    risk
  );
  trade.maxFavourableR = moveToR(trade.mfe, risk);
  // mae is signed favourable-move (negative when adverse); store adverse R positive
  trade.maxAdverseR = moveToR(-Math.min(0, trade.mae), risk);

  const scale = trade.pnlScaleEurPerPrice;
  if (scale != null && Number.isFinite(scale) && scale > 0) {
    trade.currentUnrealisedPnlEur =
      favourableMove(trade.side, trade.entryPrice, exec) * scale;
    trade.maxFavourablePnlEur = trade.mfe * scale;
    trade.maxAdversePnlEur = Math.abs(Math.min(0, trade.mae)) * scale;
  }

  trade.timeInTradeMs = Math.max(0, Date.now() - trade.entryTs);

  const prevProtected = trade.protectedProfitR ?? 0;
  const prevState = trade.smartPmState ?? "UNPROTECTED";

  const planned = targetProtectedProfitR({
    maxFavourableR: trade.maxFavourableR,
    cfg,
    side: trade.side,
    entryPrice: trade.entryPrice,
    spread,
    bestExit: trade.bestExit
  });

  const nextProtected = applyMonotonicProtectedProfitR(
    prevProtected,
    planned.targetR
  );
  const nextState = advanceSmartPmState(prevState, planned.state);

  // protectedProfitR = theoretical stage target (monotonic).
  trade.protectedProfitR = nextProtected;
  trade.smartPmState = nextState;
  trade.highestProtectionStage = advanceSmartPmState(
    trade.highestProtectionStage ?? "UNPROTECTED",
    nextState
  );

  if (nextProtected <= 0 && prevProtected <= 0) {
    trade.lastStopAdjustReason = "NONE";
    trade.protectedStopPrice = trade.initialStopPrice;
    trade.executableProtectedProfitR = applyMonotonicProtectedProfitR(
      trade.executableProtectedProfitR ?? 0,
      0
    );
    return;
  }

  const proposedStop = stopFromProtectedProfitR({
    side: trade.side,
    entryPrice: trade.entryPrice,
    protectedProfitR: nextProtected,
    riskPrice: risk,
    tickSize: cfg.spmTickSize
  });

  // Broker min-distance: cannot place stop inside the market. If the
  // ideal floor is too close, skip the amend this tick (never loosen).
  let geometryStop = proposedStop;
  let geometryOk = true;
  if (cfg.spmMinStopDistance > 0) {
    if (trade.side === "BUY") {
      const maxAllowed = bid - cfg.spmMinStopDistance;
      if (geometryStop > maxAllowed) {
        geometryStop = roundStopToTick("BUY", maxAllowed, cfg.spmTickSize);
        if (!(geometryStop <= maxAllowed + 1e-9)) geometryOk = false;
      }
    } else {
      const minAllowed = ask + cfg.spmMinStopDistance;
      if (geometryStop < minAllowed) {
        geometryStop = roundStopToTick("SELL", minAllowed, cfg.spmTickSize);
        if (!(geometryStop >= minAllowed - 1e-9)) geometryOk = false;
      }
    }
  }

  // Monotonic lockFloor in price space — never loosen even if geometry lags.
  if (nextProtected > 0 && geometryOk) {
    if (trade.lockFloor == null) {
      trade.lockFloor = geometryStop;
      trade.profitLockActive = true;
      trade.lastStopAdjustReason =
        nextProtected > prevProtected ? planned.reason : "NONE";
    } else if (trade.side === "BUY") {
      if (geometryStop > trade.lockFloor) {
        trade.lockFloor = geometryStop;
        trade.lastStopAdjustReason = planned.reason;
      } else {
        trade.lastStopAdjustReason = "MONOTONIC_HOLD";
      }
      trade.profitLockActive = true;
    } else if (geometryStop < trade.lockFloor) {
      trade.lockFloor = geometryStop;
      trade.lastStopAdjustReason = planned.reason;
      trade.profitLockActive = true;
    } else {
      trade.lastStopAdjustReason = "MONOTONIC_HOLD";
      trade.profitLockActive = true;
    }
  } else if (nextProtected > 0) {
    trade.profitLockActive = trade.lockFloor != null;
    trade.lastStopAdjustReason = "MONOTONIC_HOLD";
  }

  // Never place protection worse than hard stop
  const hard =
    trade.side === "BUY"
      ? trade.entryPrice - cfg.hardStop
      : trade.entryPrice + cfg.hardStop;
  if (trade.side === "BUY" && trade.lockFloor != null) {
    trade.lockFloor = Math.max(trade.lockFloor, hard);
  } else if (trade.side === "SELL" && trade.lockFloor != null) {
    trade.lockFloor = Math.min(trade.lockFloor, hard);
  }

  trade.protectedStopPrice = trade.lockFloor;
  trade.harvestRunner = nextState === "RUNNER" || nextState === "HARVEST";

  // Executable R from the placed lockFloor — may lag theoretical protectedProfitR.
  const placedR =
    trade.lockFloor == null
      ? 0
      : Math.max(
          0,
          moveToR(
            favourableMove(trade.side, trade.entryPrice, trade.lockFloor),
            risk
          )
        );
  trade.executableProtectedProfitR = applyMonotonicProtectedProfitR(
    trade.executableProtectedProfitR ?? 0,
    Math.min(placedR, nextProtected)
  );
}

export function evaluateSmartPositionExit(args: {
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

  // Rapid abort — thesis failure only while still unprotected / no meaningful MFE.
  // Once a trade has demonstrated >= +1R, deterioration is handled by SMART_HARVEST.
  const mfeR = trade.maxFavourableR ?? moveToR(trade.mfe, cfg.hardStop);
  if (mfeR < cfg.spmProtectMfeR) {
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
  }

  const harvest = assessSmartHarvest({ trade, f, cfg });
  trade.lastHarvestAssessment = harvest.diagnostics;
  if (harvest.harvest && harvest.reason) {
    trade.smartPmState = advanceSmartPmState(
      trade.smartPmState ?? "UNPROTECTED",
      "HARVEST"
    );
    trade.highestProtectionStage = advanceSmartPmState(
      trade.highestProtectionStage ?? "UNPROTECTED",
      "HARVEST"
    );
    return harvest.reason;
  }

  if (trade.profitLockActive && trade.lockFloor != null) {
    if (trade.side === "BUY" && exec <= trade.lockFloor) return "TRAIL_HIT";
    if (trade.side === "SELL" && exec >= trade.lockFloor) return "TRAIL_HIT";
  }

  return null;
}

export function buildClosedTradeSmartDiagnostics(args: {
  trade: GhFastOpenTrade;
  finalPnlEur: number | null;
  exitReason: string | null;
}): {
  mfeR: number;
  maeR: number;
  mfeEur: number | null;
  maeEur: number | null;
  protectedProfitR: number;
  highestProtectionStage: SmartPmState;
  profitSurrenderEur: number | null;
  profitRetentionRatio: number | null;
  positionManagerVersion: string;
  brainVersion: string;
  exitReason: string | null;
  timeInTradeMs: number;
} {
  const risk = args.trade.initialRiskPrice || 0.55;
  const mfeR = moveToR(args.trade.mfe, risk);
  const maeR = moveToR(-Math.min(0, args.trade.mae), risk);
  const mfeEur = args.trade.maxFavourablePnlEur ?? null;
  const maeEur = args.trade.maxAdversePnlEur ?? null;
  let profitSurrenderEur: number | null = null;
  let profitRetentionRatio: number | null = null;
  if (
    mfeEur != null &&
    args.finalPnlEur != null &&
    Number.isFinite(mfeEur) &&
    Number.isFinite(args.finalPnlEur)
  ) {
    profitSurrenderEur = mfeEur - args.finalPnlEur;
    if (mfeEur > 0) {
      profitRetentionRatio = args.finalPnlEur / mfeEur;
    }
  }
  return {
    mfeR,
    maeR,
    mfeEur,
    maeEur,
    protectedProfitR: args.trade.protectedProfitR ?? 0,
    highestProtectionStage:
      args.trade.highestProtectionStage ??
      args.trade.smartPmState ??
      "UNPROTECTED",
    profitSurrenderEur,
    profitRetentionRatio,
    positionManagerVersion:
      args.trade.positionManagerVersion ??
      GOLD_HUNTER_SMART_POSITION_MANAGER_VERSION,
    brainVersion: args.trade.brainVersion ?? "GOLD_HUNTER_BRAIN_V2",
    exitReason: args.exitReason,
    timeInTradeMs: args.trade.timeInTradeMs ?? Math.max(0, Date.now() - args.trade.entryTs)
  };
}

export function openTradeSmartDiagnostics(trade: GhFastOpenTrade): {
  brainVersion: string;
  positionManagerVersion: string;
  profitManagementState: SmartPmState;
  currentR: number;
  mfeR: number;
  mfeEur: number | null;
  maeR: number;
  /** Theoretical stage target R (may lead executable when geometry blocks). */
  protectedProfitR: number;
  /** R actually locked by current executable stop/lockFloor. */
  executableProtectedProfitR: number;
  protectedStopPrice: number | null;
  lastStopAdjustReason: SmartPmStopAdjustReason | null;
  lastHarvestAssessment: GhFastOpenTrade["lastHarvestAssessment"];
} {
  return {
    brainVersion: trade.brainVersion ?? "GOLD_HUNTER_BRAIN_V2",
    positionManagerVersion:
      trade.positionManagerVersion ??
      GOLD_HUNTER_SMART_POSITION_MANAGER_VERSION,
    profitManagementState: trade.smartPmState ?? "UNPROTECTED",
    currentR: trade.currentR ?? 0,
    mfeR: trade.maxFavourableR ?? moveToR(trade.mfe, trade.initialRiskPrice ?? 0.55),
    mfeEur: trade.maxFavourablePnlEur ?? null,
    maeR: trade.maxAdverseR ?? 0,
    protectedProfitR: trade.protectedProfitR ?? 0,
    executableProtectedProfitR: trade.executableProtectedProfitR ?? 0,
    protectedStopPrice: trade.protectedStopPrice ?? trade.lockFloor,
    lastStopAdjustReason: trade.lastStopAdjustReason ?? null,
    lastHarvestAssessment: trade.lastHarvestAssessment ?? null
  };
}
