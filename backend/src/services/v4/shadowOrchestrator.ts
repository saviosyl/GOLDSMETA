import { createHash } from "crypto";
import type { MarketSnapshot, TradingViewPayload } from "../../models/types";
import { logger } from "../logging/logger";
import type { GoldMetaStore } from "../storage/types";
import { v4Config } from "./config";
import { evaluateV4 } from "./engine";
import { fetchComexGcProfile } from "./gcProvider";
import { applyBarToShadowPlan, relateToShadowPlan } from "./shadowLifecycle";
import type {
  V4LockedShadowPlan,
  V4ShadowAnalysisRecord,
  V4ShadowCandidateRecord
} from "./shadowTypes";
import type { V4Bar } from "./types";
import { buildV4InputFromV3 } from "./shadowRunner";

const idFor = (parts: string[]): string =>
  createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 22);

export interface V4ShadowCycleResult {
  analysis: V4ShadowAnalysisRecord;
  candidate: V4ShadowCandidateRecord | null;
  plan: V4LockedShadowPlan | null;
  activePlanRelation: string | null;
  mutationAttempt: boolean;
}

/**
 * Full Stage B shadow cycle — analysis → candidate → optional locked plan → lifecycle update.
 * Never actionable. Never calls broker. Never mutates V3.
 */
export async function runV4ShadowLifecycle(input: {
  store: GoldMetaStore;
  userId: string;
  payload: TradingViewPayload;
  snapshot: MarketSnapshot;
  environment: "LIVE" | "TEST";
  parentDecisionId: string;
  eventId: string;
}): Promise<V4ShadowCycleResult | null> {
  if (!v4Config.flags.shadowComputeEnabled) return null;

  try {
    const gc = fetchComexGcProfile({
      session: input.snapshot.sessionVolumeProfile?.session ?? "UNKNOWN"
    });

    const v3Active = await Promise.resolve(input.store.listActiveSetups(input.userId));
    const existingPlans =
      (await input.store.listV4ShadowPlans?.(input.userId, input.environment, 20)) ?? [];
    const openPlan = existingPlans.find(
      (p) =>
        p.status === "WAITING_FOR_ENTRY" ||
        p.status === "ENTERED" ||
        p.status === "TP1_HIT" ||
        p.status === "TP2_HIT"
    );

    const engineInput = buildV4InputFromV3({
      payload: input.payload,
      snapshot: input.snapshot,
      environment: input.environment,
      parentDecisionId: input.parentDecisionId,
      hasActiveLockedPlan: Boolean(openPlan) || v3Active.length > 0
    });
    // Honest GC: null until an authorised feed is wired (do not fabricate).
    engineInput.gcProfile = null;

    const evaluated = evaluateV4({
      ...engineInput,
      nowIso: new Date().toISOString()
    });

    // Apply GC missing penalty when confirmation unavailable
    if (evaluated.lockedPlan && gc.profileQuality === "UNAVAILABLE") {
      evaluated.lockedPlan.quality = {
        ...evaluated.lockedPlan.quality,
        total: Math.max(
          0,
          evaluated.lockedPlan.quality.total - v4Config.quality.missingGcQualityPenalty
        ),
        components: {
          ...evaluated.lockedPlan.quality.components,
          volumeConfirmation: Math.max(
            0,
            (evaluated.lockedPlan.quality.components.volumeConfirmation ?? 0) -
              v4Config.quality.missingGcQualityPenalty
          )
        }
      };
    }

    const ohlcv = input.snapshot.ohlcv;
    const analysis: V4ShadowAnalysisRecord = {
      analysisId: idFor(["v4a", input.eventId, input.parentDecisionId]),
      strategyVersion: "4",
      mode: "SHADOW",
      environment: input.environment,
      eventId: input.eventId,
      parentDecisionId: input.parentDecisionId,
      barTime: evaluated.analysis.barTime,
      timeframe: evaluated.analysis.timeframe,
      ohlc: {
        open: ohlcv?.open ?? null,
        high: ohlcv?.high ?? null,
        low: ohlcv?.low ?? null,
        close: ohlcv?.close ?? null
      },
      session: evaluated.analysis.session,
      regime: evaluated.analysis.regime,
      bias: evaluated.analysis.bias,
      atr: evaluated.analysis.atr,
      atrPercentile: evaluated.analysis.atrPercentile,
      xauPoc: evaluated.analysis.xauProfile?.poc ?? null,
      vah: evaluated.analysis.xauProfile?.vah ?? null,
      val: evaluated.analysis.xauProfile?.val ?? null,
      profileSource: evaluated.analysis.xauProfile?.source ?? "UNKNOWN",
      profileAsOf: evaluated.analysis.xauProfile?.asOf ?? null,
      gcConfirmation: gc.profileQuality === "UNAVAILABLE" ? "UNAVAILABLE" : "AVAILABLE",
      htfContext: evaluated.analysis.notes.find((n) => n.includes("EMA")) ?? evaluated.analysis.regime,
      gateFailures: evaluated.gateFailures,
      rejectionReasons: evaluated.noTradeReasons,
      configVersion: v4Config.configVersion,
      profileVersion: v4Config.profileVersion,
      engineVersion: v4Config.engineVersion,
      generatedAt: evaluated.generatedAt,
      actionable: false
    };

    let candidate: V4ShadowCandidateRecord | null = null;
    let plan: V4LockedShadowPlan | null = null;
    const mutationAttempt = false;

    // Advance existing open plan first (lifecycle)
    if (v4Config.flags.shadowLifecycleEnabled && openPlan) {
      const bar: V4Bar = {
        time: input.snapshot.marketDataTime,
        open: ohlcv?.open ?? ohlcv?.close ?? openPlan.entry,
        high: ohlcv?.high ?? openPlan.entry,
        low: ohlcv?.low ?? openPlan.entry,
        close: ohlcv?.close ?? openPlan.entry,
        volume: ohlcv?.volume ?? null,
        confirmed: Boolean(input.snapshot.isConfirmedBar),
        timeframe: "15"
      };
      plan = applyBarToShadowPlan(openPlan, bar, input.eventId);
      if (input.store.saveV4ShadowPlan) {
        await input.store.saveV4ShadowPlan(input.userId, plan);
      }
    }

    // Create candidate / plan only when no open shadow plan and gates allow
    if (
      v4Config.flags.shadowLifecycleEnabled &&
      !openPlan &&
      evaluated.candidate &&
      !v4Config.flags.actionableSetupEnabled &&
      !v4Config.flags.liveSetupCreation
    ) {
      candidate = {
        candidateId: evaluated.candidate.candidateId,
        strategyVersion: "4",
        mode: "SHADOW",
        environment: input.environment,
        strategyFamily: evaluated.candidate.strategyFamily,
        direction: evaluated.candidate.direction,
        status:
          evaluated.lockedPlan &&
          evaluated.lockedPlan.quality.total >= v4Config.quality.minShadowPlanQuality
            ? "PROMOTED"
            : evaluated.gateFailures.length
              ? "CANCELLED"
              : "CANDIDATE",
        createdAt: evaluated.generatedAt,
        barTime: evaluated.candidate.barTime,
        confirmationBarsRequired: v4Config.confirmation.minBars,
        confirmationBarsSeen: evaluated.candidate.confirmationBars,
        expiresAfterBars: v4Config.confirmation.candidateExpiryBars,
        barsOpen: 0,
        cancelReason: evaluated.candidate.cancelReason,
        structureRef: evaluated.candidate.levelsHint.structureRef,
        entryHint: evaluated.candidate.levelsHint.entryZoneLow,
        parentAnalysisId: analysis.analysisId,
        parentDecisionId: input.parentDecisionId,
        actionable: false,
        updatedAt: evaluated.generatedAt
      };

      const geometryOk =
        evaluated.lockedPlan != null &&
        evaluated.lockedPlan.riskDistance >= v4Config.stop.absoluteMinPoints &&
        !evaluated.gateFailures.includes("NO_TRADE_INVALID_RISK_GEOMETRY");

      if (
        evaluated.lockedPlan &&
        geometryOk &&
        evaluated.lockedPlan.quality.total >= v4Config.quality.minShadowPlanQuality
      ) {
        plan = {
          planId: evaluated.lockedPlan.planId,
          strategyVersion: "4",
          mode: "SHADOW",
          environment: input.environment,
          strategyFamily: evaluated.lockedPlan.strategyFamily,
          direction: evaluated.lockedPlan.direction,
          entry: evaluated.lockedPlan.entry,
          stopLoss: evaluated.lockedPlan.stopLoss,
          tp1: evaluated.lockedPlan.tp1,
          tp2: evaluated.lockedPlan.tp2,
          tp3: evaluated.lockedPlan.tp3,
          riskDistance: evaluated.lockedPlan.riskDistance,
          quality: evaluated.lockedPlan.quality,
          costs: evaluated.lockedPlan.costs,
          createdAt: evaluated.lockedPlan.createdAt,
          barTime: evaluated.lockedPlan.barTime,
          expiryBarTime: evaluated.lockedPlan.expiryBarTime,
          session: evaluated.lockedPlan.session,
          regime: evaluated.lockedPlan.regime,
          profileVersion: evaluated.lockedPlan.profileVersion,
          configVersion: evaluated.lockedPlan.configVersion,
          engineVersion: v4Config.engineVersion,
          locked: true,
          status: "WAITING_FOR_ENTRY",
          candidateId: candidate.candidateId,
          parentDecisionId: input.parentDecisionId,
          actionable: false,
          entryTriggeredAt: null,
          resolvedAt: null,
          barsToEntry: 0,
          barsInTrade: null,
          grossR: null,
          netR: null,
          mfe: null,
          mae: null,
          appliedBarEventIds: [],
          lastBarTime: null,
          mutationAttempts: 0,
          updatedAt: evaluated.generatedAt
        };
      } else if (
        evaluated.gateFailures.includes("NO_TRADE_INVALID_RISK_GEOMETRY") ||
        (evaluated.lockedPlan &&
          evaluated.lockedPlan.riskDistance < v4Config.stop.absoluteMinPoints)
      ) {
        candidate.status = "CANCELLED";
        candidate.cancelReason = "NO_TRADE_INVALID_RISK_GEOMETRY";
      }
    }

    if (v4Config.flags.shadowPersistEnabled) {
      await input.store.saveV4ShadowAnalysis?.(input.userId, analysis);
      if (candidate) await input.store.saveV4ShadowCandidate?.(input.userId, candidate);
      if (plan && !openPlan) await input.store.saveV4ShadowPlan?.(input.userId, plan);
      await input.store.saveV4ShadowResult?.(input.userId, {
        ...evaluated,
        shadowId: `v4_${input.parentDecisionId}`,
        userId: input.userId,
        parentDecisionId: input.parentDecisionId,
        savedAt: new Date().toISOString(),
        analysisRecordId: analysis.analysisId,
        gcConfirmation: analysis.gcConfirmation,
        gcNote: gc.note,
        actionable: false as const,
        mode: "SHADOW" as const
      });
    }

    return {
      analysis,
      candidate,
      plan,
      activePlanRelation: openPlan
        ? relateToShadowPlan(
            openPlan,
            evaluated.analysis.bias,
            evaluated.candidate?.direction ?? null
          )
        : null,
      mutationAttempt
    };
  } catch (err) {
    logger.warn("V4 shadow lifecycle failed (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
      parentDecisionId: input.parentDecisionId
    });
    return null;
  }
}
