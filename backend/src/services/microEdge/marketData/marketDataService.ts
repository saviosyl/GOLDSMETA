/**
 * Micro market-data service used by read-only API.
 * Deployed mode: Firestore store + persistent collector status (cross-process).
 * Does not activate prediction worker. Does not deploy.
 */
import { loadMicroCTraderCredentials, publicCredentialStatus } from "./microCTraderAuth";
import {
  getMicroMarketDataStore,
  resetMicroMarketDataStoreForTests,
  type MicroMarketDataStore
} from "./marketDataStore";
import { MicroCTraderReadOnlyClient } from "./microCTraderClient";
import { getCollectorStatus } from "../runtime/collector";
import { getMicroRetentionPolicy } from "./retention";
import { computeLabelReadyDiagnostics } from "./historicalTicks";
import {
  evaluatePersistentCollectorHealth,
  getMicroCollectorStatusStore
} from "./collectorStatusStore";
import type { MicroLiveMarketSession } from "./liveSession";

const client = new MicroCTraderReadOnlyClient();
let liveSession: MicroLiveMarketSession | null = null;

export { getMicroMarketDataStore, resetMicroMarketDataStoreForTests };
export type { MicroMarketDataStore };

export function getMicroMarketClient(): MicroCTraderReadOnlyClient {
  return client;
}

export function attachMicroLiveSession(session: MicroLiveMarketSession | null): void {
  liveSession = session;
  client.attachLiveSession(session);
}

export type BuildMarketDataStatusOptions = {
  /**
   * When the Micro OAuth vault is authorized for the calling user, pass true so
   * API health does not report oauth_missing merely because the collector process
   * has not started (env MICRO_CTRADER_ACCESS_TOKEN is intentionally unused).
   */
  vaultOAuthConfigured?: boolean;
};

export async function buildMarketDataStatusPayload(
  nowMs = Date.now(),
  opts: BuildMarketDataStatusOptions = {}
): Promise<Record<string, unknown>> {
  const store = getMicroMarketDataStore();
  const statusStore = getMicroCollectorStatusStore();
  const persistent = await statusStore.get();
  const persistentHealth = evaluatePersistentCollectorHealth(persistent, nowMs);

  const creds = loadMicroCTraderCredentials();
  const pub = publicCredentialStatus(creds);
  // In-process session is optional (same-process tests). Cross-process truth = Firestore.
  const liveState = liveSession ? await liveSession.getState() : null;
  const m1 = await store.latestBar("M1");
  const m5 = await store.latestBar("M5");
  const m15 = await store.latestBar("M15");
  const latestQuote = await store.latestQuote();

  const quoteBrokerTs =
    persistent?.lastQuoteBrokerTimestamp ??
    liveState?.lastQuoteTs ??
    latestQuote?.brokerTimestamp ??
    null;
  const quoteAgeMs =
    persistentHealth.quoteAgeMs ??
    (quoteBrokerTs ? nowMs - Date.parse(quoteBrokerTs) : null);

  const quoteForHealth =
    persistent?.lastQuoteBid != null && persistent?.lastQuoteAsk != null && quoteBrokerTs
      ? {
          bid: persistent.lastQuoteBid,
          ask: persistent.lastQuoteAsk,
          mid: (persistent.lastQuoteBid + persistent.lastQuoteAsk) / 2,
          spread: persistent.lastQuoteAsk - persistent.lastQuoteBid,
          brokerTimestamp: quoteBrokerTs,
          receivedAt: persistent.updatedAt,
          ageMs: quoteAgeMs ?? 0,
          freshness: (quoteAgeMs != null && quoteAgeMs <= 30_000
            ? "LIVE"
            : "STALE") as "LIVE" | "STALE"
        }
      : liveState?.lastQuote
        ? liveState.lastQuote
        : latestQuote
          ? {
              bid: latestQuote.bid,
              ask: latestQuote.ask,
              mid: latestQuote.mid,
              spread: latestQuote.spread,
              brokerTimestamp: latestQuote.brokerTimestamp,
              receivedAt: latestQuote.receivedAt,
              ageMs: quoteAgeMs ?? latestQuote.ageMs,
              freshness: (quoteAgeMs != null && quoteAgeMs <= 30_000
                ? "LIVE"
                : "STALE") as "LIVE" | "STALE"
            }
          : null;

  // Prefer persistent status when present (worker process).
  const usePersistent = persistent != null;
  const liveConnected = usePersistent
    ? persistentHealth.liveConnected
    : liveState?.connectionState === "LIVE_CONNECTED" ||
      client.connectionState() === "LIVE_CONNECTED";
  const connectionState = liveConnected
    ? "LIVE_CONNECTED"
    : ("LIVE_NOT_CONNECTED" as const);

  const collector = getCollectorStatus(client, {
    lastQuoteTs: quoteBrokerTs,
    lastM1CloseTs:
      persistent?.lastCompletedM1 ??
      (m1 ? new Date(m1.closeTimeMs).toISOString() : null),
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
    transportConnected: usePersistent ? persistentHealth.liveConnected : undefined,
    symbolResolved: usePersistent
      ? Boolean(persistent?.symbolId)
      : liveSession
        ? Boolean(liveState?.symbol ?? (await store.getSymbolMetadata()))
        : undefined,
    credentialsConfigured: usePersistent
      ? Boolean(persistent?.oauthStatus && persistent.oauthStatus !== "AWAITING_USER_AUTHORIZATION")
      : liveState?.credentialsConfigured ??
        opts.vaultOAuthConfigured ??
        pub.configured,
    heartbeatAt: persistent?.heartbeatAt ?? liveState?.collectorHeartbeatAt ?? null,
    lastConnectedAt: liveState?.lastConnectedAt,
    lastDisconnectedAt: liveState?.lastDisconnectedAt,
    reconnectAttempts:
      persistent?.reconnectAttempts ?? liveState?.reconnectAttempts,
    lastErrorCode: liveState?.lastErrorCode,
    extraReasons: usePersistent ? persistentHealth.reasons : liveState?.healthReasons
  });

  const boundaries = await store.listBoundaryQuotes(50_000);
  const labelReady = computeLabelReadyDiagnostics(boundaries);

  return {
    connectionState,
    liveConnected,
    marketFeedStatus: liveConnected
      ? "Market feed connected"
      : "Market feed not connected",
    symbol: persistent?.symbolName ?? liveState?.symbol?.symbolName ?? "XAUUSD",
    symbolId: persistent?.symbolId ?? liveState?.symbol?.symbolId ?? null,
    broker: persistent?.broker ?? null,
    brokerVerified: persistent?.brokerVerified ?? null,
    lastQuoteTs: quoteBrokerTs,
    quoteAgeMs,
    heartbeatAgeMs: persistentHealth.heartbeatAgeMs,
    lastCompletedM1Ts:
      persistent?.lastCompletedM1 ??
      liveState?.lastCompletedM1Ts ??
      (m1 ? new Date(m1.closeTimeMs).toISOString() : null),
    lastCompletedM5Ts:
      persistent?.lastCompletedM5 ??
      liveState?.lastCompletedM5Ts ??
      (m5 ? new Date(m5.closeTimeMs).toISOString() : null),
    lastCompletedM15Ts:
      persistent?.lastCompletedM15 ??
      liveState?.lastCompletedM15Ts ??
      (m15 ? new Date(m15.closeTimeMs).toISOString() : null),
    collectorHealthy: usePersistent
      ? persistentHealth.collectorHealthy
      : collector.healthy,
    healthReasons: usePersistent ? persistentHealth.reasons : collector.reasons,
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
    collector: {
      ...collector,
      healthy: usePersistent ? persistentHealth.collectorHealthy : collector.healthy,
      reasons: usePersistent ? persistentHealth.reasons : collector.reasons,
      heartbeatAgeMs: persistentHealth.heartbeatAgeMs
    },
    capabilityStates: client.capabilityStates(),
    interfaceReady: true,
    historicalTicks: client.capabilityStates().HISTORICAL_TICKS,
    depthOfMarket: "FEATURE_GATED",
    modelNote: "DATA COLLECTION / NOT TRAINED ON REAL DATA",
    dataCollectionActive: liveConnected,
    boundaryQuoteCount: await store.countBoundaryQuotes(),
    labelReadyMinutes: labelReady.labelReadyMinutes,
    persistentCollector: persistent
      ? {
          connectionState: persistent.connectionState,
          oauthStatus: persistent.oauthStatus,
          heartbeatAt: persistent.heartbeatAt,
          collectorVersion: persistent.collectorVersion
        }
      : null
  };
}

export async function buildMarketDataDiagnosticsPayload(): Promise<Record<string, unknown>> {
  const store = getMicroMarketDataStore();
  const status = await buildMarketDataStatusPayload();
  const latestQuote = await store.latestQuote();
  const symbol = await store.getSymbolMetadata();
  const boundaries = await store.listBoundaryQuotes(50_000);
  const labelReady = computeLabelReadyDiagnostics(boundaries);
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
          // Recompute age — do not trust stored ageMs forever.
          ageMs: Date.now() - Date.parse(latestQuote.brokerTimestamp),
          freshness: latestQuote.freshness,
          source: latestQuote.source
        }
      : null,
    labelReady,
    boundaryQuoteCount: boundaries.length,
    accessToken: undefined,
    refreshToken: undefined,
    clientSecret: undefined,
    mutationSurface: "NONE"
  };
}
