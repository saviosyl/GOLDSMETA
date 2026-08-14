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
import {
  assertResearchViewOnlyScope,
  assertNoExecutionAdapterArgument,
  refuseExecutionAdapter,
  researchSafetyIdentity
} from "../goldHunter/fast/research/nullExecutionGuard";
import { ResearchIngestBridge } from "../goldHunter/fast/research/researchIngestBridge";
import type { ResearchCaptureHealth } from "../goldHunter/fast/research/researchTypes";
import type { MicroPermissionScope } from "../marketData/accountSelection";

export type FastResearchCaptureRuntimeOptions = {
  healthPort?: number;
  collectDir?: string;
  gcsBucket?: string | null;
  runId?: string;
  datasetId?: string;
  runtimeSha?: string | null;
  /** Required to be SCOPE_VIEW — fail closed otherwise. */
  permissionScope?: MicroPermissionScope;
  /** Must remain undefined — any value is refused. */
  executionAdapter?: never;
  nowMs?: () => number;
  heartbeatEveryMs?: number;
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
  private running = false;
  private readonly nowMs: () => number;
  private readonly opts: FastResearchCaptureRuntimeOptions;
  private lastHeartbeatAt = 0;

  constructor(opts: FastResearchCaptureRuntimeOptions = {}) {
    // Refuse any accidental adapter injection (typed as never, runtime check too).
    assertNoExecutionAdapterArgument(
      (opts as { executionAdapter?: unknown }).executionAdapter
    );
    if (MICRO_BROKER_EXECUTION_ENABLED !== false) {
      throw new Error("RESEARCH_CAPTURE_REFUSING_EXECUTION_FLAG");
    }
    if (!MICRO_SHADOW_ONLY) {
      throw new Error("RESEARCH_CAPTURE_REFUSING_NON_SHADOW_ENV");
    }
    const scope = opts.permissionScope ?? "SCOPE_VIEW";
    assertResearchViewOnlyScope(scope);
    researchSafetyIdentity();
    this.opts = opts;
    this.nowMs = opts.nowMs ?? (() => Date.now());
  }

  /**
   * Explicitly forbidden API — research runtime has no execution path.
   * Present so misuse fails loudly rather than silently no-oping.
   */
  submitExecutionAdapter(adapter: unknown): never {
    return refuseExecutionAdapter(adapter);
  }

  getBridge(): ResearchIngestBridge | null {
    return this.bridge;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const collectDir =
      this.opts.collectDir ??
      join(process.cwd(), ".gold-hunter-data", "fast-research-capture");
    this.bridge = new ResearchIngestBridge({
      runId: this.opts.runId,
      datasetId: this.opts.datasetId,
      localDir: collectDir,
      gcsBucket: this.opts.gcsBucket ?? null,
      runtimeSha: this.opts.runtimeSha ?? null
    });
    this.bridge.setConnectionState("DISCONNECTED");
    this.startHeartbeat();
    if (this.opts.healthPort != null) {
      await this.startHealthServer(this.opts.healthPort);
    }
  }

  /**
   * Attach read-only Spot/Depth listeners. Session must already be SCOPE_VIEW.
   * Does not create trades.
   */
  attachSession(
    session: MicroLiveMarketSession,
    permissionScope: MicroPermissionScope
  ): void {
    assertResearchViewOnlyScope(permissionScope);
    if (!this.bridge) {
      throw new Error("RESEARCH_CAPTURE_NOT_STARTED");
    }
    this.detachSession();
    this.session = session;
    this.bridge.setConnectionState("CONNECTED");
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
    void session.getState().then((st) => {
      this.bridge?.setSubscriptionFlags(
        Boolean(st.spotSubscribed),
        Boolean(st.depthSubscribed)
      );
    });
  }

  detachSession(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.session = null;
    this.bridge?.setConnectionState("DISCONNECTED");
    this.bridge?.setSubscriptionFlags(false, false);
  }

  /** Test / offline inject path — no live session required. */
  ingestSpotForTests(payload: Record<string, unknown>): void {
    if (!this.bridge) throw new Error("RESEARCH_CAPTURE_NOT_STARTED");
    this.bridge.setConnectionState("CONNECTED");
    this.bridge.setSubscriptionFlags(true, true);
    this.bridge.ingestSpot(payload, this.nowMs());
  }

  ingestDepthForTests(payload: Record<string, unknown>): void {
    if (!this.bridge) throw new Error("RESEARCH_CAPTURE_NOT_STARTED");
    this.bridge.setConnectionState("CONNECTED");
    this.bridge.setSubscriptionFlags(true, true);
    this.bridge.ingestDepth(payload, this.nowMs());
  }

  async drainForTests(): Promise<void> {
    await this.bridge?.drainForTests();
  }

  health(): ResearchCaptureHealth {
    if (!this.bridge) {
      const identity = researchSafetyIdentity();
      return {
        mode: "RESEARCH_CAPTURE_ONLY",
        service: "gold-hunter-fast-research-capture",
        serviceHealthy: false,
        spotSubscribed: false,
        depthSubscribed: false,
        spotAgeMs: null,
        depthAgeMs: null,
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
        captureStart: null,
        captureDurationMs: 0,
        runId: "not_started",
        datasetId: "not_started",
        schemaVersion: "gh-fast-research-capture-v1.0.0",
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
        healthWarning: "NOT_STARTED",
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

  private startHeartbeat(): void {
    const every = this.opts.heartbeatEveryMs ?? 1000;
    this.lastHeartbeatAt = this.nowMs();
    this.heartbeatTimer = setInterval(() => {
      const now = this.nowMs();
      const expected = this.lastHeartbeatAt + every;
      const lag = Math.max(0, now - expected);
      this.bridge?.recordHeartbeatLag(lag);
      this.lastHeartbeatAt = now;
    }, every);
    // Do not keep process alive solely for heartbeat in tests.
    if (typeof this.heartbeatTimer.unref === "function") {
      this.heartbeatTimer.unref();
    }
  }

  private startHealthServer(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.healthServer = http.createServer((req, res) => {
        if (req.url === "/health" || req.url === "/") {
          const body = JSON.stringify(this.health(), null, 2);
          res.writeHead(200, {
            "content-type": "application/json",
            "cache-control": "no-store"
          });
          res.end(body);
          return;
        }
        if (req.url === "/ui-design") {
          const body = JSON.stringify(
            this.bridge?.uiDesign(this.nowMs()) ?? {
              title: "GOLD_HUNTER FAST",
              subtitle: "RESEARCH CAPTURE — NO TRADING",
              tradingButtons: []
            },
            null,
            2
          );
          res.writeHead(200, {
            "content-type": "application/json",
            "cache-control": "no-store"
          });
          res.end(body);
          return;
        }
        res.writeHead(404);
        res.end("not found");
      });
      this.healthServer.once("error", reject);
      this.healthServer.listen(port, () => resolve());
    });
  }
}
