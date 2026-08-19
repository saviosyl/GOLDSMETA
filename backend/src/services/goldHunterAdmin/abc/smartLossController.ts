/**
 * SMART_LOSS_CONTROLLER_V1 — loss-side management on GOLD_HUNTER_BRAIN_V2.
 * Does not rewrite SMART_POSITION_MANAGER_V1.
 *
 * Below +1.0R MFE: owns soft-max-loss, early thesis failure, small-profit harvest.
 * At/above +1.0R MFE: returns null (handoff to Smart PM — never interrupts runners).
 */
import type { GhFastFeatureSnapshot } from "./features";
import type {
  GhFastConfig,
  GhFastExitReason,
  GhFastOpenTrade
} from "./types";
import {
  favourableMove,
  moveToR
} from "./smartPositionManager";
import { GOLD_HUNTER_SMART_LOSS_CONTROLLER_VERSION } from "./versions";

export function isSmartLossControllerEnabled(cfg: GhFastConfig): boolean {
  return cfg.smartLossControllerEnabled === true;
}

export type SmartLossAssessment = {
  exitReason: Extract<
    GhFastExitReason,
    | "SMART_SOFT_MAX_LOSS"
    | "SMART_EARLY_THESIS_FAILURE"
    | "SMART_SMALL_PROFIT_HARVEST"
  > | null;
  diagnostics: {
    lossControllerVersion: string;
    mfeR: number;
    maeR: number;
    currentR: number;
    handedOffToSmartPm: boolean;
    softMaxLossHit: boolean;
    earlyFailureConfirms: number;
    earlyFailureFlags: {
      accelerationAgainst: boolean;
      imbalanceAgainst: boolean;
      depthAgainst: boolean;
      velocityAgainst: boolean;
    };
    smallProfitEligible: boolean;
    smallProfitStillProfitable: boolean;
    momentumDeteriorating: boolean;
    depthAgainst: boolean;
    surrenderingFavourable: boolean;
  };
};

function currentSignedR(
  trade: GhFastOpenTrade,
  bid: number,
  ask: number,
  risk: number
): number {
  const exec = trade.side === "BUY" ? bid : ask;
  return moveToR(favourableMove(trade.side, trade.entryPrice, exec), risk);
}

/**
 * Cost-aware minimum net R still considered a small profit for harvest.
 * Uses friction + half-spread in R terms so we do not harvest into a loss.
 */
export function minProfitableRAfterCosts(args: {
  cfg: GhFastConfig;
  spread: number;
}): number {
  const risk = args.cfg.hardStop;
  if (!(risk > 0)) return 0.05;
  const cost = Math.max(0, args.cfg.friction) + Math.max(0, args.spread) * 0.5;
  return Math.max(0.02, cost / risk + 0.01);
}

export function countEarlyThesisFailureConfirms(args: {
  trade: GhFastOpenTrade;
  f: GhFastFeatureSnapshot;
  cfg: GhFastConfig;
}): {
  count: number;
  flags: SmartLossAssessment["diagnostics"]["earlyFailureFlags"];
} {
  const { trade, f, cfg } = args;
  const vel = cfg.momentumVelMin;
  if (trade.side === "BUY") {
    const flags = {
      accelerationAgainst: f.acceleration < -vel,
      imbalanceAgainst: f.signedImbalance1s < -0.2,
      depthAgainst: f.depth.depthImbalance < -0.25,
      velocityAgainst: f.midVel250 < -vel
    };
    const count =
      Number(flags.accelerationAgainst) +
      Number(flags.imbalanceAgainst) +
      Number(flags.depthAgainst) +
      Number(flags.velocityAgainst);
    return { count, flags };
  }
  const flags = {
    accelerationAgainst: f.acceleration > vel,
    imbalanceAgainst: f.signedImbalance1s > 0.2,
    depthAgainst: f.depth.depthImbalance > 0.25,
    velocityAgainst: f.midVel250 > vel
  };
  const count =
    Number(flags.accelerationAgainst) +
    Number(flags.imbalanceAgainst) +
    Number(flags.depthAgainst) +
    Number(flags.velocityAgainst);
  return { count, flags };
}

/**
 * Evaluate loss-controller exits. Null = no LC exit (including Smart PM handoff).
 * Caller must still apply HARD_PROTECTION / DATA_STALE / SPREAD_UNSAFE.
 */
export function evaluateSmartLossController(args: {
  trade: GhFastOpenTrade;
  f: GhFastFeatureSnapshot;
  cfg: GhFastConfig;
}): SmartLossAssessment {
  const { trade, f, cfg } = args;
  const risk = cfg.hardStop;
  const mfeR = trade.maxFavourableR ?? moveToR(trade.mfe, risk);
  const maeR = trade.maxAdverseR ?? moveToR(-Math.min(0, trade.mae), risk);
  const currentR = currentSignedR(trade, f.bid, f.ask, risk);
  const early = countEarlyThesisFailureConfirms({ trade, f, cfg });

  const baseDiag: SmartLossAssessment["diagnostics"] = {
    lossControllerVersion: GOLD_HUNTER_SMART_LOSS_CONTROLLER_VERSION,
    mfeR,
    maeR,
    currentR,
    handedOffToSmartPm: mfeR >= cfg.slcHandoffMfeR,
    softMaxLossHit: false,
    earlyFailureConfirms: early.count,
    earlyFailureFlags: early.flags,
    smallProfitEligible: false,
    smallProfitStillProfitable: false,
    momentumDeteriorating: false,
    depthAgainst: early.flags.depthAgainst,
    surrenderingFavourable: false
  };

  trade.lossControllerVersion =
    trade.lossControllerVersion ?? GOLD_HUNTER_SMART_LOSS_CONTROLLER_VERSION;
  trade.lastLossControllerAssessment = baseDiag;

  if (!isSmartLossControllerEnabled(cfg)) {
    return { exitReason: null, diagnostics: baseDiag };
  }

  // Handoff: Smart PM owns winners from +1R MFE onward.
  if (mfeR >= cfg.slcHandoffMfeR) {
    trade.lastLossControllerAssessment = baseDiag;
    return { exitReason: null, diagnostics: baseDiag };
  }

  // 1) Soft max loss — normal strategy exit; hard stop remains emergency.
  if (currentR <= -cfg.slcSoftMaxLossR) {
    const diagnostics = { ...baseDiag, softMaxLossHit: true };
    trade.lastLossControllerAssessment = diagnostics;
    return { exitReason: "SMART_SOFT_MAX_LOSS", diagnostics };
  }

  // 2) Early thesis failure — multi-confirm only; never a single bad tick.
  const adverseEnough = maeR >= cfg.slcEarlyFailureMinMaeR || currentR <= -cfg.slcEarlyFailureMinMaeR;
  const unprotected =
    (trade.smartPmState ?? "UNPROTECTED") === "UNPROTECTED" &&
    (trade.protectedProfitR ?? 0) <= 0;
  if (
    mfeR < cfg.slcEarlyFailureMaxMfeR &&
    unprotected &&
    adverseEnough &&
    early.count >= cfg.slcEarlyFailureMinConfirms
  ) {
    trade.lastLossControllerAssessment = baseDiag;
    return { exitReason: "SMART_EARLY_THESIS_FAILURE", diagnostics: baseDiag };
  }

  // 3) Small profit harvest — only while still net profitable after costs.
  const minProfitR = minProfitableRAfterCosts({ cfg, spread: f.spread });
  const momentumDeteriorating =
    trade.side === "BUY"
      ? f.acceleration < 0 && f.signedImbalance1s < 0
      : f.acceleration > 0 && f.signedImbalance1s > 0;
  const depthAgainst = early.flags.depthAgainst;
  const surrenderingFavourable =
    mfeR - currentR >= cfg.slcSmallHarvestMinSurrenderR && mfeR >= cfg.slcSmallHarvestMinMfeR;
  const stillProfitable = currentR >= minProfitR;
  const smallProfitEligible = mfeR >= cfg.slcSmallHarvestMinMfeR;

  const smallDiag = {
    ...baseDiag,
    smallProfitEligible,
    smallProfitStillProfitable: stillProfitable,
    momentumDeteriorating,
    depthAgainst,
    surrenderingFavourable
  };
  trade.lastLossControllerAssessment = smallDiag;

  if (
    smallProfitEligible &&
    stillProfitable &&
    momentumDeteriorating &&
    depthAgainst &&
    surrenderingFavourable
  ) {
    // Require velocity also soft (not still accelerating with trade) — avoid
    // harvesting healthy momentum on a noisy depth flick.
    const velSoft =
      trade.side === "BUY"
        ? f.midVel250 <= cfg.momentumVelMin
        : f.midVel250 >= -cfg.momentumVelMin;
    if (velSoft) {
      return { exitReason: "SMART_SMALL_PROFIT_HARVEST", diagnostics: smallDiag };
    }
  }

  return { exitReason: null, diagnostics: smallDiag };
}
