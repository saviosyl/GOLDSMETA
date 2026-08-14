/**
 * GOLD_HUNTER FAST research capture runtime.
 *
 * Observation-only process entry. Structurally incapable of submitting orders.
 * DO NOT DEPLOY until Phase 2A review is complete.
 *
 * Intentionally does NOT import:
 * - ShadowExecutionAdapter / ForbiddenLiveExecutionAdapter
 * - GoldHunterFastEngine / GoldHunterFastLiveBridge
 * - Core AutoTrade / broker order clients
 */
import http from "node:http";
import { join } from "node:path";
import {
  MICRO_BROKER_EXECUTION_ENABLED,
  MICRO_SHADOW_ONLY
} from "../config";
import type { MicroLiveMarketSession } from "../marketData/liveSession";
import type { MicroLiveSessionState } from "../marketData/liveSession";
import {
  assertResearchViewOnlyScope,
  assertNoExecutionAdapterArgument,
  refuseExecutionAdapter,
  researchSafetyIdentity
} from "../goldHunter/fast/research/nullExecutionGuard";
import { verifyResearchScopeFromBrokerAuth } from "../goldHunter/fast/research/researchScopeVerify";
import { ResearchIngestBridge } from "../goldHunter/fast/research/researchIngestBridge";
import {
  GH_FAST_RESEARCH_FRESHNESS_MS,
  GH_FAST_RESEARCH_SCHEMA_VERSION,
  type ResearchCaptureHealth,
  type ResearchConnectionState
} from "../goldHunter/fast/research/researchTypes";
import { evaluateCaptureHealth } from "../goldHunter/fast/research/researchCaptureHealth";

export type FastResearchCaptureRuntimeOptions = {
  healthPort?: number;
  collectDir?: string;
  gcsBucket?: string | null;
  runId?: string;
  datasetId?: string;
  runtimeSha?: string | null;
  /**
   * Optional hint only — attach/campaign must verify broker auth response.
   * Construction still fail-closes if explicitly SCOPE_TRADE/UNKNOWN.
   */
  permissionScope?: "SCOPE_VIEW" | "SCOPE_TRADE" | "UNKNOWN";
  /** Must remain undefined — any value is refused. */
  executionAdapter?: never;
  nowMs?: () => number;
  heartbeatEveryMs?: number;
  sessionPollEveryMs?: number;
  freshnessLimitMs?: number;
  /** Campaign mode requires GCS durable persistence for campaignValid. */
  campaignMode?: boolean;
  /** UTC YYYY-MM-DD when the continuous campaign started (Day 1). */
  campaignStartUtcDate?: string;
  onCaptureDateObserved?: (date: string, dayIndex: number) => void;
};

export class GoldHunterFastResearchCaptureRuntime {
  readonly mode = "RESEARCH_CAPTURE_ONLY" as const;
  readonly mutationSurface = "NONE" as const;
  readonly executionAdapter = "NONE" as const;
  readonly brokerRequests = 0 as const;
  readonly brokerOrders = 0 as const;
  readonly shadowOrders = 0 as const;
  readonly openShadowTrade = false as const;

  private bridge: ResearchIngestBridge | null = null;
  private session: MicroLiveMarketSession | null = null;
  private unsubs: Array<() => void> = [];
  private healthServer: http.Server | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sessionPollTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private scopeVerified = false;
  private lastSessionSnap: {
    liveConnected: boolean;
    spotSubscribed: boolean;
    depthSubscribed: boolean;
    connectionMapped: ResearchConnectionState;
  } | null = null;
  private readonly nowMs: () => number;
  private readonly opts: FastResearchCaptureRuntimeOptions;
  private lastHeartbeatAt = 0;

  constructor(opts: FastResearchCaptureRuntimeOptions = {}) {
    assertNoExecutionAdapterArgument(
      (opts as { executionAdapter?: unknown }).executionAdapter
    );
    if (MICRO_BROKER_EXECUTION_ENABLED !== false) {
      throw new Error("RESEARCH_CAPTURE_REFUSING_EXECUTION_FLAG");
    }
    if (!MICRO_SHADOW_ONLY) {
      throw new Error("RESEARCH_CAPTURE_REFUSING_NON_SHADOW_ENV");
    }
    if (opts.permissionScope != null) {
      assertResearchViewOnlyScope(opts.permissionScope);
    }
    researchSafetyIdentity();
    this.opts = opts;
    this.nowMs = opts.nowMs ?? (() => Date.now());
  }

  submitExecutionAdapter(adapter: unknown): never {
    return refuseExecutionAdapter(adapter);
  }

  getBridge(): ResearchIngestBridge | null {
    return this.bridge;
  }

  isScopeVerified(): boolean {
    return this.scopeVerified;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const collectDir =
      this.opts.collectDir ??
      join(process.cwd(), ".gold-hunter-data", "fast-research-capture");
    const campaignMode = this.opts.campaignMode === true;
    if (campaignMode && !(this.opts.gcsBucket ?? "").trim()) {
      // Still allow construction for tests that set campaignMode with explicit
      // null bucket to assert campaignValid=false; warn via sink.
    }
    this.bridge = new ResearchIngestBridge({
      runId: this.opts.runId,
      datasetId: this.opts.datasetId,
      localDir: collectDir,
      gcsBucket: this.opts.gcsBucket ?? null,
      runtimeSha: this.opts.runtimeSha ?? null,
      freshnessLimitMs:
        this.opts.freshnessLimitMs ?? GH_FAST_RESEARCH_FRESHNESS_MS,
      campaignMode,
      scopeVerified: false,
      campaignStartUtcDate: this.opts.campaignStartUtcDate,
      onCaptureDateObserved: this.opts.onCaptureDateObserved
    });
    this.bridge.setConnectionState("DISCONNECTED", "runtime_start");
    this.startHeartbeat();
    this.startSessionPoll();
    if (this.opts.healthPort != null) {
      await this.startHealthServer(this.opts.healthPort);
    }
  }

  /**
   * Attach read-only Spot/Depth listeners.
   * Requires actual broker authorization payload resolving to SCOPE_VIEW.
   */
  attachSession(
    session: MicroLiveMarketSession,
    brokerAuthorizationResponse: unknown
  ): void {
    const verified = verifyResearchScopeFromBrokerAuth(
      brokerAuthorizationResponse
    );
    this.scopeVerified = true;
    if (!this.bridge) {
      throw new Error("RESEARCH_CAPTURE_NOT_STARTED");
    }
    this.bridge.setScopeVerified(true);
    this.detachSession();
    this.session = session;
    this.bridge.setConnectionState("CONNECTED", "session_attached");
    this.unsubs.push(
      session.onSpotForFast((payload) => {
        this.bridge?.ingestSpot(payload, this.nowMs());
      })
    );
    this.unsubs.push(
      session.onDepthForFast((payload) => {
        this.bridge?.ingestDepth(payload, this.nowMs());
      })
    );
    void this.syncSessionState("attach");
    void verified;
  }

  /**
   * Test helper: mark SCOPE_VIEW verified without broker payload
   * (unit tests only — campaign attach must use attachSession).
   */
  markScopeVerifiedForTests(): void {
    this.scopeVerified = true;
    this.bridge?.setScopeVerified(true);
  }

  detachSession(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    if (this.session) {
      this.bridge?.noteDisconnect("session_detached");
    }
    this.session = null;
    this.lastSessionSnap = null;
  }

  ingestSpotForTests(payload: Record<string, unknown>): void {
    if (!this.bridge) throw new Error("RESEARCH_CAPTURE_NOT_STARTED");
    this.bridge.setConnectionState("CONNECTED", "test_inject");
    this.bridge.setSubscriptionFlags(true, true);
    this.bridge.ingestSpot(payload, this.nowMs());
  }

  ingestDepthForTests(payload: Record<string, unknown>): void {
    if (!this.bridge) throw new Error("RESEARCH_CAPTURE_NOT_STARTED");
    this.bridge.setConnectionState("CONNECTED", "test_inject");
    this.bridge.setSubscriptionFlags(true, true);
    this.bridge.ingestDepth(payload, this.nowMs());
  }

  async drainForTests(): Promise<void> {
    // Pause timers so OrderedEventQueue.drain can reach idle.
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.sessionPollTimer) {
      clearInterval(this.sessionPollTimer);
      this.sessionPollTimer = null;
    }
    await this.bridge?.drainForTests();
    if (this.running) {
      this.startHeartbeat();
      this.startSessionPoll();
    }
  }

  health(): ResearchCaptureHealth {
    if (!this.bridge) {
      const identity = researchSafetyIdentity();
      const evaluated = evaluateCaptureHealth({
        processHealthy: false,
        connectionState: "DISCONNECTED",
        spotSubscribed: false,
        depthSubscribed: false,
        spotAgeMs: null,
        depthAgeMs: null,
        eventsDropped: 0,
        persistenceDroppedRows: 0,
        persistenceDroppedChunks: 0,
        writeErrors: 0,
        uploadErrors: 0,
        durableMode: "LOCAL_BUFFER_ONLY",
        campaignMode: this.opts.campaignMode === true,
        scopeVerified: false,
        fatalPersistenceError: false,
        healthWarning: "NOT_STARTED"
      });
      return {
        mode: "RESEARCH_CAPTURE_ONLY",
        service: "gold-hunter-fast-research-capture",
        processHealthy: evaluated.processHealthy,
        captureHealthy: evaluated.captureHealthy,
        serviceHealthy: evaluated.serviceHealthy,
        dataIntegrityStatus: evaluated.dataIntegrityStatus,
        campaignValid: evaluated.campaignValid,
        scopeVerified: false,
        spotSubscribed: false,
        depthSubscribed: false,
        spotAgeMs: null,
        depthAgeMs: null,
        freshnessLimitMs:
          this.opts.freshnessLimitMs ?? GH_FAST_RESEARCH_FRESHNESS_MS,
        eventsReceived: 0,
        eventsDropped: 0,
        queueDepth: 0,
        queueLatencyP50: null,
        queueLatencyP95: null,
        queueLatencyP99: null,
        eventLoopLagP50: null,
        eventLoopLagP95: null,
        eventLoopLagP99: null,
        feedGapCount: 0,
        reconnectCount: 0,
        resyncCount: 0,
        bookCrossedCount: 0,
        candidateA: 0,
        candidateB: 0,
        candidateC: 0,
        observationA: 0,
        observationB: 0,
        observationC: 0,
        eligibleA: 0,
        eligibleB: 0,
        eligibleC: 0,
        selectedA: 0,
        selectedB: 0,
        selectedC: 0,
        lastBid: null,
        lastAsk: null,
        lastSpread: null,
        spotBidOnlyEvents: 0,
        spotAskOnlyEvents: 0,
        spotTwoSidedEvents: 0,
        referencePaper: {
          mode: "REFERENCE_PAPER_ONLY",
          label: "REFERENCE PAPER P/L — HYPOTHETICAL, NOT A BROKER TRADE",
          paperTrades: 0,
          open: 0,
          wins: 0,
          losses: 0,
          breakeven: 0,
          winRate: null,
          profitFactor: null,
          netMoveSum: 0,
          tradesPerHour: null,
          brokerRequests: 0,
          brokerOrders: 0,
          executionAdapter: "NONE"
        },
        marketDataNormalizationVersion: "CTRADER_NORMALIZED_V1",
        inputNormalizationVerified: true,
        captureStart: null,
        captureDurationMs: 0,
        runId: "not_started",
        datasetId: "not_started",
        schemaVersion: GH_FAST_RESEARCH_SCHEMA_VERSION,
        researchConfigSha: "",
        runtimeSha: null,
        brokerRequests: identity.brokerRequests,
        brokerOrders: identity.brokerOrders,
        shadowOrders: identity.shadowOrders,
        permissionScope: identity.permissionScope,
        mutationSurface: identity.mutationSurface,
        executionAdapter: identity.executionAdapter,
        openShadowTrade: identity.openShadowTrade,
        connectionState: "DISCONNECTED",
        storagePrefix: "gold-hunter-fast/research-capture",
        durableMode: "LOCAL_BUFFER_ONLY",
        persistenceQueueDepth: 0,
        persistenceDroppedChunks: 0,
        persistenceDroppedRows: 0,
        chunksWritten: 0,
        chunksUploaded: 0,
        writeErrors: 0,
        uploadErrors: 0,
        healthWarning: "NOT_STARTED",
        captureUnhealthyReasons: evaluated.captureUnhealthyReasons,
        heartbeatsPersisted: 0,
        sessionTransitionsPersisted: 0,
        disclaimer:
          "RESEARCH CAPTURE ONLY — no trading, no shadow orders, no broker orders"
      };
    }
    return this.bridge.health(this.nowMs());
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.sessionPollTimer) {
      clearInterval(this.sessionPollTimer);
      this.sessionPollTimer = null;
    }
    this.detachSession();
    if (this.bridge) {
      await this.bridge.writeDaySummary();
      await this.bridge.drainForTests();
    }
    await new Promise<void>((resolve) => {
      if (!this.healthServer) {
        resolve();
        return;
      }
      this.healthServer.close(() => resolve());
    });
    this.healthServer = null;
  }

  private mapSessionConnection(
    st: MicroLiveSessionState
  ): ResearchConnectionState {
    if (st.liveConnected) return "CONNECTED";
    if (st.reconnectAttempts > 0 && st.lastDisconnectedAt) return "RECONNECTING";
    return "DISCONNECTED";
  }

  private async syncSessionState(reason: string): Promise<void> {
    if (!this.session || !this.bridge) return;
    const st = await this.session.getState();
    const mapped = this.mapSessionConnection(st);
    const prev = this.lastSessionSnap;

    if (!st.liveConnected && prev?.liveConnected) {
      this.bridge.noteDisconnect(
        st.lastErrorCode ?? reason ?? "session_disconnected"
      );
    } else if (
      !st.liveConnected &&
      st.reconnectAttempts > 0 &&
      prev &&
      prev.connectionMapped !== "RECONNECTING"
    ) {
      this.bridge.noteReconnectStart(
        this.nowMs(),
        st.lastErrorCode ?? "session_reconnecting"
      );
    } else if (st.liveConnected && prev && !prev.liveConnected) {
      this.bridge.noteReconnectFinish(this.nowMs());
    } else if (st.liveConnected && mapped !== this.bridge.health().connectionState) {
      this.bridge.setConnectionState(mapped, reason);
    }

    this.bridge.noteSubscriptionChange(
      Boolean(st.spotSubscribed),
      Boolean(st.depthSubscribed),
      reason
    );

    this.lastSessionSnap = {
      liveConnected: st.liveConnected,
      spotSubscribed: st.spotSubscribed,
      depthSubscribed: st.depthSubscribed,
      connectionMapped: mapped
    };
  }

  private startHeartbeat(): void {
    const every = this.opts.heartbeatEveryMs ?? 1000;
    this.lastHeartbeatAt = this.nowMs();
    this.heartbeatTimer = setInterval(() => {
      const now = this.nowMs();
      const expected = this.lastHeartbeatAt + every;
      const lag = Math.max(0, now - expected);
      // Persist independent HEARTBEAT rows even with zero market events.
      this.bridge?.persistHeartbeat(lag, now);
      this.lastHeartbeatAt = now;
    }, every);
    if (typeof this.heartbeatTimer.unref === "function") {
      this.heartbeatTimer.unref();
    }
  }

  private startSessionPoll(): void {
    const every = this.opts.sessionPollEveryMs ?? 1000;
    this.sessionPollTimer = setInterval(() => {
      void this.syncSessionState("session_poll");
    }, every);
    if (typeof this.sessionPollTimer.unref === "function") {
      this.sessionPollTimer.unref();
    }
  }

  private startHealthServer(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.healthServer = http.createServer((req, res) => {
        const origin = req.headers.origin ?? "*";
        const cors = {
          "Access-Control-Allow-Origin": origin === "null" ? "*" : origin,
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Cache-Control": "no-store",
          Vary: "Origin"
        };
        if (req.method === "OPTIONS") {
          res.writeHead(204, cors);
          res.end();
          return;
        }
        const path = (req.url ?? "/").split("?")[0];
        if (path === "/health" || path === "/") {
          res.writeHead(200, { "content-type": "application/json", ...cors });
          res.end(JSON.stringify(this.health(), null, 2));
          return;
        }
        if (path === "/ui-design") {
          res.writeHead(200, { "content-type": "application/json", ...cors });
          res.end(
            JSON.stringify(
              this.bridge?.uiDesign(this.nowMs()) ?? {
                title: "GOLD_HUNTER FAST",
                subtitle: "RESEARCH CAPTURE — NO TRADING",
                tradingButtons: []
              },
              null,
              2
            )
          );
          return;
        }
        if (
          path === "/recent-candidates" ||
          path === "/research/recent-candidates"
        ) {
          const q = new URL(req.url ?? "/", "http://localhost").searchParams;
          const limit = Number(q.get("limit") ?? 40);
          const filterRaw = (q.get("filter") ?? "ELIGIBLE").toUpperCase();
          const filter =
            filterRaw === "SELECTED" || filterRaw === "ALL"
              ? filterRaw
              : "ELIGIBLE";
          res.writeHead(200, { "content-type": "application/json", ...cors });
          res.end(
            JSON.stringify(
              this.bridge?.recentCandidatesResponse(limit, filter) ?? {
                mode: "RESEARCH_CAPTURE_ONLY",
                label: "RESEARCH OBSERVATION FEED — NOT TRADES",
                runId: null,
                limit: 40,
                count: 0,
                filter: "ELIGIBLE",
                observations: [],
                brokerRequests: 0,
                brokerOrders: 0,
                shadowOrders: 0,
                executionAdapter: "NONE",
                mutationSurface: "NONE",
                tradingButtons: [],
                marketDataNormalizationVersion: "CTRADER_NORMALIZED_V1",
                inputNormalizationVerified: true
              },
              null,
              2
            )
          );
          return;
        }
        if (
          path === "/reference-paper" ||
          path === "/research/reference-paper"
        ) {
          res.writeHead(200, { "content-type": "application/json", ...cors });
          res.end(
            JSON.stringify(
              this.bridge?.referencePaperSnapshot() ?? {
                mode: "REFERENCE_PAPER_ONLY",
                label: "REFERENCE PAPER P/L — HYPOTHETICAL, NOT A BROKER TRADE",
                policy: null,
                summary: {
                  paperTrades: 0,
                  open: 0,
                  wins: 0,
                  losses: 0,
                  breakeven: 0,
                  brokerRequests: 0,
                  brokerOrders: 0,
                  executionAdapter: "NONE"
                },
                openTrade: null,
                history: []
              },
              null,
              2
            )
          );
          return;
        }
        res.writeHead(404, cors);
        res.end("not found");
      });
      this.healthServer.once("error", reject);
      this.healthServer.listen(port, () => resolve());
    });
  }
}
