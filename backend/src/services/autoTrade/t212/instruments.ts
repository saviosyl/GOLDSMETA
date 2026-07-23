/**
 * Gold instrument catalogue filtering for Trading 212 Invest.
 * Never auto-selects — user must confirm.
 */

import type { T212InstrumentResponse } from "./client";
import type { T212InstrumentCandidate } from "./types";

const GOLD_NAME_RE =
  /\b(gold|physical\s+gold|gold\s+etc|gold\s+etf|gold\s+etp|bullion|xau)\b/i;

/**
 * Exclude equities/miners, leveraged/inverse products, yield overlays, silver,
 * and unrelated commodities. Prefer physically backed gold ETC/ETP/ETF names.
 */
const EXCLUDE_RE =
  /\b(mining|miners?|producers?|junior|explorer|royalty|silver|platinum|palladium|crypto|bitcoin|leveraged|leverage|inverse|ultrashort|ultralong|ultra\s*short|ultra\s*long|short\s+gold|daily\s+short|1x\s+daily\s+short|long\s+gold\s+miners|income|yield|covered\s+call|cmci|components?|3x|2x|-3x|-2x)\b|ultra(?=short|long)/i;

const ALLOWED_TYPES = new Set(["ETF", "ETC", "ETP"]);

export function isGoldInvestInstrument(instrument: T212InstrumentResponse): boolean {
  const type = (instrument.type ?? "").trim().toUpperCase();
  if (type === "STOCK" || type === "EQUITY") return false;
  if (type && !ALLOWED_TYPES.has(type)) return false;

  const name = `${instrument.name ?? ""} ${instrument.shortName ?? ""} ${instrument.ticker ?? ""}`;
  if (!GOLD_NAME_RE.test(name)) return false;
  if (EXCLUDE_RE.test(name)) return false;
  return true;
}

export function toGoldCandidate(instrument: T212InstrumentResponse): T212InstrumentCandidate | null {
  if (!isGoldInvestInstrument(instrument)) return null;
  const ticker = (instrument.ticker ?? "").trim();
  const name = (instrument.name ?? instrument.shortName ?? ticker).trim();
  if (!ticker || !name) return null;

  let reason = "Name matches gold ETF/ETC/ETP catalogue filter";
  if (/\betf\b/i.test(name)) reason = "Gold ETF candidate";
  else if (/\betc\b/i.test(name)) reason = "Gold ETC candidate";
  else if (/\betp\b/i.test(name)) reason = "Gold ETP candidate";
  else if (/physical/i.test(name)) reason = "Physical gold product candidate";

  return {
    instrumentId: ticker,
    ticker,
    name,
    currency: instrument.currencyCode ?? null,
    isin: instrument.isin ?? null,
    exchange: null,
    type: instrument.type ?? null,
    fractionalSupported: null,
    minOrderQuantity: instrument.minTradeQuantity ?? null,
    minOrderValue: null,
    marketOpen: null,
    goldMatchReason: reason
  };
}

export function searchGoldInstruments(
  instruments: T212InstrumentResponse[],
  query?: string
): T212InstrumentCandidate[] {
  const q = (query ?? "").trim().toLowerCase();
  const candidates = instruments
    .map(toGoldCandidate)
    .filter((c): c is T212InstrumentCandidate => c != null);

  if (!q) return candidates.slice(0, 40);

  return candidates
    .filter((c) => {
      const hay = `${c.ticker} ${c.name} ${c.isin ?? ""} ${c.goldMatchReason}`.toLowerCase();
      return hay.includes(q);
    })
    .slice(0, 40);
}

/** Explicit user confirmation required — never pick silently. */
export function requireExplicitInstrumentSelection(
  candidates: T212InstrumentCandidate[],
  selectedId: string | null | undefined
): { ok: true; selectedId: string } | { ok: false; reason: string } {
  if (!selectedId) {
    return { ok: false, reason: "SELECTED_INSTRUMENT_REQUIRED" };
  }
  const found = candidates.find((c) => c.instrumentId === selectedId || c.ticker === selectedId);
  if (!found && candidates.length > 0) {
    // Selection may already be confirmed and stored from a prior catalogue snapshot.
    return { ok: true, selectedId };
  }
  if (!found && candidates.length === 0) {
    return { ok: true, selectedId };
  }
  return { ok: true, selectedId };
}
