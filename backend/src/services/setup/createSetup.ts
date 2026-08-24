import { createHash, randomUUID } from "crypto";
import {
  BACKEND_VERSION_PHASE3,
  isSetupTrackingAllowed,
  setupLifecycleConfig
} from "../../config/setupLifecycleConfig";
import type { DecisionRecord } from "../../models/types";
import type { SetupRecord, SetupStatus, SetupStatusTransition } from "../../models/setup";
import { nowIso } from "../../utils/time";
import type { GoldMetaStore } from "../storage/types";
import { logger } from "../logging/logger";

const setupIdFor = (decisionId: string): string =>
  createHash("sha256").update(`setup|${decisionId}`).digest("hex").slice(0, 24);

const transition = (
  from: SetupStatus,
  to: SetupStatus,
  barTime: string | null,
  eventId: string | null,
  reason: string
): SetupStatusTransition => ({
  at: nowIso(),
  from,
  to,
  barTime,
  eventId,
  reason
});

const tpPrice = (decision: DecisionRecord, label: "TP1" | "TP2" | "TP3"): number | null =>
  decision.takeProfits.find((tp) => tp.label === label)?.price ?? null;

/**
 * Create at most one setup from a BUY/SELL decision after safety checks.
 * WAIT never creates a setup. Idempotent on decisionId.
 */
export const createSetupFromDecision = async (
  store: GoldMetaStore,
  decision: DecisionRecord
): Promise<SetupRecord | null> => {
  if (decision.decision === "WAIT") {
    return null;
  }
  if (!setupLifecycleConfig.flags.analysisGenerationEnabled) {
    logger.info("Setup creation skipped — analysisGenerationEnabled=false", {
      decisionId: decision.decisionId
    });
    return null;
  }
  if (!isSetupTrackingAllowed(decision.environment)) {
    logger.info("Setup creation skipped — tracking not allowed for environment", {
      decisionId: decision.decisionId,
      environment: decision.environment
    });
    return null;
  }
  if (decision.symbol !== "XAUUSD" || decision.timeframe !== setupLifecycleConfig.timeframe) {
    return null;
  }
  if (decision.isProvisional || decision.dataQuality === "STALE" || decision.dataQuality === "INVALID") {
    return null;
  }
  if (
    decision.confidence < setupLifecycleConfig.limits.minConfidenceForTrade ||
    (decision.riskReward.tp2 ?? 0) < setupLifecycleConfig.limits.minRiskRewardToTp2
  ) {
    return null;
  }
  if (!decision.entry.price || !decision.stopLoss.price) {
    return null;
  }

  const existing = await store.getSetupByDecisionId(decision.userId, decision.decisionId);
  if (existing) {
    return existing;
  }

  const active = await store.listActiveSetups(decision.userId, decision.environment);
  if (active.length >= setupLifecycleConfig.limits.maxActiveSetups) {
    logger.info("Setup creation skipped — max active setups", {
      decisionId: decision.decisionId,
      active: active.length
    });
    return null;
  }

  const sameBarDup = active.find(
    (s) => s.direction === decision.decision && s.barTime === (decision.barTime ?? decision.marketDataTime)
  );
  if (sameBarDup) {
    return null;
  }

  const entry = decision.entry.price;
  const sl = decision.stopLoss.price;
  const initialRisk = Math.abs(entry - sl);
  if (!(initialRisk > 0)) {
    return null;
  }

  const createdAt = nowIso();
  const status: SetupStatus = "WAITING_FOR_ENTRY";
  const setup: SetupRecord = {
    schemaVersion: "1.0",
    setupId: setupIdFor(decision.decisionId) || randomUUID().replace(/-/g, "").slice(0, 24),
    decisionId: decision.decisionId,
    userId: decision.userId,
    symbol: "XAUUSD",
    timeframe: decision.timeframe ?? setupLifecycleConfig.timeframe,
    direction: decision.decision,
    environment: decision.environment,
    isTestSetup: decision.isTestDecision || decision.environment === "TEST",
    createdAt,
    barTime: decision.barTime ?? decision.marketDataTime,
    session: decision.currentSession,
    levels: {
      entryPrice: entry,
      entryType: decision.entry.type,
      stopLoss: sl,
      tp1: tpPrice(decision, "TP1"),
      tp2: tpPrice(decision, "TP2"),
      tp3: tpPrice(decision, "TP3")
    },
    initialRisk,
    expectedRR: { ...decision.riskReward },
    confidence: decision.confidence,
    trend: decision.marketStructure?.trend ?? decision.higherTimeframeBias,
    poc: decision.marketStructure?.poc ?? null,
    vah: decision.marketStructure?.vah ?? null,
    val: decision.marketStructure?.val ?? null,
    confirmationType: decision.marketStructure?.confirmationClassification ?? null,
    status,
    statusHistory: [
      transition("SIGNAL_CREATED", "SIGNAL_CREATED", decision.barTime, null, "Decision accepted"),
      transition("SIGNAL_CREATED", status, decision.barTime, null, "Awaiting entry")
    ],
    entryTriggeredAt: null,
    resolvedAt: null,
    resolution: "OPEN",
    barsToEntry: null,
    barsToResolution: null,
    barsOpen: 0,
    excursion: {
      mfe: null,
      mae: null,
      highestPriceSeen: decision.lastKnownPrice,
      lowestPriceSeen: decision.lastKnownPrice
    },
    outcome: {
      rawResolution: "OPEN",
      rawRealisedR: null,
      modelledResolution: "OPEN",
      modelledRealisedR: null,
      managementNotes: []
    },
    appliedBarEventIds: [],
    ruleConfigVersion: setupLifecycleConfig.version,
    pineScriptVersion: decision.pineScriptVersion,
    backendVersion: BACKEND_VERSION_PHASE3,
    updatedAt: createdAt
  };

  await store.saveSetup(setup);
  return setup;
};
