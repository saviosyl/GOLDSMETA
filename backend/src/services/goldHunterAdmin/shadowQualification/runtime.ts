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
import {
  buildUnitTestFrozenSizingSnapshot,
  loadAndFreezeAuthoritativeSizing,
  sizingSnapshotChanged
} from "./frozenSizing";
import { replayGhShadowCapturedEvents } from "./replay";
import {
  appendGhShadowCapturedEvent,
  appendGhShadowDecision,
  GH_SHADOW_QUALIFICATION_STORAGE_PATH,
  listAllGhShadowCapturedEvents,
  listAllGhShadowReplayMarkerDecisions,
  listAllGhShadowTrades,
  listGhShadowTrades,
  loadGhShadowEpoch,
  loadGhShadowTrade,
  patchGhShadowEpochReplayFields,
  resetGhShadowQualificationMemoryForTests,
  saveGhShadowEpoch,
  setGhShadowReplayPatchAfterReadHookForTests,
  upsertGhShadowTrade
} from "./store";
import type {
  GhShadowFrozenSizingSnapshot,
  GhShadowOwnerLifecycle,
  GhShadowQualificationEpoch
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
export type GhShadowPersistFailStage =
  | "after_epoch"
  | "after_first_trade"
  | "after_first_event"
  | "before_decisions"
  | "mid_decisions";
let persistFailStageForTests: GhShadowPersistFailStage | null = null;
let loadEpochDelayMsForTests = 0;
let sizingOverridesForTests: Partial<GhShadowSizingInput> | undefined;
/** When true, READY may use unit-test Pepperstone defaults (never for formal prod). */
let allowUnitTestSizingDefaults = false;
let authoritativeSizingLoaderForTests:
  | (() => ReturnType<typeof loadAndFreezeAuthoritativeSizing>)
  | null = null;
/** When false, processGhShadowMarketEventSync does not auto-schedule persist. */
let autoPersistForTests = true;

/**
 * Test hook: runs after replay start snapshot / event load, before finalise.
 * Used to simulate concurrent ACK while a long replay is in progress.
 */
let replayBeforeFinalizeHookForTests:
  | ((ctx: {
      ownerUid: string;
      qualificationId: string;
      expectedEvents: number;
    }) => void | Promise<void>)
  | null = null;

export function setGhShadowPersistDelayMsForTests(ms: number): void {
  persistDelayMsForTests = Math.max(0, ms);
}

export function setGhShadowReplayBeforeFinalizeHookForTests(
  hook:
    | ((ctx: {
        ownerUid: string;
        qualificationId: string;
        expectedEvents: number;
      }) => void | Promise<void>)
    | null
): void {
  replayBeforeFinalizeHookForTests = hook;
}

export function setGhShadowLoadEpochDelayMsForTests(ms: number): void {
  loadEpochDelayMsForTests = Math.max(0, ms);
}

export function setGhShadowPersistFailHookForTests(
  hook: ((batch: GhShadowPersistBatch) => void) | null
): void {
  persistFailHookForTests = hook;
}

export function setGhShadowPersistFailStageForTests(
  stage: GhShadowPersistFailStage | null
): void {
  persistFailStageForTests = stage;
}

export function setGhShadowSizingOverridesForTests(
  over: Partial<GhShadowSizingInput> | undefined
): void {
  sizingOverridesForTests = over;
}

export function setGhShadowAllowUnitTestSizingDefaultsForTests(
  allow: boolean
): void {
  allowUnitTestSizingDefaults = allow;
}

export function setGhShadowAuthoritativeSizingLoaderForTests(
  loader: (() => ReturnType<typeof loadAndFreezeAuthoritativeSizing>) | null
): void {
  authoritativeSizingLoaderForTests = loader;
}

export function setGhShadowAutoPersistForTests(enabled: boolean): void {
  autoPersistForTests = enabled;
}

function throwIfPersistStage(stage: GhShadowPersistFailStage): void {
  if (persistFailStageForTests === stage) {
    throw new Error(`persist_fail_injected_${stage}`);
  }
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

      let frozen;
      if (allowUnitTestSizingDefaults) {
        frozen = buildUnitTestFrozenSizingSnapshot({
          config,
          quoteToDepositRate: sizingOverridesForTests?.quoteToDepositRate ?? null,
          quoteToDepositRateSource:
            sizingOverridesForTests?.quoteToDepositRateSource ?? null,
          minLots: sizingOverridesForTests?.minLots,
          maxLots: sizingOverridesForTests?.maxLots,
          lotStep: sizingOverridesForTests?.lotStep,
          valuePerPointPerLot: sizingOverridesForTests?.valuePerPointPerLot,
          sizingProvenance: sizingOverridesForTests?.sizingProvenance
        });
      } else {
        const loader =
          authoritativeSizingLoaderForTests ??
          (() =>
            loadAndFreezeAuthoritativeSizing({
              ownerUid,
              config,
              quoteToDepositRate:
                sizingOverridesForTests?.quoteToDepositRate ?? null,
              quoteToDepositRateSource:
                sizingOverridesForTests?.quoteToDepositRateSource ?? null
            }));
        const loaded = await loader();
        if (!loaded.ok) {
          o.lifecycle = "FAILED";
          o.failReason = `WAIT / INITIALIZATION FAILED: ${loaded.blocker}`;
          return;
        }
        frozen = loaded.frozen;
      }
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
    throwIfPersistStage("after_epoch");
    for (let i = 0; i < batch.trades.length; i++) {
      await upsertGhShadowTrade(ownerUid, batch.trades[i]!);
      if (i === 0) throwIfPersistStage("after_first_trade");
    }
    for (let i = 0; i < batch.events.length; i++) {
      await appendGhShadowCapturedEvent(ownerUid, batch.events[i]!);
      if (i === 0) throwIfPersistStage("after_first_event");
    }
    throwIfPersistStage("before_decisions");
    for (let i = 0; i < batch.decisions.length; i++) {
      if (i === 1) throwIfPersistStage("mid_decisions");
      await appendGhShadowDecision(ownerUid, batch.decisions[i]!);
    }
    // FULL ACK only after complete successful batch.
    eng.acknowledgePersist(eventIds);
    // Persist post-ACK epoch mutations (e.g. REPLAY_STALE after new ACKs).
    const postAck = eng.getEpoch();
    if (postAck) {
      await saveGhShadowEpoch(ownerUid, postAck);
    }
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
      // Do NOT pretend the in-flight batch was persisted — leave it retryable.
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
  // Demo open-management Spot: features.bid/ask ONLY (NOT lastSpot / lastFeatureSpot /
  // depth best). Missing features ⇒ no formal open-trade management this tick.
  const hasFeatures = snap?.features != null;
  const strategySpotBid = hasFeatures ? snap!.features!.bid : null;
  const strategySpotAsk = hasFeatures ? snap!.features!.ask : null;
  const depthBestBid = snap?.bestBid ?? null;
  const depthBestAsk = snap?.bestAsk ?? null;

  // Entry can proceed from opportunity bid/ask without features.
  // Open management requires features — still process the tick for seq/journal/
  // activity, but engine.tickOpen no-ops when features are absent.
  const hasOpportunity =
    meta.tick.newOpportunity && meta.tick.opportunity != null;
  if (!hasFeatures && !hasOpportunity) {
    // Still need engine for open-path journaling / seq when a trade is open.
    const engProbe = getGhShadowEngine(meta.ownerUid);
    if (engProbe.getOpenTradeId() == null) {
      return;
    }
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
    strategySpotBid,
    strategySpotAsk,
    depthBestBid,
    depthBestAsk,
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
  // Compatibility only — prefer onGhShadowMarketTick with THIS event receivedAtMs.
  // When used without an event clock, last observation is the least-wrong fallback.
  onGhShadowMarketTick({
    ownerUid: args.ownerUid,
    tick: args.tick,
    receiveSeq: sel.getReceiveSeq(),
    receivedAtMs: Date.now(),
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
  /** Strategy Spot (Demo open-management). Also accepts legacy bid/ask. */
  strategySpotBid?: number;
  strategySpotAsk?: number;
  bid?: number;
  ask?: number;
  depthBestBid?: number | null;
  depthBestAsk?: number | null;
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
    // Test helper: force READY with unit-test sizing defaults
    o.lifecycle = "READY";
    o.config = args.config;
    o.configReads = Math.max(o.configReads, 1);
    o.frozenSizing =
      args.frozenSizing ??
      buildUnitTestFrozenSizingSnapshot({
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
    const existing = getGhShadowEngine(args.ownerUid);
    if (o.engineGeneration === 0) {
      o.engineGeneration = existing.getRuntimeGeneration() || 1;
    }
  }

  const strategySpotBid =
    args.features != null
      ? args.features.bid
      : args.strategySpotBid ?? null;
  const strategySpotAsk =
    args.features != null
      ? args.features.ask
      : args.strategySpotAsk ?? null;
  // Formal management requires features. Entry may use opportunity without features.
  // Do not fall back to legacy bid/ask when features are absent.
  if (
    args.features == null &&
    !args.newOpportunity &&
    getGhShadowEngine(args.ownerUid).getOpenTradeId() == null
  ) {
    return;
  }

  const eng = getGhShadowEngine(args.ownerUid);
  eng.processEvent({
    receiveSeq: args.receiveSeq,
    eventTsMs: args.eventTsMs,
    strategySpotBid,
    strategySpotAsk,
    depthBestBid: args.depthBestBid ?? null,
    depthBestAsk: args.depthBestAsk ?? null,
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
  if (autoPersistForTests) {
    schedulePersist(args.ownerUid);
  }
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

async function syncEngineReplayFields(
  ownerUid: string,
  qualificationId: string,
  status: GhShadowQualificationEpoch["lastReplayStatus"],
  detail: GhShadowQualificationEpoch["lastReplayDetail"]
): Promise<void> {
  const eng = getGhShadowEngine(ownerUid);
  const live = eng.getEpoch();
  if (live && live.qualificationId === qualificationId) {
    live.lastReplayStatus = status;
    live.lastReplayDetail = detail ? { ...detail } : null;
  }
}

/**
 * Research-only replay + gate. Must NOT mutate broker / Demo / strategy.
 *
 * Concurrency invariant: LIVE_REPLAY_OK is written ONLY if the CURRENT epoch
 * still matches the replay-start (qualificationId, persistAcknowledgedEvents).
 * Newer ACKs during a long replay ⇒ REPLAY_STALE; ACK counters never roll back.
 */
export async function runGhShadowReplayAndGate(ownerUid: string) {
  const startEpoch = await loadGhShadowEpoch(ownerUid);
  if (!startEpoch) {
    return {
      status: "LIVE_REPLAY_DIVERGENCE" as const,
      capturedEvents: 0,
      replayedEvents: 0,
      expectedEvents: 0,
      firstDivergenceSeq: null,
      divergenceDetail: "no_epoch",
      livePoints: [],
      replayPoints: [],
      replayCurrent: false
    };
  }

  const qualificationId = startEpoch.qualificationId;
  const expectedEvents = startEpoch.integrity.persistAcknowledgedEvents;

  // Page beyond any fixed ceiling until all expected events / markers retrieved.
  const events = await listAllGhShadowCapturedEvents(ownerUid, {
    qualificationId,
    pageSize: 5_000
  });
  const decisions = await listAllGhShadowReplayMarkerDecisions(ownerUid, {
    qualificationId,
    pageSize: 5_000
  });
  const trades = await listAllGhShadowTrades(ownerUid, { qualificationId });

  if (replayBeforeFinalizeHookForTests) {
    await replayBeforeFinalizeHookForTests({
      ownerUid,
      qualificationId,
      expectedEvents
    });
  }

  // Reload CURRENT epoch before finalising — never save the start snapshot.
  const currentBeforeResult = await loadGhShadowEpoch(ownerUid);
  const currentAck =
    currentBeforeResult?.integrity.persistAcknowledgedEvents ?? -1;
  const currentQid = currentBeforeResult?.qualificationId ?? null;
  const datasetMoved =
    currentQid !== qualificationId || currentAck !== expectedEvents;

  if (events.length !== expectedEvents && expectedEvents > 0 && !datasetMoved) {
    const detail = {
      capturedEvents: events.length,
      replayedEvents: 0,
      expectedEvents,
      firstDivergenceSeq: null as number | null,
      divergenceDetail: `replay_count_mismatch have=${events.length} expected=${expectedEvents}`,
      completedAt: new Date().toISOString()
    };
    const patch = await patchGhShadowEpochReplayFields(ownerUid, {
      qualificationId,
      expectedEvents,
      requireCurrentAck: true,
      lastReplayStatus: "REPLAY_INCOMPLETE",
      lastReplayDetail: detail
    });
    const written = patch.writtenStatus ?? "REPLAY_INCOMPLETE";
    await syncEngineReplayFields(
      ownerUid,
      patch.qualificationId ?? qualificationId,
      written,
      patch.epoch?.lastReplayDetail ?? detail
    );
    return {
      status: written,
      capturedEvents: events.length,
      replayedEvents: 0,
      expectedEvents,
      firstDivergenceSeq: null,
      divergenceDetail:
        patch.epoch?.lastReplayDetail?.divergenceDetail ?? detail.divergenceDetail,
      livePoints: [],
      replayPoints: [],
      replayCurrent: false,
      persistAcknowledgedEvents: patch.persistAcknowledgedEvents
    };
  }

  const result = replayGhShadowCapturedEvents({
    events,
    liveDecisions: decisions,
    liveTrades: trades
  });

  // Final currency check AFTER replay computation (ACK may have arrived mid-run).
  const current = await loadGhShadowEpoch(ownerUid);
  const finalAck = current?.integrity.persistAcknowledgedEvents ?? -1;
  const finalQid = current?.qualificationId ?? null;
  const stillCurrent =
    finalQid === qualificationId && finalAck === expectedEvents;

  if (!stillCurrent) {
    const detail = {
      capturedEvents: result.capturedEvents,
      replayedEvents: result.replayedEvents,
      expectedEvents,
      firstDivergenceSeq: null as number | null,
      divergenceDetail: `replay_stale_during_run startExpected=${expectedEvents} nowAcknowledged=${finalAck} startQid=${qualificationId} nowQid=${finalQid}`,
      completedAt: new Date().toISOString()
    };

    // Qualification rollover: current is a different epoch (Q2). The old Q1
    // replay must NOT patch Q2 replay fields or sync into the Q2 engine.
    if (finalQid != null && finalQid !== qualificationId) {
      return {
        status: "REPLAY_STALE" as const,
        capturedEvents: result.capturedEvents,
        replayedEvents: result.replayedEvents,
        expectedEvents,
        firstDivergenceSeq: null,
        divergenceDetail: `replay_stale_qualification_rollover startQid=${qualificationId} nowQid=${finalQid}`,
        livePoints: result.livePoints,
        replayPoints: result.replayPoints,
        replayCurrent: false,
        persistAcknowledgedEvents: finalAck >= 0 ? finalAck : null
      };
    }

    // Same qualification, ACK advanced (or epoch missing): field-only STALE
    // patch on the replay-start qualification only — never a different QID.
    if (finalQid && finalQid === qualificationId) {
      const patch = await patchGhShadowEpochReplayFields(ownerUid, {
        qualificationId,
        expectedEvents,
        requireCurrentAck: false,
        lastReplayStatus: "REPLAY_STALE",
        lastReplayDetail: detail
      });
      await syncEngineReplayFields(
        ownerUid,
        qualificationId,
        patch.writtenStatus ?? "REPLAY_STALE",
        patch.epoch?.lastReplayDetail ?? detail
      );
      return {
        status: "REPLAY_STALE" as const,
        capturedEvents: result.capturedEvents,
        replayedEvents: result.replayedEvents,
        expectedEvents,
        firstDivergenceSeq: null,
        divergenceDetail:
          patch.epoch?.lastReplayDetail?.divergenceDetail ?? detail.divergenceDetail,
        livePoints: result.livePoints,
        replayPoints: result.replayPoints,
        replayCurrent: false,
        persistAcknowledgedEvents: patch.persistAcknowledgedEvents
      };
    }
    return {
      status: "REPLAY_STALE" as const,
      capturedEvents: result.capturedEvents,
      replayedEvents: result.replayedEvents,
      expectedEvents,
      firstDivergenceSeq: null,
      divergenceDetail: detail.divergenceDetail,
      livePoints: result.livePoints,
      replayPoints: result.replayPoints,
      replayCurrent: false,
      persistAcknowledgedEvents: finalAck >= 0 ? finalAck : null
    };
  }

  const detail = {
    capturedEvents: result.capturedEvents,
    replayedEvents: result.replayedEvents,
    expectedEvents,
    firstDivergenceSeq: result.firstDivergenceSeq,
    divergenceDetail: result.divergenceDetail,
    completedAt: new Date().toISOString()
  };

  // Atomic finalise — currency derives from the patch transaction result, not
  // only this pre-patch check (covers TOCTOU between check and commit).
  const patch = await patchGhShadowEpochReplayFields(ownerUid, {
    qualificationId,
    expectedEvents,
    requireCurrentAck: true,
    lastReplayStatus: result.status,
    lastReplayDetail: detail
  });

  const writtenStatus = patch.writtenStatus ?? "REPLAY_STALE";
  await syncEngineReplayFields(
    ownerUid,
    patch.qualificationId ?? qualificationId,
    writtenStatus,
    patch.epoch?.lastReplayDetail ?? detail
  );

  const replayCurrent =
    patch.currency === "CURRENT" && writtenStatus === "LIVE_REPLAY_OK";

  return {
    status: writtenStatus,
    capturedEvents: result.capturedEvents,
    replayedEvents: result.replayedEvents,
    expectedEvents,
    firstDivergenceSeq:
      writtenStatus === result.status ? result.firstDivergenceSeq : null,
    divergenceDetail:
      patch.epoch?.lastReplayDetail?.divergenceDetail ?? result.divergenceDetail,
    livePoints: result.livePoints,
    replayPoints: result.replayPoints,
    replayCurrent,
    persistAcknowledgedEvents: patch.persistAcknowledgedEvents
  };
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
  persistFailStageForTests = null;
  sizingOverridesForTests = undefined;
  allowUnitTestSizingDefaults = true; // unit tests default to isolated defaults
  authoritativeSizingLoaderForTests = null;
  autoPersistForTests = true;
  replayBeforeFinalizeHookForTests = null;
  setGhShadowReplayPatchAfterReadHookForTests(null);
}

// silence unused import if hash not used
void createHash;
