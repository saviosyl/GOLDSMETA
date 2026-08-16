/**
 * Feed Spot + Depth into Gold HunterStrategySelector from the quote worker.
 * Additive — does not alter quote persist semantics.
 */
import {
  normalizeCTraderDepthPayload,
  normalizeCTraderSpotPayload
} from "./abc";
import { isGoldHunterProtectionGeometryConnected } from "./protectionGeometry";
import {
  getGoldHunterStrategySelector,
  type GoldHunterSelectedCandidate
} from "./strategySelector";
import { saveGoldHunterSelectorRuntime } from "./selectorRuntimeStore";

export type GhMarketFeedMeta = {
  ownerUid: string;
  symbolId: string;
  environment: "DEMO" | "LIVE";
};

const lastSpotAt = new Map<string, number>();
const lastDepthAt = new Map<string, number>();
const depthAttached = new Map<string, boolean>();
const spotAttached = new Map<string, boolean>();

export function resetGoldHunterMarketFeedForTests(): void {
  lastSpotAt.clear();
  lastDepthAt.clear();
  depthAttached.clear();
  spotAttached.clear();
}

export function markGoldHunterSpotAttached(ownerUid: string, v: boolean): void {
  spotAttached.set(ownerUid, v);
  getGoldHunterStrategySelector(ownerUid).markSpotSourceAttached(v);
  void persist(ownerUid, getGoldHunterStrategySelector(ownerUid).getLastCandidate()).catch(
    () => undefined
  );
}

export function markGoldHunterDepthAttached(ownerUid: string, v: boolean): void {
  depthAttached.set(ownerUid, v);
  getGoldHunterStrategySelector(ownerUid).markDepthSourceAttached(v);
  void persist(ownerUid, getGoldHunterStrategySelector(ownerUid).getLastCandidate()).catch(
    () => undefined
  );
}

export function notifyGoldHunterResync(ownerUid: string): void {
  getGoldHunterStrategySelector(ownerUid).clearForResync();
  void persist(ownerUid, null).catch(() => undefined);
}

async function persist(ownerUid: string, candidate: GoldHunterSelectedCandidate | null): Promise<void> {
  const sel = getGoldHunterStrategySelector(ownerUid);
  const snap = sel.getLastSnapshot();
  const now = Date.now();
  await saveGoldHunterSelectorRuntime({
    ownerUid,
    readiness: sel.readiness(),
    lastCandidate: candidate ?? sel.getLastCandidate(),
    lastObservationAt: sel.getLastObservationAt(),
    depthValidity: snap?.depthValidity ?? null,
    spotAgeMs: lastSpotAt.has(ownerUid) ? now - lastSpotAt.get(ownerUid)! : null,
    depthAgeMs: lastDepthAt.has(ownerUid) ? now - lastDepthAt.get(ownerUid)! : null,
    normalizationVersion: "CTRADER_NORMALIZED_V1",
    updatedAt: new Date().toISOString(),
    protectionGeometryConnected: isGoldHunterProtectionGeometryConnected()
  });
}

/**
 * Handle a raw ProtoOASpotEvent descriptor (relative prices).
 */
export async function onGoldHunterSpotEvent(
  meta: GhMarketFeedMeta,
  descriptor: Record<string, unknown>
): Promise<GoldHunterSelectedCandidate | null> {
  if (meta.environment === "LIVE") {
    getGoldHunterStrategySelector(meta.ownerUid).setFatalBlocker("LIVE_FEED_REFUSED");
    return null;
  }
  const norm = normalizeCTraderSpotPayload(descriptor);
  const sel = getGoldHunterStrategySelector(meta.ownerUid);
  markGoldHunterSpotAttached(meta.ownerUid, true);
  const now = Date.now();
  lastSpotAt.set(meta.ownerUid, now);
  const candidate = sel.onSpot({
    receivedAtMs: now,
    bid: norm.bid,
    ask: norm.ask,
    symbolId: meta.symbolId,
    brokerTimestampMs: norm.brokerTimestampMs
  });
  await persist(meta.ownerUid, candidate);
  return candidate;
}

/**
 * Handle a raw ProtoOADepthEvent descriptor.
 */
export async function onGoldHunterDepthEvent(
  meta: GhMarketFeedMeta,
  descriptor: Record<string, unknown>
): Promise<GoldHunterSelectedCandidate | null> {
  if (meta.environment === "LIVE") {
    getGoldHunterStrategySelector(meta.ownerUid).setFatalBlocker("LIVE_FEED_REFUSED");
    return null;
  }
  const norm = normalizeCTraderDepthPayload(descriptor);
  const sel = getGoldHunterStrategySelector(meta.ownerUid);
  markGoldHunterDepthAttached(meta.ownerUid, true);
  const now = Date.now();
  lastDepthAt.set(meta.ownerUid, now);
  const candidate = sel.onDepth({
    receivedAtMs: now,
    symbolId: meta.symbolId,
    brokerTimestampMs: norm.brokerTimestampMs,
    newQuotes: norm.newQuotes,
    deletedQuotes: norm.deletedQuotes
  });
  await persist(meta.ownerUid, candidate);
  return candidate;
}
