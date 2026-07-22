/**
 * Fake Trading 212 adapter for automated tests — never contacts T212.
 */

/* eslint-disable @typescript-eslint/require-await -- sync fake adapter */

import { nowIso } from "../../../utils/time";
import {
  T212_PAPER_ORDER_SUBMISSION_ENABLED,
  T212_LIVE_EXECUTION_FEATURE_FLAG,
  type T212Environment
} from "../featureFlags";
import type {
  T212AccountSummary,
  T212BrokerAdapter,
  T212Instrument,
  T212Order,
  T212OrderRequest,
  T212OrderResult,
  T212Position
} from "./t212BrokerAdapter";
import { assertQuantitySign } from "./t212BrokerAdapter";

export type FakeT212Scenario =
  | "happy"
  | "auth_fail"
  | "missing_instrument"
  | "rate_limited"
  | "timeout_unknown"
  | "partial_fill"
  | "reject_order";

export class FakeT212BrokerAdapter implements T212BrokerAdapter {
  readonly name = "fake-t212";
  readonly environment: T212Environment;
  private connected = false;
  private scenario: FakeT212Scenario;
  private account: T212AccountSummary;
  private positions: T212Position[] = [];
  private orders: T212Order[] = [];
  private instruments: T212Instrument[];

  constructor(opts: { environment?: T212Environment; scenario?: FakeT212Scenario } = {}) {
    this.environment = opts.environment ?? "PAPER";
    this.scenario = opts.scenario ?? "happy";
    this.account = {
      environment: this.environment,
      cash: 2500,
      availableToTrade: 2000,
      totalValue: 3200,
      currency: "EUR"
    };
    const mk = (
      ticker: string,
      name: string,
      type: T212Instrument["type"],
      exchange: string,
      currentPrice: number,
      minTradeQuantity = 0.001
    ): T212Instrument => ({
      ticker,
      name,
      type,
      currency: "USD",
      exchange,
      minTradeQuantity,
      maxOpenQuantity: null,
      extendedHoursAllowed: false,
      tradable: true,
      suspended: false,
      currentPrice
    });
    this.instruments = [
      mk("AAPL", "Apple Inc", "STOCK", "NASDAQ", 180),
      mk("MSFT", "Microsoft", "STOCK", "NASDAQ", 180),
      mk("NVDA", "NVIDIA", "STOCK", "NASDAQ", 180),
      mk("AMZN", "Amazon", "STOCK", "NASDAQ", 180),
      mk("META", "Meta Platforms", "STOCK", "NASDAQ", 180),
      mk("GOOGL", "Alphabet", "STOCK", "NASDAQ", 180),
      mk("SPY", "SPDR S&P 500 ETF", "ETF", "NYSE", 180),
      mk("QQQ", "Invesco QQQ", "ETF", "NASDAQ", 180),
      mk("XAUUSD.CFD", "Gold CFD", "OTHER", "CFD", 2300, 0.1)
    ];
  }

  setScenario(scenario: FakeT212Scenario): void {
    this.scenario = scenario;
  }

  seedPosition(position: T212Position): void {
    this.positions.push(position);
  }

  async connect(_credentialsRef: string): Promise<void> {
    if (this.scenario === "auth_fail") throw new Error("T212_AUTH_FAILED");
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async heartbeat(): Promise<string> {
    this.requireConnected();
    if (this.scenario === "rate_limited") throw new Error("T212_HTTP_429");
    return nowIso();
  }

  async getAccountSummary(): Promise<T212AccountSummary> {
    this.requireConnected();
    return { ...this.account };
  }

  async listInstruments(query?: string): Promise<T212Instrument[]> {
    this.requireConnected();
    if (!query) return this.instruments.map((i) => ({ ...i }));
    const q = query.toUpperCase();
    return this.instruments.filter((i) => i.ticker.includes(q) || i.name.toUpperCase().includes(q));
  }

  async listExchanges(): Promise<string[]> {
    this.requireConnected();
    return ["NASDAQ", "NYSE"];
  }

  async getPositions(): Promise<T212Position[]> {
    this.requireConnected();
    return this.positions.map((p) => ({ ...p }));
  }

  async getPendingOrders(): Promise<T212Order[]> {
    this.requireConnected();
    return this.orders.filter((o) => o.status === "PENDING" || o.status === "QUEUED");
  }

  async getOrder(orderId: string): Promise<T212Order | null> {
    this.requireConnected();
    return this.orders.find((o) => o.id === orderId) ?? null;
  }

  async listHistoricalOrders(limit = 50): Promise<T212Order[]> {
    this.requireConnected();
    return this.orders.slice(0, limit);
  }

  async placeMarketOrder(request: T212OrderRequest): Promise<T212OrderResult> {
    return this.place(request, "MARKET");
  }

  async placeLimitOrder(request: T212OrderRequest): Promise<T212OrderResult> {
    return this.place(request, "LIMIT");
  }

  async placeStopOrder(request: T212OrderRequest): Promise<T212OrderResult> {
    return this.place(request, "STOP");
  }

  async placeStopLimitOrder(request: T212OrderRequest): Promise<T212OrderResult> {
    return this.place(request, "STOP_LIMIT");
  }

  async cancelOrder(orderId: string): Promise<T212OrderResult> {
    this.requireConnected();
    this.assertSubmissionAllowed();
    const order = this.orders.find((o) => o.id === orderId);
    if (!order) {
      return {
        accepted: false,
        orderId,
        status: "REJECTED",
        reason: "ORDER_NOT_FOUND",
        rawRedacted: {}
      };
    }
    order.status = "CANCELLED";
    return {
      accepted: true,
      orderId,
      status: "CANCELLED",
      reason: null,
      rawRedacted: { cancelled: true }
    };
  }

  private async place(
    request: T212OrderRequest,
    type: T212Order["type"]
  ): Promise<T212OrderResult> {
    this.requireConnected();
    this.assertSubmissionAllowed();
    const side = request.quantity > 0 ? "BUY" : "SELL";
    assertQuantitySign(request.quantity, side);

    if (this.scenario === "missing_instrument") {
      return {
        accepted: false,
        orderId: null,
        status: "REJECTED",
        reason: "INSTRUMENT_NOT_FOUND",
        rawRedacted: {}
      };
    }
    if (this.scenario === "reject_order") {
      return {
        accepted: false,
        orderId: null,
        status: "REJECTED",
        reason: "BROKER_REJECTED",
        rawRedacted: {}
      };
    }
    if (this.scenario === "timeout_unknown") {
      throw new Error("T212_HTTP_TIMEOUT");
    }
    if (this.scenario === "rate_limited") {
      throw new Error("T212_HTTP_429");
    }

    const absQty = Math.abs(request.quantity);
    const filled =
      this.scenario === "partial_fill" ? Number((absQty * 0.5).toFixed(4)) : absQty;
    const order: T212Order = {
      id: `T212-${Date.now()}`,
      ticker: request.ticker,
      quantity: request.quantity,
      side,
      type,
      limitPrice: request.limitPrice ?? null,
      stopPrice: request.stopPrice ?? null,
      status: this.scenario === "partial_fill" ? "PARTIAL" : "FILLED",
      filledQuantity: filled,
      averageFillPrice: 180,
      createdAt: nowIso()
    };
    this.orders.push(order);
    if (side === "BUY" && order.status === "FILLED") {
      this.positions.push({
        ticker: request.ticker,
        quantity: filled,
        averagePrice: 180,
        currentPrice: 180,
        pnl: 0
      });
    }
    return {
      accepted: true,
      orderId: order.id,
      status: order.status,
      reason: null,
      rawRedacted: { status: order.status, orderId: order.id }
    };
  }

  private assertSubmissionAllowed(): void {
    if (this.environment === "LIVE" && !T212_LIVE_EXECUTION_FEATURE_FLAG) {
      throw new Error("T212_LIVE_EXECUTION_DISABLED");
    }
    if (this.environment === "PAPER" && !T212_PAPER_ORDER_SUBMISSION_ENABLED) {
      throw new Error("T212_PAPER_ORDER_SUBMISSION_DISABLED");
    }
  }

  private requireConnected(): void {
    if (!this.connected) throw new Error("NOT_CONNECTED");
  }
}
