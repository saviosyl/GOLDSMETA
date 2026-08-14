/**
 * In-process Micro live market-data session (read-only).
 * Persistent spot subscription — 5s is STORAGE sample interval only.
 */
import {
  loadMicroCTraderCredentials,
  type MicroCTraderCredentials
} from "./microCTraderAuth";
import {
  FakeMicroCTraderTransport,
  RealMicroCTraderTransport,
  type MicroOpenApiTransport,
  type MicroTransportConnectLifecycle,
  type MicroTransportEventHandler
} from "./microCTraderTransport";
import { resolveMicroXauUsd } from "./microCTraderSymbolResolver";
import {
  applySpotEvent,
  createEmptySpotBook,
  publishQuoteFromBook,
  type MicroSpotBook
} from "./microCTraderQuotes";
import {
  fetchTrendbarsWindow,
  filterCompletedBars
} from "./microCTraderTrendbars";
import { detectCompletedM1 } from "./completedBars";
import { MICRO_TIMEFRAME_MS } from "./microCTraderProtocol";
import { MICRO_QUOTE_MAX_AGE_MS } from "../config";
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
  applicationAuthenticated: boolean;
  accountAuthenticated: boolean;
  configuredAccountAuthorized: boolean | null;
  authorizedAccountCount: number | null;
  symbol: MicroSymbolMetadata | null;
  spotSubscribed: boolean;
  spotSubscribedAt: string | null;
  lastSpotEventAt: string | null;
  /** VIEW-only Level-II depth subscription (read-only; not required for LIVE_CONNECTED). */
  depthSubscribed: boolean;
  depthSubscribedAt: string | null;
  lastDepthEventAt: string | null;
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
  subscribeSpotsCallCount: number;
  subscribeDepthCallCount: number;
};

export type LiveSessionOptions = {
  store: MicroMarketDataStore;
  transport?: MicroOpenApiTransport;
  credentials?: MicroCTraderCredentials;
  quoteSampleIntervalMs?: number;
  nowMs?: () => number;
  /**
   * Opt-in for GOLD HUNTER FAST research: bound transport open/auth.
   * Omitted → default unbounded connect (unchanged for other callers).
   */
  connectLifecycle?: MicroTransportConnectLifecycle | null;
  /**
   * Dynamic lifecycle resolver (research process remaining budget).
   * When set, preferred over static connectLifecycle at connect() time.
   */
  resolveConnectLifecycle?: () => MicroTransportConnectLifecycle | null | undefined;
};

export class MicroLiveMarketSession {
  private transport: MicroOpenApiTransport | null = null;
  private credentials: MicroCTraderCredentials | null = null;
  private symbol: MicroSymbolMetadata | null = null;
  private lastQuote: MicroQuote | null = null;
  private spotBook: MicroSpotBook | null = null;
  private spotHandler: MicroTransportEventHandler | null = null;
  private depthHandler: MicroTransportEventHandler | null = null;
  private spotSubscribed = false;
  private spotSubscribedAt: string | null = null;
  private lastSpotEventAt: string | null = null;
  private depthSubscribed = false;
  private depthSubscribedAt: string | null = null;
  private lastDepthEventAt: string | null = null;
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
  private depthEventListeners = new Set<
    (payload: Record<string, unknown>) => void
  >();
  private spotEventListeners = new Set<
    (payload: Record<string, unknown>) => void
  >();

  constructor(private readonly opts: LiveSessionOptions) {
    this.quoteSampleIntervalMs =
      opts.quoteSampleIntervalMs ??
      Number(process.env.MICRO_QUOTE_SAMPLE_INTERVAL_MS ?? 5000);
    this.nowMs = opts.nowMs ?? (() => Date.now());
    if (opts.credentials) this.credentials = opts.credentials;
  }

  get mutationSurface(): "NONE" {
    return "NONE";
  }

  private credentialsAreConfigured(): boolean {
    if (this.credentials) return true;
    if (this.opts.credentials) return true;
    return loadMicroCTraderCredentials().ok;
  }

  async connect(): Promise<void> {
    microLog("MICRO_CTRADER_CONNECTING", {});
    this.clearSpotState();
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
    const lifecycle =
      this.opts.resolveConnectLifecycle?.() ??
      this.opts.connectLifecycle ??
      undefined;
    try {
      await this.transport.connect(lifecycle ?? undefined);
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
      environment: this.credentials.environment,
      authorizedAccountCount:
        this.transport.getAccountAuthMeta()?.authorizedAccountCount ?? null
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

    await this.subscribeSpotsOnce();
    await this.subscribeDepthOnce();
  }

  private clearSpotState(): void {
    if (this.transport && this.spotHandler) {
      this.transport.off("ProtoOASpotEvent", this.spotHandler);
    }
    if (this.transport && this.depthHandler) {
      this.transport.off("ProtoOADepthEvent", this.depthHandler);
    }
    this.spotHandler = null;
    this.depthHandler = null;
    this.spotSubscribed = false;
    this.spotSubscribedAt = null;
    this.lastSpotEventAt = null;
    this.depthSubscribed = false;
    this.depthSubscribedAt = null;
    this.lastDepthEventAt = null;
    this.spotBook = null;
    this.lastQuote = null;
  }

  private async subscribeSpotsOnce(): Promise<void> {
    if (!this.transport || !this.symbol) return;
    if (this.spotSubscribed) return;
    this.spotBook = createEmptySpotBook(this.symbol.symbolId);
    this.spotHandler = (_name, payload) => {
      this.onSpotEvent(payload);
    };
    this.transport.on("ProtoOASpotEvent", this.spotHandler);
    await this.transport.subscribeSpots(this.symbol.symbolId);
    this.spotSubscribed = true;
    this.spotSubscribedAt = new Date(this.nowMs()).toISOString();
  }

  private async subscribeDepthOnce(): Promise<void> {
    if (!this.transport || !this.symbol) return;
    if (this.depthSubscribed) return;
    this.depthHandler = (_name, payload) => {
      this.onDepthEvent(payload);
    };
    this.transport.on("ProtoOADepthEvent", this.depthHandler);
    await this.transport.subscribeDepthQuotes(this.symbol.symbolId);
    this.depthSubscribed = true;
    this.depthSubscribedAt = new Date(this.nowMs()).toISOString();
    microLog("MICRO_DEPTH_SUBSCRIBED", {
      symbolId: this.symbol.symbolId,
      mutationSurface: "NONE"
    });
  }

  private onSpotEvent(payload: Record<string, unknown>): void {
    if (!this.symbol || !this.spotBook) return;
    this.spotBook = applySpotEvent(this.spotBook, payload, this.symbol.symbolId);
    this.lastSpotEventAt = new Date(this.nowMs()).toISOString();
    const pub = publishQuoteFromBook({
      book: this.spotBook,
      nowMs: this.nowMs(),
      maxSideAgeMs: MICRO_QUOTE_MAX_AGE_MS
    });
    if (pub.ok) {
      this.lastQuote = pub.quote;
      void this.maybePersistQuoteSample(pub.quote);
    }
    this.heartbeatAt = new Date(this.nowMs()).toISOString();
    void this.opts.store.saveCollectorHeartbeat(this.heartbeatAt, {
      symbolId: this.symbol.symbolId,
      lastSpotEventAt: this.lastSpotEventAt
    });
    for (const listener of this.spotEventListeners) listener(payload);
  }

  private onDepthEvent(payload: Record<string, unknown>): void {
    this.lastDepthEventAt = new Date(this.nowMs()).toISOString();
    this.heartbeatAt = new Date(this.nowMs()).toISOString();
    for (const listener of this.depthEventListeners) listener(payload);
  }

  /** Read-only listeners for GOLD_HUNTER FAST event-driven engine (no broker mutation). */
  onSpotForFast(listener: (payload: Record<string, unknown>) => void): () => void {
    this.spotEventListeners.add(listener);
    return () => this.spotEventListeners.delete(listener);
  }

  onDepthForFast(listener: (payload: Record<string, unknown>) => void): () => void {
    this.depthEventListeners.add(listener);
    return () => this.depthEventListeners.delete(listener);
  }

  private async maybePersistQuoteSample(quote: MicroQuote): Promise<void> {
    if (!this.symbol || !this.credentials) return;
    const now = this.nowMs();
    if (now - this.lastQuotePersistMs < this.quoteSampleIntervalMs) return;
    const bucket =
      Math.floor(now / this.quoteSampleIntervalMs) * this.quoteSampleIntervalMs;
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

  async disconnect(): Promise<void> {
    this.clearSpotState();
    if (this.transport) {
      await this.transport.disconnect();
    }
    this.transport = null;
    this.symbol = null;
    this.lastDisconnectedAt = new Date().toISOString();
    microLog("MICRO_CTRADER_DISCONNECTED", { code: this.lastErrorCode });
  }

  /**
   * Strict LIVE_CONNECTED: app+account auth, account in list, symbol, spot sub,
   * valid fresh quote, recent completed M1, collector heartbeat fresh.
   * Synchronous path omits async store M1 lookup — prefer getState().liveConnected
   * when a definitive status is required. This method still refuses socket+symbol+old-quote.
   */
  isLiveConnected(): boolean {
    const now = this.nowMs();
    if (!this.transport?.isConnected()) return false;
    if (!this.transport.isApplicationAuthenticated()) return false;
    if (!this.transport.isAccountAuthenticated()) return false;
    if (!this.transport.getAccountAuthMeta()?.configuredAccountAuthorized) return false;
    if (!this.symbol) return false;
    if (!this.spotSubscribed) return false;
    if (!this.lastQuote || !this.spotBook) return false;
    const pub = publishQuoteFromBook({
      book: this.spotBook,
      nowMs: now,
      maxSideAgeMs: MICRO_QUOTE_MAX_AGE_MS
    });
    if (!pub.ok) return false;
    if (!this.heartbeatAt) return false;
    const hbAge = now - Date.parse(this.heartbeatAt);
    if (!Number.isFinite(hbAge) || hbAge > 60_000) return false;
    if (this.lastErrorCode != null) return false;
    return true;
  }

  /** Refresh from in-memory spot book — does NOT re-subscribe. */
  async refreshQuote(): Promise<MicroQuote> {
    if (!this.transport || !this.symbol || !this.spotBook) {
      throw Object.assign(new Error("MICRO_NOT_CONNECTED"), {
        code: "transport_disconnected"
      });
    }
    if (!this.spotSubscribed) {
      await this.subscribeSpotsOnce();
    }
    const pub = publishQuoteFromBook({
      book: this.spotBook,
      nowMs: this.nowMs(),
      maxSideAgeMs: MICRO_QUOTE_MAX_AGE_MS
    });
    if (!pub.ok) {
      if (pub.error === "quote_stale") {
        microLog("MICRO_QUOTE_STALE", { ageMs: pub.ageMs });
      }
      throw Object.assign(new Error("MICRO_QUOTE_UNAVAILABLE"), {
        code: pub.error
      });
    }
    this.lastQuote = pub.quote;
    this.heartbeatAt = new Date(this.nowMs()).toISOString();
    await this.maybePersistQuoteSample(pub.quote);
    return pub.quote;
  }

  /** Inject spot event (tests) without extra subscribe. */
  ingestSpotEventForTests(payload: Record<string, unknown>): void {
    this.onSpotEvent(payload);
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

  /**
   * Force Depth unsubscribe+subscribe so the broker re-sends a fresh book.
   * Used by GOLD_HUNTER FAST research sustained-cross recovery only.
   * Does not place orders; VIEW-only Open API commands.
   */
  async resubscribeDepthForRecovery(): Promise<boolean> {
    if (!this.transport || !this.symbol) return false;
    if (!this.transport.isConnected()) return false;
    try {
      if (this.depthSubscribed) {
        await this.transport.unsubscribeDepthQuotes(this.symbol.symbolId);
        this.depthSubscribed = false;
        this.depthSubscribedAt = null;
      }
      // Allow subscribeDepthOnce to run again.
      await this.subscribeDepthOnce();
      microLog("MICRO_DEPTH_RESUBSCRIBED", {
        symbolId: this.symbol.symbolId,
        reason: "sustained_cross_recovery",
        mutationSurface: "NONE"
      });
      return this.depthSubscribed;
    } catch (e) {
      this.lastErrorCode =
        (e as { code?: string }).code ?? "depth_resubscribe_failed";
      return false;
    }
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
    const reasons: string[] = [];
    const credsConfigured = this.credentialsAreConfigured();
    if (!credsConfigured) reasons.push("oauth_missing");
    if (!this.transport?.isConnected()) reasons.push("transport_disconnected");
    if (this.transport && !this.transport.isApplicationAuthenticated()) {
      reasons.push("transport_disconnected");
    }
    if (this.transport && !this.transport.isAccountAuthenticated()) {
      reasons.push("account_not_authorized");
    }
    const authMeta = this.transport?.getAccountAuthMeta() ?? null;
    if (this.transport && authMeta && !authMeta.configuredAccountAuthorized) {
      reasons.push("account_not_authorized");
    }
    if (!this.symbol) reasons.push("xauusd_not_found");
    if (!this.spotSubscribed) reasons.push("transport_disconnected");
    if (!this.spotBook || this.lastQuote == null) reasons.push("quote_missing");
    else {
      const pub = publishQuoteFromBook({
        book: this.spotBook,
        nowMs: now,
        maxSideAgeMs: MICRO_QUOTE_MAX_AGE_MS
      });
      if (!pub.ok) {
        reasons.push(pub.error);
        if (pub.error === "quote_stale") {
          microLog("MICRO_QUOTE_STALE", { ageMs: pub.ageMs });
        }
      }
    }
    if (!m1) reasons.push("m1_missing");
    else if (now - m1.closeTimeMs > 5 * 60_000) reasons.push("m1_stale");
    if (this.heartbeatAt) {
      const hbAge = now - Date.parse(this.heartbeatAt);
      if (!Number.isFinite(hbAge) || hbAge > 60_000) {
        reasons.push("collector_heartbeat_stale");
      }
    } else if (this.transport?.isConnected()) {
      reasons.push("collector_heartbeat_stale");
    }
    if (this.lastErrorCode) reasons.push(this.lastErrorCode);

    const unique = [...new Set(reasons)];
    const liveConnected = unique.length === 0;
    const connectionState: MicroMarketDataConnectionState = liveConnected
      ? "LIVE_CONNECTED"
      : "LIVE_NOT_CONNECTED";

    const quoteAgeMs = this.lastQuote
      ? now - Date.parse(this.lastQuote.brokerTimestamp)
      : null;

    return {
      connectionState,
      liveConnected,
      credentialsConfigured: credsConfigured,
      applicationAuthenticated: this.transport?.isApplicationAuthenticated() ?? false,
      accountAuthenticated: this.transport?.isAccountAuthenticated() ?? false,
      configuredAccountAuthorized: authMeta?.configuredAccountAuthorized ?? null,
      authorizedAccountCount: authMeta?.authorizedAccountCount ?? null,
      symbol: this.symbol,
      spotSubscribed: this.spotSubscribed,
      spotSubscribedAt: this.spotSubscribedAt,
      lastSpotEventAt: this.lastSpotEventAt,
      depthSubscribed: this.depthSubscribed,
      depthSubscribedAt: this.depthSubscribedAt,
      lastDepthEventAt: this.lastDepthEventAt,
      lastQuote: this.lastQuote,
      lastQuoteTs: this.lastQuote?.brokerTimestamp ?? null,
      quoteAgeMs,
      lastCompletedM1Ts: m1 ? new Date(m1.closeTimeMs).toISOString() : null,
      lastCompletedM5Ts: m5 ? new Date(m5.closeTimeMs).toISOString() : null,
      lastCompletedM15Ts: m15 ? new Date(m15.closeTimeMs).toISOString() : null,
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
      reconnectAttempts: this.reconnectAttempts,
      lastErrorCode: this.lastErrorCode,
      healthReasons: unique,
      collectorHeartbeatAt: this.heartbeatAt,
      m1CompletedEvents: this.m1CompletedEvents,
      subscribeSpotsCallCount: this.transport?.getSubscribeSpotsCallCount() ?? 0,
      subscribeDepthCallCount: this.transport?.getSubscribeDepthCallCount() ?? 0
    };
  }
}

/** Test helper: build a session with Fake transport. */
export function createFakeLiveSession(
  store: MicroMarketDataStore,
  fake: FakeMicroCTraderTransport = new FakeMicroCTraderTransport(),
  nowMs?: () => number
): { session: MicroLiveMarketSession; fake: FakeMicroCTraderTransport } {
  const credentials: MicroCTraderCredentials = {
    clientId: "test",
    clientSecret: "test",
    accessToken: "test-access",
    refreshToken: "test-refresh",
    accountId: "123",
    environment: "DEMO",
    tokenUrl: "https://example.test/token",
    authUrl: "https://example.test/auth",
    redirectUri: null
  };
  fake.configuredAccountId = "123";
  fake.authorizedAccountIds = ["123"];
  const session = new MicroLiveMarketSession({
    store,
    transport: fake,
    credentials,
    nowMs
  });
  return { session, fake };
}
