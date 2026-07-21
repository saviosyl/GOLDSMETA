import type {
  ApiErrorBody,
  BackendSettings,
  Decision,
  HealthResponse,
  JournalEntry,
  TradingViewConnection,
  WebPushSubscriptionPayload
} from "../types/models";
import { ApiError } from "../types/models";

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

  async getSettings(): Promise<BackendSettings> {
    const body = await this.request<{ settings: BackendSettings }>("/v1/settings");
    return body.settings;
  }

  async updateSettings(patch: Partial<BackendSettings>): Promise<BackendSettings> {
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
    direction: Decision["decision"];
    outcome?: string;
    notes?: string;
    riskReward?: number | null;
  }): Promise<JournalEntry> {
    const body = await this.request<{ entry: JournalEntry }>("/v1/journal", {
      method: "POST",
      body: JSON.stringify({ symbol: "XAUUSD", outcome: "OPEN", ...entry })
    });
    return body.entry;
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
}
