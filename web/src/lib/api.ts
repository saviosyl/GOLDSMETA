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
}
