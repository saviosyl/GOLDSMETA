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
import {
  decideResearchStaleReconnect,
  GH_FAST_RESEARCH_HARD_STALE_RECONNECT_MS,
  GH_FAST_RESEARCH_HARD_STALE_THRESHOLD_REASON,
  GH_FAST_RESEARCH_SOFT_STALE_MS,
  staleFeedBackoffMs,
  type ResearchReconnectReason
} from "../goldHunter/fast/research/researchStaleReconnectPolicy";

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
  /** Soft freshness boundary (feed stale / paper block) — not hard teardown. */
  softStaleMs: number;
  /** Hard reconnect threshold for connected-but-silent feeds. */
  hardStaleReconnectMs: number;
  hardStaleThresholdReason: string;
  feedSoftStale: boolean;
  reconnectInFlight: boolean;
  /** Genuine transport / session disconnect recoveries. */
  transportReconnectCount: number;
  /** Prolonged silence while transport claimed connected. */
  staleFeedReconnectCount: number;
  sustainedCrossRecoveryCount: number;
  disconnectResyncCount: number;
  nextStaleReconnectEligibleAtMs: number | null;
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
  /** Mutex: only one process reconnect may execute at a time. */
  private reconnectInFlight = false;
  /** Invalidates reconnect timers scheduled before the current attempt. */
  private reconnectEpoch = 0;
  private pendingReconnectReason: ResearchReconnectReason | null = null;
  private transportReconnectCount = 0;
  private staleFeedReconnectCount = 0;
  private lastStaleFeedReconnectAttemptMs: number | null = null;
  private staleFeedBackoffIndex = 0;
  private feedSoftStale = false;
  private nextStaleReconnectEligibleAtMs: number | null = null;
  /** @internal test hook — simulate slow reconnect (stacked #4 scenario). */
  private reconnectHoldMsForTests = 0;
  /** @internal test hook — skip live session connect (mutex / backoff unit tests). */
  private skipSessionConnectForTests = false;
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
  /** @deprecated Prefer softStaleMs / hardStaleReconnectMs split. */
  private readonly staleReconnectMs: number;
  private readonly softStaleMs: number;
  private readonly hardStaleReconnectMs: number;

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
      softStaleMs?: number;
      hardStaleReconnectMs?: number;
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
    this.softStaleMs = Number(
      opts.softStaleMs ??
        process.env.GOLD_HUNTER_FAST_SOFT_STALE_MS ??
        GH_FAST_RESEARCH_SOFT_STALE_MS
    );
    this.hardStaleReconnectMs = Number(
      opts.hardStaleReconnectMs ??
        process.env.GOLD_HUNTER_FAST_HARD_STALE_RECONNECT_MS ??
        GH_FAST_RESEARCH_HARD_STALE_RECONNECT_MS
    );
    // Legacy env kept as alias of hard threshold for ops familiarity.
    this.staleReconnectMs = Number(
      process.env.GOLD_HUNTER_FAST_STALE_RECONNECT_MS ??
        this.hardStaleReconnectMs
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
    // Token vault is created lazily on start()/connect — not in the constructor —
    // so unit tests can construct the process without deploy encryption secrets.
  }

  /** Test/observability: whether a process reconnect is executing. */
  isReconnectInFlight(): boolean {
    return this.reconnectInFlight;
  }

  getStaleReconnectPolicy(): {
    softStaleMs: number;
    hardStaleReconnectMs: number;
    hardStaleThresholdReason: string;
  } {
    return {
      softStaleMs: this.softStaleMs,
      hardStaleReconnectMs: this.hardStaleReconnectMs,
      hardStaleThresholdReason: GH_FAST_RESEARCH_HARD_STALE_THRESHOLD_REASON
    };
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
    void createMicroTokenVault();

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

  private async connectOnce(opts?: { fromReconnect?: boolean }): Promise<void> {
    const fromReconnect = opts?.fromReconnect === true;
    const scheduleIfNeeded = (reason: ResearchReconnectReason) => {
      // When called inside reconnect(), scheduleReconnect refuses in-flight and
      // records pending for finally — or we throw so reconnect catch retries.
      if (fromReconnect) {
        this.pendingReconnectReason = reason;
        return;
      }
      this.scheduleReconnect(reason);
    };

    const creds = await this.resolveCredentials();
    if (!creds) {
      this.campaignStatus = "NOT_LIVE";
      microLog("MICRO_COLLECTOR_OAUTH_MISSING", {
        service: this.cloudRunService
      });
      scheduleIfNeeded("oauth_missing");
      if (fromReconnect) throw new Error("RESEARCH_OAUTH_MISSING");
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
      scheduleIfNeeded("connect_failed");
      if (fromReconnect) throw e instanceof Error ? e : new Error(String(e));
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
      scheduleIfNeeded("connect_failed");
      if (fromReconnect) throw e instanceof Error ? e : new Error(String(e));
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

  /**
   * Schedule a process reconnect. Refuses while reconnectInFlight (mutex).
   * Stale-feed callers must not queue a second reconnect while one runs.
   * Transport/connect failures may set pendingReconnectReason for after finally.
   */
  private scheduleReconnect(
    reason: ResearchReconnectReason = "connect_failed",
    delayMs = 2500
  ): boolean {
    if (this.stopping || !this.running) return false;
    if (this.reconnectInFlight) {
      // Never stack a second execution. Non-stale may retry after current finishes.
      if (reason !== "stale_feed") {
        this.pendingReconnectReason = reason;
      }
      return false;
    }
    if (this.reconnectTimer) return false;
    const epoch = this.reconnectEpoch;
    this.pendingReconnectReason = reason;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopping || this.reconnectInFlight) return;
      if (epoch !== this.reconnectEpoch) return;
      void this.reconnect(reason);
    }, delayMs);
    return true;
  }

  private async reconnect(
    reason: ResearchReconnectReason = "connect_failed"
  ): Promise<void> {
    if (this.stopping || !this.running) return;
    if (this.reconnectInFlight) return;
    this.reconnectInFlight = true;
    this.reconnectEpoch += 1;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.lastReconnectAttemptMs = this.nowMs();
    this.pendingReconnectReason = reason;

    if (reason === "stale_feed") {
      this.staleFeedReconnectCount += 1;
      this.lastStaleFeedReconnectAttemptMs = this.nowMs();
      const backoffMs = staleFeedBackoffMs(this.staleFeedBackoffIndex);
      this.nextStaleReconnectEligibleAtMs =
        this.lastStaleFeedReconnectAttemptMs + backoffMs;
      microLog("MICRO_COLLECTOR_BAR_POLL_FAILED", {
        code: "RESEARCH_STALE_FEED_RECONNECT_START",
        spotAgeMs: this.runtime?.health().spotAgeMs ?? null,
        depthAgeMs: this.runtime?.health().depthAgeMs ?? null,
        hardStaleReconnectMs: this.hardStaleReconnectMs,
        staleFeedReconnectCount: this.staleFeedReconnectCount,
        staleFeedBackoffIndex: this.staleFeedBackoffIndex,
        backoffMs
      });
    } else if (reason === "transport_disconnect") {
      this.transportReconnectCount += 1;
      microLog("MICRO_COLLECTOR_BAR_POLL_FAILED", {
        code: "RESEARCH_TRANSPORT_RECONNECT_START",
        transportReconnectCount: this.transportReconnectCount
      });
    }

    let connectFailed = false;
    try {
      // Telemetry: process-driven reconnect must record lifecycle (was RECONN=0).
      this.runtime?.getBridge()?.noteReconnectStart(this.nowMs(), reason);

      this.runtime?.detachSession();
      if (this.session) {
        try {
          await this.session.disconnect();
        } catch {
          /* best effort */
        }
      }
      this.session = null;

      if (this.reconnectHoldMsForTests > 0) {
        await new Promise((r) => setTimeout(r, this.reconnectHoldMsForTests));
      }
      if (this.stopping) return;

      if (this.skipSessionConnectForTests) {
        this.runtime?.getBridge()?.noteReconnectFinish(this.nowMs());
      } else {
        await this.connectOnce({ fromReconnect: true });
        this.runtime?.getBridge()?.noteReconnectFinish(this.nowMs());
      }

      if (reason === "stale_feed") {
        // Next quiet/market-closed episode waits longer until fresh data resets.
        this.staleFeedBackoffIndex = Math.min(
          this.staleFeedBackoffIndex + 1,
          2
        );
        this.nextStaleReconnectEligibleAtMs =
          this.nowMs() + staleFeedBackoffMs(this.staleFeedBackoffIndex);
      }
    } catch {
      connectFailed = true;
      try {
        this.runtime?.getBridge()?.noteReconnectFinish(this.nowMs());
      } catch {
        /* ignore */
      }
    } finally {
      this.reconnectInFlight = false;
      const pending = this.pendingReconnectReason;
      this.pendingReconnectReason = null;
      if (this.stopping || !this.running) return;
      if (connectFailed) {
        this.scheduleReconnect("connect_failed", 2500);
      } else if (
        pending != null &&
        pending !== "stale_feed" &&
        pending !== reason
      ) {
        // Genuine transport disconnect requested while a reconnect was in flight.
        this.scheduleReconnect(pending, 500);
      }
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
    const decision = decideResearchStaleReconnect({
      nowMs: this.nowMs(),
      connectionState: h.connectionState,
      spotAgeMs: h.spotAgeMs,
      depthAgeMs: h.depthAgeMs,
      softStaleMs: this.softStaleMs,
      hardStaleReconnectMs: this.hardStaleReconnectMs,
      reconnectInFlight: this.reconnectInFlight,
      lastStaleFeedReconnectAttemptMs: this.lastStaleFeedReconnectAttemptMs,
      staleFeedBackoffIndex: this.staleFeedBackoffIndex
    });

    this.feedSoftStale = decision.feedSoftStale;
    if (decision.action === "STALE_BACKOFF_WAIT") {
      this.nextStaleReconnectEligibleAtMs = decision.nextEligibleAtMs;
    }

    if (decision.action === "NONE" && !decision.feedSoftStale) {
      // Fresh Spot+Depth resumed — reset quiet-market stale-recovery episode.
      this.staleFeedBackoffIndex = 0;
      this.lastStaleFeedReconnectAttemptMs = null;
      this.nextStaleReconnectEligibleAtMs = null;
      return;
    }

    if (decision.action === "SOFT_STALE_ONLY" || decision.action === "STALE_BACKOFF_WAIT") {
      // Soft stale: FEED_STALE / paper blocked via freshness — transport left alone.
      return;
    }

    if (decision.action === "SCHEDULE_TRANSPORT_RECONNECT") {
      this.scheduleReconnect("transport_disconnect", 500);
      return;
    }

    if (decision.action === "SCHEDULE_STALE_FEED_RECONNECT") {
      microLog("MICRO_COLLECTOR_BAR_POLL_FAILED", {
        code: "RESEARCH_FEED_HARD_STALE",
        spotAgeMs: h.spotAgeMs,
        depthAgeMs: h.depthAgeMs,
        softStaleMs: this.softStaleMs,
        hardStaleReconnectMs: this.hardStaleReconnectMs
      });
      this.scheduleReconnect("stale_feed", 0);
    }
  }

  /** @internal test hook — run stale watchdog once. */
  async checkStaleAndReconnectForTests(): Promise<void> {
    await this.checkStaleAndReconnect();
  }

  /** @internal test hook — hold reconnect body to simulate slow reconnect (#4). */
  setReconnectHoldMsForTests(ms: number): void {
    this.reconnectHoldMsForTests = Math.max(0, ms);
  }

  /** @internal test hook — skip broker connect during reconnect body. */
  setSkipSessionConnectForTests(skip: boolean): void {
    this.skipSessionConnectForTests = skip;
  }

  /** @internal test hook — schedule reconnect with explicit reason. */
  scheduleReconnectForTests(
    reason: ResearchReconnectReason,
    delayMs = 0
  ): boolean {
    this.running = true;
    this.stopping = false;
    return this.scheduleReconnect(reason, delayMs);
  }

  /** @internal test hook — mark process running without live connect. */
  markRunningForTests(): void {
    this.running = true;
    this.stopping = false;
  }

  getReconnectTelemetryForTests(): {
    reconnectInFlight: boolean;
    transportReconnectCount: number;
    staleFeedReconnectCount: number;
    staleFeedBackoffIndex: number;
    lastStaleFeedReconnectAttemptMs: number | null;
    nextStaleReconnectEligibleAtMs: number | null;
    feedSoftStale: boolean;
    reconnectTimerPending: boolean;
  } {
    return {
      reconnectInFlight: this.reconnectInFlight,
      transportReconnectCount: this.transportReconnectCount,
      staleFeedReconnectCount: this.staleFeedReconnectCount,
      staleFeedBackoffIndex: this.staleFeedBackoffIndex,
      lastStaleFeedReconnectAttemptMs: this.lastStaleFeedReconnectAttemptMs,
      nextStaleReconnectEligibleAtMs: this.nextStaleReconnectEligibleAtMs,
      feedSoftStale: this.feedSoftStale,
      reconnectTimerPending: this.reconnectTimer != null
    };
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
        depthEventCount: 0,
        depthCrossedEventCount: 0,
        depthCrossedPct: null,
        currentDepthState: "DEPTH_UNAVAILABLE",
        crossedDurationMs: 0,
        depthResyncCount: 0,
        disconnectResyncCount: 0,
        sustainedCrossRecoveryCount: 0,
        deleteHits: 0,
        deleteMisses: 0,
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
    const bridge = this.runtime?.getBridge();
    // Derive soft-stale from current ages so health does not lag a watchdog tick.
    const softNow =
      (base.spotAgeMs == null || base.spotAgeMs > this.softStaleMs) &&
      (base.depthAgeMs == null || base.depthAgeMs > this.softStaleMs);
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
        bridge?.getCurrentCaptureUtcDate() ??
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
        "RESEARCH CAPTURE ONLY — continuous market observation. No trading, no shadow orders, no broker orders. captureDayIndex ≠ validatedIndependentDays.",
      softStaleMs: this.softStaleMs,
      hardStaleReconnectMs: this.hardStaleReconnectMs,
      hardStaleThresholdReason: GH_FAST_RESEARCH_HARD_STALE_THRESHOLD_REASON,
      feedSoftStale: softNow,
      reconnectInFlight: this.reconnectInFlight,
      transportReconnectCount: this.transportReconnectCount,
      staleFeedReconnectCount: this.staleFeedReconnectCount,
      sustainedCrossRecoveryCount: bridge?.getSustainedCrossRecoveryCount() ?? 0,
      disconnectResyncCount: bridge?.getDisconnectResyncCount() ?? 0,
      nextStaleReconnectEligibleAtMs: this.nextStaleReconnectEligibleAtMs
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
          path !== "/research/recent-candidates" &&
          path !== "/reference-paper" &&
          path !== "/research/reference-paper"
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
          if (
            path === "/reference-paper" ||
            path === "/research/reference-paper"
          ) {
            const paper =
              this.runtime?.getBridge()?.referencePaperSnapshot() ?? {
                mode: "REFERENCE_PAPER_ONLY" as const,
                label:
                  "REFERENCE PAPER P/L — HYPOTHETICAL, NOT A BROKER TRADE" as const,
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
              };
            res.writeHead(200, {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              ...cors
            });
            res.end(JSON.stringify(paper, null, 2));
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
    // Do not race a reconnect: wait briefly for in-flight to observe stopping.
    const deadline = this.nowMs() + 15_000;
    while (this.reconnectInFlight && this.nowMs() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
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
