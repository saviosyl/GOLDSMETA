/**
 * Micro OpenAPI transport — READ-ONLY.
 * Uses @reiryoku/ctrader-layer directly (not Core openApiClient).
 * Mutation commands are structurally rejected.
 */

import { CTraderConnection } from "@reiryoku/ctrader-layer";
import type { MicroCTraderCredentials } from "./microCTraderAuth";
import {
  assertReadOnlyCommand,
  asFiniteNumber
} from "./microCTraderProtocol";
import type { MicroTimeframe } from "./types";
import { MICRO_TRENDBAR_PERIOD } from "./microCTraderProtocol";

export type MicroTransportEventHandler = (
  eventName: string,
  payload: Record<string, unknown>
) => void;

export type MicroOpenApiTransport = {
  readonly mutationSurface: "NONE";
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  sendReadCommand(command: string, payload: Record<string, unknown>): Promise<unknown>;
  on(eventName: string, handler: MicroTransportEventHandler): void;
  off(eventName: string, handler: MicroTransportEventHandler): void;
  getTrendbars(args: {
    symbolId: string;
    timeframe: MicroTimeframe;
    fromTimestamp: number;
    toTimestamp: number;
    count: number;
  }): Promise<{ trendbar?: unknown }>;
  subscribeSpots(symbolId: string): Promise<void>;
  listSymbols(): Promise<Array<Record<string, unknown>>>;
};

type ConnLike = {
  open: () => Promise<unknown>;
  close: () => Promise<unknown> | void;
  sendCommand: (cmd: string, payload: Record<string, unknown>) => Promise<unknown>;
  on: (event: string, cb: (evt: { descriptor?: Record<string, unknown> }) => void) => void;
};

export type MicroTransportFactory = (host: string, port: number) => ConnLike;

const DEMO_HOST = "demo.ctraderapi.com";
const LIVE_HOST = "live.ctraderapi.com";
const PORT = 5035;

function defaultFactory(host: string, port: number): ConnLike {
  return new CTraderConnection({ host, port }) as unknown as ConnLike;
}

export class RealMicroCTraderTransport implements MicroOpenApiTransport {
  readonly mutationSurface = "NONE" as const;
  private conn: ConnLike | null = null;
  private connected = false;
  private readonly handlers = new Map<string, Set<MicroTransportEventHandler>>();
  private readonly factory: MicroTransportFactory;

  constructor(
    private readonly credentials: MicroCTraderCredentials,
    factory?: MicroTransportFactory
  ) {
    this.factory = factory ?? defaultFactory;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.connected && this.conn) return;
    const host =
      this.credentials.environment === "LIVE" ? LIVE_HOST : DEMO_HOST;
    const conn = this.factory(host, PORT);
    await conn.open();
    await conn.sendCommand("ProtoOAApplicationAuthReq", {
      clientId: this.credentials.clientId,
      clientSecret: this.credentials.clientSecret
    });
    try {
      await conn.sendCommand("ProtoOAAccountAuthReq", {
        accessToken: this.credentials.accessToken,
        ctidTraderAccountId: Number(this.credentials.accountId)
      });
    } catch (e) {
      try {
        await conn.close();
      } catch {
        /* ignore */
      }
      throw Object.assign(new Error("MICRO_CTRADER_ACCOUNT_AUTH_FAILED"), {
        code: "account_not_authorized",
        cause: e
      });
    }
    this.conn = conn;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    const c = this.conn;
    this.conn = null;
    if (c) {
      try {
        await c.close();
      } catch {
        /* ignore */
      }
    }
  }

  async sendReadCommand(
    command: string,
    payload: Record<string, unknown>
  ): Promise<unknown> {
    assertReadOnlyCommand(command);
    if (!this.conn || !this.connected) {
      throw Object.assign(new Error("MICRO_TRANSPORT_DISCONNECTED"), {
        code: "transport_disconnected"
      });
    }
    return this.conn.sendCommand(command, payload);
  }

  on(eventName: string, handler: MicroTransportEventHandler): void {
    if (!this.handlers.has(eventName)) this.handlers.set(eventName, new Set());
    this.handlers.get(eventName)!.add(handler);
    this.conn?.on(eventName, (evt) => {
      handler(eventName, (evt?.descriptor ?? evt) as Record<string, unknown>);
    });
  }

  off(eventName: string, handler: MicroTransportEventHandler): void {
    this.handlers.get(eventName)?.delete(handler);
  }

  async getTrendbars(args: {
    symbolId: string;
    timeframe: MicroTimeframe;
    fromTimestamp: number;
    toTimestamp: number;
    count: number;
  }): Promise<{ trendbar?: unknown }> {
    return (await this.sendReadCommand("ProtoOAGetTrendbarsReq", {
      ctidTraderAccountId: Number(this.credentials.accountId),
      fromTimestamp: args.fromTimestamp,
      toTimestamp: args.toTimestamp,
      period: MICRO_TRENDBAR_PERIOD[args.timeframe],
      symbolId: Number(args.symbolId),
      count: args.count
    })) as { trendbar?: unknown };
  }

  async subscribeSpots(symbolId: string): Promise<void> {
    await this.sendReadCommand("ProtoOASubscribeSpotsReq", {
      ctidTraderAccountId: Number(this.credentials.accountId),
      symbolId: [Number(symbolId)],
      subscribeToSpotTimestamp: true
    });
  }

  async listSymbols(): Promise<Array<Record<string, unknown>>> {
    const res = (await this.sendReadCommand("ProtoOASymbolsListReq", {
      ctidTraderAccountId: Number(this.credentials.accountId),
      includeArchivedSymbols: false
    })) as { symbol?: Array<Record<string, unknown>> | Record<string, unknown> };
    if (Array.isArray(res.symbol)) return res.symbol;
    if (res.symbol) return [res.symbol];
    return [];
  }
}

/**
 * Deterministic fake transport for unit tests — no network, no mutations.
 */
export class FakeMicroCTraderTransport implements MicroOpenApiTransport {
  readonly mutationSurface = "NONE" as const;
  private connected = false;
  symbols: Array<Record<string, unknown>> = [
    {
      symbolId: 41,
      symbolName: "XAUUSD",
      baseAsset: "XAU",
      quoteAsset: "USD",
      digits: 2,
      pipPosition: 1
    }
  ];
  trendbarsByTf = new Map<MicroTimeframe, unknown[]>();
  spotHandlers: MicroTransportEventHandler[] = [];
  nextSpot: { bid: number; ask: number; timestamp: number; symbolId: number } | null =
    null;
  failConnectCode: string | null = null;
  rateLimitOnce = false;

  isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.failConnectCode) {
      throw Object.assign(new Error("FAKE_CONNECT_FAILED"), {
        code: this.failConnectCode
      });
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async sendReadCommand(
    command: string,
    payload: Record<string, unknown>
  ): Promise<unknown> {
    assertReadOnlyCommand(command);
    if (!this.connected) {
      throw Object.assign(new Error("MICRO_TRANSPORT_DISCONNECTED"), {
        code: "transport_disconnected"
      });
    }
    if (this.rateLimitOnce) {
      this.rateLimitOnce = false;
      throw Object.assign(new Error("RATE_LIMIT"), { code: "rate_limited", status: 429 });
    }
    if (command === "ProtoOASymbolsListReq") return { symbol: this.symbols };
    if (command === "ProtoOAGetTrendbarsReq") {
      const period = asFiniteNumber(payload.period);
      const tf =
        period === 1 ? "M1" : period === 5 ? "M5" : period === 7 ? "M15" : null;
      return { trendbar: tf ? this.trendbarsByTf.get(tf) ?? [] : [] };
    }
    if (command === "ProtoOASubscribeSpotsReq") {
      if (this.nextSpot) {
        queueMicrotask(() => {
          for (const h of this.spotHandlers) {
            h("ProtoOASpotEvent", { ...this.nextSpot! });
          }
        });
      }
      return {};
    }
    if (command === "ProtoOAApplicationAuthReq" || command === "ProtoOAAccountAuthReq") {
      return {};
    }
    return {};
  }

  on(eventName: string, handler: MicroTransportEventHandler): void {
    if (eventName === "ProtoOASpotEvent") this.spotHandlers.push(handler);
  }

  off(eventName: string, handler: MicroTransportEventHandler): void {
    if (eventName === "ProtoOASpotEvent") {
      this.spotHandlers = this.spotHandlers.filter((h) => h !== handler);
    }
  }

  async getTrendbars(args: {
    symbolId: string;
    timeframe: MicroTimeframe;
    fromTimestamp: number;
    toTimestamp: number;
    count: number;
  }): Promise<{ trendbar?: unknown }> {
    return (await this.sendReadCommand("ProtoOAGetTrendbarsReq", {
      period: MICRO_TRENDBAR_PERIOD[args.timeframe],
      symbolId: Number(args.symbolId),
      fromTimestamp: args.fromTimestamp,
      toTimestamp: args.toTimestamp,
      count: args.count
    })) as { trendbar?: unknown };
  }

  async subscribeSpots(symbolId: string): Promise<void> {
    await this.sendReadCommand("ProtoOASubscribeSpotsReq", {
      symbolId: [Number(symbolId)]
    });
  }

  async listSymbols(): Promise<Array<Record<string, unknown>>> {
    return this.symbols;
  }
}
