/**
 * SMART_LOSS_CONTROLLER_V1 — loss-side management on the current brain.
 * Does not rewrite SMART_POSITION_MANAGER_V1.
 *
 * Brain V6 policy:
 * - ordinary losers should normally be cut before the emergency hard stop;
 * - a pulse that does not progress and loses health is exited quickly;
 * - Revision 03 leaves modest profitable moves to Smart PM; the former tiny
 *   harvest path is retained behind an explicit disabled-by-default flag.
 *
 * At/above the configured handoff MFE, Smart PM owns the trade.
 */
import type { GhFastFeatureSnapshot } from "./features";
import type {
  GhFastConfig,
  GhFastExitReason,
  GhFastOpenTrade
} from "./types";
import { favourableMove, moveToR } from "./smartPositionManager";
import { GOLD_HUNTER_SMART_LOSS_CONTROLLER_VERSION } from "./versions";

const EPSILON = 1e-9;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function isSmartLossControllerEnabled(cfg: GhFastConfig): boolean {
  return cfg.smartLossControllerEnabled === true;
}

export type SmartLossAssessment = {
  exitReason: Extract<
    GhFastExitReason,
    | "SMART_SOFT_MAX_LOSS"
    | "SMART_EARLY_THESIS_FAILURE"
    | "FAILED_PULSE_EXIT"
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
    earlyFailurePersistCount: number;
    smallHarvestPersistCount: number;
    smallProfitEligible: boolean;
    smallProfitStillProfitable: boolean;
    momentumDeteriorating: boolean;
    depthAgainst: boolean;
    surrenderingFavourable: boolean;
    pulseHealthScore: number;
    progressStalled: boolean;
  };
};

/** Two snapshots avoids exiting on a single noisy book/tick update. */
export const SMART_LOSS_PERSIST_SNAPSHOTS = 2 as const;

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
 * Cost-aware minimum R still considered a small profit for harvest.
 * A small extra buffer is kept above friction/spread to avoid harvesting
 * nominally-green moves that are too close to costs.
 */
export function minProfitableRAfterCosts(args: {
  cfg: GhFastConfig;
  spread: number;
}): number {
  const risk = args.cfg.hardStop;
  if (!(risk > 0)) return 0.05;
  const cost = Math.max(0, args.cfg.friction) + Math.max(0, args.spread) * 0.5;
  return Math.max(0.03, cost / risk + 0.03);
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
      imbalanceAgainst: f.signedImbalance1s < -0.15,
      depthAgainst: f.depth.depthImbalance < -0.2,
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
    imbalanceAgainst: f.signedImbalance1s > 0.15,
    depthAgainst: f.depth.depthImbalance > 0.2,
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
 * Caller still applies HARD_PROTECTION / DATA_STALE / SPREAD_UNSAFE.
 */
export function evaluateSmartLossController(args: {
  trade: GhFastOpenTrade;
  f: GhFastFeatureSnapshot;
  cfg: GhFastConfig;
}): SmartLossAssessment {
  const { trade, f, cfg } = args;
  const risk = trade.initialRiskPrice ?? cfg.hardStop;
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
    earlyFailurePersistCount: trade.slcEarlyFailurePersistCount ?? 0,
    smallHarvestPersistCount: trade.slcSmallHarvestPersistCount ?? 0,
    smallProfitEligible: false,
    smallProfitStillProfitable: false,
    momentumDeteriorating: false,
    depthAgainst: early.flags.depthAgainst,
    surrenderingFavourable: false,
    pulseHealthScore: 100,
    progressStalled: false
  };

  trade.lossControllerVersion =
    trade.lossControllerVersion ?? GOLD_HUNTER_SMART_LOSS_CONTROLLER_VERSION;
  trade.lastLossControllerAssessment = baseDiag;

  if (!isSmartLossControllerEnabled(cfg)) {
    return { exitReason: null, diagnostics: baseDiag };
  }

  // Smart PM owns demonstrated winners from the configured handoff onward.
  if (mfeR >= cfg.slcHandoffMfeR) {
    trade.slcEarlyFailurePersistCount = 0;
    trade.slcSmallHarvestPersistCount = 0;
    const diag = {
      ...baseDiag,
      earlyFailurePersistCount: 0,
      smallHarvestPersistCount: 0
    };
    trade.lastLossControllerAssessment = diag;
    return { exitReason: null, diagnostics: diag };
  }

  // Immediate V6 soft loss cap; broker hard stop remains emergency protection.
  if (currentR <= -cfg.slcSoftMaxLossR) {
    trade.slcEarlyFailurePersistCount = 0;
    trade.slcSmallHarvestPersistCount = 0;
    const diagnostics = {
      ...baseDiag,
      softMaxLossHit: true,
      earlyFailurePersistCount: 0,
      smallHarvestPersistCount: 0
    };
    trade.lastLossControllerAssessment = diagnostics;
    return { exitReason: "SMART_SOFT_MAX_LOSS", diagnostics };
  }

  const timeInTradeMs =
    trade.timeInTradeMs ??
    (Number.isFinite(trade.entryTs) ? Math.max(0, Date.now() - trade.entryTs) : 0);
  const sideAlignedVel =
    trade.side === "BUY"
      ? f.midVel250 > 0 && f.midVel500 > 0
      : f.midVel250 < 0 && f.midVel500 < 0;
  const sideAlignedImbalance =
    trade.side === "BUY" ? f.signedImbalance1s > 0 : f.signedImbalance1s < 0;
  const pulseHealthScore = Math.round(
    100 *
      clamp01(
        0.28 * Number(sideAlignedVel) +
          0.2 * clamp01(f.efficiency1s) +
          0.22 * clamp01(sideAlignedImbalance ? Math.abs(f.signedImbalance1s) : 0) +
          0.15 * clamp01((currentR + 0.4) / 1.1) +
          0.15 *
            clamp01(
              mfeR <= 0
                ? 0
                : 1 - Math.max(0, mfeR - currentR) / Math.max(mfeR, EPSILON)
            )
      )
  );

  // V6: distinguish an immediate rejection from a merely slow trade.
  const progressStalled = mfeR < 0.16 && currentR < 0.06;
  const fastRejection =
    timeInTradeMs >= 2_500 &&
    mfeR < 0.08 &&
    currentR <= -0.22 &&
    pulseHealthScore < 45 &&
    early.count >= 2;
  const stalledFailure =
    timeInTradeMs >= 5_000 &&
    progressStalled &&
    pulseHealthScore < 50 &&
    early.count >= 2;
  const pulseFailing = fastRejection || stalledFailure;

  if (pulseFailing) {
    trade.slcEarlyFailurePersistCount = 0;
    trade.slcSmallHarvestPersistCount = 0;
    const diagnostics = {
      ...baseDiag,
      pulseHealthScore,
      progressStalled,
      earlyFailurePersistCount: 0,
      smallHarvestPersistCount: 0
    };
    trade.lastLossControllerAssessment = diagnostics;
    return { exitReason: "FAILED_PULSE_EXIT", diagnostics };
  }

  // Early thesis failure — only after a short observation window and two
  // consecutive qualifying snapshots. This is faster than V5 but not one-tick reactive.
  const adverseEnough =
    maeR >= cfg.slcEarlyFailureMinMaeR || currentR <= -cfg.slcEarlyFailureMinMaeR;
  const unprotected =
    (trade.smartPmState ?? "UNPROTECTED") === "UNPROTECTED" &&
    (trade.protectedProfitR ?? 0) <= 0;
  const earlyQualified =
    timeInTradeMs >= 1_500 &&
    mfeR < cfg.slcEarlyFailureMaxMfeR &&
    unprotected &&
    adverseEnough &&
    early.count >= cfg.slcEarlyFailureMinConfirms;

  if (earlyQualified) {
    trade.slcEarlyFailurePersistCount =
      (trade.slcEarlyFailurePersistCount ?? 0) + 1;
    trade.slcSmallHarvestPersistCount = 0;
  } else {
    trade.slcEarlyFailurePersistCount = 0;
  }

  // Small-profit harvest: require real positive room plus a giveback, then any
  // two independent deterioration signals. V5 required every signal at once
  // and therefore surrendered too many modest greens.
  const minProfitR = minProfitableRAfterCosts({ cfg, spread: f.spread });
  const momentumDeteriorating =
    trade.side === "BUY"
      ? f.acceleration < 0 && f.signedImbalance1s < 0
      : f.acceleration > 0 && f.signedImbalance1s > 0;
  const depthAgainst = early.flags.depthAgainst;
  const surrenderingFavourable =
    mfeR - currentR >= cfg.slcSmallHarvestMinSurrenderR &&
    mfeR >= cfg.slcSmallHarvestMinMfeR;
  const stillProfitable = currentR >= minProfitR;
  const smallProfitEligible = mfeR >= cfg.slcSmallHarvestMinMfeR;
  const velSoft =
    trade.side === "BUY"
      ? f.midVel250 <= cfg.momentumVelMin
      : f.midVel250 >= -cfg.momentumVelMin;
  const pulseHealthWeak = pulseHealthScore < 55;
  const deteriorationConfirms =
    Number(momentumDeteriorating) +
    Number(depthAgainst) +
    Number(velSoft) +
    Number(pulseHealthWeak);
  const harvestQualified =
    cfg.slcSmallProfitHarvestEnabled &&
    !earlyQualified &&
    timeInTradeMs >= 1_500 &&
    smallProfitEligible &&
    stillProfitable &&
    surrenderingFavourable &&
    deteriorationConfirms >= 2;

  if (harvestQualified) {
    trade.slcSmallHarvestPersistCount =
      (trade.slcSmallHarvestPersistCount ?? 0) + 1;
  } else if (!earlyQualified) {
    trade.slcSmallHarvestPersistCount = 0;
  }

  const diagnostics = {
    ...baseDiag,
    earlyFailurePersistCount: trade.slcEarlyFailurePersistCount ?? 0,
    smallHarvestPersistCount: trade.slcSmallHarvestPersistCount ?? 0,
    smallProfitEligible,
    smallProfitStillProfitable: stillProfitable,
    momentumDeteriorating,
    depthAgainst,
    surrenderingFavourable,
    pulseHealthScore,
    progressStalled
  };
  trade.lastLossControllerAssessment = diagnostics;

  if (
    earlyQualified &&
    (trade.slcEarlyFailurePersistCount ?? 0) >= SMART_LOSS_PERSIST_SNAPSHOTS
  ) {
    return { exitReason: "SMART_EARLY_THESIS_FAILURE", diagnostics };
  }

  if (
    harvestQualified &&
    (trade.slcSmallHarvestPersistCount ?? 0) >= SMART_LOSS_PERSIST_SNAPSHOTS
  ) {
    return { exitReason: "SMART_SMALL_PROFIT_HARVEST", diagnostics };
  }

  return { exitReason: null, diagnostics };
}
