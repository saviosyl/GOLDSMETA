/**
 * In-process Micro live market-data session (read-only).
 * Not a deployed worker — callable locally / from CLI / future collector.
 */
import {
  loadMicroCTraderCredentials,
  type MicroCTraderCredentials
} from "./microCTraderAuth";
import {
  FakeMicroCTraderTransport,
  RealMicroCTraderTransport,
  type MicroOpenApiTransport
} from "./microCTraderTransport";
import { resolveMicroXauUsd } from "./microCTraderSymbolResolver";
import { fetchOneShotQuote } from "./microCTraderQuotes";
import {
  fetchTrendbarsWindow,
  filterCompletedBars
} from "./microCTraderTrendbars";
import { detectCompletedM1 } from "./completedBars";
import { MICRO_TIMEFRAME_MS } from "./microCTraderProtocol";
import type { MicroMarketDataStore } from "./marketDataStore";
import { makeRawBar } from "./marketDataStore";
import { microLog } from "./microLog";
import type {
  MicroMarketDataConnectionState,
  MicroSymbolMetadata,
  MicroTimeframe
} from "./types";
import type { MicroQuote } from "../types";

export type MicroLiveSessionState = {
  connectionState: MicroMarketDataConnectionState;
  liveConnected: boolean;
  credentialsConfigured: boolean;
  symbol: MicroSymbolMetadata | null;
  lastQuote: MicroQuote | null;
  lastQuoteTs: string | null;
  quoteAgeMs: number | null;
  lastCompletedM1Ts: string | null;
  lastCompletedM5Ts: string | null;
  lastCompletedM15Ts: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  reconnectAttempts: number;
  lastErrorCode: string | null;
  healthReasons: string[];
  collectorHeartbeatAt: string | null;
  m1CompletedEvents: number;
};

export type LiveSessionOptions = {
  store: MicroMarketDataStore;
  /** Inject transport for tests. */
  transport?: MicroOpenApiTransport;
  credentials?: MicroCTraderCredentials;
  quoteSampleIntervalMs?: number;
  nowMs?: () => number;
};

export class MicroLiveMarketSession {
  private transport: MicroOpenApiTransport | null = null;
  private credentials: MicroCTraderCredentials | null = null;
  private symbol: MicroSymbolMetadata | null = null;
  private lastQuote: MicroQuote | null = null;
  private seenM1 = new Set<number>();
  private lastConnectedAt: string | null = null;
  private lastDisconnectedAt: string | null = null;
  private reconnectAttempts = 0;
  private lastErrorCode: string | null = null;
  private heartbeatAt: string | null = null;
  private m1CompletedEvents = 0;
  private lastQuotePersistMs = 0;
  private readonly quoteSampleIntervalMs: number;
  private readonly nowMs: () => number;

  constructor(private readonly opts: LiveSessionOptions) {
    this.quoteSampleIntervalMs =
      opts.quoteSampleIntervalMs ??
      Number(process.env.MICRO_QUOTE_SAMPLE_INTERVAL_MS ?? 5000);
    this.nowMs = opts.nowMs ?? (() => Date.now());
  }

  get mutationSurface(): "NONE" {
    return "NONE";
  }

  async connect(): Promise<void> {
    microLog("MICRO_CTRADER_CONNECTING", {});
    const loaded =
      this.opts.credentials != null
        ? { ok: true as const, credentials: this.opts.credentials }
        : loadMicroCTraderCredentials();
    if (!loaded.ok) {
      this.lastErrorCode = "oauth_missing";
      throw Object.assign(new Error("MICRO_OAUTH_MISSING"), {
        code: "oauth_missing",
        missing: loaded.missing
      });
    }
    this.credentials = loaded.credentials;
    this.transport =
      this.opts.transport ?? new RealMicroCTraderTransport(this.credentials);
    if (this.transport.mutationSurface !== "NONE") {
      throw new Error("MICRO_MUTATION_SURFACE_UNEXPECTED");
    }
    try {
      await this.transport.connect();
    } catch (e) {
      this.lastErrorCode =
        (e as { code?: string }).code ?? "transport_disconnected";
      this.lastDisconnectedAt = new Date().toISOString();
      microLog("MICRO_CTRADER_DISCONNECTED", { code: this.lastErrorCode });
      throw e;
    }
    this.lastConnectedAt = new Date().toISOString();
    this.reconnectAttempts = 0;
    this.lastErrorCode = null;
    microLog("MICRO_CTRADER_CONNECTED", {
      environment: this.credentials.environment
    });

    const symbols = await this.transport.listSymbols();
    const resolved = resolveMicroXauUsd(symbols);
    if (!resolved) {
      this.lastErrorCode = "xauusd_not_found";
      await this.disconnect();
      throw Object.assign(new Error("MICRO_XAUUSD_NOT_FOUND"), {
        code: "xauusd_not_found"
      });
    }
    this.symbol = {
      symbol: "XAUUSD",
      symbolId: resolved.symbolId,
      symbolName: resolved.symbolName,
      digits: resolved.digits,
      pipPosition: resolved.pipPosition,
      environment: this.credentials.environment,
      resolvedAt: new Date().toISOString()
    };
    await this.opts.store.saveSymbolMetadata(this.symbol);
    microLog("MICRO_XAUUSD_RESOLVED", {
      symbolId: this.symbol.symbolId,
      symbolName: this.symbol.symbolName
    });
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.disconnect();
    }
    this.transport = null;
    this.lastDisconnectedAt = new Date().toISOString();
    microLog("MICRO_CTRADER_DISCONNECTED", { code: this.lastErrorCode });
  }

  isLiveConnected(): boolean {
    return Boolean(
      this.transport?.isConnected() &&
        this.symbol &&
        this.lastQuote &&
        this.lastErrorCode == null
    );
  }

  async refreshQuote(): Promise<MicroQuote> {
    if (!this.transport || !this.symbol || !this.credentials) {
      throw Object.assign(new Error("MICRO_NOT_CONNECTED"), {
        code: "transport_disconnected"
      });
    }
    const quote = await fetchOneShotQuote({
      transport: this.transport,
      symbolId: this.symbol.symbolId,
      nowMs: this.nowMs()
    });
    this.lastQuote = quote;
    const now = this.nowMs();
    if (now - this.lastQuotePersistMs >= this.quoteSampleIntervalMs) {
      const bucket = Math.floor(now / this.quoteSampleIntervalMs) * this.quoteSampleIntervalMs;
      await this.opts.store.saveQuoteSample({
        id: `${this.symbol.symbolId}_${bucket}`,
        symbol: "XAUUSD",
        symbolId: this.symbol.symbolId,
        bid: quote.bid,
        ask: quote.ask,
        mid: quote.mid,
        spread: quote.spread,
        brokerTimestamp: quote.brokerTimestamp,
        receivedAt: quote.receivedAt,
        ageMs: quote.ageMs,
        freshness: quote.freshness,
        source: "CTRADER_OPEN_API",
        environment: this.credentials.environment
      });
      this.lastQuotePersistMs = now;
    }
    this.heartbeatAt = new Date(now).toISOString();
    await this.opts.store.saveCollectorHeartbeat(this.heartbeatAt, {
      symbolId: this.symbol.symbolId,
      quoteTs: quote.brokerTimestamp
    });
    return quote;
  }

  async pollCompletedBars(tf: MicroTimeframe, lookbackBars = 5): Promise<number> {
    if (!this.transport || !this.symbol || !this.credentials) return 0;
    const now = this.nowMs();
    const periodMs = MICRO_TIMEFRAME_MS[tf];
    const fromTimestamp = now - periodMs * (lookbackBars + 2);
    const bars = filterCompletedBars(
      await fetchTrendbarsWindow({
        transport: this.transport,
        symbolId: this.symbol.symbolId,
        timeframe: tf,
        fromTimestamp,
        toTimestamp: now,
        count: lookbackBars + 2
      }),
      now
    );
    let created = 0;
    for (const b of bars) {
      const r = await this.opts.store.upsertBar(
        makeRawBar({
          symbol: "XAUUSD",
          symbolId: this.symbol.symbolId,
          timeframe: tf,
          openTimeMs: b.openTimeMs,
          closeTimeMs: b.closeTimeMs,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          tickVolume: b.tickVolume,
          environment: this.credentials.environment
        })
      );
      if (r === "created") created += 1;
    }
    if (tf === "M1") {
      const events = detectCompletedM1({
        bars,
        nowMs: now,
        seenCloseTimes: this.seenM1
      });
      for (const ev of events) {
        this.m1CompletedEvents += 1;
        microLog("MICRO_M1_COMPLETED", { closeTimeMs: ev.closeTimeMs });
      }
    }
    this.heartbeatAt = new Date(now).toISOString();
    return created;
  }

  async boundedReconnect(): Promise<boolean> {
    this.reconnectAttempts += 1;
    if (this.reconnectAttempts > 8) {
      this.lastErrorCode = "transport_disconnected";
      return false;
    }
    const backoff = Math.min(30_000, 500 * 2 ** (this.reconnectAttempts - 1));
    await new Promise((r) => setTimeout(r, backoff));
    try {
      await this.disconnect();
      await this.connect();
      this.reconnectAttempts = 0;
      return true;
    } catch (e) {
      this.lastErrorCode =
        (e as { code?: string }).code ?? "transport_disconnected";
      return false;
    }
  }

  async getState(): Promise<MicroLiveSessionState> {
    const store = this.opts.store;
    const m1 = await store.latestBar("M1");
    const m5 = await store.latestBar("M5");
    const m15 = await store.latestBar("M15");
    const now = this.nowMs();
    const liveConnected = this.isLiveConnected() && this.lastQuote != null;
    const reasons: string[] = [];
    if (!this.credentials && !loadMicroCTraderCredentials().ok) {
      reasons.push("oauth_missing");
    }
    if (!this.transport?.isConnected()) reasons.push("transport_disconnected");
    if (!this.symbol) reasons.push("xauusd_not_found");
    if (!this.lastQuote) reasons.push("quote_missing");
    else if (now - Date.parse(this.lastQuote.brokerTimestamp) > 30_000) {
      reasons.push("quote_stale");
      microLog("MICRO_QUOTE_STALE", { ageMs: now - Date.parse(this.lastQuote.brokerTimestamp) });
    }
    if (!m1) reasons.push("m1_missing");
    else if (now - m1.closeTimeMs > 5 * 60_000) reasons.push("m1_stale");
    if (this.lastErrorCode) reasons.push(this.lastErrorCode);

    let connectionState: MicroMarketDataConnectionState = "LIVE_NOT_CONNECTED";
    if (liveConnected && reasons.length === 0) connectionState = "LIVE_CONNECTED";
    else if (this.transport?.isConnected()) connectionState = "LIVE_NOT_CONNECTED";

    return {
      connectionState,
      liveConnected: connectionState === "LIVE_CONNECTED",
      credentialsConfigured: loadMicroCTraderCredentials().ok,
      symbol: this.symbol,
      lastQuote: this.lastQuote,
      lastQuoteTs: this.lastQuote?.brokerTimestamp ?? null,
      quoteAgeMs: this.lastQuote
        ? now - Date.parse(this.lastQuote.brokerTimestamp)
        : null,
      lastCompletedM1Ts: m1 ? new Date(m1.closeTimeMs).toISOString() : null,
      lastCompletedM5Ts: m5 ? new Date(m5.closeTimeMs).toISOString() : null,
      lastCompletedM15Ts: m15 ? new Date(m15.closeTimeMs).toISOString() : null,
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
      reconnectAttempts: this.reconnectAttempts,
      lastErrorCode: this.lastErrorCode,
      healthReasons: [...new Set(reasons)],
      collectorHeartbeatAt: this.heartbeatAt,
      m1CompletedEvents: this.m1CompletedEvents
    };
  }
}

/** Test helper: build a session with Fake transport. */
export function createFakeLiveSession(
  store: MicroMarketDataStore,
  fake: FakeMicroCTraderTransport = new FakeMicroCTraderTransport(),
  nowMs?: () => number
): { session: MicroLiveMarketSession; fake: FakeMicroCTraderTransport } {
  const credentials = {
    clientId: "test",
    clientSecret: "test",
    accessToken: "test-access",
    refreshToken: "test-refresh",
    accountId: "123",
    environment: "DEMO" as const,
    tokenUrl: "https://example.test/token",
    authUrl: "https://example.test/auth",
    redirectUri: null
  };
  const session = new MicroLiveMarketSession({
    store,
    transport: fake,
    credentials,
    nowMs
  });
  return { session, fake };
}
