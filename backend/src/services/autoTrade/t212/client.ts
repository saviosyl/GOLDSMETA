/**
 * Trading 212 Invest Public API client — read-only equity/ETF surface.
 * Endpoints aligned to official docs: https://docs.trading212.com/api
 * Never logs credentials. Order-creation endpoints are not implemented here.
 */

import { redactSecrets } from "../redactSecrets";
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

/** Explicitly NOT implemented — order placement surface. */
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
  /** Present on some catalogue payloads; not guaranteed by docs summary. */
  workingScheduleId?: number;
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
      // Unix timestamp (seconds)
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

  constructor(
    private readonly environment: T212Environment,
    private readonly credentials: T212Credentials,
    opts?: { fetchImpl?: typeof fetch; timeoutMs?: number }
  ) {
    this.fetchImpl = opts?.fetchImpl ?? fetch;
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  getEnvironment(): T212Environment {
    return this.environment;
  }

  getLastHeartbeatAt(): string | null {
    return this.lastHeartbeatAt;
  }

  private url(path: string): string {
    return `${t212BaseUrl(this.environment)}${path}`;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    attempt = 0
  ): Promise<T> {
    // Fail closed: never allow order-create paths through this client.
    if (T212_ORDER_CREATE_PATHS.some((p) => path.startsWith(p))) {
      throw new T212ApiError("T212_ORDER_ENDPOINT_BLOCKED", 403, "ORDER_ENDPOINT_BLOCKED");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.url(path), {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: authHeader(this.credentials),
          ...(init.headers ?? {})
        }
      });

      if (res.status === 429 && attempt < MAX_READ_RETRIES) {
        await sleep(parseRetryAfterMs(res, attempt));
        return this.request<T>(path, init, attempt + 1);
      }

      if (res.status >= 500 && attempt < MAX_READ_RETRIES) {
        await sleep(300 * (attempt + 1));
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

  /** Authenticate by hitting the official account summary endpoint. */
  async authenticate(): Promise<void> {
    await this.getAccountSummary();
    this.lastHeartbeatAt = new Date().toISOString();
  }

  /** Official: GET /equity/account/summary */
  async getAccountSummary(): Promise<T212AccountSummaryResponse> {
    return this.request<T212AccountSummaryResponse>(T212_READ_PATHS.accountSummary);
  }

  /**
   * Compatibility helper mapping official summary → cash-like shape used by diagnostics.
   * Does not call undocumented /equity/account/cash.
   */
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

  /**
   * Compatibility helper for account id/currency from official summary.
   * Does not call undocumented /equity/account/info.
   */
  async getAccount(): Promise<T212AccountResponse> {
    const summary = await this.getAccountSummary();
    return {
      id: summary.id,
      currencyCode: summary.currency
    };
  }

  /** Official: GET /equity/positions */
  async getPositions(): Promise<T212PositionResponse[]> {
    const data = await this.request<T212PositionResponse[] | { items?: T212PositionResponse[] }>(
      T212_READ_PATHS.positions
    );
    if (Array.isArray(data)) return data;
    return data.items ?? [];
  }

  /**
   * Alias used by existing diagnostics — maps to official positions endpoint.
   * Does not call undocumented /equity/portfolio.
   */
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

  async getOrders(): Promise<unknown[]> {
    const data = await this.request<unknown[] | { items?: unknown[] }>(
      T212_READ_PATHS.pendingOrders
    );
    if (Array.isArray(data)) return data;
    return data.items ?? [];
  }

  /**
   * Official historical orders — first page only (cursor pagination via nextPagePath
   * is not fully walked in this read-only stage).
   */
  async getHistoricalOrders(): Promise<unknown[]> {
    const data = await this.request<unknown[] | { items?: unknown[]; nextPagePath?: string | null }>(
      `${T212_READ_PATHS.historicalOrders}?limit=20`
    );
    if (Array.isArray(data)) return data;
    return data.items ?? [];
  }

  /** Heartbeat is application-level: re-fetch official account summary and stamp time. */
  async heartbeat(): Promise<string> {
    await this.getAccountSummary();
    this.lastHeartbeatAt = new Date().toISOString();
    return this.lastHeartbeatAt;
  }
}
