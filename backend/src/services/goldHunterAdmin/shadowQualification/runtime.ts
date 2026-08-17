/**
 * Shadow qualification runtime — owner lifecycle state machine + ACK persist.
 *
 * UNINITIALIZED → INITIALIZING → READY | FAILED
 * Formal events only when READY (config frozen, recovery complete, engine finalized).
 */
import { createHash } from "crypto";
import { getFrozenGhFastIdentity } from "../abc/frozenConfig";
import { loadGoldHunterConfig } from "../configStore";
import { getGoldHunterStrategySelector } from "../strategySelector";
import type { GoldHunterSelectorTickResult } from "../strategySelector";
import type { GoldHunterAdminConfig } from "../types";
import {
  getGhShadowMutationSurfaceReport,
  refuseGhShadowBrokerMutation
} from "./brokerMutationGuard";
import {
  getGhShadowEngine,
  resetGhShadowEnginesForTests,
  type GhShadowPersistBatch
} from "./engine";
import { computeGhShadowPerformanceReport } from "./performance";
import { buildFrozenSizingSnapshot, sizingSnapshotChanged } from "./frozenSizing";
import { replayGhShadowCapturedEvents } from "./replay";
import {
  appendGhShadowCapturedEvent,
  appendGhShadowDecision,
  GH_SHADOW_QUALIFICATION_STORAGE_PATH,
  listGhShadowCapturedEvents,
  listGhShadowDecisions,
  listGhShadowTrades,
  loadGhShadowEpoch,
  loadGhShadowTrade,
  resetGhShadowQualificationMemoryForTests,
  saveGhShadowEpoch,
  upsertGhShadowTrade
} from "./store";
import type {
  GhShadowFrozenSizingSnapshot,
  GhShadowOwnerLifecycle
} from "./types";
import { GH_SHADOW_QUALIFICATION_VERSION } from "./types";
import type { GhShadowSizingInput } from "./economics";
import { computeGhShadowActivityReport } from "./activity";

type OwnerRuntime = {
  lifecycle: GhShadowOwnerLifecycle;
  initPromise: Promise<void> | null;
  frozenSizing: GhShadowFrozenSizingSnapshot | null;
  config: GoldHunterAdminConfig | null;
  configReads: number;
  failReason: string | null;
  engineGeneration: number;
};

const owners = new Map<string, OwnerRuntime>();
const persistBusy = new Map<string, boolean>();
const persistRetryCounts = new Map<string, number>();

const MAX_PERSIST_RETRIES = 5;

let persistDelayMsForTests = 0;
let persistFailHookForTests: ((batch: GhShadowPersistBatch) => void) | null =
  null;
let loadEpochDelayMsForTests = 0;
let sizingOverridesForTests: Partial<GhShadowSizingInput> | undefined;

export function setGhShadowPersistDelayMsForTests(ms: number): void {
  persistDelayMsForTests = Math.max(0, ms);
}

export function setGhShadowLoadEpochDelayMsForTests(ms: number): void {
  loadEpochDelayMsForTests = Math.max(0, ms);
}

export function setGhShadowPersistFailHookForTests(
  hook: ((batch: GhShadowPersistBatch) => void) | null
): void {
  persistFailHookForTests = hook;
}

export function setGhShadowSizingOverridesForTests(
  over: Partial<GhShadowSizingInput> | undefined
): void {
  sizingOverridesForTests = over;
}

export function getGhShadowOwnerLifecycle(
  ownerUid: string
): GhShadowOwnerLifecycle {
  return owners.get(ownerUid)?.lifecycle ?? "UNINITIALIZED";
}

export function getGhShadowConfigReadCount(ownerUid: string): number {
  return owners.get(ownerUid)?.configReads ?? 0;
}

export function isGhShadowQualificationEnabled(): boolean {
  return (
    String(process.env.GOLD_HUNTER_SHADOW_QUALIFICATION_ENABLED || "")
      .trim()
      .toLowerCase() === "true"
  );
}

export function getGhShadowStrategyConfigIdentity() {
  const id = getFrozenGhFastIdentity();
  const c = id.config;
  return {
    strategySha: id.configSha256,
    configSha: id.configSha256,
    strategyVersion: id.strategyVersion,
    engineVersion: id.engineVersion,
    soakLabel: id.soakLabel,
    hardStop: c.hardStop,
    profitLockActivateMfe: c.profitLockActivateMfe,
    profitLockFraction: c.profitLockFraction,
    trailDistance: c.trailDistance,
    friction: c.friction
  };
}

function getOrCreateOwner(ownerUid: string): OwnerRuntime {
  let o = owners.get(ownerUid);
  if (!o) {
    o = {
      lifecycle: "UNINITIALIZED",
      initPromise: null,
      frozenSizing: null,
      config: null,
      configReads: 0,
      failReason: null,
      engineGeneration: 0
    };
    owners.set(ownerUid, o);
  }
  return o;
}

async function initializeOwner(ownerUid: string): Promise<void> {
  const o = getOrCreateOwner(ownerUid);
  if (o.lifecycle === "READY" || o.lifecycle === "FAILED") return;
  if (o.initPromise) return o.initPromise;

  o.lifecycle = "INITIALIZING";
  o.initPromise = (async () => {
    try {
      if (loadEpochDelayMsForTests > 0) {
        await new Promise((r) => setTimeout(r, loadEpochDelayMsForTests));
      }
      const persisted = await loadGhShadowEpoch(ownerUid);
      const openId = persisted?.openShadowTradeId ?? null;
      const persistedOpenTrade =
        openId != null
          ? await loadGhShadowTrade(ownerUid, openId, persisted?.qualificationId)
          : null;

      o.configReads += 1;
      const config = await loadGoldHunterConfig(ownerUid);
      o.config = config;

      const frozen = buildFrozenSizingSnapshot({
        config,
        quoteToDepositRate: sizingOverridesForTests?.quoteToDepositRate ?? null,
        quoteToDepositRateSource:
          sizingOverridesForTests?.quoteToDepositRateSource ?? null,
        minLots: sizingOverridesForTests?.minLots,
        maxLots: sizingOverridesForTests?.maxLots,
        lotStep: sizingOverridesForTests?.lotStep,
        valuePerPointPerLot: sizingOverridesForTests?.valuePerPointPerLot,
        symbolMetadataProvenance: sizingOverridesForTests?.sizingProvenance
      });
      o.frozenSizing = frozen;

      // If continuing epoch with different sizing hash → fail closed / new epoch
      if (
        persisted?.frozenSizing &&
        sizingSnapshotChanged(persisted.frozenSizing, frozen)
      ) {
        persisted.status = "DATA_QUALITY_FAILED";
        persisted.dataIntegrityFailure = "sizing_config_changed";
        persisted.updatedAt = new Date().toISOString();
        await saveGhShadowEpoch(ownerUid, persisted);
      }

      o.engineGeneration = (persisted?.runtimeGeneration ?? 0) + 1;
      const eng = getGhShadowEngine(ownerUid, {
        runtimeGeneration: o.engineGeneration,
        forceNew: true
      });
      eng.recoverAfterRestart({
        persistedEpoch:
          persisted?.status === "DATA_QUALITY_FAILED" &&
          persisted.dataIntegrityFailure === "sizing_config_changed"
            ? null
            : persisted,
        persistedOpenTrade,
        reason: "process_restart_or_first_attach"
      });

      // Attach frozen sizing onto epoch if created
      const epoch = eng.getEpoch();
      if (epoch && !epoch.frozenSizing) {
        (epoch as { frozenSizing: GhShadowFrozenSizingSnapshot }).frozenSizing =
          frozen;
      }

      o.lifecycle = "READY";
      schedulePersist(ownerUid);
    } catch (e) {
      o.lifecycle = "FAILED";
      o.failReason = e instanceof Error ? e.message : "init_failed";
    }
  })();

  return o.initPromise;
}

/** Kick init without awaiting — for hot path. */
export function ensureGhShadowOwnerReady(ownerUid: string): void {
  void initializeOwner(ownerUid);
}

export async function awaitGhShadowOwnerReady(ownerUid: string): Promise<void> {
  await initializeOwner(ownerUid);
}

async function writeBatch(
  ownerUid: string,
  batch: GhShadowPersistBatch
): Promise<void> {
  const eng = getGhShadowEngine(ownerUid);
  const eventIds = batch.events.map((e) => e.eventId);
  try {
    if (persistFailHookForTests) persistFailHookForTests(batch);
    if (persistDelayMsForTests > 0) {
      await new Promise((r) => setTimeout(r, persistDelayMsForTests));
    }
    await saveGhShadowEpoch(ownerUid, batch.epoch);
    for (const t of batch.trades) {
      await upsertGhShadowTrade(ownerUid, t);
    }
    for (const e of batch.events) {
      await appendGhShadowCapturedEvent(ownerUid, e);
    }
    for (const d of batch.decisions) {
      await appendGhShadowDecision(ownerUid, d);
    }
    eng.acknowledgePersist(eventIds);
    persistRetryCounts.set(ownerUid, 0);
  } catch (e) {
    eng.requeuePersistFailure();
    const n = (persistRetryCounts.get(ownerUid) ?? 0) + 1;
    persistRetryCounts.set(ownerUid, n);
    const epoch = eng.getEpoch();
    if (n >= MAX_PERSIST_RETRIES && epoch) {
      epoch.status = "DATA_QUALITY_FAILED";
      epoch.persistFailureReason =
        e instanceof Error ? e.message : "persist_exhausted";
      epoch.dataIntegrityFailure = "persist_failure";
      epoch.updatedAt = new Date().toISOString();
      try {
        await saveGhShadowEpoch(ownerUid, epoch);
      } catch {
        /* fail closed */
      }
    }
    throw e;
  }
}

function schedulePersist(ownerUid: string): void {
  if (persistBusy.get(ownerUid)) return;
  persistBusy.set(ownerUid, true);
  void (async () => {
    try {
      for (;;) {
        const eng = getGhShadowEngine(ownerUid);
        const batch = eng.drainPersistBatch();
        if (
          !batch ||
          (batch.trades.length === 0 &&
            batch.events.length === 0 &&
            batch.decisions.length === 0)
        ) {
          if (batch?.epoch) {
            try {
              await saveGhShadowEpoch(ownerUid, batch.epoch);
            } catch {
              /* ignore epoch-only */
            }
          }
          break;
        }
        try {
          await writeBatch(ownerUid, batch);
        } catch {
          // Retry later; do not discard
          break;
        }
      }
    } finally {
      persistBusy.set(ownerUid, false);
      const retries = persistRetryCounts.get(ownerUid) ?? 0;
      if (retries > 0 && retries < MAX_PERSIST_RETRIES) {
        setTimeout(() => schedulePersist(ownerUid), 25);
      }
    }
  })();
}

export type GhShadowTickMeta = {
  ownerUid: string;
  tick: GoldHunterSelectorTickResult;
  receiveSeq: number;
  receivedAtMs: number;
  resyncGeneration: number;
  bookGeneration: number;
};

/**
 * Hot-path entry. Formal processing only when READY.
 * During INITIALIZING: warmup only (allowFormal=false) if engine exists; else ignore.
 */
export function onGhShadowMarketTick(meta: GhShadowTickMeta): void {
  if (!isGhShadowQualificationEnabled()) return;
  if (!meta.ownerUid.trim()) return;

  const forbidden = (globalThis as { __ghShadowBrokerSubmitHook?: unknown })
    .__ghShadowBrokerSubmitHook;
  if (typeof forbidden === "function") {
    refuseGhShadowBrokerMutation("shadow_runtime_broker_submit_hook");
  }

  const o = getOrCreateOwner(meta.ownerUid);
  if (o.lifecycle === "UNINITIALIZED") {
    ensureGhShadowOwnerReady(meta.ownerUid);
  }
  if (o.lifecycle === "FAILED") return;

  const allowFormal = o.lifecycle === "READY" && o.frozenSizing != null && o.config != null;

  // During INITIALIZING: do not touch engine that may be replaced by forceNew.
  if (o.lifecycle === "INITIALIZING") {
    return; // pre-qualification warmup ignore — no formal, no discarded-engine writes
  }

  if (!allowFormal) return;

  const sel = getGoldHunterStrategySelector(meta.ownerUid);
  const snap = sel.getLastSnapshot();
  const bid = snap?.bestBid ?? snap?.lastSpotBid;
  const ask = snap?.bestAsk ?? snap?.lastSpotAsk;
  if (bid == null || ask == null || !Number.isFinite(bid) || !Number.isFinite(ask)) {
    return;
  }

  const dataOk =
    snap != null &&
    !snap.crossed &&
    !snap.derivedDataContaminated &&
    snap.depthValidity === "DEPTH_VALID";

  const eng = getGhShadowEngine(meta.ownerUid);
  // Guard: reject stale engine generations
  if (eng.getRuntimeGeneration() !== o.engineGeneration) {
    return;
  }

  eng.processEvent({
    receiveSeq: meta.receiveSeq,
    eventTsMs: meta.receivedAtMs,
    bid,
    ask,
    features: snap?.features ?? null,
    dataOk,
    depthValidity: String(snap?.depthValidity ?? "DEPTH_UNKNOWN"),
    bookGeneration: meta.bookGeneration,
    resyncGeneration: meta.resyncGeneration,
    newOpportunity: meta.tick.newOpportunity,
    opportunity: meta.tick.opportunity,
    config: o.config!,
    frozenSizing: o.frozenSizing!,
    allowFormal: true
  });
  schedulePersist(meta.ownerUid);
}

/** Compatibility wrapper used by marketFeedHook. */
export function onGhShadowSelectorTick(args: {
  ownerUid: string;
  tick: GoldHunterSelectorTickResult;
}): void {
  const sel = getGoldHunterStrategySelector(args.ownerUid);
  const snap = sel.getLastSnapshot();
  onGhShadowMarketTick({
    ownerUid: args.ownerUid,
    tick: args.tick,
    receiveSeq: sel.getReceiveSeq(),
    receivedAtMs: sel.getLastSpotAtMs() ?? sel.getLastDepthAtMs() ?? Date.now(),
    resyncGeneration: sel.getResyncGeneration(),
    bookGeneration: snap?.bookGeneration ?? 0
  });
}

export const enqueueGhShadowQualificationTick = (args: {
  ownerUid: string;
  tick: GoldHunterSelectorTickResult;
}): boolean => {
  onGhShadowSelectorTick(args);
  return true;
};

export function processGhShadowMarketEventSync(args: {
  ownerUid: string;
  receiveSeq: number;
  eventTsMs: number;
  bid: number;
  ask: number;
  features: import("../abc/features").GhFastFeatureSnapshot | null;
  dataOk: boolean;
  depthValidity: string;
  bookGeneration?: number;
  resyncGeneration?: number;
  newOpportunity: boolean;
  opportunity: import("../strategySelector").GoldHunterSelectedCandidate | null;
  config: GoldHunterAdminConfig;
  sizingOverrides?: Partial<GhShadowSizingInput>;
  allowFormal?: boolean;
  frozenSizing?: GhShadowFrozenSizingSnapshot;
}): void {
  const o = getOrCreateOwner(args.ownerUid);
  if (o.lifecycle !== "READY") {
    // Test helper: force READY with provided config
    o.lifecycle = "READY";
    o.config = args.config;
    o.configReads = Math.max(o.configReads, 1);
    o.frozenSizing =
      args.frozenSizing ??
      buildFrozenSizingSnapshot({
        config: args.config,
        quoteToDepositRate:
          args.sizingOverrides?.quoteToDepositRate ??
          sizingOverridesForTests?.quoteToDepositRate ??
          null,
        quoteToDepositRateSource:
          args.sizingOverrides?.quoteToDepositRateSource ??
          sizingOverridesForTests?.quoteToDepositRateSource ??
          null
      });
    // Reuse existing engine if present; never replace mid-test unexpectedly.
    const existing = getGhShadowEngine(args.ownerUid);
    if (o.engineGeneration === 0) {
      o.engineGeneration = existing.getRuntimeGeneration() || 1;
    }
  }

  const eng = getGhShadowEngine(args.ownerUid);
  eng.processEvent({
    receiveSeq: args.receiveSeq,
    eventTsMs: args.eventTsMs,
    bid: args.bid,
    ask: args.ask,
    features: args.features,
    dataOk: args.dataOk,
    depthValidity: args.depthValidity,
    bookGeneration: args.bookGeneration ?? 0,
    resyncGeneration: args.resyncGeneration ?? 0,
    newOpportunity: args.newOpportunity,
    opportunity: args.opportunity,
    config: args.config,
    frozenSizing: o.frozenSizing!,
    allowFormal: args.allowFormal ?? true
  });
  schedulePersist(args.ownerUid);
}

export async function flushGhShadowPersistenceForTests(
  ownerUid: string
): Promise<void> {
  for (let i = 0; i < 80; i++) {
    schedulePersist(ownerUid);
    await new Promise((r) => setTimeout(r, persistDelayMsForTests + 5));
    if (!persistBusy.get(ownerUid)) {
      const eng = getGhShadowEngine(ownerUid);
      const batch = eng.drainPersistBatch();
      if (
        batch &&
        (batch.trades.length || batch.events.length || batch.decisions.length)
      ) {
        try {
          await writeBatch(ownerUid, batch);
        } catch {
          /* test may inject failures */
        }
        continue;
      }
      break;
    }
  }
}

export async function drainGhShadowQualificationForTests(
  ownerUid: string
): Promise<void> {
  await flushGhShadowPersistenceForTests(ownerUid);
}

export async function runGhShadowReplayAndGate(ownerUid: string) {
  const epoch = await loadGhShadowEpoch(ownerUid);
  if (!epoch) {
    return {
      status: "LIVE_REPLAY_DIVERGENCE" as const,
      capturedEvents: 0,
      replayedEvents: 0,
      expectedEvents: 0,
      firstDivergenceSeq: null,
      divergenceDetail: "no_epoch",
      livePoints: [],
      replayPoints: []
    };
  }
  const events = await listGhShadowCapturedEvents(ownerUid, {
    qualificationId: epoch.qualificationId,
    limit: 50_000
  });
  const decisions = await listGhShadowDecisions(ownerUid, {
    qualificationId: epoch.qualificationId
  });
  const trades = await listGhShadowTrades(ownerUid, {
    qualificationId: epoch.qualificationId,
    limit: 2000
  });

  const expectedEvents = epoch.integrity.persistAcknowledgedEvents;
  if (events.length < expectedEvents && expectedEvents > 0) {
    const incomplete = {
      status: "REPLAY_INCOMPLETE" as const,
      capturedEvents: events.length,
      replayedEvents: 0,
      expectedEvents,
      firstDivergenceSeq: null,
      divergenceDetail: `truncated_replay have=${events.length} expected=${expectedEvents}`,
      livePoints: [],
      replayPoints: []
    };
    epoch.lastReplayStatus = "REPLAY_INCOMPLETE";
    epoch.lastReplayDetail = {
      capturedEvents: events.length,
      replayedEvents: 0,
      expectedEvents,
      firstDivergenceSeq: null,
      divergenceDetail: incomplete.divergenceDetail
    };
    await saveGhShadowEpoch(ownerUid, epoch);
    return incomplete;
  }

  const result = replayGhShadowCapturedEvents({
    events,
    liveDecisions: decisions,
    liveTrades: trades
  });
  epoch.lastReplayStatus = result.status;
  epoch.lastReplayDetail = {
    capturedEvents: result.capturedEvents,
    replayedEvents: result.replayedEvents,
    expectedEvents,
    firstDivergenceSeq: result.firstDivergenceSeq,
    divergenceDetail: result.divergenceDetail
  };
  epoch.updatedAt = new Date().toISOString();
  await saveGhShadowEpoch(ownerUid, epoch);
  return { ...result, expectedEvents };
}

export async function buildGhShadowQualificationStatus(ownerUid: string) {
  await awaitGhShadowOwnerReady(ownerUid);
  const identity = getGhShadowStrategyConfigIdentity();
  const epoch = await loadGhShadowEpoch(ownerUid);
  const trades = epoch
    ? await listGhShadowTrades(ownerUid, {
        qualificationId: epoch.qualificationId,
        limit: 2000
      })
    : [];
  const performance = computeGhShadowPerformanceReport(trades, epoch);
  const activity = computeGhShadowActivityReport(epoch);
  const eng = getGhShadowEngine(ownerUid);
  const o = getOrCreateOwner(ownerUid);
  return {
    enabled: isGhShadowQualificationEnabled(),
    version: GH_SHADOW_QUALIFICATION_VERSION,
    storagePath: GH_SHADOW_QUALIFICATION_STORAGE_PATH,
    lifecycle: o.lifecycle,
    identity,
    frozenSizing: o.frozenSizing,
    epoch,
    performance,
    activity,
    mutationSurface: getGhShadowMutationSurfaceReport(),
    openShadowTradeId: eng.getOpenTradeId(),
    journalPending: eng.getJournal().stats().journalPending,
    demoAutoTradeNote:
      "Shadow qualification does not modify demoAutoTradeEnabled. No broker NewOrder."
  };
}

export function resetGhShadowQualificationRuntimeForTests(): void {
  resetGhShadowEnginesForTests();
  resetGhShadowQualificationMemoryForTests();
  owners.clear();
  persistBusy.clear();
  persistRetryCounts.clear();
  persistDelayMsForTests = 0;
  loadEpochDelayMsForTests = 0;
  persistFailHookForTests = null;
  sizingOverridesForTests = undefined;
}

// silence unused import if hash not used
void createHash;
