import type {
  ApiErrorBody,
  BackendSettings,
  Decision,
  HealthResponse,
  JournalEntry,
  JournalTag,
  ManualExecutionAction,
  AdminMarketFeedStatus,
  InAppNotification,
  MarketFeedHealth,
  NotificationPreferences,
  SetupAnalyticsSummary,
  SetupRecord,
  SystemStatus,
  AdminDiagnostics,
  TradingViewConnection,
  WebPushSubscriptionPayload
} from "../types/models";
import { ApiError } from "../types/models";
import type {
  AutoTradeMode,
  AutoTradeStatus,
  SelectedBrokerId,
  T212Environment,
  T212ExecutionProposal,
  T212InstrumentCandidate,
  T212SelectedInstrument
} from "./autoTradeTypes";

export type ManualExecutionPatch = {
  action: ManualExecutionAction;
  skipReason?: string;
  actualEntryPrice?: number;
  positionSize?: number;
  broker?: string;
  tradedAt?: string;
  cashRiskIntended?: number;
  actualStop?: number;
  actualTp1?: number;
  actualTp2?: number;
  actualTp3?: number;
  actualExitPrice?: number;
  actualPnl?: number;
  feesSpreadSlippage?: number;
  notes?: string;
  screenshotRef?: string;
};

export type TokenProvider = (forceRefresh?: boolean) => Promise<string | null>;

export interface ApiClientOptions {
  baseUrl: string;
  getIdToken: TokenProvider;
}

const parseError = async (response: Response): Promise<ApiError> => {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return new ApiError(
      response.status,
      body.error?.code ?? "UNKNOWN",
      body.error?.message ?? response.statusText
    );
  } catch {
    return new ApiError(response.status, "UNKNOWN", response.statusText || "Request failed");
  }
};

export class ApiClient {
  private readonly baseUrl: string;
  /** Optional dedicated cTrader backend (apiCTraderPreview). Falls back to baseUrl. */
  private readonly ctraderBaseUrl: string;
  private readonly getIdToken: TokenProvider;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    const ctraderEnv = (import.meta.env.VITE_CTRADER_API_BASE_URL as string | undefined)?.trim();
    /**
     * Production cTrader OAuth/read routes are served by isolated apiCTraderPreview
     * (CTRADER_* secrets bound there). Fall back to that host in production builds
     * when the env var is omitted so Broker Control Centre cannot silently hit
     * production `api` without secrets and show false "Setup required".
     */
    /**
     * Prefer the Cloud Run Function URL: the cloudfunctions.net gateway can 504
     * long Open-API diagnostics while control-centre / qualification stay healthy.
     * CORS allows the production origin on this host.
     */
    const productionCTraderFallback =
      "https://apictraderpreview-j7lu3gvotq-uc.a.run.app";
    const useProdFallback =
      !ctraderEnv &&
      import.meta.env.PROD &&
      /goldmeta-web\.cloudfunctions\.net\/api\/?$/.test(this.baseUrl);
    this.ctraderBaseUrl = (ctraderEnv || (useProdFallback ? productionCTraderFallback : this.baseUrl)).replace(
      /\/$/,
      ""
    );
    this.getIdToken = options.getIdToken;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    auth = true,
    retried = false,
    baseUrl: string = this.baseUrl
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    if (auth) {
      const token = await this.getIdToken(retried);
      if (!token) {
        throw new ApiError(401, "UNAUTHENTICATED", "Sign in required");
      }
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers
    });

    if (response.status === 401 && auth && !retried) {
      return this.request<T>(path, init, auth, true, baseUrl);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    if (!response.ok) {
      throw await parseError(response);
    }

    return (await response.json()) as T;
  }

  /** cTrader / Pepperstone routes — may target isolated apiCTraderPreview. */
  private requestCTrader<T>(
    path: string,
    init: RequestInit = {},
    auth = true
  ): Promise<T> {
    return this.request<T>(path, init, auth, false, this.ctraderBaseUrl);
  }

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health", {}, false);
  }

  async latestDecision(): Promise<Decision | null> {
    const pack = await this.latestDecisionPack();
    return pack?.decision ?? null;
  }

  /** Latest quote + optional complete strategy signal (Market Structure separation). */
  async latestDecisionPack(): Promise<{
    decision: Decision;
    latestQuote?: Decision | null;
    latestCompleteStrategySignal?: Decision | null;
    marketStructureMode?: "COMPLETE" | "LIVE_RANGE_ONLY" | "MISMATCH" | "UNAVAILABLE";
    marketStructureDiagnostics?: Record<string, unknown> | null;
    marketFeedHealth?: MarketFeedHealth | null;
    structureDecisionId?: string | null;
    /** Server-built Issue #50 intraday plan — UI must not invent levels. */
    intradayPlan?: import("../types/intradayPlan").IntradayPlan | null;
    /** Pine 3.0 stable session plan (optional until backend ships). */
    sessionPlan?: import("./sessionPlanBridge").StablePlanSummary | null;
    /** Compact stable-plan projection from GET /v1/decisions/latest. */
    stablePlan?: import("./sessionPlanBridge").StablePlanSummary | null;
  } | null> {
    try {
      return await this.request("/v1/decisions/latest");
    } catch (err) {
      // Expected empty state when the user has no published decision yet.
      if (err instanceof ApiError && err.status === 404 && err.code === "NOT_FOUND") {
        return null;
      }
      throw err;
    }
  }

  async decisionHistory(limit = 50): Promise<Decision[]> {
    const body = await this.request<{ decisions: Decision[] }>(
      `/v1/decisions?limit=${encodeURIComponent(String(limit))}`
    );
    return body.decisions;
  }

  async getDecision(decisionId: string): Promise<Decision | null> {
    try {
      const body = await this.request<{ decision: Decision }>(
        `/v1/decisions/${encodeURIComponent(decisionId)}`
      );
      return body.decision;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404 && err.code === "NOT_FOUND") {
        return null;
      }
      throw err;
    }
  }

  async getSettings(): Promise<BackendSettings> {
    const body = await this.request<{ settings: BackendSettings }>("/v1/settings");
    return body.settings;
  }

  async updateSettings(
    patch: Partial<Omit<BackendSettings, "manualRisk">> & {
      manualRisk?: Partial<NonNullable<BackendSettings["manualRisk"]>>;
      liveForwardAckAt?: string | null;
    }
  ): Promise<BackendSettings> {
    const body = await this.request<{ settings: BackendSettings }>("/v1/settings", {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
    return body.settings;
  }

  async listJournal(): Promise<JournalEntry[]> {
    const body = await this.request<{ entries: JournalEntry[] }>("/v1/journal");
    return body.entries;
  }

  async createJournal(entry: {
    decisionId?: string;
    setupId?: string;
    direction: Decision["decision"];
    outcome?: string;
    notes?: string;
    tags?: JournalTag[];
    riskReward?: number | null;
  }): Promise<JournalEntry> {
    const body = await this.request<{ entry: JournalEntry }>("/v1/journal", {
      method: "POST",
      body: JSON.stringify({ symbol: "XAUUSD", outcome: "OPEN", ...entry })
    });
    return body.entry;
  }

  async listSetups(limit = 50, environment?: "LIVE" | "TEST"): Promise<SetupRecord[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (environment) params.set("environment", environment);
    const body = await this.request<{ setups: SetupRecord[] }>(`/v1/setups?${params.toString()}`);
    return body.setups;
  }

  async listSignalOutcomes(limit = 100): Promise<import("../types/models").SignalOutcomeRecord[]> {
    const body = await this.request<{ items: import("../types/models").SignalOutcomeRecord[] }>(
      `/v1/signal-outcomes?limit=${encodeURIComponent(String(limit))}`
    );
    return body.items;
  }

  async signalOutcomeByDecision(
    decisionId: string
  ): Promise<import("../types/models").SignalOutcomeRecord | null> {
    try {
      const body = await this.request<{ item: import("../types/models").SignalOutcomeRecord }>(
        `/v1/signal-outcomes/by-decision/${encodeURIComponent(decisionId)}`
      );
      return body.item;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  }

  async signalPerformance(): Promise<import("../types/models").SignalPerformanceSummary> {
    return this.request<import("../types/models").SignalPerformanceSummary>(
      "/v1/signal-outcomes/performance"
    );
  }

  async listActiveSetups(environment?: "LIVE" | "TEST"): Promise<SetupRecord[]> {
    const q = environment ? `?environment=${environment}` : "";
    const body = await this.request<{ setups: SetupRecord[] }>(`/v1/setups/active${q}`);
    return body.setups;
  }

  async getSetup(setupId: string): Promise<SetupRecord | null> {
    try {
      const body = await this.request<{ setup: SetupRecord }>(
        `/v1/setups/${encodeURIComponent(setupId)}`
      );
      return body.setup;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  }

  async saveManualExecution(
    setupId: string,
    patch: ManualExecutionPatch
  ): Promise<SetupRecord> {
    const body = await this.request<{ setup: SetupRecord }>(
      `/v1/setups/${encodeURIComponent(setupId)}/manual-execution`,
      {
        method: "PATCH",
        body: JSON.stringify(patch)
      }
    );
    return body.setup;
  }

  async setupAnalytics(environment: "LIVE" | "TEST" = "LIVE"): Promise<SetupAnalyticsSummary> {
    const body = await this.request<{ analytics: SetupAnalyticsSummary }>(
      `/v1/analytics/setups?environment=${environment}`
    );
    return body.analytics;
  }

  async systemStatus(): Promise<SystemStatus> {
    const body = await this.request<{ status: SystemStatus }>("/v1/system/status");
    return body.status;
  }

  async adminDiagnostics(): Promise<AdminDiagnostics> {
    const body = await this.request<{ diagnostics: AdminDiagnostics }>("/v1/admin/diagnostics");
    return body.diagnostics;
  }

  async marketFeedHealth(): Promise<MarketFeedHealth> {
    const body = await this.request<{ health?: MarketFeedHealth; marketFeedHealth?: MarketFeedHealth }>(
      "/v1/market-feed/health"
    );
    return body.health ?? body.marketFeedHealth ?? (body as MarketFeedHealth);
  }

  async adminMarketFeedStatus(): Promise<AdminMarketFeedStatus> {
    const body = await this.request<{
      status?: AdminMarketFeedStatus;
      marketFeed?: AdminMarketFeedStatus;
    }>("/v1/admin/market-feed/status");
    return body.status ?? body.marketFeed ?? (body as AdminMarketFeedStatus);
  }

  async notificationPreferences(): Promise<NotificationPreferences> {
    const body = await this.request<{
      preferences?: NotificationPreferences;
      notificationPreferences?: NotificationPreferences;
    }>("/v1/notifications/preferences");
    return body.preferences ?? body.notificationPreferences ?? (body as NotificationPreferences);
  }

  async updateNotificationPreferences(
    patch: Partial<NotificationPreferences>
  ): Promise<NotificationPreferences> {
    const body = await this.request<{
      preferences?: NotificationPreferences;
      notificationPreferences?: NotificationPreferences;
    }>("/v1/notifications/preferences", {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
    return body.preferences ?? body.notificationPreferences ?? (body as NotificationPreferences);
  }

  async listNotifications(limit = 20): Promise<InAppNotification[]> {
    const body = await this.request<{
      notifications?: InAppNotification[];
      items?: InAppNotification[];
    }>(`/v1/notifications?limit=${encodeURIComponent(String(limit))}`);
    return body.notifications ?? body.items ?? [];
  }

  async markNotificationsRead(notificationIds?: string[]): Promise<{ ok: boolean }> {
    return this.request("/v1/notifications/read", {
      method: "POST",
      body: JSON.stringify(notificationIds ? { notificationIds } : {})
    });
  }

  async sendTestNotification(): Promise<{
    ok: boolean;
    message?: string;
    webSent?: number;
    fcmSent?: number;
    vapidConfigured?: boolean;
    subscriptionCount?: number;
  }> {
    return this.request("/v1/notifications/test", {
      method: "POST",
      body: "{}"
    });
  }

  async listWebPushSubscriptions(): Promise<{
    count: number;
    subscriptions: Array<{
      subscriptionId: string;
      endpointHost: string;
      userAgent: string | null;
      registeredAt: string;
      updatedAt: string;
      expirationTime: number | null;
    }>;
  }> {
    return this.request("/v1/push/web-subscriptions");
  }

  async listTradingViewConnections(): Promise<TradingViewConnection[]> {
    const body = await this.request<{ connections: TradingViewConnection[] }>(
      "/v1/tradingview/connections"
    );
    return body.connections;
  }

  async createTradingViewConnection(): Promise<{
    connection: TradingViewConnection;
    webhookUrl?: string;
    secret?: string;
  }> {
    return this.request("/v1/tradingview/connections", { method: "POST" });
  }

  async revokeTradingViewConnection(webhookId: string): Promise<{
    connection: TradingViewConnection;
  }> {
    return this.request(`/v1/tradingview/connections/${encodeURIComponent(webhookId)}`, {
      method: "DELETE"
    });
  }

  async sendTestAlert(connectionId?: string): Promise<{
    ok: boolean;
    message: string;
  }> {
    return this.request("/v1/tradingview/test", {
      method: "POST",
      body: JSON.stringify(connectionId ? { connectionId } : {})
    });
  }

  async getTradingViewSetup(): Promise<Record<string, unknown>> {
    return this.request("/v1/tradingview/setup");
  }

  async updateTradingViewSetup(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request("/v1/tradingview/setup", {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  }

  async restoreTradingViewStandard(): Promise<Record<string, unknown>> {
    return this.request("/v1/tradingview/setup/restore-standard", {
      method: "POST",
      body: "{}"
    });
  }

  async saveTradingViewCustomMapping(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request("/v1/tradingview/setup/custom-mapping", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async rotateTradingViewConnection(webhookId: string): Promise<{
    secret?: string;
    webhookUrl?: string;
    connection?: TradingViewConnection;
  }> {
    return this.request(`/v1/tradingview/connections/${encodeURIComponent(webhookId)}/rotate`, {
      method: "POST",
      body: "{}"
    });
  }

  async getAdminTradingViewTemplate(): Promise<Record<string, unknown>> {
    return this.request("/v1/admin/tradingview/template");
  }

  async publishAdminTradingViewTemplate(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request("/v1/admin/tradingview/template", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async registerDevice(payload: {
    deviceId: string;
    platform: "ios" | "web";
    fcmToken: string;
    appVersion?: string;
  }): Promise<unknown> {
    return this.request("/v1/devices/register", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async registerWebPushSubscription(payload: WebPushSubscriptionPayload): Promise<unknown> {
    return this.request("/v1/push/web-subscriptions", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async deleteWebPushSubscription(endpoint: string): Promise<void> {
    await this.request("/v1/push/web-subscriptions", {
      method: "DELETE",
      body: JSON.stringify({ endpoint })
    });
  }

  async getVapidPublicKey(): Promise<string | null> {
    const body = await this.request<{ publicKey: string | null }>(
      "/v1/push/vapid-public-key",
      {},
      true
    );
    return body.publicKey;
  }

  async v4Status(): Promise<{
    strategyVersion: string;
    engineVersion?: string;
    configVersion?: string;
    deploymentStage?: string;
    mode?: string;
    actionableLiveEnabled?: boolean;
    shadowComputeEnabled?: boolean;
    shadowLifecycleEnabled?: boolean;
    flags?: Record<string, unknown>;
    brokerExecution?: string;
    banner?: string;
    disclaimer?: string;
    note?: string;
  }> {
    const body = await this.request<{ v4: Record<string, unknown> }>("/v1/v4/status");
    return body.v4 as {
      strategyVersion: string;
      engineVersion?: string;
      configVersion?: string;
      deploymentStage?: string;
      mode?: string;
      actionableLiveEnabled?: boolean;
      shadowComputeEnabled?: boolean;
      shadowLifecycleEnabled?: boolean;
      flags?: Record<string, unknown>;
      brokerExecution?: string;
      banner?: string;
      disclaimer?: string;
      note?: string;
    };
  }

  async v4Shadows(limit = 20): Promise<unknown[]> {
    const body = await this.request<{ shadows: unknown[] }>(
      `/v1/v4/shadows?limit=${encodeURIComponent(String(limit))}`
    );
    return body.shadows;
  }

  async v4Analyses(environment: "LIVE" | "TEST" = "LIVE", limit = 20): Promise<unknown[]> {
    const body = await this.request<{ analyses: unknown[] }>(
      `/v1/v4/analyses?environment=${environment}&limit=${encodeURIComponent(String(limit))}`
    );
    return body.analyses;
  }

  async v4Candidates(environment: "LIVE" | "TEST" = "LIVE", limit = 20): Promise<unknown[]> {
    const body = await this.request<{ candidates: unknown[] }>(
      `/v1/v4/candidates?environment=${environment}&limit=${encodeURIComponent(String(limit))}`
    );
    return body.candidates;
  }

  async v4Plans(environment: "LIVE" | "TEST" = "LIVE", limit = 20): Promise<{
    plans: unknown[];
    openPlan: unknown | null;
  }> {
    const body = await this.request<{ plans: unknown[]; openPlan: unknown | null }>(
      `/v1/v4/plans?environment=${environment}&limit=${encodeURIComponent(String(limit))}`
    );
    return { plans: body.plans, openPlan: body.openPlan };
  }

  async v4Analytics(environment: "LIVE" | "TEST" = "LIVE"): Promise<Record<string, unknown>> {
    const body = await this.request<{ analytics: Record<string, unknown> }>(
      `/v1/v4/analytics?environment=${environment}`
    );
    return body.analytics;
  }

  async v4GcStatus(): Promise<{
    gc: Record<string, unknown>;
    banner?: string;
    dataSourceOptions?: unknown[];
  }> {
    return this.request(`/v1/v4/gc/status`);
  }

  async v5Status(): Promise<Record<string, unknown>> {
    const body = await this.request<{ v5: Record<string, unknown> }>("/v1/v5/status");
    return body.v5;
  }

  async v5Briefing(environment: "LIVE" | "TEST" = "LIVE"): Promise<Record<string, unknown>> {
    const body = await this.request<{ briefing: Record<string, unknown> }>(
      `/v1/v5/briefing?environment=${environment}`
    );
    return body.briefing;
  }

  async v5Ask(
    question: string,
    environment: "LIVE" | "TEST" = "LIVE"
  ): Promise<Record<string, unknown>> {
    const body = await this.request<{ answer: Record<string, unknown> }>(
      "/v1/v5/intelligence/ask",
      { method: "POST", body: JSON.stringify({ question, environment }) }
    );
    return body.answer;
  }

  async v5Score(environment: "LIVE" | "TEST" = "LIVE"): Promise<Record<string, unknown> | null> {
    const body = await this.request<{ score: Record<string, unknown> | null }>(
      `/v1/v5/score?environment=${environment}`
    );
    return body.score;
  }

  async v5Learning(environment: "LIVE" | "TEST" = "LIVE"): Promise<Record<string, unknown>> {
    const body = await this.request<{ insights: Record<string, unknown> }>(
      `/v1/v5/learning?environment=${environment}`
    );
    return body.insights;
  }

  async v5PremiumAnalytics(filters: {
    environment?: "LIVE" | "TEST";
    session?: string;
    direction?: "BUY" | "SELL";
    strategy?: string;
    regime?: string;
  }): Promise<Record<string, unknown>> {
    const q = new URLSearchParams();
    q.set("environment", filters.environment ?? "LIVE");
    if (filters.session) q.set("session", filters.session);
    if (filters.direction) q.set("direction", filters.direction);
    if (filters.strategy) q.set("strategy", filters.strategy);
    if (filters.regime) q.set("regime", filters.regime);
    const body = await this.request<{ analytics: Record<string, unknown> }>(
      `/v1/v5/analytics/premium?${q.toString()}`
    );
    return body.analytics;
  }

  async v5Personal(): Promise<Record<string, unknown>> {
    const body = await this.request<{ stats: Record<string, unknown> }>("/v1/v5/personal");
    return body.stats;
  }

  async v5WeeklyCoach(environment: "LIVE" | "TEST" = "LIVE"): Promise<Record<string, unknown>> {
    const body = await this.request<{ report: Record<string, unknown> }>(
      `/v1/v5/coach/weekly?environment=${environment}`
    );
    return body.report;
  }

  async v5ScreenshotAnalyse(input: {
    observations: Record<string, unknown>;
    environment?: "LIVE" | "TEST";
  }): Promise<Record<string, unknown>> {
    const body = await this.request<{ result: Record<string, unknown> }>(
      "/v1/v5/screenshot/analyse",
      {
        method: "POST",
        body: JSON.stringify({
          observations: input.observations,
          environment: input.environment ?? "LIVE"
        })
      }
    );
    return body.result;
  }

  async v5Replay(
    environment: "LIVE" | "TEST" = "LIVE",
    limit = 40
  ): Promise<{
    frames: Array<{
      barTime: string;
      analysisSummary: string | null;
      candidateStatus: string | null;
      planStatus: string | null;
      lifecycleNote: string | null;
      result: string | null;
    }>;
    disclaimer?: string;
    insufficientData?: boolean;
  }> {
    const body = await this.request<{ session: Record<string, unknown> }>(
      `/v1/v5/replay?environment=${environment}&limit=${encodeURIComponent(String(limit))}`
    );
    return body.session as {
      frames: Array<{
        barTime: string;
        analysisSummary: string | null;
        candidateStatus: string | null;
        planStatus: string | null;
        lifecycleNote: string | null;
        result: string | null;
      }>;
      disclaimer?: string;
      insufficientData?: boolean;
    };
  }

  async v5GlossaryTerm(slug: string): Promise<{
    term: string;
    whatItIs: string;
    whyItMatters: string;
    howGoldMetaUsesIt: string;
  }> {
    const body = await this.request<{ entry: Record<string, string> }>(
      `/v1/v5/glossary/${encodeURIComponent(slug)}`
    );
    return body.entry as {
      term: string;
      whatItIs: string;
      whyItMatters: string;
      howGoldMetaUsesIt: string;
    };
  }

  async autoTradeStatus(): Promise<AutoTradeStatus> {
    const body = await this.request<{ status: AutoTradeStatus }>("/v1/autotrade/status");
    return body.status;
  }

  async autoTradeSetMode(
    mode: AutoTradeMode,
    opts: {
      liveConfirmationPhrase?: string;
      riskAcknowledged?: boolean;
      accountVerified?: boolean;
    } = {}
  ): Promise<AutoTradeStatus> {
    const body = await this.request<{ status: AutoTradeStatus }>("/v1/autotrade/mode", {
      method: "POST",
      body: JSON.stringify({ mode, ...opts })
    });
    return body.status;
  }

  async autoTradeConnect(environment: "DEMO" | "LIVE"): Promise<AutoTradeStatus> {
    const body = await this.request<{ status: AutoTradeStatus }>("/v1/autotrade/connect", {
      method: "POST",
      body: JSON.stringify({ environment })
    });
    return body.status;
  }

  async autoTradeEmergencyStop(): Promise<AutoTradeStatus> {
    const body = await this.request<{ status: AutoTradeStatus }>("/v1/autotrade/emergency-stop", {
      method: "POST"
    });
    return body.status;
  }

  async autoTradeUnlock(): Promise<AutoTradeStatus> {
    const body = await this.request<{ status: AutoTradeStatus }>("/v1/autotrade/unlock", {
      method: "POST"
    });
    return body.status;
  }

  async autoTradeUpdateLimits(
    patch: Partial<AutoTradeStatus["limits"]> & { confirmIncrease?: boolean }
  ): Promise<AutoTradeStatus> {
    const body = await this.request<{ status: AutoTradeStatus }>("/v1/autotrade/limits", {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
    return body.status;
  }

  async autoTradeDemoDiagnostics(): Promise<AutoTradeStatus> {
    const body = await this.request<{ status: AutoTradeStatus }>("/v1/autotrade/demo/diagnostics", {
      method: "POST"
    });
    return body.status;
  }

  async autoTradeDisconnect(): Promise<AutoTradeStatus> {
    const body = await this.request<{ status: AutoTradeStatus }>("/v1/autotrade/disconnect", {
      method: "POST"
    });
    return body.status;
  }

  async autoTradeSelectBroker(broker: SelectedBrokerId): Promise<AutoTradeStatus> {
    const body = await this.request<{ status: AutoTradeStatus }>("/v1/autotrade/broker", {
      method: "POST",
      body: JSON.stringify({ broker })
    });
    return body.status;
  }

  async autoTradeT212Connect(
    environment: T212Environment = "PRACTICE"
  ): Promise<AutoTradeStatus> {
    const body = await this.request<{ status: AutoTradeStatus }>("/v1/autotrade/t212/connect", {
      method: "POST",
      body: JSON.stringify({ environment })
    });
    return body.status;
  }

  async autoTradeT212Disconnect(): Promise<AutoTradeStatus> {
    const body = await this.request<{ status: AutoTradeStatus }>(
      "/v1/autotrade/t212/disconnect",
      { method: "POST" }
    );
    return body.status;
  }

  async autoTradeT212Diagnostics(): Promise<AutoTradeStatus> {
    const body = await this.request<{ status: AutoTradeStatus }>(
      "/v1/autotrade/t212/diagnostics",
      { method: "POST" }
    );
    return body.status;
  }

  async autoTradeT212SearchInstruments(
    query?: string
  ): Promise<{ candidates: T212InstrumentCandidate[]; status: AutoTradeStatus }> {
    const body = await this.request<{
      candidates: T212InstrumentCandidate[];
      status: AutoTradeStatus;
    }>("/v1/autotrade/t212/instruments/search", {
      method: "POST",
      body: JSON.stringify(query ? { query } : {})
    });
    return body;
  }

  async autoTradeT212ConfirmInstrument(
    payload: Omit<T212SelectedInstrument, "confirmedAt" | "confirmedBy"> & {
      isin?: string | null;
      exchange?: string | null;
      fractionalSupported?: boolean | null;
      minOrderQuantity?: number | null;
      minOrderValue?: number | null;
    }
  ): Promise<AutoTradeStatus> {
    const body = await this.request<{ status: AutoTradeStatus }>(
      "/v1/autotrade/t212/instruments/confirm",
      {
        method: "POST",
        body: JSON.stringify(payload)
      }
    );
    return body.status;
  }

  async autoTradeT212CreateProposal(payload: {
    decisionId: string;
    decision: string;
    confidence?: number | null;
    score?: number | null;
    generatedAt?: string | null;
    marketOpen?: boolean | null;
    holdingQuantity?: number;
  }): Promise<{
    proposal: T212ExecutionProposal;
    status: AutoTradeStatus;
  }> {
    const body = await this.request<{
      proposal: T212ExecutionProposal;
      status: AutoTradeStatus;
    }>("/v1/autotrade/t212/proposals", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    return body;
  }

  async autoTradeT212ApproveDryRun(
    proposalId: string,
    confirmMethod?: "manual" | "biometric_future"
  ): Promise<{ proposal: T212ExecutionProposal; status: AutoTradeStatus }> {
    const body = await this.request<{
      proposal: T212ExecutionProposal;
      status: AutoTradeStatus;
    }>("/v1/autotrade/t212/proposals/approve-dry-run", {
      method: "POST",
      body: JSON.stringify({
        proposalId,
        ...(confirmMethod ? { confirmMethod } : {})
      })
    });
    return body;
  }

  async getBrokerControlCentre(): Promise<
    import("./broker/ctraderTypes").BrokerControlCentreResponse
  > {
    return this.requestCTrader("/v1/brokers/control-centre");
  }

  async getCTraderStatus(): Promise<unknown> {
    return this.requestCTrader("/v1/ctrader/status");
  }

  async getCTraderDemonstration(): Promise<
    import("./broker/ctraderTypes").CTraderDemonstrationBundle
  > {
    return this.requestCTrader("/v1/ctrader/demonstration");
  }

  async startCTraderOAuth(): Promise<{
    authorizationUrl: string;
    state: string;
    expiresAt: string;
    environment: "DEMO" | "LIVE";
    scope?: "accounts" | "trading";
  }> {
    return this.requestCTrader("/v1/ctrader/oauth/start", { method: "POST", body: "{}" });
  }

  /** Authorise Demo Trading — opens cTrader consent with scope=trading. */
  async authoriseCTraderDemoTrading(): Promise<{
    authorizationUrl: string;
    state: string;
    expiresAt: string;
    scope: "trading";
    purpose: string;
    warning?: string;
    message?: string;
  }> {
    return this.requestCTrader("/v1/ctrader/oauth/authorise-demo-trading", {
      method: "POST",
      body: JSON.stringify({ confirmTradingPermission: true })
    });
  }

  async getFirstDemoOrderCheckpoint(params?: {
    decision?: "BUY" | "SELL" | "WAIT";
    confidence?: number;
  }): Promise<Record<string, unknown>> {
    const q = new URLSearchParams();
    if (params?.decision) q.set("decision", params.decision);
    if (params?.confidence != null) q.set("confidence", String(params.confidence));
    const suffix = q.toString() ? `?${q}` : "";
    return this.requestCTrader(`/v1/ctrader/demo-orders/first-checkpoint${suffix}`);
  }

  async listCTraderDemoAccounts(): Promise<{
    accounts: import("./broker/ctraderTypes").CTraderBrokerAccountOption[];
    autoSelected?: {
      accountIdMasked: string;
      brokerNameTitle: string | null;
      accountType?: "Demo" | "Live";
    } | null;
  }> {
    return this.requestCTrader("/v1/ctrader/accounts");
  }

  /** Alias — lists Demo and Live accounts authorised for the signed-in user. */
  async listCTraderAccounts(): Promise<{
    accounts: import("./broker/ctraderTypes").CTraderBrokerAccountOption[];
    autoSelected?: {
      accountIdMasked: string;
      brokerNameTitle: string | null;
      accountType?: "Demo" | "Live";
    } | null;
  }> {
    return this.listCTraderDemoAccounts();
  }

  async selectCTraderDemoAccount(payload: {
    ctidTraderAccountId: string;
    confirmPepperstone?: boolean;
    confirmLiveSelection?: boolean;
  }): Promise<unknown> {
    return this.requestCTrader("/v1/ctrader/accounts/select", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async selectCTraderAccount(payload: {
    ctidTraderAccountId: string;
    confirmPepperstone?: boolean;
    confirmLiveSelection?: boolean;
  }): Promise<unknown> {
    return this.selectCTraderDemoAccount(payload);
  }

  async getAutoTradeSettings(environment: "demo" | "live"): Promise<{
    settings: import("./broker/ctraderTypes").UserAutoTradeSettingsDto;
    recommended: Record<string, unknown>;
  }> {
    return this.requestCTrader(`/v1/ctrader/autotrade-settings/${environment}`);
  }

  async saveAutoTradeSettings(
    environment: "demo" | "live",
    patch: Record<string, unknown>
  ): Promise<{ settings: import("./broker/ctraderTypes").UserAutoTradeSettingsDto }> {
    return this.requestCTrader(`/v1/ctrader/autotrade-settings/${environment}`, {
      method: "PUT",
      body: JSON.stringify(patch)
    });
  }

  async confirmLiveAutoTradeActivation(phrase: string): Promise<unknown> {
    return this.requestCTrader("/v1/ctrader/live-activation/confirm", {
      method: "POST",
      body: JSON.stringify({ phrase })
    });
  }

  async setCTraderEmergencyStop(payload: {
    environment: "demo" | "live";
    active?: boolean;
  }): Promise<unknown> {
    return this.requestCTrader("/v1/ctrader/emergency-stop", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async setCTraderAutomationMode(
    mode: "OFF" | "MANUAL" | "CONFIRM" | "DEMO_AUTO"
  ): Promise<{
    mode: string;
    autoTrade: string;
    orderSubmissionEnabled?: boolean;
    liveEnabled?: boolean;
    note?: string;
    qualification?: import("./broker/qualificationTypes").QualificationPublicView;
  }> {
    return this.requestCTrader("/v1/ctrader/automation/mode", {
      method: "POST",
      body: JSON.stringify({ mode })
    });
  }

  async getAutoTradeQualification(): Promise<
    import("./broker/qualificationTypes").QualificationPublicView
  > {
    return this.requestCTrader("/v1/ctrader/qualification");
  }

  async startAutoTradeQualification(): Promise<
    import("./broker/qualificationTypes").QualificationPublicView
  > {
    return this.requestCTrader("/v1/ctrader/qualification/start", {
      method: "POST",
      body: "{}"
    });
  }

  async pauseAutoTradeQualification(): Promise<
    import("./broker/qualificationTypes").QualificationPublicView
  > {
    return this.requestCTrader("/v1/ctrader/qualification/pause", {
      method: "POST",
      body: "{}"
    });
  }

  async resumeAutoTradeQualification(): Promise<
    import("./broker/qualificationTypes").QualificationPublicView
  > {
    return this.requestCTrader("/v1/ctrader/qualification/resume", {
      method: "POST",
      body: "{}"
    });
  }

  async enableDemoAutoFromQualification(): Promise<
    import("./broker/qualificationTypes").QualificationPublicView
  > {
    return this.requestCTrader("/v1/ctrader/qualification/enable-demo-auto", {
      method: "POST",
      body: "{}"
    });
  }

  async getDailySafety(
    environment: "demo" | "live" = "demo"
  ): Promise<import("./broker/ctraderTypes").DailySafetyPublicView> {
    return this.requestCTrader(`/v1/ctrader/daily-safety/${environment}`);
  }

  async resumeDailySafety(
    environment: "demo" | "live" = "demo"
  ): Promise<import("./broker/ctraderTypes").DailySafetyPublicView> {
    return this.requestCTrader(`/v1/ctrader/daily-safety/${environment}/resume`, {
      method: "POST",
      body: "{}"
    });
  }

  async pauseAutoTradeEnv(
    environment: "demo" | "live",
    reason?: string
  ): Promise<import("./broker/ctraderTypes").DailySafetyPublicView> {
    return this.requestCTrader(`/v1/ctrader/autotrade/${environment}/pause`, {
      method: "POST",
      body: JSON.stringify({ reason: reason ?? "Paused by user" })
    });
  }

  async getSystemHealth(): Promise<import("./broker/ctraderTypes").SystemHealthView> {
    return this.requestCTrader("/v1/ctrader/system-health");
  }

  async getAutoTradePerformance(opts?: {
    environment?: "DEMO" | "LIVE" | "ALL";
    period?: "today" | "7d" | "30d" | "all";
  }): Promise<Record<string, unknown>> {
    const environment = opts?.environment ?? "DEMO";
    const period = opts?.period ?? "7d";
    return this.requestCTrader(
      `/v1/ctrader/performance?environment=${encodeURIComponent(environment)}&period=${encodeURIComponent(period)}`
    );
  }

  async getWeeklyGoldMetaReport(
    environment: "DEMO" | "LIVE" = "DEMO"
  ): Promise<Record<string, unknown>> {
    return this.requestCTrader(
      `/v1/ctrader/weekly-report?environment=${encodeURIComponent(environment)}`
    );
  }

  async getNewsGuardStatus(): Promise<Record<string, unknown>> {
    return this.requestCTrader("/v1/ctrader/news-guard");
  }

  async getOpenAutoTradePositions(): Promise<{
    environment: string;
    positions: Array<Record<string, unknown>>;
  }> {
    return this.requestCTrader("/v1/ctrader/open-positions");
  }

  async reconcileOpenAutoTradePositions(): Promise<Record<string, unknown>> {
    return this.requestCTrader("/v1/ctrader/open-positions/reconcile", {
      method: "POST",
      body: "{}"
    });
  }

  async placeCTraderDemoMarketOrder(args: {
    side: "BUY" | "SELL";
    lots: number;
    stopLoss?: number;
    takeProfit?: number;
    entryHint?: number;
    symbolId?: string;
  }): Promise<{
    submitted: boolean;
    environment: string;
    result: Record<string, unknown>;
  }> {
    return this.requestCTrader("/v1/ctrader/orders/market", {
      method: "POST",
      body: JSON.stringify(args)
    });
  }

  async disconnectCTrader(): Promise<{ disconnected: boolean }> {
    return this.requestCTrader("/v1/ctrader/disconnect", { method: "POST", body: "{}" });
  }

  async getCTraderDiagnostics(): Promise<
    import("./broker/ctraderTypes").CTraderDiagnosticsReport
  > {
    return this.requestCTrader("/v1/ctrader/diagnostics");
  }

  async getCTraderQuote(): Promise<{
    available?: boolean;
    quote: {
      symbolId?: string;
      symbolName?: string;
      digits?: number | null;
      pipPosition?: number | null;
      bid: number | null;
      ask: number | null;
      mid?: number | null;
      spread: number | null;
      timestamp?: string;
      brokerTimestamp?: string;
      receivedAt?: string;
      quoteSequence?: number;
      marketStatus?: string;
      stale?: boolean;
      freshness?: string;
      ageMs?: number;
      executable?: boolean;
      environment?: string;
      source?: string;
    } | null;
    mid?: number | null;
    freshness?: string;
    livePriceHealth?: string;
    label: string;
    planIndependent?: boolean;
  }> {
    return this.requestCTrader("/v1/ctrader/quote");
  }

  /** Authoritative live XAUUSD snapshot — independent of plan generation. */
  async getCTraderLiveQuote(opts?: { refresh?: boolean }): Promise<{
    available: boolean;
    quote: {
      symbolId: string;
      symbolName: string;
      digits: number | null;
      pipPosition: number | null;
      bid: number;
      ask: number;
      mid: number;
      spread: number;
      brokerTimestamp: string;
      receivedAt: string;
      quoteSequence: number;
      freshness: string;
      marketStatus: string;
      ageMs: number;
      executable: boolean;
      environment: string;
    } | null;
    livePriceHealth: string;
    label: string;
    planIndependent?: boolean;
  }> {
    const q = opts?.refresh ? "?refresh=1" : "";
    return this.requestCTrader(`/v1/ctrader/live-quote${q}`);
  }

  /**
   * Shared XAUUSD market quote for every approved user.
   * Does not require the viewer's personal cTrader connection.
   */
  async getMarketXauusdQuote(opts?: { refresh?: boolean }): Promise<{
    available: boolean;
    symbol?: string;
    quote: {
      symbolName?: string;
      bid: number;
      ask: number;
      mid: number;
      spread?: number;
      brokerTimestamp?: string;
      receivedAt?: string;
      timestamp?: string;
      freshness: string;
      marketStatus: string;
      ageMs?: number;
    } | null;
    mid?: number | null;
    freshness?: string;
    livePriceHealth: string;
    marketStatus?: string;
    label: string;
    source?: string;
    planIndependent?: boolean;
  }> {
    const q = opts?.refresh ? "?refresh=1" : "";
    return this.request(`/v1/market/xauusd/quote${q}`);
  }

  /** Display-only XAUUSD OHLC candles for Plan chart — never used by trading logic. */
  async getCTraderCandles(opts?: {
    timeframe?: string;
    count?: number;
  }): Promise<{
    symbol: string;
    timeframe: string;
    bars: Array<{
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume?: number | null;
    }>;
    source: string;
    environment?: string;
    cached?: boolean;
    planIndependent?: boolean;
  }> {
    const tf = encodeURIComponent(opts?.timeframe ?? "M15");
    const count = opts?.count ?? 120;
    const path = `/v1/ctrader/candles?tf=${tf}&count=${count}`;
    try {
      return await this.requestCTrader(path);
    } catch (err) {
      // Production browser historically targets apiCTraderPreview for cTrader routes.
      // If that revision lacks /candles, fall back to the main api host which serves it.
      const status =
        err && typeof err === "object" && "status" in err
          ? Number((err as { status: number }).status)
          : 0;
      if (
        (status === 404 || status === 405) &&
        this.ctraderBaseUrl !== this.baseUrl
      ) {
        return this.request(path);
      }
      throw err;
    }
  }

  /**
   * Shared XAUUSD OHLC for Plan chart — all approved users.
   * Does not require the viewer's personal cTrader connection.
   */
  async getMarketXauusdCandles(opts?: {
    timeframe?: string;
    count?: number;
  }): Promise<{
    symbol: string;
    timeframe: string;
    bars: Array<{
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume?: number | null;
    }>;
    source: string;
    cached?: boolean;
    marketStatus?: string;
    updatedAt?: string;
    planIndependent?: boolean;
  }> {
    const tf = encodeURIComponent(opts?.timeframe ?? "M15");
    const count = opts?.count ?? 120;
    return this.request(`/v1/market/xauusd/candles?tf=${tf}&count=${count}`);
  }

  async createCTraderPreview(payload: Record<string, unknown>): Promise<unknown> {
    return this.requestCTrader("/v1/ctrader/preview", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  getRegistrationStatus(): Promise<{
    registrationEnabled: boolean;
    emailVerificationRequired: boolean;
    approvalRequired: boolean;
    brokerEnabledByRegistration: boolean;
    autoTradeDefault: string;
    messages: Record<string, string>;
  }> {
    return this.request("/v1/auth/registration-status", {}, false);
  }

  registerAccount(payload: Record<string, unknown>): Promise<{
    message: string;
    uidMasked: string;
    role: string;
    emailVerificationSent: boolean;
    brokerAccess: boolean;
    autoTrade: boolean;
  }> {
    return this.request("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(payload)
    }, false);
  }

  registrationPreflight(payload: Record<string, unknown>): Promise<{ ok: boolean }> {
    return this.request(
      "/v1/auth/register/preflight",
      { method: "POST", body: JSON.stringify(payload) },
      false
    );
  }

  getAuthMe(): Promise<{
    uidMasked: string | null;
    role: string;
    approvalStatus: string;
    emailVerified: boolean;
    access: "APP" | "VERIFY_EMAIL" | "AWAITING_APPROVAL" | "SUSPENDED" | "FORBIDDEN" | "UNKNOWN";
    profile: {
      firstName?: string;
      lastName?: string;
      email?: string;
      brokerAccess?: boolean;
      autoTrade?: boolean;
      brokerMessage?: string | null;
    } | null;
  }> {
    return this.request("/v1/auth/me");
  }

  resendVerification(): Promise<{ message: string }> {
    return this.request("/v1/auth/resend-verification", { method: "POST", body: "{}" });
  }

  listAdminUsers(): Promise<{
    users: Array<{
      userId: string;
      userIdMasked: string;
      firstName: string;
      lastName: string;
      email: string;
      registeredAt: string;
      emailVerified: boolean;
      approvalStatus: string;
      role: string;
      lastSignInAt: string | null;
      suspended: boolean;
    }>;
  }> {
    return this.request("/v1/admin/users");
  }

  adminUserAction(
    uid: string,
    action: "approve" | "reject" | "suspend" | "restore"
  ): Promise<{ user: Record<string, unknown> }> {
    return this.request(`/v1/admin/users/${encodeURIComponent(uid)}/${action}`, {
      method: "POST",
      body: "{}"
    });
  }

  /** Micro Edge — shadow research API (read-only; no broker orders). */
  microEdgeStatus(): Promise<Record<string, unknown>> {
    return this.request("/v1/micro-edge/status");
  }

  microEdgeLatest(): Promise<{ prediction: Record<string, unknown> | null }> {
    return this.request("/v1/micro-edge/latest");
  }

  microEdgeHistory(limit = 30): Promise<{
    items: Array<Record<string, unknown>>;
    outcomes: Array<Record<string, unknown>>;
  }> {
    return this.request(`/v1/micro-edge/history?limit=${encodeURIComponent(String(limit))}`);
  }

  microEdgePerformance(): Promise<{ summary: Record<string, unknown> }> {
    return this.request("/v1/micro-edge/performance");
  }

  microEdgeModels(): Promise<Record<string, unknown>> {
    return this.request("/v1/micro-edge/models");
  }

  microEdgeMarketDataDiagnostics(): Promise<Record<string, unknown>> {
    return this.request("/v1/micro-edge/market-data/diagnostics");
  }

  microEdgeOAuthStatus(): Promise<Record<string, unknown>> {
    return this.request("/v1/micro-edge/oauth/status");
  }

  microEdgeOAuthStart(): Promise<{
    authorizationUrl: string;
    sessionId: string;
    scope: "accounts";
    tradingScopeRequested: false;
    redirectUri: string;
    confirmation: Record<string, string>;
  }> {
    return this.request("/v1/micro-edge/oauth/start", {
      method: "POST",
      body: "{}"
    });
  }

  microEdgeOAuthCallback(body: {
    code: string;
    sessionId: string;
    accountId?: string;
  }): Promise<Record<string, unknown>> {
    return this.request("/v1/micro-edge/oauth/callback", {
      method: "POST",
      body: JSON.stringify(body)
    });
  }

  microEdgeOAuthDisconnect(): Promise<Record<string, unknown>> {
    return this.request("/v1/micro-edge/oauth/disconnect", {
      method: "POST",
      body: "{}"
    });
  }

  microEdgeOAuthSelectAccount(accountId: string): Promise<Record<string, unknown>> {
    return this.request("/v1/micro-edge/oauth/select-account", {
      method: "POST",
      body: JSON.stringify({ accountId })
    });
  }

  /** GOLD HUNTER Admin Tool — ADMIN ONLY. */
  goldHunterStatus(): Promise<GoldHunterStatusResponse> {
    return this.request("/v1/gold-hunter/status");
  }

  goldHunterConfig(): Promise<GoldHunterConfigResponse> {
    return this.request("/v1/gold-hunter/config");
  }

  goldHunterUpdateConfig(
    patch: Record<string, unknown>
  ): Promise<GoldHunterConfigResponse> {
    return this.request("/v1/gold-hunter/config", {
      method: "PUT",
      body: JSON.stringify(patch)
    });
  }

  goldHunterTrades(): Promise<{
    trades: GoldHunterTrade[];
    strategy: "GOLD_HUNTER";
    environment: "DEMO";
  }> {
    return this.request("/v1/gold-hunter/trades");
  }

  goldHunterPerformance(range: "today" | "week" | "month" | "all" = "today"): Promise<{
    range: string;
    demo: GoldHunterPerformanceBucket;
    paper: null;
    paperNote: string;
  }> {
    return this.request(
      `/v1/gold-hunter/performance?range=${encodeURIComponent(range)}`
    );
  }
}

export type GoldHunterTrade = {
  goldHunterTradeId: string;
  strategy: "GOLD_HUNTER";
  environment: "DEMO";
  setup: "A" | "B" | "C" | null;
  side: "BUY" | "SELL";
  signalTs: string | null;
  orderTs: string | null;
  fillTs: string | null;
  closeTs: string | null;
  entry: number | null;
  exit: number | null;
  stop: number | null;
  entrySpread: number | null;
  durationMs: number | null;
  mfe: number | null;
  mae: number | null;
  grossPnlEur: number | null;
  netPnlEur: number | null;
  result: "WIN" | "LOSS" | "BREAKEVEN" | "OPEN" | null;
  exitReason: string | null;
  brokerOrderId: string | null;
  brokerPositionId: string | null;
  status: string;
};

export type GoldHunterPerformanceBucket = {
  netPnl: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  profitFactor: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  expectancy: number | null;
  maxDrawdown: number | null;
};

export type GoldHunterConfigResponse = {
  config: {
    allocatedCapitalEur: number;
    riskPerTradePct: number;
    dailyLossLimitPct: number;
    maxOpenTrades: number;
    demoAutoTradeEnabled: boolean;
    pauseNewEntries: boolean;
    emergencyStopActive: boolean;
    mode: "RESEARCH" | "DEMO_AUTO" | "LIVE_LOCKED";
    updatedAt: string;
    updatedBy: string;
  };
  presetsEur?: number[];
  executionMode: "DEMO_ONLY";
  liveExecutionEnabled: false;
  riskBudgetEur?: number;
  dailyLossBudgetEur?: number;
};

export type GoldHunterStatusResponse = {
  product: "GOLD_HUNTER";
  executionMode: "DEMO_ONLY";
  liveExecutionEnabled: false;
  runtimeSha: string | null;
  config: GoldHunterConfigResponse["config"];
  modeLabel: { primary: string; secondary: string; tertiary: string };
  market: {
    symbol: "XAUUSD";
    bid: number | null;
    ask: number | null;
    mid: number | null;
    spread: number | null;
    marketStatus: string;
    freshness: string;
    ageMs: number | null;
    feedState: string;
    updatedAt: string | null;
  };
  broker: {
    connected: boolean;
    environment: "DEMO" | "LIVE" | null;
    accountMasked: string | null;
    brokerName: string | null;
    balance: number | null;
    currency: string | null;
    equity: number | null;
    marginUsed: number | null;
    freeMargin: number | null;
  };
  capital: {
    allocatedEur: number;
    committedEur: number;
    availableEur: number;
    todayPnlEur: number;
    riskBudgetEur: number;
    dailyLossBudgetEur: number;
  };
  health: {
    marketFeed: string;
    transport: string;
    depth: string;
    strategy: string;
    risk: string;
    autoTrade: string;
  };
  gates: {
    ok: boolean;
    blockers: string[];
    executionMode: "DEMO_ONLY";
    liveExecutionEnabled: false;
  };
  openTrades: GoldHunterTrade[];
  unmatchedDemoPositions: Array<{
    label: string;
    brokerPositionId: string;
    note: string;
  }>;
  performanceToday: GoldHunterPerformanceBucket;
  audit: Array<{ id: string; at: string; byUid: string; action: string; detail: string }>;
  signal: {
    present: boolean;
    setup: "A" | "B" | "C" | null;
    side: "BUY" | "SELL" | null;
    note: string;
  };
};
