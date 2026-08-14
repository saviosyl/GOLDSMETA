/**
 * GOLD_HUNTER FAST — isolated research capture process orchestrator.
 *
 * Continuous market research service (Spot + Depth observation only).
 * NEVER imports trading engine, live bridge, shadow/live execution adapters,
 * or Core AutoTrade. Broker mutation surface remains NONE.
 *
 * Startup:
 * 1) Resolve vault credentials (read-only Micro OAuth)
 * 2) Fetch actual ProtoOAGetAccountListByAccessToken response
 * 3) verifyResearchScopeFromBrokerAuth(raw) → SCOPE_VIEW or refuse
 * 4) Connect MicroLiveMarketSession (Spot+Depth)
 * 5) attachSession(session, rawBrokerAuthResponse)
 * 6) campaignMode=true + explicit research GCS bucket → durableMode=GCS
 */
import http from "node:http";
import { join } from "node:path";
import {
  MICRO_BROKER_EXECUTION_ENABLED,
  MICRO_SHADOW_ONLY
} from "../config";
import type { MicroCTraderCredentials } from "../marketData/microCTraderAuth";
import { MicroLiveMarketSession } from "../marketData/liveSession";
import { MemoryMicroMarketDataStore } from "../marketData/marketDataStore";
import { microLog } from "../marketData/microLog";
import {
  credentialsFromVault,
  refreshVaultTokensIfNeeded
} from "../marketData/oauthService";
import { fetchMicroAccountList } from "../marketData/fetchAuthorizedAccounts";
import { createMicroTokenVault } from "../marketData/tokenVault";
import { GoldHunterFastResearchCaptureRuntime } from "./fastResearchCaptureRuntime";
import { verifyResearchScopeFromBrokerAuth } from "../goldHunter/fast/research/researchScopeVerify";
import {
  GH_FAST_RESEARCH_FORBIDDEN_GCS_PREFIX,
  GH_FAST_RESEARCH_GCS_PREFIX_ROOT,
  type ResearchCaptureHealth
} from "../goldHunter/fast/research/researchTypes";
import { hashGhFastConfig, frozenGhFastSoakConfig } from "../goldHunter/fast/frozenConfig";
import {
  captureDayIndexFromDates,
  utcDateFromMs
} from "../goldHunter/fast/research/researchDurableSink";

export type ResearchBrokerPermissionProof = {
  permissionScope: "SCOPE_VIEW";
  source: "broker_authorization_response";
  verifiedAt: string;
  accountCount: number;
  environment: string | null;
  /** Sanitized — no tokens. */
  selectedAccountIdPresent: boolean;
};

export type ResearchCampaignStatus =
  | "STARTING"
  | "CAPTURE_CAMPAIGN_ACTIVE"
  | "NOT_LIVE"
  | "SCOPE_REFUSED"
  | "GCS_REQUIRED";

export type ResearchProcessHealth = ResearchCaptureHealth & {
  cloudRunService: "gold-hunter-fast-research-collector";
  campaignMode: true;
  campaignStatus: ResearchCampaignStatus;
  captureDayIndex: number | null;
  /** Offline qualification count — not advanced by calendar rollover alone. */
  validatedIndependentDays: number;
  campaignStartUtcDate: string | null;
  /** Exact original campaign activation timestamp (not midnight). */
  campaignStartedAt: string | null;
  currentCaptureUtcDate: string | null;
  day1StartedAt: string | null;
  liveCaptureReady: boolean;
  brokerPermissionProof: ResearchBrokerPermissionProof | null;
  startupGate: {
    ok: boolean;
    reasons: string[];
  };
  continuousOperation: true;
  autoStopAfterFiveDays: false;
  earliestAnalysisCheckpointDays: 5;
  preferredCaptureDays: "10+";
  disclaimer: string;
};

function requireExplicitResearchGcsBucket(): string {
  const bucket = (process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET ?? "").trim();
  if (!bucket) {
    throw Object.assign(
      new Error(
        "RESEARCH_CAPTURE_REFUSING_MISSING_GCS_BUCKET — set GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET explicitly"
      ),
      { code: "RESEARCH_CAPTURE_REFUSING_MISSING_GCS_BUCKET" }
    );
  }
  if (bucket.includes("live-shadow")) {
    throw Object.assign(
      new Error("RESEARCH_CAPTURE_REFUSING_LIVE_SHADOW_BUCKET_NAME"),
      { code: "RESEARCH_CAPTURE_REFUSING_LIVE_SHADOW_BUCKET_NAME" }
    );
  }
  return bucket;
}

export function evaluateLiveCaptureStartupGate(
  h: ResearchCaptureHealth,
  proof: ResearchBrokerPermissionProof | null
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!proof || proof.permissionScope !== "SCOPE_VIEW") {
    reasons.push("broker_scope_not_scope_view");
  }
  if (h.connectionState !== "CONNECTED") reasons.push("not_connected");
  if (!h.spotSubscribed) reasons.push("spot_not_subscribed");
  if (!h.depthSubscribed) reasons.push("depth_not_subscribed");
  if (h.spotAgeMs == null || h.spotAgeMs > h.freshnessLimitMs) {
    reasons.push("spot_not_fresh");
  }
  if (h.depthAgeMs == null || h.depthAgeMs > h.freshnessLimitMs) {
    reasons.push("depth_not_fresh");
  }
  if (h.executionAdapter !== "NONE") reasons.push("execution_adapter_not_none");
  if (h.brokerRequests !== 0) reasons.push("broker_requests_nonzero");
  if (h.brokerOrders !== 0) reasons.push("broker_orders_nonzero");
  if (h.shadowOrders !== 0) reasons.push("shadow_orders_nonzero");
  if (h.durableMode !== "GCS") reasons.push("durable_mode_not_gcs");
  if (h.eventsDropped !== 0) reasons.push("events_dropped");
  if (h.persistenceDroppedRows !== 0) reasons.push("persistence_dropped_rows");
  if (h.persistenceDroppedChunks !== 0) {
    reasons.push("persistence_dropped_chunks");
  }
  if (h.dataIntegrityStatus !== "CLEAN") reasons.push("integrity_not_clean");
  if (h.heartbeatsPersisted <= 0) reasons.push("heartbeats_missing");
  if (h.sessionTransitionsPersisted <= 0) {
    reasons.push("session_transitions_missing");
  }
  if (!h.captureHealthy) reasons.push("capture_not_healthy");
  if (!h.campaignValid) reasons.push("campaign_not_valid");
  if (h.storagePrefix !== GH_FAST_RESEARCH_GCS_PREFIX_ROOT) {
    reasons.push("storage_prefix_invalid");
  }
  if (h.storagePrefix.includes(GH_FAST_RESEARCH_FORBIDDEN_GCS_PREFIX)) {
    reasons.push("forbidden_live_shadow_prefix");
  }
  return { ok: reasons.length === 0, reasons };
}

export class GoldHunterFastResearchCaptureProcess {
  readonly cloudRunService = "gold-hunter-fast-research-collector" as const;
  readonly mutationSurface = "NONE" as const;
  readonly executionAdapter = "NONE" as const;
  readonly continuousOperation = true as const;
  readonly autoStopAfterFiveDays = false as const;

  private runtime: GoldHunterFastResearchCaptureRuntime | null = null;
  private session: MicroLiveMarketSession | null = null;
  private healthServer: http.Server | null = null;
  private running = false;
  private stopping = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private lastReconnectAttemptMs = 0;
  private brokerPermissionProof: ResearchBrokerPermissionProof | null = null;
  private lastBrokerAuthRaw: unknown = null;
  private campaignStatus: ResearchCampaignStatus = "STARTING";
  private day1StartedAt: string | null = null;
  private captureDayIndex: number | null = null;
  private validatedIndependentDays = 0;
  private campaignStartUtcDate: string;
  private campaignStartedAt: string;
  private currentCaptureUtcDate: string | null = null;
  private readonly gcsBucket: string;
  private readonly researchConfigSha: string;
  private readonly runtimeSha: string | null;
  private readonly store = new MemoryMicroMarketDataStore();
  private readonly nowMs: () => number;
  private readonly staleReconnectMs: number;

  constructor(
    private readonly opts: {
      healthPort?: number;
      vaultUid?: string;
      collectDir?: string;
      nowMs?: () => number;
      allowLocalInjectedCredentials?: boolean;
      credentials?: MicroCTraderCredentials;
      gcsBucket?: string;
      runtimeSha?: string | null;
    } = {}
  ) {
    if (MICRO_BROKER_EXECUTION_ENABLED !== false) {
      throw new Error("RESEARCH_CAPTURE_REFUSING_EXECUTION_FLAG");
    }
    if (!MICRO_SHADOW_ONLY) {
      throw new Error("RESEARCH_CAPTURE_REFUSING_NON_SHADOW_ENV");
    }
    this.gcsBucket = opts.gcsBucket ?? requireExplicitResearchGcsBucket();
    this.nowMs = opts.nowMs ?? (() => Date.now());
    this.runtimeSha =
      opts.runtimeSha ??
      ((process.env.GOLD_HUNTER_FAST_DEPLOY_GIT_SHA ?? "").trim() || null);
    this.researchConfigSha = hashGhFastConfig(frozenGhFastSoakConfig());
    this.staleReconnectMs = Number(
      process.env.GOLD_HUNTER_FAST_STALE_RECONNECT_MS ?? 20_000
    );
    this.campaignStartUtcDate =
      (process.env.GOLD_HUNTER_FAST_CAMPAIGN_START_DATE ?? "").trim() ||
      utcDateFromMs(this.nowMs());
    this.campaignStartedAt =
      (process.env.GOLD_HUNTER_FAST_CAMPAIGN_STARTED_AT ?? "").trim() ||
      // Preserve original Day-1 wall clock when env is set at deploy; otherwise
      // use this process activation time (never force midnight).
      new Date(this.nowMs()).toISOString();
    this.day1StartedAt = this.campaignStartedAt;
    void createMicroTokenVault();
  }

  getRuntime(): GoldHunterFastResearchCaptureRuntime | null {
    return this.runtime;
  }

  getBrokerPermissionProof(): ResearchBrokerPermissionProof | null {
    return this.brokerPermissionProof;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopping = false;
    this.campaignStatus = "STARTING";

    const collectDir =
      this.opts.collectDir ??
      join(process.cwd(), ".gold-hunter-data", "fast-research-capture");

    this.runtime = new GoldHunterFastResearchCaptureRuntime({
      healthPort: undefined, // process owns the HTTP server
      collectDir,
      gcsBucket: this.gcsBucket,
      runtimeSha: this.runtimeSha,
      campaignMode: true,
      heartbeatEveryMs: 1000,
      sessionPollEveryMs: 1000,
      campaignStartUtcDate: this.campaignStartUtcDate,
      onCaptureDateObserved: (date, dayIndex) => {
        this.currentCaptureUtcDate = date;
        this.captureDayIndex = dayIndex;
        // validatedIndependentDays is NOT advanced here — offline qualification only.
      }
    });
    await this.runtime.start();

    const port =
      this.opts.healthPort ??
      Number(process.env.PORT ?? process.env.GOLD_HUNTER_FAST_HEALTH_PORT ?? 8080);
    await this.listenHealth(port);

    await this.connectOnce();
    this.startStaleWatchdog();

    microLog("MICRO_COLLECTOR_STARTED", {
      service: this.cloudRunService,
      mode: "RESEARCH_CAPTURE_ONLY",
      campaignMode: true,
      gcsBucket: this.gcsBucket,
      storagePrefix: GH_FAST_RESEARCH_GCS_PREFIX_ROOT,
      mutationSurface: "NONE",
      executionAdapter: "NONE",
      continuousOperation: true,
      autoStopAfterFiveDays: false
    });
  }

  private async resolveCredentials(): Promise<MicroCTraderCredentials | null> {
    if (this.opts.credentials && this.opts.allowLocalInjectedCredentials) {
      return this.opts.credentials;
    }
    const vaultUid =
      this.opts.vaultUid ?? (process.env.MICRO_COLLECTOR_VAULT_UID ?? "").trim();
    if (!vaultUid) return null;
    await refreshVaultTokensIfNeeded(vaultUid);
    return credentialsFromVault(vaultUid);
  }

  /**
   * Obtain the actual broker GetAccountList response and verify SCOPE_VIEW.
   * Does not trust vault-cached permissionScope alone for attach.
   */
  private async verifyLiveBrokerScope(
    creds: MicroCTraderCredentials
  ): Promise<{ proof: ResearchBrokerPermissionProof; raw: unknown }> {
    const list = await fetchMicroAccountList({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      accessToken: creds.accessToken,
      environment: creds.environment,
      // Fail closed via research verifier (not only fetch helper).
      requireViewScope: false
    });
    const verified = verifyResearchScopeFromBrokerAuth(list.raw);
    const proof: ResearchBrokerPermissionProof = {
      permissionScope: verified.permissionScope,
      source: verified.source,
      verifiedAt: new Date(this.nowMs()).toISOString(),
      accountCount: list.accounts.length,
      environment: creds.environment,
      selectedAccountIdPresent: Boolean(creds.accountId)
    };
    return { proof, raw: list.raw };
  }

  private async connectOnce(): Promise<void> {
    const creds = await this.resolveCredentials();
    if (!creds) {
      this.campaignStatus = "NOT_LIVE";
      microLog("MICRO_COLLECTOR_OAUTH_MISSING", {
        service: this.cloudRunService
      });
      this.scheduleReconnect();
      return;
    }

    try {
      const { proof, raw } = await this.verifyLiveBrokerScope(creds);
      this.brokerPermissionProof = proof;
      this.lastBrokerAuthRaw = raw;
    } catch (e) {
      this.campaignStatus = "SCOPE_REFUSED";
      this.brokerPermissionProof = null;
      microLog("MICRO_COLLECTOR_CONNECT_FAILED", {
        service: this.cloudRunService,
        code: (e as { code?: string }).code ?? "SCOPE_VERIFY_FAILED",
        message: e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120)
      });
      this.scheduleReconnect();
      return;
    }

    this.session = new MicroLiveMarketSession({
      store: this.store,
      credentials: creds,
      nowMs: this.nowMs
    });

    try {
      await this.session.connect();
      if (!this.runtime) throw new Error("RESEARCH_CAPTURE_NOT_STARTED");
      this.runtime.attachSession(this.session, this.lastBrokerAuthRaw);
      microLog("MICRO_COLLECTOR_CONNECTED", {
        service: this.cloudRunService,
        environment: creds.environment,
        permissionScope: "SCOPE_VIEW",
        storagePrefix: GH_FAST_RESEARCH_GCS_PREFIX_ROOT,
        durableMode: "GCS"
      });
      this.maybeActivateCampaign();
    } catch (e) {
      microLog("MICRO_COLLECTOR_CONNECT_FAILED", {
        service: this.cloudRunService,
        code: (e as { code?: string }).code ?? "transport_disconnected",
        message: e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120)
      });
      this.scheduleReconnect();
    }
  }

  private maybeActivateCampaign(): void {
    if (!this.runtime) return;
    const h = this.runtime.health();
    const gate = evaluateLiveCaptureStartupGate(h, this.brokerPermissionProof);
    const today = utcDateFromMs(this.nowMs());
    // Keep day index aligned with calendar even before first persisted row.
    if (this.captureDayIndex == null) {
      this.captureDayIndex = captureDayIndexFromDates(
        this.campaignStartUtcDate,
        today
      );
      this.currentCaptureUtcDate = today;
    }
    if (gate.ok) {
      if (this.campaignStatus !== "CAPTURE_CAMPAIGN_ACTIVE") {
        this.campaignStatus = "CAPTURE_CAMPAIGN_ACTIVE";
        this.captureDayIndex = captureDayIndexFromDates(
          this.campaignStartUtcDate,
          this.currentCaptureUtcDate ?? today
        );
        this.day1StartedAt = this.campaignStartedAt;
        microLog("MICRO_COLLECTOR_CONNECTED", {
          code: "CAPTURE_CAMPAIGN_ACTIVE",
          day: this.captureDayIndex,
          campaignStartUtcDate: this.campaignStartUtcDate,
          campaignStartedAt: this.campaignStartedAt,
          currentCaptureUtcDate: this.currentCaptureUtcDate ?? today,
          day1StartedAt: this.day1StartedAt,
          validatedIndependentDays: this.validatedIndependentDays,
          runId: h.runId,
          datasetId: h.datasetId,
          note: "captureDayIndex is calendar progression — not validatedIndependentDays"
        });
      } else {
        this.captureDayIndex = captureDayIndexFromDates(
          this.campaignStartUtcDate,
          this.currentCaptureUtcDate ??
            this.runtime.getBridge()?.getCurrentCaptureUtcDate() ??
            today
        );
      }
    } else if (h.durableMode !== "GCS") {
      this.campaignStatus = "GCS_REQUIRED";
    } else if (this.campaignStatus !== "CAPTURE_CAMPAIGN_ACTIVE") {
      this.campaignStatus = "STARTING";
    }
  }

  private scheduleReconnect(): void {
    if (this.stopping || !this.running || this.reconnectTimer) return;
    const now = this.nowMs();
    if (now - this.lastReconnectAttemptMs < 30_000 && this.lastReconnectAttemptMs > 0) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, 2500);
  }

  private async reconnect(): Promise<void> {
    this.lastReconnectAttemptMs = this.nowMs();
    try {
      this.runtime?.detachSession();
      if (this.session) {
        try {
          await this.session.disconnect();
        } catch {
          /* best effort */
        }
      }
      this.session = null;
      await this.connectOnce();
    } catch {
      this.scheduleReconnect();
    }
  }

  private startStaleWatchdog(): void {
    this.staleTimer = setInterval(() => {
      void this.checkStaleAndReconnect();
      this.maybeActivateCampaign();
    }, 5_000);
    if (typeof this.staleTimer.unref === "function") this.staleTimer.unref();
  }

  private async checkStaleAndReconnect(): Promise<void> {
    if (this.stopping || !this.running || !this.runtime) return;
    const h = this.runtime.health();
    if (h.connectionState === "DISCONNECTED" || h.connectionState === "RECONNECTING") {
      this.scheduleReconnect();
      return;
    }
    const spotStale =
      h.spotAgeMs == null || h.spotAgeMs > this.staleReconnectMs;
    const depthStale =
      h.depthAgeMs == null || h.depthAgeMs > this.staleReconnectMs;
    if (spotStale && depthStale) {
      microLog("MICRO_COLLECTOR_BAR_POLL_FAILED", {
        code: "RESEARCH_FEED_STALE_RECONNECT",
        spotAgeMs: h.spotAgeMs,
        depthAgeMs: h.depthAgeMs,
        thresholdMs: this.staleReconnectMs
      });
      this.scheduleReconnect();
    }
  }

  buildHealth(): ResearchProcessHealth {
    const base =
      this.runtime?.health() ??
      ({
        mode: "RESEARCH_CAPTURE_ONLY",
        service: "gold-hunter-fast-research-capture",
        processHealthy: false,
        captureHealthy: false,
        serviceHealthy: false,
        dataIntegrityStatus: "FAILED",
        campaignValid: false,
        scopeVerified: false,
        spotSubscribed: false,
        depthSubscribed: false,
        spotAgeMs: null,
        depthAgeMs: null,
        freshnessLimitMs: 20_000,
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
        researchConfigSha: this.researchConfigSha,
        runtimeSha: this.runtimeSha,
        brokerRequests: 0,
        brokerOrders: 0,
        shadowOrders: 0,
        permissionScope: "SCOPE_VIEW",
        mutationSurface: "NONE",
        executionAdapter: "NONE",
        openShadowTrade: false,
        connectionState: "DISCONNECTED",
        storagePrefix: GH_FAST_RESEARCH_GCS_PREFIX_ROOT,
        durableMode: "LOCAL_BUFFER_ONLY",
        persistenceQueueDepth: 0,
        persistenceDroppedChunks: 0,
        persistenceDroppedRows: 0,
        chunksWritten: 0,
        chunksUploaded: 0,
        writeErrors: 0,
        uploadErrors: 0,
        healthWarning: "NOT_STARTED",
        captureUnhealthyReasons: ["not_started"],
        heartbeatsPersisted: 0,
        sessionTransitionsPersisted: 0,
        disclaimer:
          "RESEARCH CAPTURE ONLY — no trading, no shadow orders, no broker orders"
      } as ResearchCaptureHealth);

    const gate = evaluateLiveCaptureStartupGate(base, this.brokerPermissionProof);
    return {
      ...base,
      researchConfigSha: base.researchConfigSha || this.researchConfigSha,
      runtimeSha: base.runtimeSha ?? this.runtimeSha,
      cloudRunService: this.cloudRunService,
      campaignMode: true,
      campaignStatus: this.campaignStatus,
      captureDayIndex: this.captureDayIndex,
      validatedIndependentDays: this.validatedIndependentDays,
      campaignStartUtcDate: this.campaignStartUtcDate,
      campaignStartedAt: this.campaignStartedAt,
      currentCaptureUtcDate:
        this.currentCaptureUtcDate ??
        this.runtime?.getBridge()?.getCurrentCaptureUtcDate() ??
        null,
      day1StartedAt: this.day1StartedAt ?? this.campaignStartedAt,
      liveCaptureReady: gate.ok,
      brokerPermissionProof: this.brokerPermissionProof,
      startupGate: gate,
      continuousOperation: true,
      autoStopAfterFiveDays: false,
      earliestAnalysisCheckpointDays: 5,
      preferredCaptureDays: "10+",
      disclaimer:
        "RESEARCH CAPTURE ONLY — continuous market observation. No trading, no shadow orders, no broker orders. captureDayIndex ≠ validatedIndependentDays."
    };
  }

  private listenHealth(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.healthServer = http.createServer((req, res) => {
        const origin = req.headers.origin ?? "*";
        const cors = {
          "Access-Control-Allow-Origin": origin === "null" ? "*" : origin,
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
          Vary: "Origin"
        };
        if (req.method === "OPTIONS") {
          res.writeHead(204, cors);
          res.end();
          return;
        }
        const path = req.url?.split("?")[0] ?? "/";
        if (
          path !== "/health" &&
          path !== "/" &&
          path !== "/ui-design" &&
          path !== "/recent-candidates" &&
          path !== "/research/recent-candidates"
        ) {
          res.writeHead(404, cors);
          res.end("not found");
          return;
        }
        try {
          if (path === "/ui-design") {
            const ui = this.runtime?.getBridge()?.uiDesign() ?? {
              title: "GOLD_HUNTER FAST",
              subtitle: "RESEARCH CAPTURE — NO TRADING",
              tradingButtons: []
            };
            res.writeHead(200, {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              ...cors
            });
            res.end(JSON.stringify(ui, null, 2));
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
            const feed =
              this.runtime?.getBridge()?.recentCandidatesResponse(limit, filter) ?? {
                mode: "RESEARCH_CAPTURE_ONLY" as const,
                label: "RESEARCH OBSERVATION FEED — NOT TRADES" as const,
                runId: null,
                limit: 40,
                count: 0,
                filter: "ELIGIBLE" as const,
                observations: [],
                brokerRequests: 0 as const,
                brokerOrders: 0 as const,
                shadowOrders: 0 as const,
                executionAdapter: "NONE" as const,
                mutationSurface: "NONE" as const,
                tradingButtons: [] as [],
                marketDataNormalizationVersion: "CTRADER_NORMALIZED_V1",
                inputNormalizationVerified: true
              };
            res.writeHead(200, {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              ...cors
            });
            res.end(JSON.stringify(feed, null, 2));
            return;
          }
          const health = this.buildHealth();
          // Always HTTP 200 so brief disconnects do not restart the always-on
          // research service; operational readiness is liveCaptureReady.
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            ...cors
          });
          res.end(JSON.stringify(health, null, 2));
        } catch {
          res.writeHead(500, {
            "Content-Type": "application/json",
            ...cors
          });
          res.end(
            JSON.stringify({
              processHealthy: false,
              captureHealthy: false,
              campaignValid: false,
              mutationSurface: "NONE",
              executionAdapter: "NONE",
              brokerOrders: 0,
              shadowOrders: 0
            })
          );
        }
      });
      this.healthServer.once("error", reject);
      this.healthServer.listen(port, "0.0.0.0", () => {
        microLog("MICRO_COLLECTOR_HEALTH_LISTEN", {
          port,
          service: this.cloudRunService
        });
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.running = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.runtime?.detachSession();
    if (this.session) {
      try {
        await this.session.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.session = null;
    if (this.runtime) await this.runtime.stop();
    this.runtime = null;
    if (this.healthServer) {
      await new Promise<void>((resolve) =>
        this.healthServer!.close(() => resolve())
      );
      this.healthServer = null;
    }
  }
}

export async function runGoldHunterFastResearchCaptureProcessMain(): Promise<void> {
  const port = Number(
    process.env.PORT ?? process.env.GOLD_HUNTER_FAST_HEALTH_PORT ?? 8080
  );
  const vaultUid = (process.env.MICRO_COLLECTOR_VAULT_UID ?? "").trim() || undefined;
  const processRuntime = new GoldHunterFastResearchCaptureProcess({
    healthPort: port,
    vaultUid
  });
  const shutdown = async (signal: string) => {
    microLog("MICRO_COLLECTOR_SHUTDOWN", {
      signal,
      service: "gold-hunter-fast-research-collector"
    });
    await processRuntime.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  await processRuntime.start();
}
