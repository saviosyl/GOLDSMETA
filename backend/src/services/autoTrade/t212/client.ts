/**
 * Trading 212 Invest Public API client — read-only equity/ETF surface.
 * Never logs credentials. Order-creation endpoints are not implemented here.
 */

import { redactSecrets } from "../redactSecrets";
import type { T212Environment } from "./types";

export const T212_PRACTICE_BASE = "https://demo.trading212.com/api/v0";
export const T212_LIVE_BASE = "https://live.trading212.com/api/v0";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_READ_RETRIES = 2;

export interface T212Credentials {
  apiKey: string;
  apiSecret: string;
}

export interface T212CashResponse {
  free?: number;
  total?: number;
  invested?: number;
  pieCash?: number;
  currency?: string;
}

export interface T212AccountResponse {
  id?: number | string;
  currencyCode?: string;
}

export interface T212PositionResponse {
  ticker?: string;
  quantity?: number;
  averagePrice?: number;
  currentPrice?: number;
  currency?: string;
  instrumentType?: string;
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
        await sleep(400 * (attempt + 1));
        return this.request<T>(path, init, attempt + 1);
      }

      if (res.status >= 500 && attempt < MAX_READ_RETRIES) {
        await sleep(300 * (attempt + 1));
        return this.request<T>(path, init, attempt + 1);
      }

      if (!res.ok) {
        let code = `HTTP_${res.status}`;
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
      return (await res.json()) as T;
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

  /** Authenticate by hitting a lightweight account endpoint. */
  async authenticate(): Promise<void> {
    await this.getCash();
    this.lastHeartbeatAt = new Date().toISOString();
  }

  async getAccount(): Promise<T212AccountResponse> {
    // Trading 212 equity account metadata endpoint (read-only).
    return this.request<T212AccountResponse>("/equity/account/info");
  }

  async getCash(): Promise<T212CashResponse> {
    return this.request<T212CashResponse>("/equity/account/cash");
  }

  async getPortfolio(): Promise<T212PositionResponse[]> {
    const data = await this.request<T212PositionResponse[] | { items?: T212PositionResponse[] }>(
      "/equity/portfolio"
    );
    if (Array.isArray(data)) return data;
    return data.items ?? [];
  }

  async getInstruments(): Promise<T212InstrumentResponse[]> {
    const data = await this.request<T212InstrumentResponse[] | { items?: T212InstrumentResponse[] }>(
      "/equity/metadata/instruments"
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
    const data = await this.request<unknown[] | { items?: unknown[] }>("/equity/orders");
    if (Array.isArray(data)) return data;
    return data.items ?? [];
  }

  async getHistoricalOrders(): Promise<unknown[]> {
    const data = await this.request<unknown[] | { items?: unknown[] }>("/equity/history/orders");
    if (Array.isArray(data)) return data;
    return data.items ?? [];
  }

  async heartbeat(): Promise<string> {
    await this.getCash();
    this.lastHeartbeatAt = new Date().toISOString();
    return this.lastHeartbeatAt;
  }
}
