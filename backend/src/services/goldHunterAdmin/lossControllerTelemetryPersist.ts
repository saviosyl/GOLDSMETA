/**
 * Persist authoritative quote-worker loss-controller telemetry.
 * Kept separate from marketFeedHook to avoid circular imports with settlement.
 */
import { isGoldHunterProtectionGeometryConnected } from "./protectionGeometry";
import { getGoldHunterStrategySelector } from "./strategySelector";
import { saveGoldHunterSelectorRuntime } from "./selectorRuntimeStore";
import {
  goldHunterWorkerRevision,
  type GoldHunterLossControllerTelemetry
} from "./lossControllerTelemetry";

export function buildGoldHunterLossControllerTelemetry(
  ownerUid: string,
  updatedAtIso?: string
): GoldHunterLossControllerTelemetry {
  const updatedAt = updatedAtIso ?? new Date().toISOString();
  const lc = getGoldHunterStrategySelector(ownerUid).getLossControllerEntryState();
  return {
    updatedAt,
    workerRevision: goldHunterWorkerRevision(),
    consecutiveLosses: lc.consecutiveLosses,
    rollingRealisedR: lc.rollingRealisedR,
    rollingSampleCount: lc.rollingSampleCount,
    lossStreakGuardActive: lc.lossStreakGuardActive,
    lossCircuitBreakerActive: lc.lossCircuitBreakerActive,
    circuitBreakerReason: lc.circuitBreakerReason,
    unknownRealisedRLossCount: lc.unknownRealisedRLossCount,
    rollingUnknownRTradeCount: lc.rollingUnknownRTradeCount,
    consecutiveUnknownRLosses: lc.consecutiveUnknownRLosses,
    unknownRGuardActive: lc.unknownRGuardActive,
    entryIntegrityHealthy: lc.entryIntegrityHealthy,
    entryIntegrityRecoveredAtMs: lc.entryIntegrityRecoveredAtMs,
    lastEntryIntegrityRecoveryReason: lc.lastEntryIntegrityRecoveryReason,
    lastClosedTradeId: lc.lastClosedTradeId,
    lastUnknownRTradeId: lc.lastUnknownRTradeId,
    lastUnknownRReason: lc.lastUnknownRReason,
    telemetrySource: "QUOTE_WORKER"
  };
}

export async function persistGoldHunterLossControllerTelemetry(
  ownerUid: string
): Promise<void> {
  const sel = getGoldHunterStrategySelector(ownerUid);
  const snap = sel.getLastSnapshot();
  const updatedAt = new Date().toISOString();
  await saveGoldHunterSelectorRuntime({
    ownerUid,
    readiness: sel.readiness(),
    lastCandidate: sel.getLastCandidate(),
    lastObservationAt: sel.getLastObservationAt(),
    depthValidity: snap?.depthValidity ?? null,
    spotAgeMs: null,
    depthAgeMs: null,
    normalizationVersion: "CTRADER_NORMALIZED_V1",
    updatedAt,
    protectionGeometryConnected: isGoldHunterProtectionGeometryConnected(),
    lossControllerTelemetry: buildGoldHunterLossControllerTelemetry(
      ownerUid,
      updatedAt
    )
  });
}
