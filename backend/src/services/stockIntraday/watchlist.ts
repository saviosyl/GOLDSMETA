/**
 * Controlled SHADOW watchlist — max 10 liquid US symbols.
 * Each symbol must pass Alpaca availability + Trading 212 instrument validation.
 */

import { DEFAULT_ALPACA_SHADOW_WATCHLIST } from "./marketData/alpacaConfig";
import type { MarketDataProvider } from "./marketData/marketDataProvider";
import type { T212BrokerAdapter } from "./broker/t212BrokerAdapter";
import type { StockUniverseFilters } from "./types";

export const MAX_SHADOW_WATCHLIST = 10;

/** Default engineering watchlist (editable; capped at MAX_SHADOW_WATCHLIST). */
export const DEFAULT_SHADOW_WATCHLIST = [...DEFAULT_ALPACA_SHADOW_WATCHLIST];

export function defaultShadowWatchlist(max = MAX_SHADOW_WATCHLIST): string[] {
  return [...DEFAULT_ALPACA_SHADOW_WATCHLIST].slice(0, Math.min(max, MAX_SHADOW_WATCHLIST));
}

export type WatchlistValidationResult = {
  symbol: string;
  accepted: boolean;
  alpacaAvailable: boolean;
  t212Available: boolean;
  universeEligible: boolean;
  reasons: string[];
};

export function isUniverseEligible(symbol: string, universe: StockUniverseFilters): boolean {
  const upper = symbol.toUpperCase();
  if (universe.exclusionList.map((s) => s.toUpperCase()).includes(upper)) return false;
  if (universe.allowlist.length && !universe.allowlist.map((s) => s.toUpperCase()).includes(upper)) {
    return false;
  }
  return true;
}

export async function validateWatchlistSymbol(args: {
  symbol: string;
  marketData: MarketDataProvider;
  broker: T212BrokerAdapter | null;
  universe: StockUniverseFilters;
}): Promise<WatchlistValidationResult> {
  const symbol = args.symbol.toUpperCase();
  const reasons: string[] = [];
  const universeEligible = isUniverseEligible(symbol, args.universe);
  if (!universeEligible) reasons.push("UNIVERSE_INELIGIBLE");

  let alpacaAvailable = false;
  try {
    alpacaAvailable = args.marketData.symbolAvailable
      ? await args.marketData.symbolAvailable(symbol)
      : Boolean(await args.marketData.getQuote(symbol));
  } catch {
    alpacaAvailable = false;
  }
  if (!alpacaAvailable) reasons.push("ALPACA_UNAVAILABLE");

  let t212Available = false;
  if (!args.broker || !args.broker.isConnected()) {
    reasons.push("T212_NOT_CONNECTED");
  } else {
    try {
      const instruments = await args.broker.listInstruments(symbol);
      const match = instruments.find(
        (i) => i.ticker.toUpperCase() === symbol || i.ticker.toUpperCase().startsWith(`${symbol}_`)
      );
      t212Available = Boolean(match && match.tradable && !match.suspended);
      if (!t212Available) reasons.push("T212_INSTRUMENT_MISSING");
    } catch {
      reasons.push("T212_VALIDATION_FAILED");
    }
  }

  const accepted = universeEligible && alpacaAvailable && t212Available;
  return { symbol, accepted, alpacaAvailable, t212Available, universeEligible, reasons };
}

export async function validateShadowWatchlist(args: {
  symbols: string[];
  marketData: MarketDataProvider;
  broker: T212BrokerAdapter | null;
  universe: StockUniverseFilters;
  maxSymbols?: number;
}): Promise<{ accepted: string[]; results: WatchlistValidationResult[] }> {
  const max = Math.min(args.maxSymbols ?? MAX_SHADOW_WATCHLIST, MAX_SHADOW_WATCHLIST);
  const unique = [...new Set(args.symbols.map((s) => s.toUpperCase()))].slice(0, max);
  const results: WatchlistValidationResult[] = [];
  for (const symbol of unique) {
    results.push(
      await validateWatchlistSymbol({
        symbol,
        marketData: args.marketData,
        broker: args.broker,
        universe: args.universe
      })
    );
  }
  return {
    accepted: results.filter((r) => r.accepted).map((r) => r.symbol),
    results
  };
}
