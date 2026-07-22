/**
 * Trading 212 Paper/Live HTTP adapter.
 * Read-only methods are implemented. Order methods are scaffolded and blocked
 * by feature flags (both false in this delivery).
 * Automated tests must use FakeT212BrokerAdapter — never this class with real secrets.
 */

/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-base-to-string -- HTTP mapping of unknown JSON */

import { logger } from "../../logging/logger";
import {
  T212_LIVE_EXECUTION_FEATURE_FLAG,
  T212_PAPER_ORDER_SUBMISSION_ENABLED,
  type T212Environment
} from "../featureFlags";
import { redactSecrets } from "../redact";
import type {
  T212AccountSummary,
  T212BrokerAdapter,
  T212Instrument,
  T212Order,
  T212OrderRequest,
  T212OrderResult,
  T212Position
} from "./t212BrokerAdapter";
import { T212_ENDPOINTS, assertQuantitySign } from "./t212BrokerAdapter";

export interface T212CredentialBundle {
  apiKey: string;
  apiSecret: string;
}

export function loadT212CredentialsFromServerEnv(
  environment: T212Environment
): T212CredentialBundle | null {
  const prefix = environment === "LIVE" ? "T212_LIVE" : "T212_PAPER";
  const apiKey = process.env[`${prefix}_API_KEY`];
  const apiSecret = process.env[`${prefix}_API_SECRET`];
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret };
}

export interface T212HttpAdapterOptions {
  environment: T212Environment;
  fetchImpl?: typeof fetch;
  dryRun?: boolean;
}

export class T212HttpBrokerAdapter implements T212BrokerAdapter {
  readonly name = "t212";
  readonly environment: T212Environment;
  private connected = false;
  private credentials: T212CredentialBundle | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly dryRun: boolean;
  private lastHeartbeatAt: string | null = null;

  constructor(opts: T212HttpAdapterOptions) {
    this.environment = opts.environment;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.dryRun = opts.dryRun ?? true;
  }

  private baseUrl(): string {
    return this.environment === "LIVE" ? T212_ENDPOINTS.LIVE : T212_ENDPOINTS.PAPER;
  }

  async connect(credentialsRef: string): Promise<void> {
    if (this.environment === "LIVE" && !T212_LIVE_EXECUTION_FEATURE_FLAG) {
      // Read-only Live connect is still blocked until Live review — fail closed.
      throw new Error("T212_LIVE_CONNECTION_BLOCKED");
    }
    const loaded = loadT212CredentialsFromServerEnv(this.environment);
    if (!loaded) {
      logger.warn("T212 credentials not configured", {
        environment: this.environment,
        credentialsRef
      });
      throw new Error("T212_CREDENTIALS_NOT_CONFIGURED");
    }
    this.credentials = loaded;
    if (this.dryRun) {
      this.connected = true;
      this.lastHeartbeatAt = new Date().toISOString();
      return;
    }
    // Validate auth with a lightweight account read
    await this.t212Json("/equity/account/cash", "GET");
    this.connected = true;
    this.lastHeartbeatAt = new Date().toISOString();
    logger.info("T212 session established", {
      environment: this.environment,
      credentialsRef
    });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.credentials = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async heartbeat(): Promise<string> {
    this.requireConnected();
    if (!this.dryRun) {
      await this.t212Json("/equity/account/cash", "GET");
    }
    this.lastHeartbeatAt = new Date().toISOString();
    return this.lastHeartbeatAt;
  }

  async getAccountSummary(): Promise<T212AccountSummary> {
    this.requireConnected();
    if (this.dryRun) {
      return {
        environment: this.environment,
        cash: 0,
        availableToTrade: 0,
        totalValue: 0,
        currency: "EUR"
      };
    }
    const cash = await this.t212Json<Record<string, unknown>>("/equity/account/cash", "GET");
    return {
      environment: this.environment,
      cash: Number(cash.cash ?? cash.total ?? 0),
      availableToTrade: Number(cash.availableToTrade ?? cash.free ?? 0),
      totalValue: Number(cash.total ?? cash.cash ?? 0),
      currency: String(cash.currency ?? "EUR")
    };
  }

  async listInstruments(query?: string): Promise<T212Instrument[]> {
    this.requireConnected();
    if (this.dryRun) return [];
    const path = query
      ? `/equity/metadata/instruments?ticker=${encodeURIComponent(query)}`
      : "/equity/metadata/instruments";
    const data = await this.t212Json<unknown>(path, "GET");
    const rows = Array.isArray(data) ? data : [];
    return rows.map((row) => mapInstrument(row as Record<string, unknown>));
  }

  async listExchanges(): Promise<string[]> {
    this.requireConnected();
    if (this.dryRun) return [];
    const data = await this.t212Json<unknown>("/equity/metadata/exchanges", "GET");
    if (!Array.isArray(data)) return [];
    return data.map((row) =>
      typeof row === "string"
        ? row
        : String((row as { name?: string }).name ?? (row as { code?: string }).code ?? "")
    );
  }

  async getPositions(): Promise<T212Position[]> {
    this.requireConnected();
    if (this.dryRun) return [];
    const data = await this.t212Json<unknown>("/equity/portfolio", "GET");
    const rows = Array.isArray(data) ? data : [];
    return rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        ticker: String(r.ticker ?? r.symbol ?? ""),
        quantity: Number(r.quantity ?? 0),
        averagePrice: Number(r.averagePricePaid ?? r.averagePrice ?? 0),
        currentPrice: r.currentPrice != null ? Number(r.currentPrice) : null,
        pnl: r.ppl != null ? Number(r.ppl) : r.pnl != null ? Number(r.pnl) : null
      };
    });
  }

  async getPendingOrders(): Promise<T212Order[]> {
    this.requireConnected();
    if (this.dryRun) return [];
    const data = await this.t212Json<unknown>("/equity/orders", "GET");
    const rows = Array.isArray(data) ? data : [];
    return rows.map((row) => mapOrder(row as Record<string, unknown>));
  }

  async getOrder(orderId: string): Promise<T212Order | null> {
    this.requireConnected();
    if (this.dryRun) return null;
    const data = await this.t212Json<Record<string, unknown>>(
      `/equity/orders/${encodeURIComponent(orderId)}`,
      "GET"
    );
    return mapOrder(data);
  }

  async listHistoricalOrders(limit = 50): Promise<T212Order[]> {
    this.requireConnected();
    if (this.dryRun) return [];
    const data = await this.t212Json<unknown>(`/equity/history/orders?limit=${limit}`, "GET");
    const rows = Array.isArray(data) ? data : [];
    return rows.map((row) => mapOrder(row as Record<string, unknown>));
  }

  async placeMarketOrder(request: T212OrderRequest): Promise<T212OrderResult> {
    return this.submitOrder(request, "MARKET");
  }

  async placeLimitOrder(request: T212OrderRequest): Promise<T212OrderResult> {
    return this.submitOrder(request, "LIMIT");
  }

  async placeStopOrder(request: T212OrderRequest): Promise<T212OrderResult> {
    return this.submitOrder(request, "STOP");
  }

  async placeStopLimitOrder(request: T212OrderRequest): Promise<T212OrderResult> {
    return this.submitOrder(request, "STOP_LIMIT");
  }

  async cancelOrder(orderId: string): Promise<T212OrderResult> {
    this.requireConnected();
    this.assertOrderSubmissionAllowed();
    if (this.dryRun) {
      return {
        accepted: false,
        orderId,
        status: "REJECTED",
        reason: "dry-run",
        rawRedacted: { dryRun: true }
      };
    }
    await this.t212Json(`/equity/orders/${encodeURIComponent(orderId)}`, "DELETE");
    return {
      accepted: true,
      orderId,
      status: "CANCELLED",
      reason: null,
      rawRedacted: { cancelled: true }
    };
  }

  private async submitOrder(
    request: T212OrderRequest,
    type: T212Order["type"]
  ): Promise<T212OrderResult> {
    this.requireConnected();
    this.assertOrderSubmissionAllowed();
    const side = request.quantity > 0 ? "BUY" : "SELL";
    assertQuantitySign(request.quantity, side);

    if (this.dryRun) {
      return {
        accepted: false,
        orderId: null,
        status: "REJECTED",
        reason: "T212 adapter dry-run; no order sent.",
        rawRedacted: { dryRun: true, type }
      };
    }

    // Host isolation: never switch PAPER <-> LIVE
    const endpoint =
      type === "MARKET"
        ? "/equity/orders/market"
        : type === "LIMIT"
          ? "/equity/orders/limit"
          : type === "STOP"
            ? "/equity/orders/stop"
            : "/equity/orders/stop_limit";

    try {
      const data = await this.t212Json<Record<string, unknown>>(endpoint, "POST", {
        ticker: request.ticker,
        quantity: request.quantity,
        limitPrice: request.limitPrice,
        stopPrice: request.stopPrice,
        timeValidity: request.timeInForce ?? "DAY"
      });
      return {
        accepted: true,
        orderId: data.id != null ? String(data.id) : null,
        status: "PENDING",
        reason: null,
        rawRedacted: redactSecrets({ id: data.id, status: "SUBMITTED", type })
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "T212_ORDER_FAILED";
      if (message === "T212_HTTP_TIMEOUT") {
        return {
          accepted: false,
          orderId: null,
          status: "UNKNOWN",
          reason: "HTTP timeout after submit — reconciliation required; do not retry blindly.",
          rawRedacted: { status: "UNKNOWN" }
        };
      }
      return {
        accepted: false,
        orderId: null,
        status: "REJECTED",
        reason: message,
        rawRedacted: redactSecrets({ status: "REJECTED", reason: message })
      };
    }
  }

  private assertOrderSubmissionAllowed(): void {
    if (this.environment === "LIVE") {
      if (!T212_LIVE_EXECUTION_FEATURE_FLAG) {
        throw new Error("T212_LIVE_EXECUTION_DISABLED");
      }
      throw new Error("T212_LIVE_ORDER_HARD_BLOCKED");
    }
    if (!T212_PAPER_ORDER_SUBMISSION_ENABLED) {
      throw new Error("T212_PAPER_ORDER_SUBMISSION_DISABLED");
    }
  }

  private requireConnected(): void {
    if (!this.connected || !this.credentials) throw new Error("NOT_CONNECTED");
  }

  private async t212Json<T>(
    path: string,
    method: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const creds = this.credentials;
    if (!creds) throw new Error("NOT_CONNECTED");
    const auth = Buffer.from(`${creds.apiKey}:${creds.apiSecret}`).toString("base64");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await this.fetchImpl(`${this.baseUrl()}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      const remaining = res.headers.get("x-ratelimit-remaining");
      if (remaining != null) {
        logger.info("T212 rate-limit remaining", {
          remaining,
          path,
          environment: this.environment
        });
      }

      if (res.status === 429) {
        throw new Error("T212_HTTP_429");
      }
      if (!res.ok) {
        throw new Error(`T212_HTTP_${res.status}`);
      }
      if (res.status === 204) return {} as T;
      return (await res.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("T212_HTTP_TIMEOUT");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function mapInstrument(row: Record<string, unknown>): T212Instrument {
  const typeRaw = String(row.type ?? row.instrumentType ?? "").toUpperCase();
  const type =
    typeRaw.includes("ETF")
      ? "ETF"
      : typeRaw.includes("STOCK") || typeRaw === "EQUITY"
        ? "STOCK"
        : typeRaw
          ? "OTHER"
          : "OTHER";
  const minRaw = row.minTradeQuantity ?? row.extendedHoursMinTradeQuantity;
  const minTradeQuantity =
    minRaw != null && Number.isFinite(Number(minRaw)) && Number(minRaw) > 0
      ? Number(minRaw)
      : NaN;
  return {
    ticker: String(row.ticker ?? row.symbol ?? ""),
    name: String(row.name ?? row.ticker ?? ""),
    type,
    currency: String(row.currencyCode ?? row.currency ?? ""),
    exchange: String(row.exchangeName ?? row.exchange ?? ""),
    minTradeQuantity,
    maxOpenQuantity: row.maxOpenQuantity != null ? Number(row.maxOpenQuantity) : null,
    extendedHoursAllowed: Boolean(row.extendedHoursAllowed ?? false),
    tradable: row.workingScheduleId != null || row.addedOn != null ? true : Boolean(row.tradable ?? true),
    suspended: Boolean(row.suspended ?? false)
    // Official Trading 212 instrument metadata has no currentPrice/lastPrice.
    // Do not read undocumented price fields from this response.
  };
}

/** Test-only export for documented-schema contract tests. */
export function mapInstrumentForTests(row: Record<string, unknown>): T212Instrument {
  return mapInstrument(row);
}

function mapOrder(row: Record<string, unknown>): T212Order {
  const qty = Number(row.quantity ?? 0);
  return {
    id: String(row.id ?? row.orderId ?? ""),
    ticker: String(row.ticker ?? ""),
    quantity: qty,
    side: qty >= 0 ? "BUY" : "SELL",
    type: mapOrderType(String(row.type ?? "MARKET")),
    limitPrice: row.limitPrice != null ? Number(row.limitPrice) : null,
    stopPrice: row.stopPrice != null ? Number(row.stopPrice) : null,
    status: mapOrderStatus(String(row.status ?? "UNKNOWN")),
    filledQuantity: Number(row.filledQuantity ?? 0),
    averageFillPrice: row.fillPrice != null ? Number(row.fillPrice) : null,
    createdAt: String(row.createdAt ?? row.dateCreated ?? new Date().toISOString())
  };
}

function mapOrderType(type: string): T212Order["type"] {
  const t = type.toUpperCase();
  if (t.includes("STOP_LIMIT") || t === "STOP_LIMIT") return "STOP_LIMIT";
  if (t.includes("STOP")) return "STOP";
  if (t.includes("LIMIT")) return "LIMIT";
  return "MARKET";
}

function mapOrderStatus(status: string): T212Order["status"] {
  const s = status.toUpperCase();
  if (s.includes("FILL") && s.includes("PARTIAL")) return "PARTIAL";
  if (s.includes("FILL")) return "FILLED";
  if (s.includes("CANCEL")) return "CANCELLED";
  if (s.includes("REJECT")) return "REJECTED";
  if (s.includes("QUEUE")) return "QUEUED";
  if (s.includes("PEND") || s.includes("NEW")) return "PENDING";
  return "UNKNOWN";
}
