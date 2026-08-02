import type {
  ApiErrorBody,
  BackendSettings,
  Decision,
  HealthResponse,
  JournalEntry,
  JournalTag,
  ManualExecutionAction,
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
  private readonly getIdToken: TokenProvider;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.getIdToken = options.getIdToken;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    auth = true,
    retried = false
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

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers
    });

    if (response.status === 401 && auth && !retried) {
      return this.request<T>(path, init, auth, true);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    if (!response.ok) {
      throw await parseError(response);
    }

    return (await response.json()) as T;
  }

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health", {}, false);
  }

  async latestDecision(): Promise<Decision | null> {
    try {
      const body = await this.request<{ decision: Decision }>("/v1/decisions/latest");
      return body.decision;
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
    return this.request("/v1/brokers/control-centre");
  }

  async getCTraderStatus(): Promise<unknown> {
    return this.request("/v1/ctrader/status");
  }

  async getCTraderDemonstration(): Promise<
    import("./broker/ctraderTypes").CTraderDemonstrationBundle
  > {
    return this.request("/v1/ctrader/demonstration");
  }

  async startCTraderOAuth(): Promise<{
    authorizationUrl: string;
    state: string;
    expiresAt: string;
    environment: "DEMO" | "LIVE";
  }> {
    return this.request("/v1/ctrader/oauth/start", { method: "POST", body: "{}" });
  }

  async listCTraderDemoAccounts(): Promise<{
    accounts: import("./broker/ctraderTypes").CTraderBrokerAccountOption[];
    autoSelected?: {
      accountIdMasked: string;
      brokerNameTitle: string | null;
      accountType?: "Demo" | "Live";
    } | null;
  }> {
    return this.request("/v1/ctrader/accounts");
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
    return this.request("/v1/ctrader/accounts/select", {
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
    return this.request(`/v1/ctrader/autotrade-settings/${environment}`);
  }

  async saveAutoTradeSettings(
    environment: "demo" | "live",
    patch: Record<string, unknown>
  ): Promise<{ settings: import("./broker/ctraderTypes").UserAutoTradeSettingsDto }> {
    return this.request(`/v1/ctrader/autotrade-settings/${environment}`, {
      method: "PUT",
      body: JSON.stringify(patch)
    });
  }

  async confirmLiveAutoTradeActivation(phrase: string): Promise<unknown> {
    return this.request("/v1/ctrader/live-activation/confirm", {
      method: "POST",
      body: JSON.stringify({ phrase })
    });
  }

  async setCTraderEmergencyStop(payload: {
    environment: "demo" | "live";
    active?: boolean;
  }): Promise<unknown> {
    return this.request("/v1/ctrader/emergency-stop", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async disconnectCTrader(): Promise<{ disconnected: boolean }> {
    return this.request("/v1/ctrader/disconnect", { method: "POST", body: "{}" });
  }

  async getCTraderDiagnostics(): Promise<
    import("./broker/ctraderTypes").CTraderDiagnosticsReport
  > {
    return this.request("/v1/ctrader/diagnostics");
  }

  async getCTraderQuote(): Promise<{
    quote: {
      bid: number | null;
      ask: number | null;
      spread: number | null;
      timestamp?: string;
      marketStatus?: string;
      stale?: boolean;
    };
    label: string;
  }> {
    return this.request("/v1/ctrader/quote");
  }

  async createCTraderPreview(payload: Record<string, unknown>): Promise<unknown> {
    return this.request("/v1/ctrader/preview", {
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
}
