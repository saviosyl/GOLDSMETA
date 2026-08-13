/**
 * Process-local Micro market-data service used by read-only API.
 * Does not activate prediction worker. Does not deploy.
 */
import { loadMicroCTraderCredentials, publicCredentialStatus } from "./microCTraderAuth";
import { MemoryMicroMarketDataStore } from "./marketDataStore";
import { MicroCTraderReadOnlyClient } from "./microCTraderClient";
import { getCollectorStatus } from "../runtime/collector";
import { getMicroRetentionPolicy } from "./retention";
import type { MicroLiveMarketSession } from "./liveSession";

const store = new MemoryMicroMarketDataStore();
const client = new MicroCTraderReadOnlyClient();
let liveSession: MicroLiveMarketSession | null = null;

export function getMicroMarketDataStore(): MemoryMicroMarketDataStore {
  return store;
}

export function getMicroMarketClient(): MicroCTraderReadOnlyClient {
  return client;
}

export function attachMicroLiveSession(session: MicroLiveMarketSession | null): void {
  liveSession = session;
  client.attachLiveSession(session);
}

export async function buildMarketDataStatusPayload(nowMs = Date.now()): Promise<Record<string, unknown>> {
  const creds = loadMicroCTraderCredentials();
  const pub = publicCredentialStatus(creds);
  const liveState = liveSession ? await liveSession.getState() : null;
  const m1 = await store.latestBar("M1");
  const m5 = await store.latestBar("M5");
  const m15 = await store.latestBar("M15");
  const latestQuote = liveState?.lastQuote ?? (await store.latestQuote());
  const quoteForHealth = liveState?.lastQuote
    ? liveState.lastQuote
    : latestQuote
      ? {
          bid: latestQuote.bid,
          ask: latestQuote.ask,
          mid: latestQuote.mid,
          spread: latestQuote.spread,
          brokerTimestamp: latestQuote.brokerTimestamp,
          receivedAt: latestQuote.receivedAt,
          ageMs: latestQuote.ageMs,
          freshness: latestQuote.freshness as "LIVE"
        }
      : null;

  const collector = getCollectorStatus(client, {
    lastQuoteTs: liveState?.lastQuoteTs ?? latestQuote?.brokerTimestamp ?? null,
    lastM1CloseTs: m1 ? new Date(m1.closeTimeMs).toISOString() : null,
    quote: quoteForHealth,
    lastM1: m1
      ? {
          timeframe: "M1",
          openTimeMs: m1.openTimeMs,
          closeTimeMs: m1.closeTimeMs,
          open: m1.open,
          high: m1.high,
          low: m1.low,
          close: m1.close,
          tickVolume: m1.tickVolume
        }
      : null,
    nowMs,
    transportConnected: liveSession
      ? Boolean(liveState?.liveConnected || liveSession.isLiveConnected())
      : undefined,
    symbolResolved: liveSession
      ? Boolean(liveState?.symbol ?? (await store.getSymbolMetadata()))
      : undefined,
    credentialsConfigured: liveState?.credentialsConfigured ?? pub.configured,
    heartbeatAt: liveState?.collectorHeartbeatAt ?? null,
    lastConnectedAt: liveState?.lastConnectedAt,
    lastDisconnectedAt: liveState?.lastDisconnectedAt,
    reconnectAttempts: liveState?.reconnectAttempts,
    lastErrorCode: liveState?.lastErrorCode,
    extraReasons: liveState?.healthReasons
  });

  // Honest: only LIVE_CONNECTED when session reports it — never infer from config alone.
  const connectionState = liveState?.connectionState ?? client.connectionState();
  const liveConnected = connectionState === "LIVE_CONNECTED";

  return {
    connectionState,
    liveConnected,
    marketFeedStatus: liveConnected
      ? "Market feed connected"
      : "Market feed not connected",
    symbol: liveState?.symbol?.symbolName ?? "XAUUSD",
    symbolId: liveState?.symbol?.symbolId ?? null,
    lastQuoteTs: liveState?.lastQuoteTs ?? latestQuote?.brokerTimestamp ?? null,
    quoteAgeMs: liveState?.quoteAgeMs ?? null,
    lastCompletedM1Ts: liveState?.lastCompletedM1Ts ?? (m1 ? new Date(m1.closeTimeMs).toISOString() : null),
    lastCompletedM5Ts: liveState?.lastCompletedM5Ts ?? (m5 ? new Date(m5.closeTimeMs).toISOString() : null),
    lastCompletedM15Ts:
      liveState?.lastCompletedM15Ts ?? (m15 ? new Date(m15.closeTimeMs).toISOString() : null),
    collectorHealthy: collector.healthy,
    healthReasons: collector.reasons,
    backfillStatus: {
      M1: await store.getCheckpoint("M1"),
      M5: await store.getCheckpoint("M5"),
      M15: await store.getCheckpoint("M15")
    },
    historicalObservationCounts: {
      M1: await store.countBars("M1"),
      M5: await store.countBars("M5"),
      M15: await store.countBars("M15")
    },
    quoteSamplesStored: await store.countQuotes(),
    credentials: pub,
    retention: getMicroRetentionPolicy(),
    collector,
    capabilityStates: client.capabilityStates(),
    interfaceReady: true,
    historicalTicks: "FEATURE_GATED",
    depthOfMarket: "FEATURE_GATED",
    modelNote: "RESEARCH / NOT TRAINED ON LIVE DATA",
    dataCollectionActive: liveConnected
  };
}

export async function buildMarketDataDiagnosticsPayload(): Promise<Record<string, unknown>> {
  const status = await buildMarketDataStatusPayload();
  const latestQuote = await store.latestQuote();
  const symbol = await store.getSymbolMetadata();
  return {
    ...status,
    symbolMetadata: symbol,
    latestQuote: latestQuote
      ? {
          bid: latestQuote.bid,
          ask: latestQuote.ask,
          mid: latestQuote.mid,
          spread: latestQuote.spread,
          brokerTimestamp: latestQuote.brokerTimestamp,
          ageMs: latestQuote.ageMs,
          freshness: latestQuote.freshness,
          source: latestQuote.source
        }
      : null,
    // Explicitly never include secrets
    accessToken: undefined,
    refreshToken: undefined,
    clientSecret: undefined,
    mutationSurface: "NONE"
  };
}
