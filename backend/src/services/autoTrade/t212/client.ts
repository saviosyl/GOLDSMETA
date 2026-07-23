/**
 * Trading 212 Invest Public API client — strict allowlist HTTP surface.
 * Endpoints aligned to official docs: https://docs.trading212.com/api
 * Never logs credentials. Never accepts caller base URL or Authorization.
 */

import { isPracticeOrderSubmissionAllowed } from "../executionFlags";
import { redactSecrets } from "../redactSecrets";
import {
  assertT212RequestAllowed,
  normalizeT212Path,
  type T212HttpMethod
} from "./allowlist";
import type { T212Environment } from "./types";

export const T212_PRACTICE_BASE = "https://demo.trading212.com/api/v0";
export const T212_LIVE_BASE = "https://live.trading212.com/api/v0";

/** Official documented read endpoints used by this client. */
export const T212_READ_PATHS = {
  accountSummary: "/equity/account/summary",
  positions: "/equity/positions",
  instruments: "/equity/metadata/instruments",
  exchanges: "/equity/metadata/exchanges",
  pendingOrders: "/equity/orders",
  historicalOrders: "/equity/history/orders"
} as const;

/** Explicit create-order paths — only market POST is gated via mutationsEnabled. */
export const T212_ORDER_CREATE_PATHS = [
  "/equity/orders/limit",
  "/equity/orders/market",
  "/equity/orders/stop",
  "/equity/orders/stop_limit"
] as const;

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_READ_RETRIES = 2;

export interface T212Credentials {
  apiKey: string;
  apiSecret: string;
}

/** Official GET /equity/account/summary response (subset). */
export interface T212AccountSummaryResponse {
  id?: number | string;
  currency?: string;
  totalValue?: number;
  cash?: {
    availableToTrade?: number;
    inPies?: number;
    reservedForOrders?: number;
  };
  investments?: {
    currentValue?: number;
    realizedProfitLoss?: number;
    totalCost?: number;
    unrealizedProfitLoss?: number;
  };
}

/** @deprecated Prefer T212AccountSummaryResponse — kept for test/fixture aliases. */
export type T212CashResponse = {
  free?: number;
  total?: number;
  invested?: number;
  pieCash?: number;
  currency?: string;
};

export interface T212AccountResponse {
  id?: number | string;
  currencyCode?: string;
}

/** Official GET /equity/positions item (subset). */
export interface T212PositionResponse {
  ticker?: string;
  quantity?: number;
  averagePrice?: number;
  averagePricePaid?: number;
  currentPrice?: number;
  currency?: string;
  instrumentType?: string;
  quantityAvailableForTrading?: number;
  instrument?: {
    ticker?: string;
    name?: string;
    isin?: string;
    currency?: string;
  };
}

export interface T212InstrumentResponse {
  ticker?: string;
  name?: string;
  isin?: string;
  currencyCode?: string;
  type?: string;
  shortName?: string;
  maxOpenQuantity?: number;
  minTradeQuantity?: number;
  addedOn?: string;
  workingScheduleId?: number;
  /** Not guaranteed — treat null as unknown, never guess. */
  extendedHours?: boolean;
}

export interface T212ExchangeTimeEvent {
  date?: string;
  type?: string;
}

export interface T212WorkingSchedule {
  id?: number | string;
  timeEvents?: T212ExchangeTimeEvent[];
  open?: boolean;
  openFrom?: string;
  openTo?: string;
}

export interface T212ExchangeResponse {
  id?: number | string;
  workingScheduleId?: number | string;
  open?: boolean;
  openFrom?: string;
  openTo?: string;
  name?: string;
  /** Nested schedules — instrument.workingScheduleId matches workingSchedules[].id */
  workingSchedules?: T212WorkingSchedule[];
}

export interface T212OrderResponse {
  id?: number | string;
  ticker?: string;
  quantity?: number;
  filledQuantity?: number;
  status?: string;
  averagePricePaid?: number;
  type?: string;
  currency?: string;
}

export interface T212PlaceMarketOrderInput {
  ticker: string;
  /** Positive for BUY, negative for SELL per T212 API. */
  quantity: number;
}

export class T212ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = "T212ApiError";
  }
}

export function t212BaseUrl(environment: T212Environment): string {
  return environment === "LIVE" ? T212_LIVE_BASE : T212_PRACTICE_BASE;
}

export function loadT212CredentialsFromServerEnv(
  environment: T212Environment,
  source: NodeJS.ProcessEnv = process.env
): T212Credentials | null {
  const prefix = environment === "LIVE" ? "T212_LIVE" : "T212_DEMO";
  const apiKey = (source[`${prefix}_API_KEY`] ?? "").trim();
  const apiSecret = (source[`${prefix}_API_SECRET`] ?? "").trim();
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret };
}

function authHeader(creds: T212Credentials): string {
  const token = Buffer.from(`${creds.apiKey}:${creds.apiSecret}`).toString("base64");
  return `Basic ${token}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfterMs(res: Response, attempt: number): number {
  const reset = res.headers.get("x-ratelimit-reset");
  if (reset) {
    const resetSec = Number(reset);
    if (Number.isFinite(resetSec) && resetSec > 1_000_000_000) {
      return Math.min(Math.max(0, resetSec * 1000 - Date.now()), 15_000);
    }
    if (Number.isFinite(resetSec) && resetSec > 0 && resetSec < 120) {
      return Math.min(resetSec * 1000, 15_000);
    }
  }
  return 400 * (attempt + 1);
}

export class T212InvestClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private lastHeartbeatAt: string | null = null;
  /** When true, Practice mutations (market POST / owned DELETE) may pass allowlist. */
  private readonly mutationsEnabled: boolean;

  constructor(
    private readonly environment: T212Environment,
    private readonly credentials: T212Credentials,
    opts?: {
      fetchImpl?: typeof fetch;
      timeoutMs?: number;
      /** Override; defaults to runtime practice-order allowance. */
      mutationsEnabled?: boolean;
    }
  ) {
    this.fetchImpl = opts?.fetchImpl ?? fetch;
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.mutationsEnabled =
      opts?.mutationsEnabled ??
      (environment === "PRACTICE" && isPracticeOrderSubmissionAllowed());
  }

  getEnvironment(): T212Environment {
    return this.environment;
  }

  getLastHeartbeatAt(): string | null {
    return this.lastHeartbeatAt;
  }

  areMutationsEnabled(): boolean {
    return this.mutationsEnabled;
  }

  private url(path: string): string {
    if (this.environment === "LIVE") {
      throw new T212ApiError("T212_LIVE_HOST_LOCKED", 403, "T212_LIVE_HOST_LOCKED");
    }
    return `${T212_PRACTICE_BASE}${path}`;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    attempt = 0
  ): Promise<T> {
    const method = String(init.method ?? "GET").toUpperCase() as T212HttpMethod;
    const bare = normalizeT212Path(path);

    // Reject caller-supplied auth/base if somehow present on init (defense in depth).
    const headersIn = (init.headers ?? {}) as Record<string, string>;
    const allow = assertT212RequestAllowed({
      method,
      path: bare,
      environment: this.environment,
      mutationsEnabled: this.mutationsEnabled,
      requestedBaseUrl: null,
      requestedAuthorization: headersIn.Authorization ?? headersIn.authorization ?? null
    });
    if (!allow.ok) {
      throw new T212ApiError(allow.message, 403, allow.code);
    }

    // Strip any caller Authorization — server secrets only.
    const safeHeaders: Record<string, string> = { Accept: "application/json" };
    for (const [k, v] of Object.entries(headersIn)) {
      if (k.toLowerCase() === "authorization") continue;
      if (k.toLowerCase() === "host") continue;
      safeHeaders[k] = v;
    }
    safeHeaders.Authorization = authHeader(this.credentials);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.url(path), {
        ...init,
        method,
        signal: controller.signal,
        headers: safeHeaders
      });

      const retryable =
        method === "GET" &&
        (res.status === 429 || res.status >= 500) &&
        attempt < MAX_READ_RETRIES;
      if (retryable) {
        await sleep(
          res.status === 429
            ? parseRetryAfterMs(res, attempt)
            : 300 * (attempt + 1)
        );
        return this.request<T>(path, init, attempt + 1);
      }

      if (!res.ok) {
        let code =
          res.status === 401
            ? "UNAUTHORIZED"
            : res.status === 403
              ? "FORBIDDEN"
              : res.status === 429
                ? "RATE_LIMITED"
                : res.status === 408
                  ? "TIMEOUT"
                  : res.status >= 500
                    ? "SERVER_ERROR"
                    : `HTTP_${res.status}`;
        try {
          const body = (await res.json()) as { code?: string; errorCode?: string };
          code = body.code ?? body.errorCode ?? code;
        } catch {
          await res.arrayBuffer().catch(() => undefined);
        }
        throw new T212ApiError("T212_REQUEST_FAILED", res.status, code);
      }

      if (res.status === 204) {
        return undefined as T;
      }
      try {
        return (await res.json()) as T;
      } catch {
        throw new T212ApiError("T212_MALFORMED_RESPONSE", res.status, "MALFORMED_RESPONSE");
      }
    } catch (error) {
      if (error instanceof T212ApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new T212ApiError("T212_TIMEOUT", 408, "TIMEOUT");
      }
      throw new T212ApiError(
        redactSecrets(error instanceof Error ? error.message : "T212_NETWORK_ERROR"),
        0,
        "NETWORK"
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async authenticate(): Promise<void> {
    await this.getAccountSummary();
    this.lastHeartbeatAt = new Date().toISOString();
  }

  async getAccountSummary(): Promise<T212AccountSummaryResponse> {
    return this.request<T212AccountSummaryResponse>(T212_READ_PATHS.accountSummary);
  }

  async getCash(): Promise<T212CashResponse> {
    const summary = await this.getAccountSummary();
    return {
      free: summary.cash?.availableToTrade,
      total: summary.totalValue,
      invested: summary.investments?.currentValue,
      pieCash: summary.cash?.inPies,
      currency: summary.currency
    };
  }

  async getAccount(): Promise<T212AccountResponse> {
    const summary = await this.getAccountSummary();
    return {
      id: summary.id,
      currencyCode: summary.currency
    };
  }

  async getPositions(): Promise<T212PositionResponse[]> {
    const data = await this.request<T212PositionResponse[] | { items?: T212PositionResponse[] }>(
      T212_READ_PATHS.positions
    );
    if (Array.isArray(data)) return data;
    return data.items ?? [];
  }

  async getPortfolio(): Promise<T212PositionResponse[]> {
    return this.getPositions();
  }

  async getInstruments(): Promise<T212InstrumentResponse[]> {
    const data = await this.request<T212InstrumentResponse[] | { items?: T212InstrumentResponse[] }>(
      T212_READ_PATHS.instruments
    );
    if (Array.isArray(data)) return data;
    return data.items ?? [];
  }

  async getExchanges(): Promise<T212ExchangeResponse[]> {
    const data = await this.request<T212ExchangeResponse[] | { items?: T212ExchangeResponse[] }>(
      T212_READ_PATHS.exchanges
    );
    if (Array.isArray(data)) return data;
    return data.items ?? [];
  }

  async searchInstruments(query: string): Promise<T212InstrumentResponse[]> {
    const q = query.trim().toLowerCase();
    const all = await this.getInstruments();
    if (!q) return all.slice(0, 50);
    return all
      .filter((i) => {
        const hay = `${i.ticker ?? ""} ${i.name ?? ""} ${i.isin ?? ""} ${i.shortName ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 50);
  }

  async getOrders(): Promise<T212OrderResponse[]> {
    const data = await this.request<T212OrderResponse[] | { items?: T212OrderResponse[] }>(
      T212_READ_PATHS.pendingOrders
    );
    if (Array.isArray(data)) return data;
    return data.items ?? [];
  }

  async getOrder(orderId: string): Promise<T212OrderResponse> {
    const id = encodeURIComponent(String(orderId));
    return this.request<T212OrderResponse>(`/equity/orders/${id}`);
  }

  async getHistoricalOrders(): Promise<T212OrderResponse[]> {
    const data = await this.request<
      T212OrderResponse[] | { items?: T212OrderResponse[]; nextPagePath?: string | null }
    >(`${T212_READ_PATHS.historicalOrders}?limit=20`);
    if (Array.isArray(data)) return data;
    return data.items ?? [];
  }

  /**
   * Practice market order — only when mutationsEnabled (order preview runtime).
   * Quantity must already be server-validated; SELL uses negative quantity.
   */
  async placeMarketOrder(input: T212PlaceMarketOrderInput): Promise<T212OrderResponse> {
    if (this.environment !== "PRACTICE") {
      throw new T212ApiError("T212_LIVE_HOST_LOCKED", 403, "T212_LIVE_HOST_LOCKED");
    }
    if (!this.mutationsEnabled) {
      throw new T212ApiError("T212_MUTATION_DISABLED", 403, "T212_MUTATION_DISABLED");
    }
    if (!input.ticker || !Number.isFinite(input.quantity) || input.quantity === 0) {
      throw new T212ApiError("INVALID_ORDER_QUANTITY", 400, "INVALID_ORDER_QUANTITY");
    }
    return this.request<T212OrderResponse>("/equity/orders/market", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticker: input.ticker,
        quantity: input.quantity
      })
    });
  }

  /**
   * Cancel a GoldMeta-created Practice order by id only.
   * Caller must verify ownership before invoking.
   */
  async cancelOrder(orderId: string): Promise<void> {
    if (this.environment !== "PRACTICE") {
      throw new T212ApiError("T212_LIVE_HOST_LOCKED", 403, "T212_LIVE_HOST_LOCKED");
    }
    if (!this.mutationsEnabled) {
      throw new T212ApiError("T212_MUTATION_DISABLED", 403, "T212_MUTATION_DISABLED");
    }
    const id = encodeURIComponent(String(orderId));
    await this.request<void>(`/equity/orders/${id}`, { method: "DELETE" });
  }

  async heartbeat(): Promise<string> {
    await this.getAccountSummary();
    this.lastHeartbeatAt = new Date().toISOString();
    return this.lastHeartbeatAt;
  }
}
