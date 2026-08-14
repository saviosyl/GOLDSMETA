/**
 * Optional bridge: Micro live session spot/depth → GOLD_HUNTER FAST engine.
 * Shadow-only. Ordered single-consumer queue. Async persistence off hot path.
 */
import { spotPriceFromRelative } from "../../marketData/microCTraderProtocol";
import type { MicroLiveMarketSession } from "../../marketData/liveSession";
import { GoldHunterFastEngine } from "./engine";
import { GhFastEventCollector } from "./collector";
import { ShadowExecutionAdapter } from "./executionAdapter";
import { OrderedEventQueue } from "./eventQueue";
import { parseProtoOADepthEventPayload } from "./depthProtocol";
import { depthUnavailableReason } from "./depthDiagnostics";
import { defaultGhFastConfig } from "./defaults";
import {
  getFrozenGhFastIdentity,
  hashGhFastConfig
} from "./frozenConfig";
import { computeSetupStats } from "./soakMetrics";
import {
  GH_FAST_BROKER_EXECUTION_ENABLED,
  GH_FAST_MUTATION_SURFACE,
  isGoldHunterFastShadowEnabled
} from "./versions";
import type {
  GhFastConfig,
  GhFastDecision,
  GhFastMarketEvent,
  GhFastSetupId
} from "./types";

export type GhFastLiveUi = {
  state: string;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  eventRate1s: number;
  bidDepth: number;
  askDepth: number;
  depthImbalance: number;
  velocity: number;
  acceleration: number;
  setup: string | null;
  setupQuality: number;
  action: string | null;
  decisionLatencyMs: number | null;
  open: {
    side: string;
    entry: number;
    executableExit: number;
    openPnl: number;
    mfe: number;
    mae: number;
    durationMs: number;
    profitLock: boolean;
    trail: number | null;
    exitPressure: string | null;
  } | null;
  shadowOrders: number;
  brokerRequests: 0;
  brokerOrders: 0;
  mutationSurface: "NONE";
  shadowOnly: true;
  /** Live-shadow soak identity (frozen config). */
  realMarketData: true;
  pepperstoneDemo: true;
  soakLabel: "LIVE_SHADOW_SOAK_V1" | null;
  engineVersion: string | null;
  configSha256: string | null;
  tuningAllowed: false;
  completedShadowTrades: number;
  todayNetMove: number;
  wins: number;
  losses: number;
  profitFactor: number | null;
  rejectionsTop: Record<string, number>;
  setupDetections: Record<string, number>;
};

export type GhFastRuntimeHealth = {
  fastEnabled: boolean;
  fastAttached: boolean;
  ready: boolean;
  spotSubscribed: boolean;
  depthSubscribed: boolean;
  lastSpotEventAt: string | null;
  lastDepthEventAt: string | null;
  spotAgeMs: number | null;
  depthAgeMs: number | null;
  depthBookAvailable: boolean;
  depthCrossed: boolean;
  depthUnavailableReason: string | null;
  depthBidLevels: number;
  depthAskLevels: number;
  bestDepthBid: number | null;
  bestDepthAsk: number | null;
  depthSpread: number | null;
  spotBid: number | null;
  spotAsk: number | null;
  spotSpread: number | null;
  depthVsSpotDifference: number | null;
  deleteHitRate: number;
  deleteMissCount: number;
  lastValidBookAt: string | null;
  consecutiveInvalidDepthSnapshots: number;
  bookGeneration: number;
  resyncCount: number;
  warmingUp: boolean;
  eventsReceived: number;
  spotEvents: number;
  depthEvents: number;
  decisions: number;
  shadowEntries: number;
  shadowExits: number;
  openShadowTrade: boolean;
  lastDecision: string | null;
  lastSetup: string | null;
  setupA: number;
  setupB: number;
  setupC: number;
  eventToDecision: {
    p50: number | null;
    p95: number | null;
    p99: number | null;
  };
  queueDepth: number;
  queueWait: {
    p50: number | null;
    p95: number | null;
    p99: number | null;
  };
  eventsDropped: number;
  persistenceQueueDepth: number;
  persistenceHealthWarning: string | null;
  durableMode: string;
  depthParse: {
    decodedBid: number;
    decodedAsk: number;
    invalid: number;
    deletedIds: number;
  };
  brokerRequests: 0;
  brokerOrders: 0;
  mutationSurface: "NONE";
  shadowOnly: true;
  brokerExecutionEnabled: false;
  soakLabel: "LIVE_SHADOW_SOAK_V1" | null;
  engineVersion: string | null;
  configSha256: string | null;
  tuningAllowed: false;
};

type RawIngress = {
  kind: "SPOT" | "DEPTH";
  receiveSeq: number;
  receivedAtMs: number;
  payload: Record<string, unknown>;
};

export class GoldHunterFastLiveBridge {
  readonly engine: GoldHunterFastEngine;
  readonly collector: GhFastEventCollector | null;
  readonly queue = new OrderedEventQueue<RawIngress>();
  private unsubs: Array<() => void> = [];
  private attached = false;
  private lastAction: string | null = null;
  private lastDecision: GhFastDecision | null = null;
  private receiveSeq = 0;
  private spotEvents = 0;
  private depthEvents = 0;
  private lastSpotAt: number | null = null;
  private lastDepthAt: number | null = null;
  private sessionSpotSub = false;
  private sessionDepthSub = false;
  private setupCounts = {
    A_MOMENTUM_IGNITION: 0,
    B_FAST_BREAKOUT: 0,
    C_PULLBACK_REACCEL: 0
  };
  private parseStats = {
    decodedBid: 0,
    decodedAsk: 0,
    invalid: 0,
    deletedIds: 0
  };
  private staleMarked = false;
  private readonly enabled: boolean;
  private readonly soakFrozen: boolean;
  private readonly configSha256: string;

  constructor(opts?: {
    config?: Partial<GhFastConfig>;
    collectDir?: string;
    enableCollector?: boolean;
    enabled?: boolean;
    gcsBucket?: string | null;
    /** Soak path: freeze defaults; ignore threshold overrides. */
    useFrozenSoakConfig?: boolean;
  }) {
    this.enabled = opts?.enabled ?? isGoldHunterFastShadowEnabled();
    this.soakFrozen = opts?.useFrozenSoakConfig === true;
    if (GH_FAST_BROKER_EXECUTION_ENABLED !== false) {
      throw new Error("REFUSING: FAST broker execution must be false");
    }
    const adapter = new ShadowExecutionAdapter();
    const frozen = getFrozenGhFastIdentity();
    const cfg = this.soakFrozen
      ? frozen.config
      : defaultGhFastConfig(opts?.config);
    this.configSha256 = this.soakFrozen
      ? frozen.configSha256
      : hashGhFastConfig(cfg);
    this.engine = new GoldHunterFastEngine({
      config: cfg,
      adapter,
      useFrozenSoakConfig: this.soakFrozen
    });
    this.collector =
      opts?.enableCollector === false
        ? null
        : new GhFastEventCollector({
            dir: opts?.collectDir,
            configHash: this.configSha256.slice(0, 16),
            gcsBucket: opts?.gcsBucket
          });
    this.queue.setHandler(async (item) => {
      await this.processOrdered(item.payload);
    });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isAttached(): boolean {
    return this.attached;
  }

  /** Attach to session — detaches first to prevent duplicate listeners. */
  attach(session: MicroLiveMarketSession): void {
    if (!this.enabled) return;
    this.detach();
    this.staleMarked = false;
    this.unsubs.push(
      session.onSpotForFast((payload) => {
        this.ingressSpot(payload);
      })
    );
    this.unsubs.push(
      session.onDepthForFast((payload) => {
        this.ingressDepth(payload);
      })
    );
    this.attached = true;
    void session.getState().then((st) => {
      this.sessionSpotSub = st.spotSubscribed;
      this.sessionDepthSub = st.depthSubscribed;
    });
  }

  detach(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.attached = false;
  }

  markStale(): void {
    this.staleMarked = true;
    this.sessionSpotSub = false;
    this.sessionDepthSub = false;
  }

  /**
   * Market-data reset used on transport reconnect / invalid-book resync.
   * Does not recreate the bridge (avoids duplicate listeners when re-attached).
   */
  async resetMarketDataForResync(reason = "market_data_resync"): Promise<void> {
    await this.engine.resetMarketDataForResync({
      reason,
      nowMs: Date.now()
    });
    this.lastSpotAt = null;
    this.lastDepthAt = null;
    this.lastAction = null;
    this.lastDecision = null;
    this.staleMarked = false;
  }

  listenerCountForTests(): number {
    return this.unsubs.length;
  }

  private nextSeq(): number {
    this.receiveSeq += 1;
    return this.receiveSeq;
  }

  private ingressSpot(payload: Record<string, unknown>): void {
    const receiveSeq = this.nextSeq();
    const receivedAtMs = Date.now();
    this.spotEvents += 1;
    this.lastSpotAt = receivedAtMs;
    this.queue.enqueue(receiveSeq, {
      kind: "SPOT",
      receiveSeq,
      receivedAtMs,
      payload
    });
  }

  private ingressDepth(payload: Record<string, unknown>): void {
    const receiveSeq = this.nextSeq();
    const receivedAtMs = Date.now();
    this.depthEvents += 1;
    this.lastDepthAt = receivedAtMs;
    this.queue.enqueue(receiveSeq, {
      kind: "DEPTH",
      receiveSeq,
      receivedAtMs,
      payload
    });
  }

  /** Test helper: feed raw transport payloads through the ordered queue. */
  ingestRawForTests(
    kind: "SPOT" | "DEPTH",
    payload: Record<string, unknown>
  ): void {
    if (kind === "SPOT") this.ingressSpot(payload);
    else this.ingressDepth(payload);
  }

  async drainForTests(): Promise<void> {
    await this.queue.drain();
    if (this.collector) await this.collector.flushAndWait(2000);
  }

  private async processOrdered(raw: RawIngress): Promise<void> {
    let ev: GhFastMarketEvent;
    if (raw.kind === "SPOT") {
      const bid =
        raw.payload.bid != null ? spotPriceFromRelative(raw.payload.bid) : null;
      const ask =
        raw.payload.ask != null ? spotPriceFromRelative(raw.payload.ask) : null;
      const brokerTs =
        typeof raw.payload.timestamp === "number"
          ? raw.payload.timestamp
          : null;
      ev = {
        kind: "SPOT",
        receiveSeq: raw.receiveSeq,
        eventId: `SPOT:${raw.receiveSeq}:${brokerTs ?? ""}:${bid ?? ""}:${ask ?? ""}`,
        receivedAtMs: raw.receivedAtMs,
        brokerTimestampMs: brokerTs,
        bid,
        ask,
        symbolId: raw.payload.symbolId as string | number | undefined
      };
    } else {
      const parsed = parseProtoOADepthEventPayload(raw.payload);
      this.parseStats.decodedBid += parsed.stats.decodedBid;
      this.parseStats.decodedAsk += parsed.stats.decodedAsk;
      this.parseStats.invalid += parsed.stats.invalid;
      this.parseStats.deletedIds += parsed.stats.deletedIds;
      const brokerTs =
        typeof raw.payload.timestamp === "number"
          ? raw.payload.timestamp
          : null;
      const ids = parsed.newQuotes.map((q) => String(q.id ?? "")).join(",");
      const dels = parsed.deletedQuotes.map((d) => d.id).join(",");
      ev = {
        kind: "DEPTH",
        receiveSeq: raw.receiveSeq,
        eventId: `DEPTH:${raw.receiveSeq}:${brokerTs ?? ""}:${ids}:${dels}`,
        receivedAtMs: raw.receivedAtMs,
        brokerTimestampMs: brokerTs,
        symbolId: raw.payload.symbolId as string | number | undefined,
        newQuotes: parsed.newQuotes,
        deletedQuotes: parsed.deletedQuotes
      };
    }

    const decision = await this.engine.onMarketEvent(ev);
    this.lastAction = decision.action;
    this.lastDecision = decision;
    if (
      (decision.action === "ENTER_BUY" || decision.action === "ENTER_SELL") &&
      decision.setup
    ) {
      this.setupCounts[decision.setup as GhFastSetupId] += 1;
    }

    // Persistence enqueue only — never sync gzip/write on this path.
    if (this.collector) {
      const st = this.engine.status();
      this.collector.record({
        t: ev.receivedAtMs,
        event: ev,
        decision,
        status: {
          state: st.state,
          bid: st.bid,
          ask: st.ask,
          spread: st.spread,
          depthImbalance: st.depthImbalance,
          velocity: st.velocity,
          acceleration: st.acceleration,
          setup: st.setup,
          setupQuality: st.setupQuality
        },
        depthTop: this.engine.depth.snapshot(5)
      });
    }
  }

  async refreshSessionFlags(session: MicroLiveMarketSession): Promise<void> {
    const st = await session.getState();
    this.sessionSpotSub = st.spotSubscribed;
    this.sessionDepthSub = st.depthSubscribed;
  }

  health(): GhFastRuntimeHealth {
    const now = Date.now();
    const st = this.engine.status();
    const depth = this.engine.depth.stats(5);
    const q = this.queue.stats();
    const persist = this.collector?.stats();
    const lat = st.latency;
    const depthFresh =
      this.lastDepthAt != null && now - this.lastDepthAt < 2000;
    const warmingUp = this.engine.isWarmingUp();
    const unavailable = depthUnavailableReason({
      stats: depth,
      depthAgeMs: this.lastDepthAt != null ? now - this.lastDepthAt : null,
      depthFreshnessMs: 2000,
      warmingUp
    });
    const ready =
      this.enabled &&
      this.attached &&
      !this.staleMarked &&
      !warmingUp &&
      this.sessionSpotSub &&
      this.sessionDepthSub &&
      depth.available &&
      depthFresh &&
      st.bid != null &&
      st.ask != null;

    const spotMid =
      st.bid != null && st.ask != null ? (st.bid + st.ask) / 2 : null;
    const depthMid =
      depth.bestBid != null && depth.bestAsk != null
        ? (depth.bestBid + depth.bestAsk) / 2
        : null;

    const adapterOrders =
      this.engine.shadowOrders?.() ?? [];
    const entries = adapterOrders.filter((o) => o.kind === "ENTER").length;
    const exits = adapterOrders.filter((o) => o.kind === "EXIT").length;

    return {
      fastEnabled: this.enabled,
      fastAttached: this.attached,
      ready: Boolean(ready),
      spotSubscribed: this.sessionSpotSub,
      depthSubscribed: this.sessionDepthSub,
      lastSpotEventAt: this.lastSpotAt
        ? new Date(this.lastSpotAt).toISOString()
        : null,
      lastDepthEventAt: this.lastDepthAt
        ? new Date(this.lastDepthAt).toISOString()
        : null,
      spotAgeMs: this.lastSpotAt != null ? now - this.lastSpotAt : null,
      depthAgeMs: this.lastDepthAt != null ? now - this.lastDepthAt : null,
      depthBookAvailable: depth.available,
      depthCrossed: depth.crossed,
      depthUnavailableReason: unavailable,
      depthBidLevels: depth.bidLevels,
      depthAskLevels: depth.askLevels,
      bestDepthBid: depth.bestBid,
      bestDepthAsk: depth.bestAsk,
      depthSpread: depth.spread,
      spotBid: st.bid,
      spotAsk: st.ask,
      spotSpread: st.spread,
      depthVsSpotDifference:
        spotMid != null && depthMid != null ? depthMid - spotMid : null,
      deleteHitRate: depth.deleteHitRate,
      deleteMissCount: depth.deleteMisses,
      lastValidBookAt: depth.lastValidBookMs
        ? new Date(depth.lastValidBookMs).toISOString()
        : null,
      consecutiveInvalidDepthSnapshots: depth.consecutiveInvalidSnapshots,
      bookGeneration: depth.bookGeneration,
      resyncCount: depth.resyncCount,
      warmingUp,
      eventsReceived: this.spotEvents + this.depthEvents,
      spotEvents: this.spotEvents,
      depthEvents: this.depthEvents,
      decisions: this.engine.decisions.length,
      shadowEntries: entries,
      shadowExits: exits,
      openShadowTrade: st.openTrade != null,
      lastDecision: this.lastAction,
      lastSetup: st.setup,
      setupA: this.setupCounts.A_MOMENTUM_IGNITION,
      setupB: this.setupCounts.B_FAST_BREAKOUT,
      setupC: this.setupCounts.C_PULLBACK_REACCEL,
      eventToDecision: {
        p50: lat.p50,
        p95: lat.p95,
        p99: lat.p99
      },
      queueDepth: q.depth,
      queueWait: {
        p50: q.queueWait.p50,
        p95: q.queueWait.p95,
        p99: q.queueWait.p99
      },
      eventsDropped: q.dropped,
      persistenceQueueDepth: persist?.queueDepth ?? 0,
      persistenceHealthWarning: persist?.healthWarning ?? null,
      durableMode: persist?.durableMode ?? "NONE",
      depthParse: { ...this.parseStats },
      brokerRequests: 0,
      brokerOrders: 0,
      mutationSurface: GH_FAST_MUTATION_SURFACE,
      shadowOnly: true,
      brokerExecutionEnabled: false,
      soakLabel: this.soakFrozen ? "LIVE_SHADOW_SOAK_V1" : null,
      engineVersion: this.soakFrozen
        ? getFrozenGhFastIdentity().engineVersion
        : this.engine.frozen().engineVersion,
      configSha256: this.configSha256,
      tuningAllowed: false
    };
  }

  uiStatus(): GhFastLiveUi {
    const st = this.engine.status();
    const depth = this.engine.depth.stats(5);
    const open = st.openTrade;
    const now = Date.now();
    const warmingUi = this.engine.isWarmingUp();
    let openUi: GhFastLiveUi["open"] = null;
    if (open && st.bid != null && st.ask != null) {
      const exec = open.side === "BUY" ? st.bid : st.ask;
      const pnl =
        open.side === "BUY" ? exec - open.entryPrice : open.entryPrice - exec;
      openUi = {
        side: open.side,
        entry: open.entryPrice,
        executableExit: exec,
        openPnl: pnl,
        mfe: open.mfe,
        mae: open.mae,
        durationMs: now - open.entryTs,
        profitLock: open.profitLockActive,
        trail: open.lockFloor,
        exitPressure: open.harvestRunner ? "RUNNER" : null
      };
    }
    const closed = this.engine.closed;
    const allStats = computeSetupStats(
      "ALL",
      closed,
      this.engine.setupDetections.A_MOMENTUM_IGNITION +
        this.engine.setupDetections.B_FAST_BREAKOUT +
        this.engine.setupDetections.C_PULLBACK_REACCEL,
      this.engine.entryTimestampsMs.length
    );
    const rej = this.engine.rejections.snapshot();
    const topRej: Record<string, number> = {};
    for (const [k, v] of Object.entries(rej).slice(0, 8)) topRej[k] = v;
    const frozen = getFrozenGhFastIdentity();
    return {
      state: this.staleMarked
        ? "DATA_STALE"
        : warmingUi
          ? "BOOK_REBUILDING"
          : st.state,
      bid: st.bid,
      ask: st.ask,
      spread: st.spread,
      eventRate1s: st.eventRate1s,
      bidDepth: depth.bidDepthN,
      askDepth: depth.askDepthN,
      depthImbalance: st.depthImbalance,
      velocity: st.velocity,
      acceleration: st.acceleration,
      setup: st.setup,
      setupQuality: st.setupQuality,
      action: this.lastAction,
      decisionLatencyMs: st.latency.p50,
      open: openUi,
      shadowOrders: st.shadowOrders,
      brokerRequests: 0,
      brokerOrders: 0,
      mutationSurface: "NONE",
      shadowOnly: true,
      realMarketData: true,
      pepperstoneDemo: true,
      soakLabel: this.soakFrozen ? "LIVE_SHADOW_SOAK_V1" : null,
      engineVersion: frozen.engineVersion,
      configSha256: this.configSha256,
      tuningAllowed: false,
      completedShadowTrades: closed.length,
      todayNetMove: allStats.netMove,
      wins: allStats.wins,
      losses: allStats.losses,
      profitFactor:
        allStats.profitFactor != null && Number.isFinite(allStats.profitFactor)
          ? allStats.profitFactor
          : null,
      rejectionsTop: topRej,
      setupDetections: { ...this.engine.setupDetections }
    };
  }
}

let bridgeSingleton: GoldHunterFastLiveBridge | null = null;

export function getGoldHunterFastLiveBridge(): GoldHunterFastLiveBridge {
  if (!bridgeSingleton) {
    bridgeSingleton = new GoldHunterFastLiveBridge({
      enabled: isGoldHunterFastShadowEnabled()
    });
  }
  return bridgeSingleton;
}

export function resetGoldHunterFastLiveBridgeForTests(): void {
  bridgeSingleton?.detach();
  bridgeSingleton = null;
}
