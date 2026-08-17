/**
 * Gold Hunter Clean Shadow Qualification — runtime wiring.
 *
 * Hot path: sync engine.processEvent (no Firestore).
 * Persistence: async batched drain (may lag; does not gate MFE/MAE/exit).
 */
import { getFrozenGhFastIdentity } from "../abc/frozenConfig";
import { loadGoldHunterConfig } from "../configStore";
import { getGoldHunterStrategySelector } from "../strategySelector";
import type { GoldHunterSelectorTickResult } from "../strategySelector";
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
import { buildFrozenSizingSnapshot } from "./frozenSizing";
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
import { GH_SHADOW_QUALIFICATION_VERSION } from "./types";
import type { GhShadowFrozenSizingSnapshot } from "./types";
import type { GhShadowSizingInput } from "./economics";
import type { GoldHunterAdminConfig } from "../types";

const persistBusy = new Map<string, boolean>();
const recoveryDone = new Map<string, boolean>();

/** Optional slow persist hook for stress tests. */
let persistDelayMsForTests = 0;
let sizingOverridesForTests: Partial<GhShadowSizingInput> | undefined;

export function setGhShadowPersistDelayMsForTests(ms: number): void {
  persistDelayMsForTests = Math.max(0, ms);
}

export function setGhShadowSizingOverridesForTests(
  over: Partial<GhShadowSizingInput> | undefined
): void {
  sizingOverridesForTests = over;
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

async function ensureRecovery(ownerUid: string): Promise<void> {
  if (recoveryDone.get(ownerUid)) return;
  recoveryDone.set(ownerUid, true);
  const persisted = await loadGhShadowEpoch(ownerUid);
  const openId = persisted?.openShadowTradeId ?? null;
  const persistedOpenTrade =
    openId != null
      ? await loadGhShadowTrade(ownerUid, openId, persisted?.qualificationId)
      : null;
  const eng = getGhShadowEngine(ownerUid, {
    runtimeGeneration: (persisted?.runtimeGeneration ?? 0) + 1,
    forceNew: true
  });
  const { excludedTradeId } = eng.recoverAfterRestart({
    persistedEpoch: persisted,
    persistedOpenTrade,
    reason: "process_restart_or_first_attach"
  });
  if (excludedTradeId || eng.getEpoch()) {
    schedulePersist(ownerUid);
  }
}

function buildFrozenSizingForRuntime(
  config: GoldHunterAdminConfig,
  epoch: { frozenSizing?: GhShadowFrozenSizingSnapshot } | null,
  over?: Partial<GhShadowSizingInput>
): GhShadowFrozenSizingSnapshot {
  const sizingOver = over ?? sizingOverridesForTests ?? {};
  if (epoch?.frozenSizing && sizingOver.quoteToDepositRate == null) {
    return epoch.frozenSizing;
  }
  return buildFrozenSizingSnapshot({
    config,
    quoteToDepositRate:
      sizingOver.quoteToDepositRate ?? epoch?.frozenSizing?.quoteToDepositRate ?? null,
    quoteToDepositRateSource:
      sizingOver.quoteToDepositRateSource ??
      epoch?.frozenSizing?.quoteToDepositRateSource ??
      null
  });
}

async function writeBatch(
  ownerUid: string,
  batch: GhShadowPersistBatch
): Promise<void> {
  const eng = getGhShadowEngine(ownerUid);
  const eventIds = batch.events.map((e) => e.eventId);
  try {
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
  } catch {
    eng.requeuePersistFailure();
    throw new Error("gh_shadow_persist_failed");
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
          // Still persist epoch counters periodically
          if (batch?.epoch) await saveGhShadowEpoch(ownerUid, batch.epoch);
          break;
        }
        await writeBatch(ownerUid, batch);
      }
    } finally {
      persistBusy.set(ownerUid, false);
      const eng = getGhShadowEngine(ownerUid);
      const leftover = eng.drainPersistBatch();
      if (
        leftover &&
        (leftover.trades.length ||
          leftover.events.length ||
          leftover.decisions.length)
      ) {
        schedulePersist(ownerUid);
      }
    }
  })();
}

/**
 * Hot-path entry from marketFeedHook — synchronous engine update.
 * Never blocks on Firestore. Never calls Demo/broker submit.
 */
export function onGhShadowSelectorTick(args: {
  ownerUid: string;
  tick: GoldHunterSelectorTickResult;
}): void {
  if (!isGhShadowQualificationEnabled()) return;
  if (!args.ownerUid.trim()) return;

  const forbidden = (globalThis as { __ghShadowBrokerSubmitHook?: unknown })
    .__ghShadowBrokerSubmitHook;
  if (typeof forbidden === "function") {
    refuseGhShadowBrokerMutation("shadow_runtime_broker_submit_hook");
  }

  // Kick recovery async once; still process this tick on in-memory engine.
  if (!recoveryDone.get(args.ownerUid)) {
    void ensureRecovery(args.ownerUid).catch(() => undefined);
  }

  const sel = getGoldHunterStrategySelector(args.ownerUid);
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

  const receiveSeq =
    args.tick.opportunity?.latestReceiveSeq ??
    args.tick.candidate?.latestReceiveSeq ??
    0;

  const eng = getGhShadowEngine(args.ownerUid);

  // Config load is async — use last-known via fire-and-forget cache
  void loadGoldHunterConfig(args.ownerUid)
    .then((config) => {
      // If this tick already processed with default, subsequent ticks use real config.
      (eng as unknown as { _lastConfig?: typeof config })._lastConfig = config;
    })
    .catch(() => undefined);

  const cachedConfig = (eng as unknown as { _lastConfig?: Awaited<ReturnType<typeof loadGoldHunterConfig>> })
    ._lastConfig;

  // For first ticks before config resolves, use a sync path with defaults from store memory.
  // processEvent must stay sync — load config outside hot path when possible.
  if (!cachedConfig) {
    // Defer this tick's open until config ready; still need config for sizing.
    // Use ensureRecovery + async process for opens only when config missing.
    void (async () => {
      await ensureRecovery(args.ownerUid);
      const config = await loadGoldHunterConfig(args.ownerUid);
      (eng as unknown as { _lastConfig?: typeof config })._lastConfig = config;
      eng.processEvent({
        receiveSeq,
        eventTsMs: Date.now(),
        bid,
        ask,
        features: snap?.features ?? null,
        dataOk,
        depthValidity: String(snap?.depthValidity ?? "DEPTH_UNKNOWN"),
        bookGeneration: snap?.bookGeneration ?? 0,
        resyncGeneration: 0,
        newOpportunity: args.tick.newOpportunity,
        opportunity: args.tick.opportunity,
        config,
        frozenSizing: buildFrozenSizingForRuntime(config, eng.getEpoch()),
        allowFormal: true
      });
      schedulePersist(args.ownerUid);
    })();
    return;
  }

  eng.processEvent({
    receiveSeq,
    eventTsMs: Date.now(),
    bid,
    ask,
    features: snap?.features ?? null,
    dataOk,
    depthValidity: String(snap?.depthValidity ?? "DEPTH_UNKNOWN"),
    bookGeneration: snap?.bookGeneration ?? 0,
    resyncGeneration: 0,
    newOpportunity: args.tick.newOpportunity,
    opportunity: args.tick.opportunity,
    config: cachedConfig,
    frozenSizing: buildFrozenSizingForRuntime(cachedConfig, eng.getEpoch()),
    allowFormal: true
  });
  schedulePersist(args.ownerUid);
}

/**
 * Direct sync API for tests / deterministic feeds (preferred over selector hook).
 */
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
  config: import("../types").GoldHunterAdminConfig;
  sizingOverrides?: Partial<GhShadowSizingInput>;
  allowFormal?: boolean;
}): void {
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
    frozenSizing: buildFrozenSizingForRuntime(
      args.config,
      eng.getEpoch(),
      args.sizingOverrides ?? sizingOverridesForTests
    ),
    allowFormal: args.allowFormal ?? true
  });
  schedulePersist(args.ownerUid);
}

export async function flushGhShadowPersistenceForTests(
  ownerUid: string
): Promise<void> {
  // Drain until idle
  for (let i = 0; i < 50; i++) {
    schedulePersist(ownerUid);
    await new Promise((r) => setTimeout(r, persistDelayMsForTests + 5));
    if (!persistBusy.get(ownerUid)) {
      const eng = getGhShadowEngine(ownerUid);
      const batch = eng.drainPersistBatch();
      if (
        batch &&
        (batch.trades.length || batch.events.length || batch.decisions.length)
      ) {
        await writeBatch(ownerUid, batch);
        continue;
      }
      break;
    }
  }
}

export async function runGhShadowReplayAndGate(
  ownerUid: string
): Promise<ReturnType<typeof replayGhShadowCapturedEvents>> {
  const epoch = await loadGhShadowEpoch(ownerUid);
  if (!epoch) {
    return {
      status: "LIVE_REPLAY_DIVERGENCE",
      capturedEvents: 0,
      replayedEvents: 0,
      firstDivergenceSeq: null,
      divergenceDetail: "no_epoch",
      livePoints: [],
      replayPoints: []
    };
  }
  const events = await listGhShadowCapturedEvents(ownerUid, {
    qualificationId: epoch.qualificationId
  });
  const decisions = await listGhShadowDecisions(ownerUid, {
    qualificationId: epoch.qualificationId
  });
  const trades = await listGhShadowTrades(ownerUid, {
    qualificationId: epoch.qualificationId,
    limit: 2000
  });
  const result = replayGhShadowCapturedEvents({
    events,
    liveDecisions: decisions,
    liveTrades: trades
  });
  epoch.lastReplayStatus = result.status;
  epoch.lastReplayDetail = {
    capturedEvents: result.capturedEvents,
    replayedEvents: result.replayedEvents,
    firstDivergenceSeq: result.firstDivergenceSeq,
    divergenceDetail: result.divergenceDetail
  };
  epoch.updatedAt = new Date().toISOString();
  await saveGhShadowEpoch(ownerUid, epoch);
  return result;
}

export async function buildGhShadowQualificationStatus(ownerUid: string) {
  await ensureRecovery(ownerUid);
  const identity = getGhShadowStrategyConfigIdentity();
  const epoch = await loadGhShadowEpoch(ownerUid);
  const trades = epoch
    ? await listGhShadowTrades(ownerUid, {
        qualificationId: epoch.qualificationId,
        limit: 2000
      })
    : [];
  const performance = computeGhShadowPerformanceReport(trades, epoch);
  const eng = getGhShadowEngine(ownerUid);
  return {
    enabled: isGhShadowQualificationEnabled(),
    version: GH_SHADOW_QUALIFICATION_VERSION,
    storagePath: GH_SHADOW_QUALIFICATION_STORAGE_PATH,
    identity,
    epoch,
    performance,
    mutationSurface: getGhShadowMutationSurfaceReport(),
    openShadowTradeId: eng.getOpenTradeId(),
    journalSize: eng.getJournalEvents().length,
    demoAutoTradeNote:
      "Shadow qualification does not modify demoAutoTradeEnabled / pauseNewEntries / emergencyStopActive. No broker NewOrder from this path."
  };
}

export function resetGhShadowQualificationRuntimeForTests(): void {
  resetGhShadowEnginesForTests();
  resetGhShadowQualificationMemoryForTests();
  persistBusy.clear();
  recoveryDone.clear();
  persistDelayMsForTests = 0;
  sizingOverridesForTests = undefined;
}

/** Compatibility aliases used by older tests / routes. */
export const enqueueGhShadowQualificationTick = (args: {
  ownerUid: string;
  tick: GoldHunterSelectorTickResult;
}): boolean => {
  onGhShadowSelectorTick(args);
  return true;
};

export async function drainGhShadowQualificationForTests(
  ownerUid: string
): Promise<void> {
  await flushGhShadowPersistenceForTests(ownerUid);
}
