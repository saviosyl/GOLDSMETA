/**
 * Micro OpenAPI transport — READ-ONLY.
 * Uses @reiryoku/ctrader-layer directly (not Core openApiClient).
 *
 * Auth flow (official):
 * 1) ProtoOAApplicationAuthReq
 * 2) ProtoOAGetAccountListByAccessTokenReq
 * 3) verify configured account is in authorized list
 * 4) ProtoOAAccountAuthReq
 */

import { CTraderConnection } from "@reiryoku/ctrader-layer";
import {
  assertConfiguredAccountAuthorized,
  extractAuthorizedAccountIds,
  type MicroCTraderCredentials
} from "./microCTraderAuth";
import {
  assertReadOnlyCommand,
  asFiniteNumber,
  MICRO_QUOTE_TYPE,
  MICRO_TRENDBAR_PERIOD,
  type MicroHistoricalQuoteSide
} from "./microCTraderProtocol";
import type { MicroTimeframe } from "./types";

export type MicroTransportEventHandler = (
  eventName: string,
  payload: Record<string, unknown>
) => void;

export type MicroAccountAuthMeta = {
  authorizedAccountCount: number;
  configuredAccountAuthorized: boolean;
};

export type MicroOpenApiTransport = {
  readonly mutationSurface: "NONE";
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  isApplicationAuthenticated(): boolean;
  isAccountAuthenticated(): boolean;
  getAccountAuthMeta(): MicroAccountAuthMeta | null;
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
  /** VIEW-only Level-II depth subscription (no trade scope). */
  subscribeDepthQuotes(symbolId: string): Promise<void>;
  listSymbols(): Promise<Array<Record<string, unknown>>>;
  getTickData(args: {
    symbolId: string;
    side: MicroHistoricalQuoteSide;
    fromTimestamp: number;
    toTimestamp: number;
  }): Promise<{ tickData?: unknown; hasMore?: boolean }>;
  /** Test/observability: count of SubscribeSpots commands sent. */
  getSubscribeSpotsCallCount(): number;
  /** Test/observability: count of SubscribeDepthQuotes commands sent. */
  getSubscribeDepthCallCount(): number;
};

type ConnLike = {
  open: () => Promise<unknown>;
  close: () => Promise<unknown> | void;
  sendCommand: (cmd: string, payload: Record<string, unknown>) => Promise<unknown>;
  on: (event: string, cb: (evt: unknown) => void) => void;
  removeListener?: (event: string, cb: (evt: unknown) => void) => void;
  off?: (event: string, cb: (evt: unknown) => void) => void;
};

export type MicroTransportFactory = (host: string, port: number) => ConnLike;

const DEMO_HOST = "demo.ctraderapi.com";
const LIVE_HOST = "live.ctraderapi.com";
const PORT = 5035;

function defaultFactory(host: string, port: number): ConnLike {
  return new CTraderConnection({ host, port }) as unknown as ConnLike;
}

function unwrapEvent(evt: unknown): Record<string, unknown> {
  if (!evt || typeof evt !== "object") return {};
  const o = evt as { descriptor?: Record<string, unknown> };
  if (o.descriptor && typeof o.descriptor === "object") return o.descriptor;
  return evt as Record<string, unknown>;
}

export class RealMicroCTraderTransport implements MicroOpenApiTransport {
  readonly mutationSurface = "NONE" as const;
  private conn: ConnLike | null = null;
  private connected = false;
  private applicationAuthenticated = false;
  private accountAuthenticated = false;
  private accountAuthMeta: MicroAccountAuthMeta | null = null;
  private readonly handlers = new Map<string, Set<MicroTransportEventHandler>>();
  /** Bound native listeners so we can detach on reconnect/disconnect. */
  private readonly nativeBindings = new Map<
    string,
    Map<MicroTransportEventHandler, (evt: unknown) => void>
  >();
  private readonly factory: MicroTransportFactory;
  private subscribeSpotsCallCount = 0;
  private subscribeDepthCallCount = 0;

  constructor(
    private readonly credentials: MicroCTraderCredentials,
    factory?: MicroTransportFactory
  ) {
    this.factory = factory ?? defaultFactory;
  }

  isConnected(): boolean {
    return this.connected;
  }

  isApplicationAuthenticated(): boolean {
    return this.applicationAuthenticated;
  }

  isAccountAuthenticated(): boolean {
    return this.accountAuthenticated;
  }

  getAccountAuthMeta(): MicroAccountAuthMeta | null {
    return this.accountAuthMeta;
  }

  getSubscribeSpotsCallCount(): number {
    return this.subscribeSpotsCallCount;
  }

  getSubscribeDepthCallCount(): number {
    return this.subscribeDepthCallCount;
  }

  async connect(): Promise<void> {
    if (this.connected && this.conn) return;
    await this.disconnect();
    const host =
      this.credentials.environment === "LIVE" ? LIVE_HOST : DEMO_HOST;
    const conn = this.factory(host, PORT);
    await conn.open();
    this.conn = conn;
    // Attach any handlers registered before connect.
    this.attachAllHandlersToConnection(conn);

    await conn.sendCommand("ProtoOAApplicationAuthReq", {
      clientId: this.credentials.clientId,
      clientSecret: this.credentials.clientSecret
    });
    this.applicationAuthenticated = true;

    let accountListRes: unknown;
    try {
      accountListRes = await conn.sendCommand(
        "ProtoOAGetAccountListByAccessTokenReq",
        { accessToken: this.credentials.accessToken }
      );
    } catch (e) {
      await this.failClosedDisconnect();
      throw Object.assign(new Error("MICRO_ACCOUNT_LIST_FAILED"), {
        code: "account_not_authorized",
        cause: e
      });
    }

    const authorizedIds = extractAuthorizedAccountIds(accountListRes);
    try {
      this.accountAuthMeta = assertConfiguredAccountAuthorized({
        configuredAccountId: this.credentials.accountId,
        authorizedAccountIds: authorizedIds
      });
    } catch (e) {
      await this.failClosedDisconnect();
      throw e;
    }

    try {
      await conn.sendCommand("ProtoOAAccountAuthReq", {
        accessToken: this.credentials.accessToken,
        ctidTraderAccountId: Number(this.credentials.accountId)
      });
    } catch (e) {
      await this.failClosedDisconnect();
      throw Object.assign(new Error("MICRO_CTRADER_ACCOUNT_AUTH_FAILED"), {
        code: "account_not_authorized",
        cause: e
      });
    }

    this.accountAuthenticated = true;
    this.connected = true;
  }

  private async failClosedDisconnect(): Promise<void> {
    this.applicationAuthenticated = false;
    this.accountAuthenticated = false;
    this.accountAuthMeta = null;
    this.connected = false;
    const c = this.conn;
    this.conn = null;
    this.detachAllNative(c);
    if (c) {
      try {
        await c.close();
      } catch {
        /* ignore */
      }
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.applicationAuthenticated = false;
    this.accountAuthenticated = false;
    this.accountAuthMeta = null;
    const c = this.conn;
    this.conn = null;
    this.detachAllNative(c);
    if (c) {
      try {
        await c.close();
      } catch {
        /* ignore */
      }
    }
  }

  private detachAllNative(conn: ConnLike | null): void {
    if (!conn) {
      this.nativeBindings.clear();
      return;
    }
    for (const [eventName, map] of this.nativeBindings) {
      for (const native of map.values()) {
        try {
          conn.removeListener?.(eventName, native);
          conn.off?.(eventName, native);
        } catch {
          /* ignore */
        }
      }
    }
    this.nativeBindings.clear();
  }

  private attachAllHandlersToConnection(conn: ConnLike): void {
    for (const [eventName, set] of this.handlers) {
      for (const handler of set) {
        this.bindNative(conn, eventName, handler);
      }
    }
  }

  private bindNative(
    conn: ConnLike,
    eventName: string,
    handler: MicroTransportEventHandler
  ): void {
    if (!this.nativeBindings.has(eventName)) {
      this.nativeBindings.set(eventName, new Map());
    }
    const map = this.nativeBindings.get(eventName)!;
    if (map.has(handler)) return; // no duplicate native registration
    const native = (evt: unknown) => {
      handler(eventName, unwrapEvent(evt));
    };
    map.set(handler, native);
    conn.on(eventName, native);
  }

  async sendReadCommand(
    command: string,
    payload: Record<string, unknown>
  ): Promise<unknown> {
    assertReadOnlyCommand(command);
    if (!this.conn) {
      throw Object.assign(new Error("MICRO_TRANSPORT_DISCONNECTED"), {
        code: "transport_disconnected"
      });
    }
    // Allow account-list during connect before connected flag is set.
    if (
      !this.connected &&
      command !== "ProtoOAApplicationAuthReq" &&
      command !== "ProtoOAGetAccountListByAccessTokenReq" &&
      command !== "ProtoOAAccountAuthReq"
    ) {
      throw Object.assign(new Error("MICRO_TRANSPORT_DISCONNECTED"), {
        code: "transport_disconnected"
      });
    }
    if (command === "ProtoOASubscribeSpotsReq") {
      this.subscribeSpotsCallCount += 1;
    }
    if (command === "ProtoOASubscribeDepthQuotesReq") {
      this.subscribeDepthCallCount += 1;
    }
    return this.conn.sendCommand(command, payload);
  }

  on(eventName: string, handler: MicroTransportEventHandler): void {
    if (!this.handlers.has(eventName)) this.handlers.set(eventName, new Set());
    this.handlers.get(eventName)!.add(handler);
    if (this.conn) this.bindNative(this.conn, eventName, handler);
  }

  off(eventName: string, handler: MicroTransportEventHandler): void {
    this.handlers.get(eventName)?.delete(handler);
    const native = this.nativeBindings.get(eventName)?.get(handler);
    if (native && this.conn) {
      try {
        this.conn.removeListener?.(eventName, native);
        this.conn.off?.(eventName, native);
      } catch {
        /* ignore */
      }
    }
    this.nativeBindings.get(eventName)?.delete(handler);
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

  async subscribeDepthQuotes(symbolId: string): Promise<void> {
    await this.sendReadCommand("ProtoOASubscribeDepthQuotesReq", {
      ctidTraderAccountId: Number(this.credentials.accountId),
      symbolId: [Number(symbolId)]
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

  async getTickData(args: {
    symbolId: string;
    side: MicroHistoricalQuoteSide;
    fromTimestamp: number;
    toTimestamp: number;
  }): Promise<{ tickData?: unknown; hasMore?: boolean }> {
    return (await this.sendReadCommand("ProtoOAGetTickDataReq", {
      ctidTraderAccountId: Number(this.credentials.accountId),
      symbolId: Number(args.symbolId),
      type: MICRO_QUOTE_TYPE[args.side],
      fromTimestamp: args.fromTimestamp,
      toTimestamp: args.toTimestamp
    })) as { tickData?: unknown; hasMore?: boolean };
  }
}

/**
 * Deterministic fake transport for unit tests — no network, no mutations.
 */
export class FakeMicroCTraderTransport implements MicroOpenApiTransport {
  readonly mutationSurface = "NONE" as const;
  private connected = false;
  private applicationAuthenticated = false;
  private accountAuthenticated = false;
  private accountAuthMeta: MicroAccountAuthMeta | null = null;
  private subscribeSpotsCallCount = 0;
  private subscribeDepthCallCount = 0;
  /** Authorized account ids returned by GetAccountList. */
  authorizedAccountIds: string[] = ["123"];
  configuredAccountId = "123";
  failAccountList = false;
  emptyAccountList = false;
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
  /** Fake historical ticks keyed by side. */
  tickDataBySide = new Map<MicroHistoricalQuoteSide, unknown[]>();
  tickHasMore = false;
  private readonly handlers = new Map<string, Set<MicroTransportEventHandler>>();
  nextSpot: Record<string, unknown> | null = null;
  failConnectCode: string | null = null;
  rateLimitOnce = false;
  getTickDataCallCount = 0;

  isConnected(): boolean {
    return this.connected;
  }
  isApplicationAuthenticated(): boolean {
    return this.applicationAuthenticated;
  }
  isAccountAuthenticated(): boolean {
    return this.accountAuthenticated;
  }
  getAccountAuthMeta(): MicroAccountAuthMeta | null {
    return this.accountAuthMeta;
  }
  getSubscribeSpotsCallCount(): number {
    return this.subscribeSpotsCallCount;
  }
  getSubscribeDepthCallCount(): number {
    return this.subscribeDepthCallCount;
  }

  async connect(): Promise<void> {
    if (this.failConnectCode) {
      throw Object.assign(new Error("FAKE_CONNECT_FAILED"), {
        code: this.failConnectCode
      });
    }
    this.applicationAuthenticated = true;
    if (this.failAccountList) {
      throw Object.assign(new Error("FAKE_ACCOUNT_LIST_FAILED"), {
        code: "account_not_authorized"
      });
    }
    const ids = this.emptyAccountList ? [] : this.authorizedAccountIds;
    this.accountAuthMeta = assertConfiguredAccountAuthorized({
      configuredAccountId: this.configuredAccountId,
      authorizedAccountIds: ids
    });
    this.accountAuthenticated = true;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.applicationAuthenticated = false;
    this.accountAuthenticated = false;
    this.accountAuthMeta = null;
    this.handlers.clear();
  }

  async sendReadCommand(
    command: string,
    payload: Record<string, unknown>
  ): Promise<unknown> {
    assertReadOnlyCommand(command);
    if (!this.connected && command !== "ProtoOAGetAccountListByAccessTokenReq") {
      // After connect() fake is connected; allow reads only when connected.
      if (
        command !== "ProtoOAApplicationAuthReq" &&
        command !== "ProtoOAAccountAuthReq"
      ) {
        throw Object.assign(new Error("MICRO_TRANSPORT_DISCONNECTED"), {
          code: "transport_disconnected"
        });
      }
    }
    if (this.rateLimitOnce) {
      this.rateLimitOnce = false;
      throw Object.assign(new Error("RATE_LIMIT"), { code: "rate_limited", status: 429 });
    }
    if (command === "ProtoOAGetAccountListByAccessTokenReq") {
      if (this.failAccountList) {
        throw Object.assign(new Error("FAKE_ACCOUNT_LIST_FAILED"), {
          code: "account_not_authorized"
        });
      }
      const ids = this.emptyAccountList ? [] : this.authorizedAccountIds;
      return {
        ctidTraderAccount: ids.map((id) => ({ ctidTraderAccountId: Number(id) }))
      };
    }
    if (command === "ProtoOASymbolsListReq") return { symbol: this.symbols };
    if (command === "ProtoOAGetTrendbarsReq") {
      const period = asFiniteNumber(payload.period);
      const tf =
        period === 1 ? "M1" : period === 5 ? "M5" : period === 7 ? "M15" : null;
      return { trendbar: tf ? this.trendbarsByTf.get(tf) ?? [] : [] };
    }
    if (command === "ProtoOASubscribeSpotsReq") {
      this.subscribeSpotsCallCount += 1;
      if (this.nextSpot) {
        const payloadSpot = { ...this.nextSpot };
        queueMicrotask(() => this.emitSpot(payloadSpot));
      }
      return {};
    }
    if (command === "ProtoOASubscribeDepthQuotesReq") {
      this.subscribeDepthCallCount += 1;
      return {};
    }
    if (command === "ProtoOAUnsubscribeDepthQuotesReq") {
      return {};
    }
    if (command === "ProtoOAGetTickDataReq") {
      this.getTickDataCallCount += 1;
      const type = asFiniteNumber(payload.type);
      const side: MicroHistoricalQuoteSide | null =
        type === MICRO_QUOTE_TYPE.BID
          ? "BID"
          : type === MICRO_QUOTE_TYPE.ASK
            ? "ASK"
            : null;
      const fromTs = asFiniteNumber(payload.fromTimestamp) ?? 0;
      const toTs = asFiniteNumber(payload.toTimestamp) ?? 0;
      if (toTs - fromTs > 604_800_000) {
        throw Object.assign(new Error("FAKE_TICK_WINDOW_TOO_LARGE"), {
          code: "tick_window_too_large"
        });
      }
      return {
        tickData: side ? this.tickDataBySide.get(side) ?? [] : [],
        hasMore: this.tickHasMore
      };
    }
    if (command === "ProtoOATraderReq") {
      return {
        trader: {
          balance: 100_000 * 100, // moneyDigits=2 → 100000.00
          moneyDigits: 2,
          depositAssetId: 15,
          depositCurrency: "EUR"
        }
      };
    }
    if (
      command === "ProtoOAApplicationAuthReq" ||
      command === "ProtoOAAccountAuthReq" ||
      command === "ProtoOAUnsubscribeSpotsReq"
    ) {
      return {};
    }
    return {};
  }

  emitSpot(payload: Record<string, unknown>): void {
    for (const h of this.handlers.get("ProtoOASpotEvent") ?? []) {
      h("ProtoOASpotEvent", payload);
    }
  }

  emitDepth(payload: Record<string, unknown>): void {
    for (const h of this.handlers.get("ProtoOADepthEvent") ?? []) {
      h("ProtoOADepthEvent", payload);
    }
  }

  on(eventName: string, handler: MicroTransportEventHandler): void {
    if (!this.handlers.has(eventName)) this.handlers.set(eventName, new Set());
    this.handlers.get(eventName)!.add(handler);
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

  async subscribeDepthQuotes(symbolId: string): Promise<void> {
    await this.sendReadCommand("ProtoOASubscribeDepthQuotesReq", {
      ctidTraderAccountId: Number(this.configuredAccountId),
      symbolId: [Number(symbolId)]
    });
  }

  async listSymbols(): Promise<Array<Record<string, unknown>>> {
    return this.symbols;
  }

  async getTickData(args: {
    symbolId: string;
    side: MicroHistoricalQuoteSide;
    fromTimestamp: number;
    toTimestamp: number;
  }): Promise<{ tickData?: unknown; hasMore?: boolean }> {
    return (await this.sendReadCommand("ProtoOAGetTickDataReq", {
      symbolId: Number(args.symbolId),
      type: MICRO_QUOTE_TYPE[args.side],
      fromTimestamp: args.fromTimestamp,
      toTimestamp: args.toTimestamp
    })) as { tickData?: unknown; hasMore?: boolean };
  }
}
