import { createHash } from "crypto";
import { BACKEND_VERSION, decisionConfig, RULE_CONFIG_VERSION } from "../../config/decisionConfig";
import type {
  AiExplanation,
  CanonicalSymbolIdentity,
  DecisionDirection,
  DecisionMarketStructure,
  DecisionRecord,
  MarketSnapshot,
  PricePointMeta,
  TradingViewPayload,
  TrendDirection
} from "../../models/types";
import { addMsIso, nowIso } from "../../utils/time";
import { AiExplainer } from "../ai/explainer";
import { buildFallbackExplanation } from "../ai/fallback";
import { sendDecisionPushIfMeaningful } from "../notifications/push";
import { sendPlanLifecycleNotifications } from "../notifications/planLifecycleNotifications";
import { evaluateDataQuality } from "../snapshot/dataQuality";
import { mergeSnapshot } from "../snapshot/mergeSnapshot";
import type { DecisionEnvironment, GoldMetaStore } from "../storage/types";
import { isPositivePrice } from "../../utils/money";
import { calculateConfidence } from "./confidence";
import { evaluateHardGuards } from "./hardGuards";
import { scoreSnapshot, directionFromScore } from "./scoringEngine";
import { buildTradePlan } from "./tradePlanEngine";
import { createSetupFromDecision } from "../setup/createSetup";
import { logger } from "../logging/logger";
import { runV4ShadowLifecycle } from "../v4/shadowOrchestrator";
import { processSessionPlanLifecycle } from "./sessionPlanLifecycle";
import {
  extractPlanSourceKey,
  isConfirmAlert,
  isQuoteAlert,
  metadataString as alertMetadataString,
  resolveAlertRole
} from "./alertRole";
import { isSharedFeedSourceUser } from "../marketFeed/sharedFeed";

const disclaimer =
  "GoldMeta provides market analysis and decision support only. Trading involves substantial risk.";

const unique = (values: string[]): string[] => [...new Set(values)];

const metadataString = (payload: TradingViewPayload, key: string): string | null => {
  const value = payload.metadata?.[key];
  return typeof value === "string" ? value : null;
};

const decisionIdFor = (stableEventId: string, generatedAt: string): string =>
  createHash("sha256").update(`${stableEventId}|${generatedAt}`).digest("hex").slice(0, 24);

const applyAiDowngrade = (
  decision: DecisionDirection,
  ai: AiExplanation,
  hardGuardsPassed: boolean
): { decision: DecisionDirection; safetyDowngraded: boolean; reasonCodes: string[] } => {
  if (decision !== "WAIT" && hardGuardsPassed && ai.recommendWait) {
    return {
      decision: "WAIT",
      safetyDowngraded: true,
      reasonCodes: ["AI_WAIT_DOWNGRADE"]
    };
  }
  return {
    decision,
    safetyDowngraded: false,
    reasonCodes: []
  };
};

const reasonSummaryFor = (ai: AiExplanation, finalDecision: DecisionDirection): string[] => {
  if (ai.summary.length > 0) {
    return ai.summary;
  }
  if (finalDecision === "WAIT") {
    return ["WAIT until the deterministic setup is complete and passes safety rules."];
  }
  return [`${finalDecision} setup passes deterministic thresholds and safety guards.`];
};

const resolveVolumeProfile = (
  snapshot: MarketSnapshot
): { poc: number | null; vah: number | null; val: number | null } => {
  const poc = snapshot.levels?.pocAll ?? snapshot.sessionVolumeProfile?.poc ?? null;
  const vah = snapshot.levels?.vahAll ?? snapshot.sessionVolumeProfile?.vah ?? null;
  const val = snapshot.levels?.valAll ?? snapshot.sessionVolumeProfile?.val ?? null;
  return {
    poc: isPositivePrice(poc) ? poc : null,
    vah: isPositivePrice(vah) ? vah : null,
    val: isPositivePrice(val) ? val : null
  };
};

const marketStructureFor = (snapshot: MarketSnapshot): DecisionMarketStructure => {
  const profile = resolveVolumeProfile(snapshot);
  return {
    trend: snapshot.trend?.direction ?? null,
    trendStrength: typeof snapshot.trend?.strength === "number" ? snapshot.trend.strength : null,
    poc: profile.poc,
    vah: profile.vah,
    val: profile.val,
    confirmationClassification: snapshot.confirmationCandle?.classification ?? null,
    confirmationDirection: snapshot.confirmationCandle?.direction ?? null,
    confirmationCandleType: snapshot.confirmationCandle?.candleType ?? null
  };
};

/**
 * Pine Bridge 3.0 publishes explicit MTF components. Day-trade direction is the 1H
 * component; the aggregate trend may also include 15M/5M and is therefore not a
 * reliable replacement for the higher-timeframe bias.
 */
const higherTimeframeBiasFor = (snapshot: MarketSnapshot): TrendDirection | null => {
  const oneHour = snapshot.trend?.components?.find((component) => {
    const sourceTimeframe = component.sourceTimeframe.trim().toUpperCase();
    return (
      sourceTimeframe === "60" ||
      sourceTimeframe === "60M" ||
      sourceTimeframe === "1H" ||
      component.name.trim().toLowerCase() === "gm_direction_1h"
    );
  });
  if (oneHour) return oneHour.direction;

  // A native confirmed 1H payload may use its aggregate trend. Never relabel a
  // 1M/5M/15M aggregate direction as the Day Trade 1H bias.
  return snapshot.timeframe === "60" ? snapshot.trend?.direction ?? null : null;
};

const oneHourBiasSourceCloseTimeFor = (
  payload: TradingViewPayload,
  hasOneHourBias: boolean
): string | null => {
  if (!hasOneHourBias) return null;
  const fromMetadata = alertMetadataString(payload, "oneHourBiasSourceTime");
  if (fromMetadata) return fromMetadata;

  const fromOptionalIndicators = (
    payload.optionalIndicators?.oneHourBias as { oneHourBiasSourceTime?: unknown } | undefined
  )?.oneHourBiasSourceTime;
  if (typeof fromOptionalIndicators === "string" && fromOptionalIndicators.trim().length > 0) {
    return fromOptionalIndicators.trim();
  }
  return null;
};

const oneHourBiasConfirmedFor = (
  payload: TradingViewPayload,
  hasOneHourBias: boolean
): boolean | null => {
  if (!hasOneHourBias) return null;
  const explicit = payload.metadata?.oneHourBiasConfirmed;
  if (typeof explicit === "boolean") return explicit;
  const fromOptionalIndicators = (
    payload.optionalIndicators?.oneHourBias as { oneHourBiasConfirmed?: unknown } | undefined
  )?.oneHourBiasConfirmed;
  if (typeof fromOptionalIndicators === "boolean") return fromOptionalIndicators;
  return null;
};

const quoteAgeSeconds = (timestamp: string | null, receivedAt: string): number | null => {
  if (!timestamp) return null;
  const ageMs = Date.parse(receivedAt) - Date.parse(timestamp);
  return Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs / 1000)) : null;
};

const pricePoint = (
  value: number | null | undefined,
  snapshot: MarketSnapshot,
  source: string
): PricePointMeta | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return {
    source,
    symbol: snapshot.symbol,
    exchangeOrBroker: snapshot.exchange,
    timeframe: snapshot.timeframe,
    timestamp: snapshot.marketDataTime,
    receivedAt: snapshot.receivedAt,
    quoteAgeSeconds: quoteAgeSeconds(snapshot.marketDataTime, snapshot.receivedAt),
    value
  };
};

const symbolIdentityFor = (snapshot: MarketSnapshot): CanonicalSymbolIdentity => ({
  tradingViewSymbol: snapshot.symbol,
  exchange: snapshot.exchange,
  ctraderSymbolId: null,
  canonicalSymbol: "XAUUSD"
});

const dataSourceLabelFor = (
  environment: DecisionEnvironment,
  isTestDecision: boolean,
  dataQuality: { quality: string }
): DecisionRecord["dataSourceLabel"] => {
  if (environment === "TEST" || isTestDecision) return "TEST";
  if (dataQuality.quality === "STALE") return "STALE";
  if (dataQuality.quality === "CONFLICTED" || dataQuality.quality === "INVALID") return "STALE";
  return "LIVE";
};

export const processDecisionPipeline = async (
  userId: string,
  payload: TradingViewPayload,
  stableEventId: string,
  store: GoldMetaStore,
  aiExplainer = new AiExplainer(),
  options: {
    environment?: DecisionEnvironment;
    isTestDecision?: boolean;
    webhookId?: string;
  } = {}
): Promise<DecisionRecord> => {
  const environment = options.environment ?? "LIVE";
  const isTestDecision = options.isTestDecision ?? false;

  await store.saveRawEvent(userId, payload, stableEventId, {
    webhookId: options.webhookId,
    environment,
    isTestEvent: isTestDecision
  });

  const previousMeaningfulDecision = await store.latestMeaningfulDecision(userId);
  const snapshot = mergeSnapshot(payload, stableEventId);
  await store.saveSnapshot(userId, snapshot);
  const dataQuality = evaluateDataQuality(snapshot);
  const score = scoreSnapshot(snapshot);
  const initialDecision = directionFromScore(score.score);
  const initialPlan = buildTradePlan(snapshot, initialDecision);
  const confidence = calculateConfidence(dataQuality, score);
  const hardGuards = evaluateHardGuards(
    snapshot,
    initialDecision,
    initialPlan,
    dataQuality,
    confidence.confidence
  );
  const guardedDecision: DecisionDirection = hardGuards.passed ? initialDecision : "WAIT";
  const guardedPlan = guardedDecision === initialDecision ? initialPlan : buildTradePlan(snapshot, "WAIT");
  const boundedConfidence = hardGuards.passed
    ? confidence.confidence
    : Math.min(confidence.confidence, 40);

  const deterministicInput = {
    snapshot,
    dataQuality,
    score,
    hardGuards,
    guardedDecision,
    guardedPlan
  };

  const fallback = buildFallbackExplanation(
    guardedDecision,
    score,
    hardGuards,
    unique([...dataQuality.warnings, ...hardGuards.warnings])
  );
  const ai = await aiExplainer.explain({
    decision: guardedDecision,
    score,
    guards: hardGuards,
    warnings: fallback.warnings,
    deterministicInput
  });
  const aiDecision = applyAiDowngrade(guardedDecision, ai, hardGuards.passed);
  const finalDecision = aiDecision.decision;
  const finalPlan = finalDecision === guardedDecision ? guardedPlan : buildTradePlan(snapshot, "WAIT");
  const generatedAt = nowIso();
  const reasonCodes = unique([...score.reasonCodes, ...hardGuards.reasonCodes, ...aiDecision.reasonCodes]);
  const allWarnings = unique([...dataQuality.warnings, ...hardGuards.warnings, ...ai.warnings]);
  const role = resolveAlertRole(payload);
  const normalizedPlanSourceKey = extractPlanSourceKey(payload);
  const htfBias = higherTimeframeBiasFor(snapshot);
  const oneHourBiasSourceTime = oneHourBiasSourceCloseTimeFor(payload, htfBias != null);
  const oneHourBiasConfirmed = oneHourBiasConfirmedFor(payload, htfBias != null);

  const decision: DecisionRecord = {
    schemaVersion: "1.0",
    decisionId: decisionIdFor(stableEventId, generatedAt),
    userId,
    symbol: "XAUUSD",
    timeframe: snapshot.timeframe,
    barTime: snapshot.marketDataTime,
    generatedAt,
    marketDataTime: snapshot.marketDataTime,
    validUntil: addMsIso(generatedAt, decisionConfig.decisionTtlMs),
    decision: finalDecision,
    confidence: boundedConfidence,
    confidenceLabel:
      boundedConfidence >= 85
        ? "VERY_HIGH"
        : boundedConfidence >= 70
          ? "HIGH"
          : boundedConfidence >= 45
            ? "MODERATE"
            : "LOW",
    marketRegime: score.marketRegime,
    dataQuality: dataQuality.quality,
    isProvisional: !snapshot.isConfirmedBar,
    setupScore: score.score,
    entry: finalPlan.entry,
    stopLoss: finalPlan.stopLoss,
    takeProfits: finalPlan.takeProfits,
    riskReward: finalPlan.riskReward,
    breakeven: finalPlan.breakeven,
    earlyExit: finalPlan.earlyExit,
    bullishEvidence: score.bullishEvidence,
    bearishEvidence: score.bearishEvidence,
    reasonCodes,
    reasonSummary: reasonSummaryFor({ ...ai, safetyDowngraded: aiDecision.safetyDowngraded }, finalDecision),
    warnings: allWarnings,
    missingInputs: dataQuality.missingInputs,
    invalidation:
      finalDecision === "WAIT"
        ? "Setup remains invalid until all safety guards pass."
        : "Decision invalidates if price accepts beyond the stop-loss structure or an opposite confirmed signal appears.",
    disclaimer,
    lifecycleState: finalDecision === "WAIT" ? "INCOMPLETE" : "ACTIVE",
    snapshotId: snapshot.id,
    ruleConfigVersion: RULE_CONFIG_VERSION,
    pineScriptVersion: metadataString(payload, "scriptVersion"),
    backendVersion: BACKEND_VERSION,
    aiModelId: ai.modelId,
    aiPromptVersion: ai.promptVersion,
    aiSafetyDowngraded: aiDecision.safetyDowngraded,
    notificationSent: false,
    currentSession: snapshot.sessionVolumeProfile?.session ?? null,
    higherTimeframeBias: htfBias,
    alertRole: role,
    planSourceKey: normalizedPlanSourceKey,
    oneHourBiasSourceTime,
    oneHourBiasConfirmed,
    lastKnownPrice: snapshot.price,
    ohlcv: snapshot.ohlcv ?? null,
    marketStructure: marketStructureFor(snapshot),
    dataSourceLabel: dataSourceLabelFor(environment, isTestDecision, dataQuality),
    environment,
    isTestDecision,
    symbolIdentity: symbolIdentityFor(snapshot),
    priceSources: {
      alertClose: pricePoint(snapshot.price, snapshot, isTestDecision ? "TEST_FIXTURE" : "TRADINGVIEW_ALERT"),
      barHigh: pricePoint(snapshot.ohlcv?.high ?? null, snapshot, isTestDecision ? "TEST_FIXTURE" : "TRADINGVIEW_OHLC"),
      barLow: pricePoint(snapshot.ohlcv?.low ?? null, snapshot, isTestDecision ? "TEST_FIXTURE" : "TRADINGVIEW_OHLC"),
      poc: pricePoint(
        snapshot.levels?.pocAll ?? snapshot.sessionVolumeProfile?.poc ?? null,
        snapshot,
        isTestDecision ? "TEST_FIXTURE" : "TRADINGVIEW_VOLUME_PROFILE"
      ),
      vah: pricePoint(
        snapshot.levels?.vahAll ?? snapshot.sessionVolumeProfile?.vah ?? null,
        snapshot,
        isTestDecision ? "TEST_FIXTURE" : "TRADINGVIEW_VOLUME_PROFILE"
      ),
      val: pricePoint(
        snapshot.levels?.valAll ?? snapshot.sessionVolumeProfile?.val ?? null,
        snapshot,
        isTestDecision ? "TEST_FIXTURE" : "TRADINGVIEW_VOLUME_PROFILE"
      )
    }
  };

  decision.notificationSent = await sendDecisionPushIfMeaningful(
    store,
    decision,
    previousMeaningfulDecision
  );

  await store.saveDecision(decision);

  // Stable session plan (Pine 3.0 / 2.1 compat). Quotes/confirms never place orders.
  try {
    // Skip setup creation for quote/confirm-only — analysis plan only.
    if (!isQuoteAlert(role) && !isConfirmAlert(role)) {
      try {
        await createSetupFromDecision(store, decision);
      } catch (error: unknown) {
        logger.warn("Setup creation failed (non-fatal)", {
          decisionId: decision.decisionId,
          error: error instanceof Error ? error.message : "unknown"
        });
      }
    }

    const previousSessionPlan = isSharedFeedSourceUser(userId)
      ? (await store.getActiveSessionPlan?.(userId)) ?? null
      : null;
    const sessionPlan = await processSessionPlanLifecycle({
      userId,
      payload,
      decision,
      store
    });
    if (isSharedFeedSourceUser(userId)) {
      await sendPlanLifecycleNotifications({
        store,
        previousPlan: previousSessionPlan,
        plan: sessionPlan,
        decision,
        sourceEventId: stableEventId
      });
    }
  } catch (error: unknown) {
    logger.warn("Session plan lifecycle failed (non-fatal)", {
      decisionId: decision.decisionId,
      error: error instanceof Error ? error.message : "unknown"
    });
  }

  // GoldMeta V4 LIVE SHADOW — after V3 is stored. Await so Cloud Functions
  // do not freeze before persistence. Errors remain non-fatal inside the runner.
  try {
    await runV4ShadowLifecycle({
      store,
      userId: decision.userId,
      payload,
      snapshot,
      environment,
      parentDecisionId: decision.decisionId,
      eventId: stableEventId
    });
  } catch (error: unknown) {
    logger.warn("V4 shadow lifecycle outer catch (non-fatal)", {
      decisionId: decision.decisionId,
      error: error instanceof Error ? error.message : "unknown"
    });
  }

  return decision;
};
