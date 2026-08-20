/**
 * Feed Spot + Depth into GoldHunterStrategySelector from the quote worker.
 * Additive — does not alter quote persist semantics.
 *
 * HOT PATH: normalize → book → features → selection → opportunity detect
 * MONITORING: coalesced/throttled Firestore persistence (never every Depth tick)
 * EXECUTION: bounded async queue (never blocks quote ingestion)
 */
import {
  normalizeCTraderDepthPayload,
  normalizeCTraderSpotPayload
} from "./abc";
import { isGoldHunterProtectionGeometryConnected } from "./protectionGeometry";
import {
  getGoldHunterStrategySelector,
  type GoldHunterSelectedCandidate,
  type GoldHunterSelectorTickResult
} from "./strategySelector";
import { saveGoldHunterSelectorRuntime } from "./selectorRuntimeStore";
import { buildGoldHunterLossControllerTelemetry } from "./lossControllerTelemetryPersist";
import {
  enqueueGoldHunterDemoAutoExecution,
  maybeReconsiderGoldHunterDemoAutoExecution
} from "./demoAutoExecutionRuntime";
import { enqueueGoldHunterPositionManagerTick } from "./demoPositionManager";
import { onGhShadowMarketTick } from "./shadowQualification";

/** Re-export for callers that previously imported from this module. */
export { persistGoldHunterLossControllerTelemetry } from "./lossControllerTelemetryPersist";

export type GhMarketFeedMeta = {
  ownerUid: string;
  symbolId: string;
  environment: "DEMO" | "LIVE";
};

const lastSpotAt = new Map<string, number>();
const lastDepthAt = new Map<string, number>();
const depthAttached = new Map<string, boolean>();
const spotAttached = new Map<string, boolean>();

/** Monitoring persist cadence — a few Hz, not per Depth event. */
export const GH_SELECTOR_RUNTIME_PERSIST_MIN_MS = 400;

const lastPersistAt = new Map<string, number>();
const persistInFlight = new Map<string, boolean>();
const pendingForcePersist = new Map<string, boolean>();

/** Test counters */
const persistWriteCounts = new Map<string, number>();

export function resetGoldHunterMarketFeedForTests(): void {
  lastSpotAt.clear();
  lastDepthAt.clear();
  depthAttached.clear();
  spotAttached.clear();
  lastPersistAt.clear();
  persistInFlight.clear();
  pendingForcePersist.clear();
  persistWriteCounts.clear();
}

export function getGoldHunterRuntimePersistWriteCount(ownerUid: string): number {
  return persistWriteCounts.get(ownerUid) ?? 0;
}

export async function markGoldHunterSpotAttached(
  ownerUid: string,
  v: boolean
): Promise<void> {
  const prev = spotAttached.get(ownerUid) === true;
  spotAttached.set(ownerUid, v);
  getGoldHunterStrategySelector(ownerUid).markSpotSourceAttached(v);
  // Persist only on meaningful attach TRANSITIONS (not every Spot event).
  if (prev !== v) {
    await persistRuntime(ownerUid, getGoldHunterStrategySelector(ownerUid).getLastCandidate(), {
      force: true
    });
  }
}

export async function markGoldHunterDepthAttached(
  ownerUid: string,
  v: boolean
): Promise<void> {
  const prev = depthAttached.get(ownerUid) === true;
  depthAttached.set(ownerUid, v);
  getGoldHunterStrategySelector(ownerUid).markDepthSourceAttached(v);
  if (prev !== v) {
    await persistRuntime(ownerUid, getGoldHunterStrategySelector(ownerUid).getLastCandidate(), {
      force: true
    });
  }
}

export async function notifyGoldHunterResync(ownerUid: string): Promise<void> {
  getGoldHunterStrategySelector(ownerUid).clearForResync();
  // Do not persist here — callers mark Spot/Depth attached next and persist once.
}

async function persistRuntime(
  ownerUid: string,
  candidate: GoldHunterSelectedCandidate | null,
  opts?: { force?: boolean }
): Promise<void> {
  const now = Date.now();
  const last = lastPersistAt.get(ownerUid) ?? 0;
  if (!opts?.force && now - last < GH_SELECTOR_RUNTIME_PERSIST_MIN_MS) {
    pendingForcePersist.set(ownerUid, true);
    return;
  }
  if (persistInFlight.get(ownerUid)) {
    pendingForcePersist.set(ownerUid, true);
    return;
  }
  persistInFlight.set(ownerUid, true);
  try {
    const sel = getGoldHunterStrategySelector(ownerUid);
    const snap = sel.getLastSnapshot();
    await saveGoldHunterSelectorRuntime({
      ownerUid,
      readiness: sel.readiness(),
      lastCandidate: candidate ?? sel.getLastCandidate(),
      lastObservationAt: sel.getLastObservationAt(),
      depthValidity: snap?.depthValidity ?? null,
      spotAgeMs: lastSpotAt.has(ownerUid) ? now - lastSpotAt.get(ownerUid)! : null,
      depthAgeMs: lastDepthAt.has(ownerUid)
        ? now - lastDepthAt.get(ownerUid)!
        : null,
      normalizationVersion: "CTRADER_NORMALIZED_V1",
      updatedAt: new Date(now).toISOString(),
      protectionGeometryConnected: isGoldHunterProtectionGeometryConnected(),
      lossControllerTelemetry: buildGoldHunterLossControllerTelemetry(
        ownerUid,
        new Date(now).toISOString()
      )
    });
    lastPersistAt.set(ownerUid, now);
    persistWriteCounts.set(
      ownerUid,
      (persistWriteCounts.get(ownerUid) ?? 0) + 1
    );
    pendingForcePersist.set(ownerUid, false);
  } finally {
    persistInFlight.set(ownerUid, false);
    if (pendingForcePersist.get(ownerUid)) {
      pendingForcePersist.set(ownerUid, false);
      // Schedule a follow-up persist off the hot path (fire-and-forget).
      void persistRuntime(ownerUid, null, { force: true }).catch(() => undefined);
    }
  }
}

function afterSelectorTick(
  meta: GhMarketFeedMeta,
  tick: GoldHunterSelectorTickResult,
  receivedAtMs: number
): void {
  // Opportunity / consume transitions → immediate monitoring persist.
  if (tick.newOpportunity) {
    void persistRuntime(meta.ownerUid, tick.candidate, { force: true }).catch(
      () => undefined
    );
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: meta.ownerUid,
      newOpportunity: tick.newOpportunity,
      opportunity: tick.opportunity,
      source: "NEW"
    });
  } else {
    // Throttled monitoring snapshot only.
    void persistRuntime(meta.ownerUid, tick.candidate).catch(() => undefined);
    // Bounded reconsider: same opportunity still active + unconsumed after
    // retryable PRE-CLAIM failure / QUEUE_FULL — never blocks quote ingestion.
    maybeReconsiderGoldHunterDemoAutoExecution(meta.ownerUid);
  }

  // Position management — bounded async, never blocks quote path.
  enqueueGoldHunterPositionManagerTick(meta.ownerUid);

  // Research shadow qualification — independent of Demo AutoTrade / broker.
  // Default OFF. Pass THIS event's receivedAtMs (not lastSpot ?? lastDepth).
  {
    const sel = getGoldHunterStrategySelector(meta.ownerUid);
    const snap = sel.getLastSnapshot();
    onGhShadowMarketTick({
      ownerUid: meta.ownerUid,
      tick,
      receiveSeq: sel.getReceiveSeq(),
      receivedAtMs,
      resyncGeneration: sel.getResyncGeneration(),
      bookGeneration: snap?.bookGeneration ?? 0
    });
  }
}

/**
 * Handle a raw ProtoOASpotEvent descriptor (relative prices).
 * Synchronous selector work; async I/O is queued/throttled.
 */
export async function onGoldHunterSpotEvent(
  meta: GhMarketFeedMeta,
  descriptor: Record<string, unknown>
): Promise<GoldHunterSelectorTickResult | null> {
  if (meta.environment === "LIVE") {
    getGoldHunterStrategySelector(meta.ownerUid).setFatalBlocker("LIVE_FEED_REFUSED");
    return null;
  }
  const norm = normalizeCTraderSpotPayload(descriptor);
  const sel = getGoldHunterStrategySelector(meta.ownerUid);
  // Attach transition only (idempotent true→true does not persist).
  await markGoldHunterSpotAttached(meta.ownerUid, true);
  const now = Date.now();
  lastSpotAt.set(meta.ownerUid, now);
  const tick = sel.onSpot({
    receivedAtMs: now,
    bid: norm.bid,
    ask: norm.ask,
    symbolId: meta.symbolId,
    brokerTimestampMs: norm.brokerTimestampMs
  });
  afterSelectorTick(meta, tick, now);
  return tick;
}

/**
 * Handle a raw ProtoOADepthEvent descriptor.
 */
export async function onGoldHunterDepthEvent(
  meta: GhMarketFeedMeta,
  descriptor: Record<string, unknown>
): Promise<GoldHunterSelectorTickResult | null> {
  if (meta.environment === "LIVE") {
    getGoldHunterStrategySelector(meta.ownerUid).setFatalBlocker("LIVE_FEED_REFUSED");
    return null;
  }
  const norm = normalizeCTraderDepthPayload(descriptor);
  const sel = getGoldHunterStrategySelector(meta.ownerUid);
  await markGoldHunterDepthAttached(meta.ownerUid, true);
  const now = Date.now();
  lastDepthAt.set(meta.ownerUid, now);
  const tick = sel.onDepth({
    receivedAtMs: now,
    symbolId: meta.symbolId,
    brokerTimestampMs: norm.brokerTimestampMs,
    newQuotes: norm.newQuotes,
    deletedQuotes: norm.deletedQuotes
  });
  afterSelectorTick(meta, tick, now);
  return tick;
}
