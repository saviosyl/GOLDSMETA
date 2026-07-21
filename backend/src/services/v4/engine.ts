import { createHash } from "crypto";
import { v4Config } from "./config";
import { evaluateMandatoryGates, scoreSetupQuality } from "./gatesAndScore";
import { mlMetaFilter } from "./mlMetaFilter";
import { isNewsBlackout, type EconomicEvent } from "./newsCalendar";
import {
  atrFromBars,
  buildVolumeProfile,
  profilesConflictMaterially
} from "./profileEngine";
import { classifyRegime } from "./regimeEngine";
import { computeStructuralStop } from "./stopEngine";
import { detectStrategyPatterns } from "./strategies";
import { attachNetRr, computeTargets, estimateCosts } from "./targetCostEngine";
import type {
  V4Bar,
  V4EngineResult,
  V4LockedPlan,
  V4PlanRelation,
  V4ProfileSource,
  V4SetupCandidate
} from "./types";

export interface V4EngineInput {
  bars15: V4Bar[];
  bars60: V4Bar[];
  session: string;
  symbol?: string;
  environment: "LIVE" | "TEST" | "RESEARCH";
  parentDecisionId?: string | null;
  /** Optional COMEX GC profile fields when available. */
  gcProfile?: {
    poc: number | null;
    vah: number | null;
    val: number | null;
    asOf: string;
    barCount: number;
    volumeObservations: number;
  } | null;
  xauProfile: {
    source?: V4ProfileSource;
    poc: number | null;
    vah: number | null;
    val: number | null;
    hvn?: number[];
    lvn?: number[];
    sessionHigh?: number | null;
    sessionLow?: number | null;
    priorDayHigh?: number | null;
    priorDayLow?: number | null;
    pocMigration?: "UP" | "DOWN" | "FLAT" | "UNKNOWN";
    asOf: string;
    barCount: number;
    volumeObservations: number;
  };
  economicEvents?: EconomicEvent[];
  hasActiveLockedPlan?: boolean;
  activePlan?: V4LockedPlan | null;
  manualSpreadPoints?: number | null;
  atrPercentile?: number | null;
  staleEvent?: boolean;
  duplicateEvent?: boolean;
  nowIso?: string;
}

const idFor = (parts: string[]): string =>
  createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 20);

const relateToActive = (
  active: V4LockedPlan | null | undefined,
  bias: string,
  direction: "BUY" | "SELL" | null
): V4PlanRelation | null => {
  if (!active) return null;
  if (!direction) return "NEUTRAL_TO_ACTIVE_PLAN";
  if (direction === active.direction) return "SUPPORTS_ACTIVE_PLAN";
  if (bias.includes("BIAS") && direction !== active.direction) return "CONFLICTS_WITH_ACTIVE_PLAN";
  return "WEAKENS_ACTIVE_PLAN";
};

/**
 * GoldMeta V4 engine — research/shadow.
 * Always returns actionable: false until Stage D gates pass and flag enabled.
 */
export function evaluateV4(input: V4EngineInput): V4EngineResult {
  const generatedAt = input.nowIso ?? new Date().toISOString();
  const confirmed15 = input.bars15.filter((b) => b.confirmed);
  const lastBar = confirmed15[confirmed15.length - 1];
  const barTime = lastBar?.time ?? generatedAt;
  const atr = atrFromBars(confirmed15);
  const news = isNewsBlackout(
    generatedAt,
    input.economicEvents ?? [],
    v4Config.news.blackoutMinutesBefore,
    v4Config.news.blackoutMinutesAfter
  );

  const xau = buildVolumeProfile({
    source: input.xauProfile.source ?? "XAUUSD_TV",
    session: input.session,
    poc: input.xauProfile.poc,
    vah: input.xauProfile.vah,
    val: input.xauProfile.val,
    hvn: input.xauProfile.hvn,
    lvn: input.xauProfile.lvn,
    sessionHigh: input.xauProfile.sessionHigh,
    sessionLow: input.xauProfile.sessionLow,
    priorDayHigh: input.xauProfile.priorDayHigh,
    priorDayLow: input.xauProfile.priorDayLow,
    pocMigration: input.xauProfile.pocMigration,
    barCount: input.xauProfile.barCount,
    volumeObservations: input.xauProfile.volumeObservations,
    asOf: input.xauProfile.asOf,
    atr
  });

  const gc = input.gcProfile
    ? buildVolumeProfile({
        source: "COMEX_GC",
        session: input.session,
        poc: input.gcProfile.poc,
        vah: input.gcProfile.vah,
        val: input.gcProfile.val,
        barCount: input.gcProfile.barCount,
        volumeObservations: input.gcProfile.volumeObservations,
        asOf: input.gcProfile.asOf,
        atr
      })
    : null;

  const profileConflict = profilesConflictMaterially(xau, gc, atr);
  const primaryProfile = gc?.valid ? gc : xau;

  const { regime, bias, notes } = classifyRegime({
    bars15: input.bars15,
    bars60: input.bars60,
    atr,
    atrPercentile: input.atrPercentile ?? null,
    profile: primaryProfile,
    newsBlackout: news.blackout,
    session: input.session
  });

  const analysis = {
    strategyVersion: "4" as const,
    generatedAt,
    barTime,
    symbol: input.symbol ?? "XAUUSD",
    timeframe: "15",
    regime,
    bias,
    atr,
    atrPercentile: input.atrPercentile ?? null,
    session: input.session,
    xauProfile: xau,
    gcProfile: gc,
    profileConflict,
    newsBlackout: news.blackout,
    notes: [
      ...notes,
      ...(news.event ? [`NEWS BLACKOUT: ${news.event.title}`] : []),
      ...(profileConflict ? ["Material XAUUSD vs GC profile conflict"] : []),
      "WAIT — NO VALIDATED EDGE unless all gates pass"
    ]
  };

  const patterns = primaryProfile.valid
    ? detectStrategyPatterns({ bars: input.bars15, profile: primaryProfile, regime })
    : [];
  // Prefer breakout family when both fire — still separately scored later
  const pattern = patterns[0] ?? null;

  let stop = null;
  let targets = null;
  let costs = null;
  let quality = null;
  let lockedPlan: V4LockedPlan | null = null;
  let candidate: V4SetupCandidate | null = null;

  if (pattern && lastBar) {
    stop = computeStructuralStop({
      direction: pattern.direction,
      entry: pattern.entryHint,
      atr,
      spreadPoints:
        input.manualSpreadPoints ??
        v4Config.costs.defaultSpreadPointsBySession[input.session] ??
        0.4,
      bars: input.bars15,
      profile: primaryProfile,
      rejectionLow: pattern.direction === "BUY" ? pattern.structureRef : null,
      rejectionHigh: pattern.direction === "SELL" ? pattern.structureRef : null
    });

    if (!stop.rejected && stop.price != null && stop.distance != null) {
      costs = attachNetRr(
        estimateCosts({
          session: input.session,
          riskDistance: stop.distance,
          manualSpreadPoints: input.manualSpreadPoints
        }),
        stop.distance
      );
      targets = computeTargets({
        direction: pattern.direction,
        entry: pattern.entryHint,
        stop: stop.price,
        profile: primaryProfile,
        opposingLevels: []
      });
    }
  }

  const ml = mlMetaFilter(v4Config.flags.mlMetaFilterEnabled, {
    qualityScore: 0,
    netRrTp2: costs?.netRrTp2 ?? null,
    atrPercentile: input.atrPercentile ?? null,
    session: input.session,
    regime,
    strategyFamily: pattern?.family ?? "NONE",
    direction: pattern?.direction ?? "BUY",
    spreadCostR: costs?.totalCostR ?? null,
    confirmationBars: pattern ? v4Config.confirmation.minBars : 0,
    gcConfirmed: Boolean(gc?.valid)
  });

  const gates = evaluateMandatoryGates({
    barConfirmed: Boolean(lastBar?.confirmed),
    marketDataValid: Boolean(lastBar && atr != null),
    profile: primaryProfile,
    profileConflict,
    regime,
    session: input.session,
    pattern,
    confirmationBars: pattern ? v4Config.confirmation.minBars : 0,
    atr,
    stop,
    targets,
    costs,
    hasActiveLockedPlan: Boolean(input.hasActiveLockedPlan),
    newsBlackout: news.blackout,
    staleEvent: Boolean(input.staleEvent),
    duplicateEvent: Boolean(input.duplicateEvent),
    mlDecision: ml.decision
  });

  if (pattern && gates.passed && stop?.price != null && targets && !targets.rejected && costs) {
    quality = scoreSetupQuality({
      pattern,
      regime,
      profile: primaryProfile,
      confirmationBars: v4Config.confirmation.minBars,
      atrPercentile: input.atrPercentile ?? null,
      session: input.session,
      gcConfirmed: Boolean(gc?.valid),
      profileConflict,
      netRrTp2: costs.netRrTp2
    });

    if (quality.total >= v4Config.quality.minShadowPlanQuality) {
      const planId = idFor([
        "v4plan",
        pattern.family,
        pattern.direction,
        barTime,
        String(pattern.entryHint),
        String(stop.price)
      ]);
      lockedPlan = {
        planId,
        strategyVersion: "4",
        strategyFamily: pattern.family,
        profileVersion: v4Config.profileVersion,
        configVersion: v4Config.configVersion,
        direction: pattern.direction,
        entry: pattern.entryHint,
        stopLoss: stop.price,
        tp1: targets.selected.tp1,
        tp2: targets.selected.tp2,
        tp3: targets.selected.tp3,
        riskDistance: stop.distance!,
        createdAt: generatedAt,
        barTime,
        expiryBarTime: null,
        session: input.session,
        regime,
        quality,
        costs,
        netRrTp2: costs.netRrTp2,
        locked: true,
        environment: input.environment,
        shadow: true
      };
    } else {
      gates.failures.push("NO_STRATEGY_PATTERN");
      gates.reasons.push(`Quality ${quality.total}/100 below minimum ${v4Config.quality.minShadowPlanQuality}`);
    }
  }

  if (pattern) {
    candidate = {
      candidateId: idFor(["v4cand", pattern.family, barTime, pattern.direction]),
      strategyVersion: "4",
      strategyFamily: pattern.family,
      status: lockedPlan ? "VALIDATED_PLAN" : gates.passed ? "CONFIRMATION" : "CANDIDATE",
      direction: pattern.direction,
      observedAt: generatedAt,
      barTime,
      levelsHint: {
        entryZoneLow: pattern.entryHint,
        entryZoneHigh: pattern.entryHint,
        structureRef: pattern.structureRef
      },
      confirmationBars: v4Config.confirmation.minBars,
      cancelReason: gates.passed ? null : gates.reasons[0] ?? null,
      gateFailures: gates.failures,
      lockedPlan,
      parentDecisionId: input.parentDecisionId ?? null,
      environment: input.environment,
      shadow: true
    };
  }

  const noTradeReasons =
    gates.reasons.length > 0
      ? gates.reasons
      : lockedPlan
        ? []
        : ["WAIT — NO VALIDATED EDGE"];

  return {
    strategyVersion: "4",
    engineVersion: v4Config.engineVersion,
    configVersion: v4Config.configVersion,
    deploymentStage: v4Config.deploymentStage,
    actionable: false,
    analysis,
    candidate,
    lockedPlan,
    gateFailures: gates.failures,
    noTradeReasons,
    relationToActivePlan: relateToActive(
      input.activePlan,
      bias,
      pattern?.direction ?? null
    ),
    generatedAt
  };
}
