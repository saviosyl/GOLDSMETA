/**
 * Separate latest market quote / OHLC-only events from complete TradingView strategy signals.
 * A newer incomplete event must not erase a still-valid complete structure signal.
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

/** Production / non-test decision usable on the LIVE dashboard. */
export function isLiveDecision(d: DecisionRecord | null | undefined): boolean {
  if (!d) return false;
  return !d.isTestDecision && d.environment !== "TEST" && d.dataSourceLabel !== "TEST";
}

/**
 * Complete strategy signal = verified structure levels + trend context.
 * Plan entry/stop/TP are preferred when present (BUY/SELL) but WAIT with full
 * volume-profile structure still counts as a complete structure signal.
 */
export function isCompleteStrategySignal(d: DecisionRecord | null | undefined): boolean {
  if (!isLiveDecision(d) || !d) return false;
  if (d.dataQuality === "INVALID" || d.dataQuality === "CONFLICTED") return false;
  const poc = positive(d.marketStructure?.poc);
  const vah = positive(d.marketStructure?.vah);
  const val = positive(d.marketStructure?.val);
  const close = positive(d.lastKnownPrice) ?? positive(d.ohlcv?.close);
  if (poc == null || vah == null || val == null || close == null) return false;
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
  if (Number.isFinite(generated) && nowMs - generated > decisionConfig.decisionTtlMs * 2) {
    return false;
  }
  return true;
}

export function selectLatestQuoteDecision(
  recent: DecisionRecord[]
): DecisionRecord | null {
  return recent.find((d) => isLiveDecision(d)) ?? recent[0] ?? null;
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
  /** Decision used for POC/VAH/VAL / plan structure when compatible */
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
    const quoteClose =
      positive(latestQuote.lastKnownPrice) ?? positive(latestQuote.ohlcv?.close);
    const signalClose =
      positive(latestComplete.lastKnownPrice) ?? positive(latestComplete.ohlcv?.close);
    const signalPoc = positive(latestComplete.marketStructure?.poc);
    priceConsistencyOk =
      pricesAreConsistent(quoteClose, signalClose) &&
      pricesAreConsistent(quoteClose, signalPoc);
    if (!priceConsistencyOk) {
      marketStructureMode = "MISMATCH";
      rejectionReasons.push("PRICE_SOURCE_MISMATCH");
      fieldsRejected.push("combined_structure");
      structureDecision = null;
    } else if (isCompleteStrategySignal(latestQuote)) {
      marketStructureMode = "COMPLETE";
      structureDecision = latestQuote;
    } else {
      marketStructureMode = "COMPLETE";
      structureDecision = latestComplete;
      if (listMissingStructureFields(latestQuote).length > 0) {
        rejectionReasons.push(
          "LATEST_EVENT_INCOMPLETE — using latest valid complete strategy signal for structure levels"
        );
      }
    }
  } else if (latestComplete) {
    marketStructureMode = "COMPLETE";
    structureDecision = latestComplete;
    priceConsistencyOk = true;
  } else {
    marketStructureMode = "LIVE_RANGE_ONLY";
    rejectionReasons.push("NO_VALID_COMPLETE_STRATEGY_SIGNAL");
  }

  const diagnostics: MarketStructureDiagnostics = {
    lastWebhookOrDecisionAt: latestQuote?.generatedAt ?? latestQuote?.marketDataTime ?? null,
    lastCompleteSignalAt: latestComplete?.generatedAt ?? latestComplete?.marketDataTime ?? null,
    schemaVersion: latestQuote?.schemaVersion ?? latestComplete?.schemaVersion ?? null,
    signalSource: latestComplete?.priceSources?.poc?.source ?? latestComplete?.dataSourceLabel ?? null,
    quoteSource: latestQuote?.priceSources?.alertClose?.source ?? latestQuote?.dataSourceLabel ?? null,
    canonicalSymbol:
      latestQuote?.symbolIdentity?.canonicalSymbol ?? latestQuote?.symbol ?? "XAUUSD",
    exchangeOrBroker:
      latestQuote?.symbolIdentity?.exchange ??
      latestQuote?.priceSources?.alertClose?.exchangeOrBroker ??
      null,
    timeframe: latestQuote?.timeframe ?? latestComplete?.timeframe ?? null,
    fieldsReceived: listReceivedFields(latestQuote ?? latestComplete),
    fieldsMissing: listMissingStructureFields(latestQuote),
    fieldsRejected,
    rejectionReasons: [
      ...rejectionReasons,
      ...(latestQuote?.warnings ?? []).filter((w) => /PRICE_SOURCE|TEST_FIXTURE|MISMATCH/i.test(w))
    ],
    priceConsistencyOk,
    signalAgeSeconds: ageSeconds(latestComplete?.generatedAt, nowMs),
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
