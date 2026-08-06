/**
 * One authoritative Pepperstone XAUUSD quote service for:
 * - dashboard display
 * - AutoTrade pre-order validation
 * - spread / distance / tolerance checks
 * - position monitoring
 *
 * Independent of the 15M plan-generation cycle.
 *
 * Architecture honesty:
 * - HTTP Cloud Functions open a Spotware WebSocket per refresh and close it
 *   after one tick (`openApiClient.withOpenApiConnection`). That is NOT a
 *   continuous stream between requests.
 * - Continuous pricing requires `persistentQuoteWorker` (always-on runtime)
 *   writing into the Firestore quote store; this service then serves snapshots.
 * - The 1-minute `refreshCTraderLiveQuotes` scheduler is only a keepalive
 *   fallback, not a live tick worker.
 */

import {
  assertBrokerUser,
  ensureFreshAccessToken
} from "./connectionService";
import { getConnection } from "./connectionStore";
import {
  buildAuthoritativeQuote,
  loadLiveQuoteThresholds,
  publicLiveQuotePayload,
  refreshAuthoritativeFreshness,
  toBrokerQuote,
  type AuthoritativeQuote
} from "./liveQuote";
import {
  getStoredAuthoritativeQuote,
  nextQuoteSequence,
  saveAuthoritativeQuote,
  listOwnersNeedingQuoteRefresh
} from "./quoteStore";
import {
  createOpenApiClient,
  type CTraderOpenApiClient
} from "./openApiClient";
import type { BrokerQuote } from "../domain";

/** Serve cached quote when fresher than this (ms) to avoid excessive broker WS opens. */
const DEFAULT_CACHE_MAX_AGE_MS = 1_000;

function cacheMaxAgeMs(source: NodeJS.ProcessEnv = process.env): number {
  const n = Number(source.CTRADER_QUOTE_CACHE_MAX_AGE_MS ?? "");
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_CACHE_MAX_AGE_MS;
}

function clientCreds(source = process.env) {
  return {
    clientId: (source.CTRADER_CLIENT_ID ?? "").trim(),
    clientSecret: (source.CTRADER_CLIENT_SECRET ?? "").trim()
  };
}

export type LiveQuoteSnapshotResult = {
  available: boolean;
  quote: ReturnType<typeof publicLiveQuotePayload>["quote"];
  label: string;
  /** Separate health — never conflated with plan/confirm/autotrade. */
  livePriceHealth: AuthoritativeQuote["freshness"] | "UNAVAILABLE";
  thresholds: ReturnType<typeof loadLiveQuoteThresholds>;
};

/**
 * Fetch a fresh tick from Pepperstone, persist it, return authoritative record.
 */
export async function refreshAuthoritativeQuoteFromBroker(
  ownerUid: string,
  api: CTraderOpenApiClient = createOpenApiClient()
): Promise<AuthoritativeQuote> {
  assertBrokerUser(ownerUid);
  const connection = await getConnection(ownerUid);
  if (!connection?.selectedAccountId || !connection.symbolId) {
    throw Object.assign(new Error("CTRADER_ACCOUNT_OR_SYMBOL_REQUIRED"), {
      code: "CTRADER_ACCOUNT_OR_SYMBOL_REQUIRED"
    });
  }

  const { accessToken, connection: freshConn } =
    await ensureFreshAccessToken(connection);
  const { clientId, clientSecret } = clientCreds();
  const isLive = Boolean(freshConn.selectedAccountIsLive);
  const brokerQuote = await api.fetchQuote({
    accessToken,
    clientId,
    clientSecret,
    ctidTraderAccountId: freshConn.selectedAccountId!,
    symbolId: freshConn.symbolId!,
    isLive
  });

  if (brokerQuote.bid == null || brokerQuote.ask == null) {
    throw Object.assign(new Error("CTRADER_QUOTE_UNAVAILABLE"), {
      code: "CTRADER_QUOTE_UNAVAILABLE"
    });
  }

  const sequence = await nextQuoteSequence(ownerUid);
  const authoritative = buildAuthoritativeQuote({
    symbolId: freshConn.symbolId!,
    symbolName: freshConn.symbolName ?? brokerQuote.symbolName ?? "XAUUSD",
    digits: freshConn.symbolDigits ?? null,
    pipPosition: freshConn.symbolPipPosition ?? null,
    bid: brokerQuote.bid,
    ask: brokerQuote.ask,
    brokerTimestamp: brokerQuote.timestamp ?? new Date().toISOString(),
    quoteSequence: sequence,
    marketStatus: brokerQuote.marketStatus,
    environment: isLive ? "LIVE" : "DEMO",
    source: "LIVE",
    thresholds: loadLiveQuoteThresholds()
  });

  await saveAuthoritativeQuote(ownerUid, authoritative);
  return authoritative;
}

/**
 * Latest verified quote for dashboard display.
 * Prefers the authoritative store (populated by the always-on worker).
 * Optionally opens a short-lived broker WS only when the store is empty/old
 * and no persistent worker is feeding ticks.
 * Never throws for DELAYED/STALE — caller sees freshness instead.
 */
export async function getLiveQuoteSnapshot(args: {
  ownerUid: string;
  /** When true, hit broker if cache older than cacheMaxAge. Default true. */
  refreshIfNeeded?: boolean;
  api?: CTraderOpenApiClient;
  nowMs?: number;
}): Promise<LiveQuoteSnapshotResult> {
  assertBrokerUser(args.ownerUid);
  const thresholds = loadLiveQuoteThresholds();
  const nowMs = args.nowMs ?? Date.now();
  const refreshIfNeeded = args.refreshIfNeeded !== false;
  // When a persistent worker is expected, prefer store-only reads (no per-request WS).
  const preferStoreOnly =
    String(process.env.CTRADER_QUOTE_PREFER_STORE ?? "").toLowerCase() === "true";

  let stored = await getStoredAuthoritativeQuote(args.ownerUid);
  if (stored) {
    stored = {
      ...refreshAuthoritativeFreshness(stored, nowMs, thresholds),
      ownerUid: stored.ownerUid,
      updatedAt: stored.updatedAt
    };
  }

  const cacheAge = stored
    ? nowMs - Date.parse(stored.receivedAt)
    : Number.POSITIVE_INFINITY;

  if (
    refreshIfNeeded &&
    !preferStoreOnly &&
    (stored == null || cacheAge >= cacheMaxAgeMs())
  ) {
    try {
      const fresh = await refreshAuthoritativeQuoteFromBroker(
        args.ownerUid,
        args.api ?? createOpenApiClient()
      );
      const payload = publicLiveQuotePayload(fresh);
      return {
        available: payload.available,
        quote: payload.quote,
        label: "Pepperstone cTrader live quote",
        livePriceHealth: fresh.freshness,
        thresholds
      };
    } catch (e) {
      // Fall through to last verified quote when broker refresh fails.
      if (!stored) {
        const code =
          e && typeof e === "object" && "code" in e
            ? String((e as { code: string }).code)
            : "CTRADER_QUOTE_UNAVAILABLE";
        throw Object.assign(new Error(code), { code, cause: e });
      }
    }
  }

  if (!stored) {
    return {
      available: false,
      quote: null,
      label: "Price unavailable",
      livePriceHealth: "UNAVAILABLE",
      thresholds
    };
  }

  const current = refreshAuthoritativeFreshness(stored, nowMs, thresholds);
  const payload = publicLiveQuotePayload(current);
  return {
    available: payload.available,
    quote: payload.quote,
    label: "Pepperstone cTrader live quote",
    livePriceHealth: current.freshness,
    thresholds
  };
}

/**
 * Quote for AutoTrade execution validation.
 * Fail closed when not LIVE + OPEN.
 */
export async function getExecutableQuoteForAutoTrade(args: {
  ownerUid: string;
  api?: CTraderOpenApiClient;
  nowMs?: number;
}): Promise<AuthoritativeQuote> {
  const snap = await getLiveQuoteSnapshot({
    ownerUid: args.ownerUid,
    refreshIfNeeded: true,
    api: args.api,
    nowMs: args.nowMs
  });
  if (!snap.quote) {
    throw Object.assign(new Error("CTRADER_QUOTE_UNAVAILABLE"), {
      code: "CTRADER_QUOTE_UNAVAILABLE"
    });
  }
  if (snap.quote.marketStatus === "CLOSED") {
    throw Object.assign(new Error("MARKET_CLOSED"), {
      code: "MARKET_CLOSED",
      quote: snap.quote
    });
  }
  if (!snap.quote.executable || snap.quote.freshness !== "LIVE") {
    throw Object.assign(new Error("CTRADER_QUOTE_STALE"), {
      code: "CTRADER_QUOTE_STALE",
      quote: snap.quote,
      freshness: snap.quote.freshness
    });
  }
  return {
    ...snap.quote,
    source: "LIVE",
    receivedAt: snap.quote.receivedAt
  };
}

/** Compatibility: BrokerQuote for existing preview / diagnostics paths. */
export async function readAuthoritativeBrokerQuote(
  ownerUid: string,
  api?: CTraderOpenApiClient
): Promise<BrokerQuote> {
  const q = await getExecutableQuoteForAutoTrade({ ownerUid, api });
  return toBrokerQuote(q);
}

/**
 * Background keepalive — refresh quotes for connected owners while UI is closed.
 * Safe to call from a 1-minute scheduler; frontend short-poll keeps display live.
 */
export async function runQuoteKeepalivePass(opts?: {
  limit?: number;
  api?: CTraderOpenApiClient;
}): Promise<{ refreshed: number; failed: number; owners: string[] }> {
  const owners = await listOwnersNeedingQuoteRefresh(opts?.limit ?? 50);
  let refreshed = 0;
  let failed = 0;
  for (const ownerUid of owners) {
    try {
      await refreshAuthoritativeQuoteFromBroker(
        ownerUid,
        opts?.api ?? createOpenApiClient()
      );
      refreshed += 1;
    } catch {
      failed += 1;
    }
  }
  return { refreshed, failed, owners };
}
