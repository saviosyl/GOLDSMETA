/**
 * Authoritative XAUUSD BrokerSymbol cache for the active cTrader quote-worker
 * session. Keyed by owner + account + environment + symbolId.
 *
 * Lifetime = active authenticated worker session (not a 5s TTL).
 * Gold Hunter Spot/Depth freshness remains independent.
 */
import type { BrokerSymbol } from "../domain";
import { getConnection } from "./connectionStore";
import { loadDemoXauUsdSymbol } from "./demoPositionMutations";

export type WorkerSymbolMetadataSource =
  | "CTRADER_WORKER_SYMBOL_BY_ID"
  | "FALLBACK_DISCOVERY";

export type WorkerSymbolMetadataEntry = {
  symbol: BrokerSymbol;
  loadedAt: string;
  source: WorkerSymbolMetadataSource;
  ownerUid: string;
  ctidTraderAccountId: string;
  environment: "DEMO" | "LIVE";
  symbolId: string;
};

export type GoldHunterSymbolMetadataDiagnostics = {
  available: boolean;
  source: WorkerSymbolMetadataSource | null;
  loadedAt: string | null;
  symbolId: string | null;
  /** Actual cTrader Open API account id when known. */
  ctidTraderAccountId: string | null;
  accountMatched: boolean;
  environment: "DEMO" | "LIVE" | null;
};

type CacheKey = string;

const cache = new Map<CacheKey, WorkerSymbolMetadataEntry>();
const inflightFallback = new Map<
  CacheKey,
  Promise<WorkerSymbolMetadataEntry | null>
>();

let hits = 0;
let misses = 0;
let refreshes = 0;
let invalidated = 0;
let parseFailed = 0;

function keyOf(args: {
  ownerUid: string;
  ctidTraderAccountId: string;
  environment: "DEMO" | "LIVE";
  symbolId: string;
}): CacheKey {
  return [
    args.ownerUid,
    args.ctidTraderAccountId,
    args.environment,
    String(args.symbolId)
  ].join("|");
}

/** Sizing-critical completeness — mirrors metadataFromBrokerSymbol gates. */
export function isBrokerSymbolSizingComplete(symbol: BrokerSymbol): {
  complete: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  if (!symbol.symbolId) missing.push("symbolId");
  if (symbol.minVolume == null || !(symbol.minVolume > 0)) missing.push("minVolume");
  if (symbol.maxVolume == null || !(symbol.maxVolume > 0)) missing.push("maxVolume");
  if (symbol.volumeStep == null || !(symbol.volumeStep > 0)) {
    missing.push("volumeStep");
  }
  return { complete: missing.length === 0, missing };
}

function logCacheEvent(
  event:
    | "gold_hunter_symbol_cache_hit"
    | "gold_hunter_symbol_cache_miss"
    | "gold_hunter_symbol_cache_refresh"
    | "gold_hunter_symbol_cache_invalidated"
    | "gold_hunter_symbol_cache_parse_failed",
  fields: Record<string, string | number | boolean | null | undefined>
): void {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (/token|secret|password|authorization/i.test(k)) continue;
    safe[k] = v;
  }
  console.info(
    JSON.stringify({
      msg: event,
      product: "GOLD_HUNTER",
      ts: new Date().toISOString(),
      ...safe
    })
  );
}

export function resetWorkerSymbolMetadataCacheForTests(): void {
  cache.clear();
  inflightFallback.clear();
  hits = 0;
  misses = 0;
  refreshes = 0;
  invalidated = 0;
  parseFailed = 0;
}

export function workerSymbolMetadataCacheStats(): {
  hits: number;
  misses: number;
  refreshes: number;
  invalidated: number;
  parseFailed: number;
  size: number;
} {
  return {
    hits,
    misses,
    refreshes,
    invalidated,
    parseFailed,
    size: cache.size
  };
}

export function invalidateWorkerSymbolMetadataCache(args?: {
  ownerUid?: string;
  reason?: string;
}): void {
  if (!args?.ownerUid) {
    const n = cache.size;
    cache.clear();
    if (n > 0) {
      invalidated += n;
      logCacheEvent("gold_hunter_symbol_cache_invalidated", {
        reason: args?.reason ?? "all",
        count: n
      });
    }
    return;
  }
  let count = 0;
  for (const k of [...cache.keys()]) {
    if (k.startsWith(`${args.ownerUid}|`)) {
      cache.delete(k);
      count += 1;
    }
  }
  if (count > 0) {
    invalidated += count;
    logCacheEvent("gold_hunter_symbol_cache_invalidated", {
      ownerUidHash: args.ownerUid.slice(0, 6) + "…",
      reason: args.reason ?? "owner",
      count
    });
  }
}

/**
 * Store authoritative metadata from ProtoOASymbolById on the worker session.
 * Rejects incomplete sizing-critical fields.
 */
export function putWorkerSymbolMetadata(args: {
  ownerUid: string;
  ctidTraderAccountId: string;
  environment: "DEMO" | "LIVE";
  symbol: BrokerSymbol;
  source?: WorkerSymbolMetadataSource;
}): boolean {
  const check = isBrokerSymbolSizingComplete(args.symbol);
  if (!check.complete) {
    parseFailed += 1;
    logCacheEvent("gold_hunter_symbol_cache_parse_failed", {
      ownerUidHash: args.ownerUid.slice(0, 6) + "…",
      environment: args.environment,
      symbolId: String(args.symbol.symbolId),
      missing: check.missing.join(",")
    });
    return false;
  }
  if (args.symbol.environment !== args.environment) {
    parseFailed += 1;
    logCacheEvent("gold_hunter_symbol_cache_parse_failed", {
      ownerUidHash: args.ownerUid.slice(0, 6) + "…",
      reason: "environment_mismatch"
    });
    return false;
  }
  const entry: WorkerSymbolMetadataEntry = {
    symbol: args.symbol,
    loadedAt: new Date().toISOString(),
    source: args.source ?? "CTRADER_WORKER_SYMBOL_BY_ID",
    ownerUid: args.ownerUid,
    ctidTraderAccountId: String(args.ctidTraderAccountId),
    environment: args.environment,
    symbolId: String(args.symbol.symbolId)
  };
  cache.set(
    keyOf({
      ownerUid: args.ownerUid,
      ctidTraderAccountId: entry.ctidTraderAccountId,
      environment: entry.environment,
      symbolId: entry.symbolId
    }),
    entry
  );
  refreshes += 1;
  logCacheEvent("gold_hunter_symbol_cache_refresh", {
    ownerUidHash: args.ownerUid.slice(0, 6) + "…",
    environment: entry.environment,
    symbolId: entry.symbolId,
    source: entry.source
  });
  return true;
}

export function getWorkerSymbolMetadata(args: {
  ownerUid: string;
  ctidTraderAccountId: string;
  environment: "DEMO" | "LIVE";
  symbolId: string;
}): WorkerSymbolMetadataEntry | null {
  const k = keyOf({
    ownerUid: args.ownerUid,
    ctidTraderAccountId: String(args.ctidTraderAccountId),
    environment: args.environment,
    symbolId: String(args.symbolId)
  });
  return cache.get(k) ?? null;
}

/**
 * Gold Hunter DEMO symbol load: prefer worker-session cache; coalesce a single
 * fallback discovery when cache is missing.
 */
export async function loadGoldHunterDemoXauUsdSymbol(ownerUid: string): Promise<{
  symbol: BrokerSymbol | null;
  diagnostics: GoldHunterSymbolMetadataDiagnostics;
}> {
  const emptyDiag = (): GoldHunterSymbolMetadataDiagnostics => ({
    available: false,
    source: null,
    loadedAt: null,
    symbolId: null,
    ctidTraderAccountId: null,
    accountMatched: false,
    environment: null
  });

  const connection = await getConnection(ownerUid);
  if (!connection?.selectedAccountId || !connection.symbolId) {
    misses += 1;
    logCacheEvent("gold_hunter_symbol_cache_miss", {
      ownerUidHash: ownerUid.slice(0, 6) + "…",
      reason: "no_connection"
    });
    return { symbol: null, diagnostics: emptyDiag() };
  }

  const environment: "DEMO" | "LIVE" = connection.selectedAccountIsLive
    ? "LIVE"
    : connection.environment === "LIVE"
      ? "LIVE"
      : "DEMO";

  // Gold Hunter refuses LIVE metadata for execution sizing.
  if (environment === "LIVE" || connection.selectedAccountIsLive) {
    misses += 1;
    logCacheEvent("gold_hunter_symbol_cache_miss", {
      ownerUidHash: ownerUid.slice(0, 6) + "…",
      reason: "live_refused"
    });
    return {
      symbol: null,
      diagnostics: {
        available: false,
        source: null,
        loadedAt: null,
        symbolId: String(connection.symbolId),
        ctidTraderAccountId: connection.selectedAccountId
          ? String(connection.selectedAccountId)
          : null,
        accountMatched: false,
        environment: "LIVE"
      }
    };
  }

  const accountId = String(connection.selectedAccountId);
  const symbolId = String(connection.symbolId);
  const cached = getWorkerSymbolMetadata({
    ownerUid,
    ctidTraderAccountId: accountId,
    environment: "DEMO",
    symbolId
  });

  if (cached) {
    const check = isBrokerSymbolSizingComplete(cached.symbol);
    if (
      check.complete &&
      cached.environment === "DEMO" &&
      cached.ctidTraderAccountId === accountId &&
      cached.symbolId === symbolId
    ) {
      hits += 1;
      logCacheEvent("gold_hunter_symbol_cache_hit", {
        ownerUidHash: ownerUid.slice(0, 6) + "…",
        symbolId,
        source: cached.source
      });
      return {
        symbol: cached.symbol,
        diagnostics: {
          available: true,
          source: cached.source,
          loadedAt: cached.loadedAt,
          symbolId,
          ctidTraderAccountId: accountId,
          accountMatched: true,
          environment: "DEMO"
        }
      };
    }
  }

  misses += 1;
  logCacheEvent("gold_hunter_symbol_cache_miss", {
    ownerUidHash: ownerUid.slice(0, 6) + "…",
    symbolId,
    reason: "cache_miss"
  });

  const k = keyOf({
    ownerUid,
    ctidTraderAccountId: accountId,
    environment: "DEMO",
    symbolId
  });

  let pending = inflightFallback.get(k);
  if (!pending) {
    pending = (async () => {
      const symbol = await loadDemoXauUsdSymbol(ownerUid);
      if (!symbol) return null;
      if (symbol.environment === "LIVE") return null;
      const demoSymbol: BrokerSymbol = { ...symbol, environment: "DEMO" };
      const ok = putWorkerSymbolMetadata({
        ownerUid,
        ctidTraderAccountId: accountId,
        environment: "DEMO",
        symbol: demoSymbol,
        source: "FALLBACK_DISCOVERY"
      });
      if (!ok) return null;
      return getWorkerSymbolMetadata({
        ownerUid,
        ctidTraderAccountId: accountId,
        environment: "DEMO",
        symbolId: String(demoSymbol.symbolId)
      });
    })().finally(() => {
      inflightFallback.delete(k);
    });
    inflightFallback.set(k, pending);
  }

  const entry = await pending;
  if (!entry) {
    return {
      symbol: null,
      diagnostics: {
        available: false,
        source: null,
        loadedAt: null,
        symbolId,
        ctidTraderAccountId: accountId,
        accountMatched: true,
        environment: "DEMO"
      }
    };
  }

  return {
    symbol: entry.symbol,
    diagnostics: {
      available: true,
      source: entry.source,
      loadedAt: entry.loadedAt,
      symbolId: entry.symbolId,
      ctidTraderAccountId: accountId,
      accountMatched: true,
      environment: "DEMO"
    }
  };
}
