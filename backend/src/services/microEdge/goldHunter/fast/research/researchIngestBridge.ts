/**
 * Research ingest bridge — ordered Spot/Depth observation path.
 * NO trading engine. NO execution adapter. NO ENTER/EXIT.
 */
import { OrderedEventQueue } from "../eventQueue";
import { LatencyTracker } from "../latency";
import { hashGhFastConfig, frozenGhFastSoakConfig } from "../frozenConfig";
import type { GhFastDepthEvent, GhFastSpotEvent } from "../types";
import { ResearchFeaturePipeline } from "./researchFeaturePipeline";
import { ResearchEventCollector } from "./researchCollector";
import { ResearchDurableSink } from "./researchDurableSink";
import {
  assertNoExecutionAdapterArgument,
  researchSafetyIdentity
} from "./nullExecutionGuard";
import {
  GH_FAST_RESEARCH_GCS_PREFIX_ROOT,
  GH_FAST_RESEARCH_MODE,
  GH_FAST_RESEARCH_SCHEMA_VERSION,
  type ResearchCaptureHealth,
  type ResearchCaptureRecord,
  type ResearchConnectionState,
  type ResearchDaySummary,
  type ResearchResubscribeState,
  type ResearchStatusUiDesign,
  type ResearchSubscriptionState
} from "./researchTypes";

type QueuedIngress = {
  kind: "SPOT" | "DEPTH" | "RESYNC_MARKER" | "HEARTBEAT";
  receiveSeq: number;
  rawCallbackArrivalMs: number;
  bridgeEnqueueMs: number;
  payload: Record<string, unknown>;
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function makeRunId(): string {
  return `gh_research_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export class ResearchIngestBridge {
  private readonly queue = new OrderedEventQueue<QueuedIngress>();
  private readonly pipeline = new ResearchFeaturePipeline();
  private readonly queueLat = new LatencyTracker();
  private readonly lagLat = new LatencyTracker();
  private readonly sink: ResearchDurableSink;
  private readonly collector: ResearchEventCollector;
  private readonly runId: string;
  private readonly datasetId: string;
  private readonly researchConfigSha: string;
  private readonly runtimeSha: string | null;
  private readonly captureStartIso: string;
  private readonly captureStartMs: number;
  private receiveSeq = 0;
  private eventsReceived = 0;
  private lastSpotAt: number | null = null;
  private lastDepthAt: number | null = null;
  private feedGapCount = 0;
  private reconnectCount = 0;
  private resyncCount = 0;
  private bookCrossedCount = 0;
  private candidateA = 0;
  private candidateB = 0;
  private candidateC = 0;
  private prevEventTs: number | null = null;
  private spotSubscribed = false;
  private depthSubscribed = false;
  private connectionState: ResearchConnectionState = "DISCONNECTED";
  private disconnectTs: number | null = null;
  private reconnectStartTs: number | null = null;
  private reconnectFinishTs: number | null = null;
  private resubscribeState: ResearchResubscribeState = "IDLE";
  private reconnectReason: string | null = null;
  private lastEventLoopLagMs: number | null = null;
  private readonly gapMs: number;

  constructor(opts?: {
    runId?: string;
    datasetId?: string;
    localDir?: string;
    gcsBucket?: string | null;
    chunkRows?: number;
    runtimeSha?: string | null;
    gapMs?: number;
    _executionAdapterMustBeUndefined?: unknown;
  }) {
    assertNoExecutionAdapterArgument(opts?._executionAdapterMustBeUndefined);
    researchSafetyIdentity();
    this.runId = opts?.runId ?? makeRunId();
    this.datasetId = opts?.datasetId ?? `dataset_${this.runId}`;
    this.researchConfigSha = hashGhFastConfig(frozenGhFastSoakConfig());
    this.runtimeSha = opts?.runtimeSha ?? null;
    this.captureStartMs = Date.now();
    this.captureStartIso = new Date(this.captureStartMs).toISOString();
    this.gapMs = opts?.gapMs ?? 2000;
    this.sink = new ResearchDurableSink({
      runId: this.runId,
      datasetId: this.datasetId,
      researchConfigSha: this.researchConfigSha,
      runtimeSha: this.runtimeSha,
      captureStart: this.captureStartIso,
      localDir: opts?.localDir,
      gcsBucket: opts?.gcsBucket,
      chunkRows: opts?.chunkRows
    });
    this.collector = new ResearchEventCollector(this.sink);
    this.queue.setHandler(async (item) => {
      await this.processOrdered(item.payload, item.enqueuedAtMs);
    });
  }

  getRunId(): string {
    return this.runId;
  }

  getDatasetId(): string {
    return this.datasetId;
  }

  getSink(): ResearchDurableSink {
    return this.sink;
  }

  setSubscriptionFlags(spot: boolean, depth: boolean): void {
    this.spotSubscribed = spot;
    this.depthSubscribed = depth;
  }

  setConnectionState(state: ResearchConnectionState): void {
    this.connectionState = state;
  }

  noteDisconnect(reason: string, ts = Date.now()): void {
    this.disconnectTs = ts;
    this.connectionState = "DISCONNECTED";
    this.reconnectReason = reason;
    this.spotSubscribed = false;
    this.depthSubscribed = false;
  }

  noteReconnectStart(ts = Date.now()): void {
    this.reconnectStartTs = ts;
    this.reconnectCount += 1;
    this.connectionState = "RECONNECTING";
    this.resubscribeState = "PENDING";
  }

  noteReconnectFinish(ts = Date.now()): void {
    this.reconnectFinishTs = ts;
    this.connectionState = "CONNECTED";
    this.resubscribeState = "COMPLETE";
  }

  /**
   * Market-data reset for research — clears book/features and records a marker.
   * Does NOT fabricate trades (there is no trade state).
   */
  noteResync(reason: string, ts = Date.now()): void {
    this.resyncCount += 1;
    this.pipeline.clearForResync();
    const receiveSeq = this.nextSeq();
    const rawCallbackArrivalMs = ts;
    const bridgeEnqueueMs = ts;
    this.queue.enqueue(receiveSeq, {
      kind: "RESYNC_MARKER",
      receiveSeq,
      rawCallbackArrivalMs,
      bridgeEnqueueMs,
      payload: { reason }
    });
  }

  recordHeartbeatLag(lagMs: number): void {
    this.lastEventLoopLagMs = lagMs;
    this.lagLat.record({
      marketEventReceivedMs: 0,
      featuresCalculatedMs: 0,
      decisionProducedMs: lagMs,
      shadowOrderProducedMs: null,
      eventToDecisionMs: lagMs
    });
  }

  /** Ingress from transport callback (or tests). */
  ingestSpot(payload: Record<string, unknown>, rawCallbackArrivalMs = Date.now()): void {
    const receiveSeq = this.nextSeq();
    // Enqueue time is never before the raw callback arrival (monotonic transport).
    const bridgeEnqueueMs = Math.max(Date.now(), rawCallbackArrivalMs);
    this.eventsReceived += 1;
    this.lastSpotAt = rawCallbackArrivalMs;
    this.queue.enqueue(receiveSeq, {
      kind: "SPOT",
      receiveSeq,
      rawCallbackArrivalMs,
      bridgeEnqueueMs,
      payload
    });
  }

  ingestDepth(payload: Record<string, unknown>, rawCallbackArrivalMs = Date.now()): void {
    const receiveSeq = this.nextSeq();
    const bridgeEnqueueMs = Math.max(Date.now(), rawCallbackArrivalMs);
    this.eventsReceived += 1;
    this.lastDepthAt = rawCallbackArrivalMs;
    this.queue.enqueue(receiveSeq, {
      kind: "DEPTH",
      receiveSeq,
      rawCallbackArrivalMs,
      bridgeEnqueueMs,
      payload
    });
  }

  async drainForTests(timeoutMs = 5000): Promise<void> {
    await this.queue.drain(timeoutMs);
    await this.collector.flushAndWait(timeoutMs);
  }

  private nextSeq(): number {
    this.receiveSeq += 1;
    return this.receiveSeq;
  }

  private subscriptionSnap(): ResearchSubscriptionState {
    return {
      spotSubscribed: this.spotSubscribed,
      depthSubscribed: this.depthSubscribed,
      connectionState: this.connectionState,
      disconnectTs: this.disconnectTs,
      reconnectStartTs: this.reconnectStartTs,
      reconnectFinishTs: this.reconnectFinishTs,
      resubscribeState: this.resubscribeState,
      reconnectReason: this.reconnectReason
    };
  }

  private safetyBlock(): ResearchCaptureRecord["safety"] {
    return {
      brokerRequests: 0,
      brokerOrders: 0,
      shadowOrders: 0,
      openShadowTrade: false,
      executionAdapter: "NONE",
      mutationSurface: "NONE",
      permissionScope: "SCOPE_VIEW"
    };
  }

  private async processOrdered(
    item: QueuedIngress,
    _queueEnqueuedAtMs: number
  ): Promise<void> {
    const processStartMs = Math.max(Date.now(), item.bridgeEnqueueMs);
    const enqueueToProcessLatencyMs = Math.max(
      0,
      processStartMs - item.bridgeEnqueueMs
    );
    this.queueLat.record({
      marketEventReceivedMs: item.bridgeEnqueueMs,
      featuresCalculatedMs: item.bridgeEnqueueMs,
      decisionProducedMs: processStartMs,
      shadowOrderProducedMs: null,
      eventToDecisionMs: enqueueToProcessLatencyMs
    });

    if (
      this.prevEventTs != null &&
      item.rawCallbackArrivalMs - this.prevEventTs > this.gapMs
    ) {
      this.feedGapCount += 1;
    }
    this.prevEventTs = item.rawCallbackArrivalMs;

    const qStats = this.queue.stats();
    const base = {
      schemaVersion: GH_FAST_RESEARCH_SCHEMA_VERSION,
      mode: GH_FAST_RESEARCH_MODE,
      t: item.rawCallbackArrivalMs,
      runId: this.runId,
      datasetId: this.datasetId,
      receiveSeq: item.receiveSeq,
      transport: {
        rawCallbackArrivalMs: item.rawCallbackArrivalMs,
        bridgeEnqueueMs: item.bridgeEnqueueMs,
        processStartMs,
        enqueueToProcessLatencyMs
      },
      subscription: this.subscriptionSnap(),
      queueDepthAtProcess: qStats.depth,
      eventLoopLagMs: this.lastEventLoopLagMs,
      safety: this.safetyBlock()
    } as const;

    if (item.kind === "RESYNC_MARKER") {
      const rec: ResearchCaptureRecord = {
        ...base,
        eventKind: "RESYNC_MARKER",
        market: {
          kind: "RESYNC_MARKER",
          reason: String(item.payload.reason ?? "unknown")
        },
        features: null,
        specialists: null
      };
      this.collector.record(rec);
      return;
    }

    if (item.kind === "HEARTBEAT") {
      const lag = num(item.payload.eventLoopLagMs) ?? 0;
      const rec: ResearchCaptureRecord = {
        ...base,
        eventKind: "HEARTBEAT",
        market: { kind: "HEARTBEAT", eventLoopLagMs: lag },
        features: null,
        specialists: null
      };
      this.collector.record(rec);
      return;
    }

    if (item.kind === "SPOT") {
      const bid = num(item.payload.bid);
      const ask = num(item.payload.ask);
      const brokerTimestampMs = num(
        item.payload.brokerTimestampMs ?? item.payload.timestamp
      );
      const spotEv: GhFastSpotEvent = {
        kind: "SPOT",
        receiveSeq: item.receiveSeq,
        eventId: `SPOT:${item.receiveSeq}`,
        receivedAtMs: item.rawCallbackArrivalMs,
        brokerTimestampMs,
        bid,
        ask
      };
      const snap = this.pipeline.onSpot(spotEv);
      this.tallyCandidates(snap.specialists);
      if (snap.crossed) this.bookCrossedCount += 1;
      const rec: ResearchCaptureRecord = {
        ...base,
        eventKind: "SPOT",
        market: {
          kind: "SPOT",
          bid,
          ask,
          spread: bid != null && ask != null ? ask - bid : null,
          brokerTimestampMs
        },
        features: snap.features,
        specialists: snap.specialists
      };
      this.collector.record(rec);
      return;
    }

    // DEPTH
    const brokerTimestampMs = num(
      item.payload.brokerTimestampMs ?? item.payload.timestamp
    );
    const newQuotes = Array.isArray(item.payload.newQuotes)
      ? (item.payload.newQuotes as GhFastDepthEvent["newQuotes"])
      : undefined;
    const deletedQuotes = Array.isArray(item.payload.deletedQuotes)
      ? (item.payload.deletedQuotes as GhFastDepthEvent["deletedQuotes"])
      : undefined;
    const depthEv: GhFastDepthEvent = {
      kind: "DEPTH",
      receiveSeq: item.receiveSeq,
      eventId: `DEPTH:${item.receiveSeq}`,
      receivedAtMs: item.rawCallbackArrivalMs,
      brokerTimestampMs,
      newQuotes,
      deletedQuotes
    };
    const snap = this.pipeline.onDepth(depthEv);
    this.tallyCandidates(snap.specialists);
    if (snap.crossed) this.bookCrossedCount += 1;
    const rec: ResearchCaptureRecord = {
      ...base,
      eventKind: "DEPTH",
      market: {
        kind: "DEPTH",
        newQuotes: newQuotes as unknown[] | undefined,
        deletedQuotes: deletedQuotes as unknown[] | undefined,
        bestBid: snap.bestBid,
        bestAsk: snap.bestAsk,
        depthAvailable: snap.depthAvailable,
        crossed: snap.crossed,
        bookGeneration: snap.bookGeneration,
        brokerTimestampMs
      },
      features: snap.features,
      specialists: snap.specialists
    };
    this.collector.record(rec);
  }

  private tallyCandidates(
    specialists: ResearchCaptureRecord["specialists"]
  ): void {
    if (!specialists) return;
    for (const s of specialists) {
      if (!s.eligible && s.rawQuality == null && !s.selectedCandidate) continue;
      if (s.setup === "A_MOMENTUM_IGNITION") this.candidateA += 1;
      else if (s.setup === "B_FAST_BREAKOUT") this.candidateB += 1;
      else if (s.setup === "C_PULLBACK_REACCEL") this.candidateC += 1;
    }
  }

  health(nowMs = Date.now()): ResearchCaptureHealth {
    const q = this.queue.stats();
    const sink = this.sink.stats();
    const ql = this.queueLat.percentiles();
    const el = this.lagLat.percentiles();
    const identity = researchSafetyIdentity();
    return {
      mode: GH_FAST_RESEARCH_MODE,
      service: "gold-hunter-fast-research-capture",
      serviceHealthy:
        this.connectionState === "CONNECTED" ||
        this.connectionState === "DISCONNECTED" ||
        this.eventsReceived > 0,
      spotSubscribed: this.spotSubscribed,
      depthSubscribed: this.depthSubscribed,
      spotAgeMs: this.lastSpotAt != null ? nowMs - this.lastSpotAt : null,
      depthAgeMs: this.lastDepthAt != null ? nowMs - this.lastDepthAt : null,
      eventsReceived: this.eventsReceived,
      eventsDropped: q.dropped,
      queueDepth: q.depth,
      queueLatencyP50: ql.p50,
      queueLatencyP95: ql.p95,
      queueLatencyP99: ql.p99,
      eventLoopLagP50: el.p50,
      eventLoopLagP95: el.p95,
      eventLoopLagP99: el.p99,
      feedGapCount: this.feedGapCount,
      reconnectCount: this.reconnectCount,
      resyncCount: this.resyncCount,
      bookCrossedCount: this.bookCrossedCount,
      candidateA: this.candidateA,
      candidateB: this.candidateB,
      candidateC: this.candidateC,
      captureStart: this.captureStartIso,
      captureDurationMs: Math.max(0, nowMs - this.captureStartMs),
      runId: this.runId,
      datasetId: this.datasetId,
      schemaVersion: GH_FAST_RESEARCH_SCHEMA_VERSION,
      researchConfigSha: this.researchConfigSha,
      runtimeSha: this.runtimeSha,
      brokerRequests: identity.brokerRequests,
      brokerOrders: identity.brokerOrders,
      shadowOrders: identity.shadowOrders,
      permissionScope: identity.permissionScope,
      mutationSurface: identity.mutationSurface,
      executionAdapter: identity.executionAdapter,
      openShadowTrade: identity.openShadowTrade,
      connectionState: this.connectionState,
      storagePrefix: GH_FAST_RESEARCH_GCS_PREFIX_ROOT,
      durableMode: sink.durableMode,
      healthWarning: sink.healthWarning,
      disclaimer:
        "RESEARCH CAPTURE ONLY — no trading, no shadow orders, no broker orders"
    };
  }

  uiDesign(nowMs = Date.now()): ResearchStatusUiDesign {
    const h = this.health(nowMs);
    const day = h.captureStart
      ? new Date(h.captureStart).toISOString().slice(0, 10)
      : "—";
    return {
      title: "GOLD_HUNTER FAST",
      subtitle: "RESEARCH CAPTURE — NO TRADING",
      data: h.connectionState === "CONNECTED" ? "LIVE" : "OFFLINE",
      spot: h.spotSubscribed ? "LIVE" : "OFFLINE",
      depth: h.depthSubscribed ? "LIVE" : "OFFLINE",
      captureDayLabel: `Day ${day}`,
      eventsCaptured: h.eventsReceived,
      feedGaps: h.feedGapCount,
      reconnects: h.reconnectCount,
      queueLatencyP95: h.queueLatencyP95,
      eventLoopLagP95: h.eventLoopLagP95,
      candidateObservations: {
        A: h.candidateA,
        B: h.candidateB,
        C: h.candidateC
      },
      safety: {
        shadowOrders: 0,
        brokerRequests: 0,
        brokerOrders: 0
      },
      tradingButtons: []
    };
  }

  async writeDaySummary(): Promise<string> {
    const h = this.health();
    const summary: ResearchDaySummary = {
      date: new Date().toISOString().slice(0, 10),
      runId: this.runId,
      datasetId: this.datasetId,
      schemaVersion: GH_FAST_RESEARCH_SCHEMA_VERSION,
      captureStart: this.captureStartIso,
      captureEnd: new Date().toISOString(),
      eventsReceived: h.eventsReceived,
      eventsDropped: h.eventsDropped,
      feedGapCount: h.feedGapCount,
      reconnectCount: h.reconnectCount,
      resyncCount: h.resyncCount,
      bookCrossedCount: h.bookCrossedCount,
      candidateA: h.candidateA,
      candidateB: h.candidateB,
      candidateC: h.candidateC,
      chunksWritten: this.sink.stats().chunksWritten,
      brokerRequests: 0,
      brokerOrders: 0,
      shadowOrders: 0,
      mode: GH_FAST_RESEARCH_MODE
    };
    return this.sink.writeDaySummary(summary);
  }
}
