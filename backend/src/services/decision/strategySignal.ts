/**
 * Separate latest market quote / OHLC-only events from complete TradingView strategy signals.
 * A newer incomplete event must not erase a still-valid complete 15M structure signal.
 *
 * Market-data alignment rule:
 * - QUOTE_1M (or the newest live event as a legacy fallback) owns the analysis price.
 * - Confirmed PLAN_15M owns POC / VAH / VAL and structural plan levels.
 * - CONFIRM_5M may confirm a plan but must never replace 15M structure.
 */

import { decisionConfig } from "../../config/decisionConfig";
import type { DecisionRecord } from "../../models/types";
import { pricesAreConsistent } from "../snapshot/priceConsistency";

export type MarketStructureMode = "COMPLETE" | "LIVE_RANGE_ONLY" | "MISMATCH" | "UNAVAILABLE";

export type MarketStructureDiagnostics = {
  lastWebhookOrDecisionAt: string | null;
  lastCompleteSignalAt: string | null;
  schemaVersion: string | null;
  signalSource: string | null;
  quoteSource: string | null;
  canonicalSymbol: string | null;
  exchangeOrBroker: string | null;
  timeframe: string | null;
  quoteTimeframe: string | null;
  structureTimeframe: string | null;
  fieldsReceived: string[];
  fieldsMissing: string[];
  fieldsRejected: string[];
  rejectionReasons: string[];
  priceConsistencyOk: boolean | null;
  signalAgeSeconds: number | null;
  quoteAgeSeconds: number | null;
  validityStatus: "VALID" | "EXPIRED" | "TEST" | "INCOMPLETE" | "MISMATCH" | "NONE";
  marketStructureMode: MarketStructureMode;
};

function positive(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

function ageSeconds(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((nowMs - t) / 1000));
}

function exchangeOf(d: DecisionRecord | null | undefined): string | null {
  return d?.symbolIdentity?.exchange ?? d?.priceSources?.alertClose?.exchangeOrBroker ?? null;
}

function sameInstrument(a: DecisionRecord | null | undefined, b: DecisionRecord | null | undefined): boolean {
  if (!a || !b) return true;
  const symbolA = a.symbolIdentity?.canonicalSymbol ?? a.symbol;
  const symbolB = b.symbolIdentity?.canonicalSymbol ?? b.symbol;
  if (symbolA !== symbolB) return false;
  const exchangeA = exchangeOf(a);
  const exchangeB = exchangeOf(b);
  return !exchangeA || !exchangeB || exchangeA === exchangeB;
}

/** Production / non-test decision usable on the LIVE dashboard. */
export function isLiveDecision(d: DecisionRecord | null | undefined): boolean {
  if (!d) return false;
  return !d.isTestDecision && d.environment !== "TEST" && d.dataSourceLabel !== "TEST";
}

/**
 * Complete strategy structure is deliberately restricted to a confirmed 15M plan bar.
 * Pine 3.0 emits POC/VAH/VAL on 1M and 5M role charts as diagnostics too; those values
 * are NOT interchangeable with the canonical 15M plan profile.
 */
export function isCompleteStrategySignal(d: DecisionRecord | null | undefined): boolean {
  if (!isLiveDecision(d) || !d) return false;
  if (d.timeframe !== "15" || d.isProvisional) return false;
  if (d.dataQuality === "INVALID" || d.dataQuality === "CONFLICTED") return false;
  const poc = positive(d.marketStructure?.poc);
  const vah = positive(d.marketStructure?.vah);
  const val = positive(d.marketStructure?.val);
  const close = positive(d.lastKnownPrice) ?? positive(d.ohlcv?.close);
  if (poc == null || vah == null || val == null || close == null) return false;

  // POC/VAH/VAL are allowed to be meaningfully distant from current price. The 2% regime
  // gate still protects fixture/price-scale mistakes without pretending a structural level
  // should sit close to the latest quote.
  if (!pricesAreConsistent(close, poc) || !pricesAreConsistent(close, vah) || !pricesAreConsistent(close, val)) {
    return false;
  }
  const trend = d.marketStructure?.trend ?? d.higherTimeframeBias;
  if (!trend || trend === "NEUTRAL") {
    // Allow NEUTRAL trend if confirmation classification exists (structure-first WAIT).
    if (!d.marketStructure?.confirmationClassification) return false;
  }
  return true;
}

export function isStrategySignalValid(
  d: DecisionRecord | null | undefined,
  nowMs = Date.now()
): boolean {
  if (!isCompleteStrategySignal(d) || !d) return false;
  const until = d.validUntil ? Date.parse(d.validUntil) : NaN;
  if (Number.isFinite(until) && until < nowMs) return false;
  const generated = Date.parse(d.generatedAt);
  if (Number.isFinite(generated) && nowMs - generated > decisionConfig.freshness.plan15mStaleMs) {
    return false;
  }
  return true;
}

export function selectLatestQuoteDecision(
  recent: DecisionRecord[]
): DecisionRecord | null {
  // Prefer the dedicated TradingView 1M quote role. 5M confirmation and 15M plan
  // decisions must not become the live quote merely because they were received later.
  return (
    recent.find((d) => isLiveDecision(d) && d.timeframe === "1") ??
    recent.find((d) => isLiveDecision(d)) ??
    recent[0] ??
    null
  );
}

export function selectLatestCompleteStrategySignal(
  recent: DecisionRecord[],
  nowMs = Date.now()
): DecisionRecord | null {
  return recent.find((d) => isStrategySignalValid(d, nowMs)) ?? null;
}

export function listReceivedFields(d: DecisionRecord | null | undefined): string[] {
  if (!d) return [];
  const out: string[] = [];
  if (positive(d.lastKnownPrice) != null || positive(d.ohlcv?.close) != null) out.push("price");
  if (d.ohlcv) out.push("ohlcv");
  if (positive(d.marketStructure?.poc) != null) out.push("poc");
  if (positive(d.marketStructure?.vah) != null) out.push("vah");
  if (positive(d.marketStructure?.val) != null) out.push("val");
  if (d.marketStructure?.trend) out.push("trend");
  if (d.marketStructure?.confirmationClassification) out.push("confirmation");
  if (positive(d.entry?.price) != null) out.push("entry");
  if (positive(d.stopLoss?.price) != null) out.push("stopLoss");
  if (d.takeProfits?.some((t) => positive(t.price) != null)) out.push("takeProfits");
  return out;
}

export function listMissingStructureFields(d: DecisionRecord | null | undefined): string[] {
  if (!d) return ["price", "ohlcv", "poc", "vah", "val", "trend", "confirmation"];
  const missing: string[] = [];
  if (positive(d.lastKnownPrice) == null && positive(d.ohlcv?.close) == null) missing.push("price");
  if (!d.ohlcv) missing.push("ohlcv");
  if (positive(d.marketStructure?.poc) == null) missing.push("poc");
  if (positive(d.marketStructure?.vah) == null) missing.push("vah");
  if (positive(d.marketStructure?.val) == null) missing.push("val");
  if (!d.marketStructure?.trend && !d.higherTimeframeBias) missing.push("trend");
  if (!d.marketStructure?.confirmationClassification) missing.push("confirmation");
  return missing;
}

export function resolveMarketStructureView(
  recent: DecisionRecord[],
  nowMs = Date.now()
): {
  latestQuote: DecisionRecord | null;
  latestCompleteStrategySignal: DecisionRecord | null;
  marketStructureMode: MarketStructureMode;
  diagnostics: MarketStructureDiagnostics;
  /** Decision used for live/bar prices */
  quoteDecision: DecisionRecord | null;
  /** Confirmed 15M decision used for POC/VAH/VAL / plan structure when compatible */
  structureDecision: DecisionRecord | null;
} {
  const latestQuote = selectLatestQuoteDecision(recent);
  const latestComplete = selectLatestCompleteStrategySignal(recent, nowMs);

  let marketStructureMode: MarketStructureMode = "UNAVAILABLE";
  let structureDecision: DecisionRecord | null = null;
  let priceConsistencyOk: boolean | null = null;
  const rejectionReasons: string[] = [];
  const fieldsRejected: string[] = [];

  if (!latestQuote && !latestComplete) {
    marketStructureMode = "UNAVAILABLE";
  } else if (latestComplete && latestQuote) {
    const quoteClose = positive(latestQuote.lastKnownPrice) ?? positive(latestQuote.ohlcv?.close);
    const signalClose = positive(latestComplete.lastKnownPrice) ?? positive(latestComplete.ohlcv?.close);

    // Only compare quote vs plan close for catastrophic price-regime mistakes. Do not compare
    // the live quote with POC: a valid POC is expected to be away from current price.
    priceConsistencyOk = pricesAreConsistent(quoteClose, signalClose) && sameInstrument(latestQuote, latestComplete);
    if (!priceConsistencyOk) {
      marketStructureMode = "MISMATCH";
      rejectionReasons.push(sameInstrument(latestQuote, latestComplete) ? "PRICE_SOURCE_MISMATCH" : "SYMBOL_OR_EXCHANGE_MISMATCH");
      fieldsRejected.push("combined_structure");
      structureDecision = null;
    } else {
      marketStructureMode = "COMPLETE";
      structureDecision = latestComplete;
      if (latestQuote.timeframe !== "1") {
        rejectionReasons.push("DEDICATED_QUOTE_1M_MISSING — using newest live TradingView event for price");
      }
    }
  } else if (latestComplete) {
    marketStructureMode = "COMPLETE";
    structureDecision = latestComplete;
    priceConsistencyOk = true;
  } else {
    marketStructureMode = "LIVE_RANGE_ONLY";
    rejectionReasons.push("NO_VALID_CONFIRMED_15M_PLAN_SIGNAL");
  }

  const diagnostics: MarketStructureDiagnostics = {
    lastWebhookOrDecisionAt: latestQuote?.generatedAt ?? latestQuote?.marketDataTime ?? null,
    lastCompleteSignalAt: latestComplete?.generatedAt ?? latestComplete?.marketDataTime ?? null,
    schemaVersion: latestQuote?.schemaVersion ?? latestComplete?.schemaVersion ?? null,
    signalSource: latestComplete?.priceSources?.poc?.source ?? latestComplete?.dataSourceLabel ?? null,
    quoteSource: latestQuote?.priceSources?.alertClose?.source ?? latestQuote?.dataSourceLabel ?? null,
    canonicalSymbol: latestQuote?.symbolIdentity?.canonicalSymbol ?? latestQuote?.symbol ?? "XAUUSD",
    exchangeOrBroker: exchangeOf(latestQuote) ?? exchangeOf(latestComplete),
    timeframe: latestComplete?.timeframe ?? latestQuote?.timeframe ?? null,
    quoteTimeframe: latestQuote?.timeframe ?? null,
    structureTimeframe: latestComplete?.timeframe ?? null,
    fieldsReceived: listReceivedFields(latestComplete ?? latestQuote),
    fieldsMissing: listMissingStructureFields(latestComplete),
    fieldsRejected,
    rejectionReasons: [
      ...rejectionReasons,
      ...(latestQuote?.warnings ?? []).filter((w) => /PRICE_SOURCE|TEST_FIXTURE|MISMATCH/i.test(w))
    ],
    priceConsistencyOk,
    signalAgeSeconds: ageSeconds(latestComplete?.marketDataTime ?? latestComplete?.generatedAt, nowMs),
    quoteAgeSeconds: ageSeconds(latestQuote?.marketDataTime ?? latestQuote?.generatedAt, nowMs),
    validityStatus: latestComplete
      ? isStrategySignalValid(latestComplete, nowMs)
        ? priceConsistencyOk === false
          ? "MISMATCH"
          : "VALID"
        : "EXPIRED"
      : latestQuote
        ? latestQuote.isTestDecision
          ? "TEST"
          : "INCOMPLETE"
        : "NONE",
    marketStructureMode
  };

  return {
    latestQuote,
    latestCompleteStrategySignal: latestComplete,
    marketStructureMode,
    diagnostics,
    quoteDecision: latestQuote,
    structureDecision
  };
}
