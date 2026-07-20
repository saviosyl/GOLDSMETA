import { createHash } from "crypto";
import { BACKEND_VERSION, decisionConfig, RULE_CONFIG_VERSION } from "../../config/decisionConfig";
import type {
  AiExplanation,
  DecisionDirection,
  DecisionRecord,
  TradingViewPayload,
  TrendDirection
} from "../../models/types";
import { addMsIso, nowIso } from "../../utils/time";
import { AiExplainer } from "../ai/explainer";
import { buildFallbackExplanation } from "../ai/fallback";
import { sendDecisionPushIfMeaningful } from "../notifications/push";
import { evaluateDataQuality } from "../snapshot/dataQuality";
import { mergeSnapshot } from "../snapshot/mergeSnapshot";
import type { InMemoryStore } from "../storage/inMemoryStore";
import { calculateConfidence } from "./confidence";
import { evaluateHardGuards } from "./hardGuards";
import { scoreSnapshot, directionFromScore } from "./scoringEngine";
import { buildTradePlan } from "./tradePlanEngine";

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

export const processDecisionPipeline = async (
  payload: TradingViewPayload,
  stableEventId: string,
  store: InMemoryStore,
  aiExplainer = new AiExplainer()
): Promise<DecisionRecord> => {
  store.saveRawEvent(payload, stableEventId);

  const previousMeaningfulDecision = store.latestMeaningfulDecision();
  const snapshot = mergeSnapshot(payload, stableEventId);
  const dataQuality = evaluateDataQuality(snapshot);
  const score = scoreSnapshot(snapshot);
  const initialDecision = directionFromScore(score.score);
  const initialPlan = buildTradePlan(snapshot, initialDecision);
  const hardGuards = evaluateHardGuards(snapshot, initialDecision, initialPlan, dataQuality);
  const guardedDecision: DecisionDirection = hardGuards.passed ? initialDecision : "WAIT";
  const guardedPlan = guardedDecision === initialDecision ? initialPlan : buildTradePlan(snapshot, "WAIT");
  const confidence = calculateConfidence(dataQuality, score);
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
  const htfBias: TrendDirection | null = snapshot.trend?.direction ?? null;

  const decision: DecisionRecord = {
    schemaVersion: "1.0",
    decisionId: decisionIdFor(stableEventId, generatedAt),
    userId: metadataString(payload, "userId") ?? "default-user",
    symbol: "XAUUSD",
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
    lastKnownPrice: snapshot.price,
    dataSourceLabel: dataQuality.quality === "STALE" ? "STALE" : "LIVE"
  };

  decision.notificationSent = await sendDecisionPushIfMeaningful(
    store,
    decision,
    previousMeaningfulDecision
  );

  store.saveDecision(decision);
  return decision;
};
