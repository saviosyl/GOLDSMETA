/**
 * Separate latest market quote / OHLC-only events from complete TradingView strategy signals.
 * A newer incomplete event must not erase a still-valid complete 15M structure signal.
 *
 * Market-data alignment rule:
 * - QUOTE_1M (or the newest live event as a legacy fallback) owns the analysis price.
 * - Confirmed PLAN_15M owns POC / VAH / VAL and structural plan levels.
 * - Confirmed CONFIRM_5M owns entry confirmation only and never replaces 15M structure.
 */

import { decisionConfig } from "../../config/decisionConfig";
import type { DecisionRecord } from "../../models/types";
import { pricesAreConsistent } from "../snapshot/priceConsistency";
import {
  normalizePlanSourceKey,
  parsePlanSourceKey
} from "./alertRole";

export type MarketStructureMode = "COMPLETE" | "LIVE_RANGE_ONLY" | "MISMATCH" | "UNAVAILABLE";

export type MarketStructureDiagnostics = {
  lastWebhookOrDecisionAt: string | null;
  lastCompleteSignalAt: string | null;
  lastConfirmationAt: string | null;
  schemaVersion: string | null;
  signalSource: string | null;
  quoteSource: string | null;
  canonicalSymbol: string | null;
  exchangeOrBroker: string | null;
  timeframe: string | null;
  quoteTimeframe: string | null;
  structureTimeframe: string | null;
  confirmationTimeframe: string | null;
  fieldsReceived: string[];
  fieldsMissing: string[];
  fieldsRejected: string[];
  rejectionReasons: string[];
  priceConsistencyOk: boolean | null;
  signalAgeSeconds: number | null;
  quoteAgeSeconds: number | null;
  confirmationAgeSeconds: number | null;
  planSourceKey: string | null;
  confirmationSourceKey: string | null;
  confirmationPlanKeyMatch: boolean;
  oneHourBiasSourceTime: string | null;
  oneHourBiasConfirmed: boolean | null;
  oneHourBiasState: "CONFIRMED" | "DEVELOPING" | "MISSING" | "INVALID" | "STALE";
  oneHourBiasAgeSeconds: number | null;
  dayTradeBiasReason: string | null;
  /** All canonical short-term roles are present, fresh and source-aligned. */
  shortTermDataReady: boolean;
  /** Confirmed 15M structure has an explicit 1H bias for the Day Trade view. */
  dayTradeDataReady: boolean;
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

function canonicalSymbolOf(d: DecisionRecord | null | undefined): string | null {
  if (!d) return null;
  return d.symbolIdentity?.canonicalSymbol ?? d.symbol ?? null;
}

function parseTimestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type OneHourBiasResolution = {
  direction: DecisionRecord["higherTimeframeBias"] | null;
  sourceTime: string | null;
  confirmed: boolean | null;
  state: "CONFIRMED" | "DEVELOPING" | "MISSING" | "INVALID" | "STALE";
  ageSeconds: number | null;
  valid: boolean;
  reason: string | null;
};

function resolveOneHourBias(
  structure: DecisionRecord | null,
  nowMs: number
): OneHourBiasResolution {
  const direction = structure?.higherTimeframeBias ?? null;
  if (!structure || !direction) {
    return {
      direction: null,
      sourceTime: null,
      confirmed: null,
      state: "MISSING",
      ageSeconds: null,
      valid: false,
      reason: "DAY_TRADE_1H_BIAS_MISSING"
    };
  }
  if (direction !== "BULLISH" && direction !== "BEARISH" && direction !== "NEUTRAL") {
    return {
      direction,
      sourceTime: structure.oneHourBiasSourceTime ?? null,
      confirmed: structure.oneHourBiasConfirmed ?? null,
      state: "INVALID",
      ageSeconds: null,
      valid: false,
      reason: "DAY_TRADE_1H_BIAS_INVALID"
    };
  }
  if (structure.oneHourBiasConfirmed !== true) {
    return {
      direction,
      sourceTime: structure.oneHourBiasSourceTime ?? null,
      confirmed: structure.oneHourBiasConfirmed ?? null,
      state: "DEVELOPING",
      ageSeconds: null,
      valid: false,
      reason: "DAY_TRADE_1H_BIAS_DEVELOPING"
    };
  }
  const sourceMs = parseTimestampMs(structure.oneHourBiasSourceTime ?? null);
  if (!sourceMs) {
    return {
      direction,
      sourceTime: structure.oneHourBiasSourceTime ?? null,
      confirmed: structure.oneHourBiasConfirmed ?? null,
      state: "INVALID",
      ageSeconds: null,
      valid: false,
      reason: "DAY_TRADE_1H_BIAS_INVALID"
    };
  }
  const ageMs = Math.max(0, nowMs - sourceMs);
  const ageSecondsValue = Math.round(ageMs / 1000);
  if (ageMs > decisionConfig.freshness.oneHourBiasStaleMs) {
    return {
      direction,
      sourceTime: structure.oneHourBiasSourceTime ?? null,
      confirmed: structure.oneHourBiasConfirmed ?? null,
      state: "STALE",
      ageSeconds: ageSecondsValue,
      valid: false,
      reason: "DAY_TRADE_1H_BIAS_STALE"
    };
  }
  return {
    direction,
    sourceTime: structure.oneHourBiasSourceTime ?? null,
    confirmed: structure.oneHourBiasConfirmed ?? null,
    state: "CONFIRMED",
    ageSeconds: ageSecondsValue,
    valid: true,
    reason: null
  };
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

  // This remains a broad regime guard only. A valid structural level can be far from price.
  if (!pricesAreConsistent(close, poc) || !pricesAreConsistent(close, vah) || !pricesAreConsistent(close, val)) {
    return false;
  }
  const trend = d.marketStructure?.trend ?? d.higherTimeframeBias;
  if (!trend || trend === "NEUTRAL") {
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
  // Freshness is based on the market bar clock, not processing time. A delayed old
  // webhook received now must not revive an expired 15M plan.
  const marketTime = Date.parse(d.marketDataTime ?? d.generatedAt);
  if (!Number.isFinite(marketTime)) return false;
  if (nowMs - marketTime > decisionConfig.freshness.plan15mStaleMs) {
    return false;
  }
  return true;
}

export function selectLatestQuoteDecision(recent: DecisionRecord[]): DecisionRecord | null {
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

type ConfirmationSelection = {
  decision: DecisionRecord | null;
  candidate: DecisionRecord | null;
  rejectionReasons: string[];
};

function validateConfirmationCandidate(
  candidate: DecisionRecord,
  structure: DecisionRecord | null,
  nowMs: number
): string[] {
  const reasons: string[] = [];
  if (!isLiveDecision(candidate)) reasons.push("CONFIRM_NOT_LIVE");
  if (candidate.timeframe !== "5") reasons.push("CONFIRM_WRONG_TIMEFRAME");
  if (candidate.isProvisional) reasons.push("CONFIRM_PROVISIONAL");
  if (candidate.dataQuality === "CONFLICTED" || candidate.dataQuality === "INVALID") {
    reasons.push("CONFIRM_CONFLICTED");
  }
  if (
    candidate.dataQuality === "STALE" ||
    candidate.dataSourceLabel === "STALE" ||
    candidate.dataSourceLabel === "OFFLINE" ||
    candidate.dataSourceLabel === "MOCK"
  ) {
    reasons.push("CONFIRM_STALE");
  }

  const age = ageSeconds(candidate.marketDataTime ?? candidate.generatedAt, nowMs);
  if (age == null || age * 1000 > decisionConfig.freshness.confirm5mStaleMs) {
    reasons.push("CONFIRM_STALE");
  }

  const classification = candidate.marketStructure?.confirmationClassification;
  const direction = candidate.marketStructure?.confirmationDirection;
  if (!classification || classification === "NONE" || !direction || direction === "NEUTRAL") {
    reasons.push("CONFIRM_INCOMPLETE");
  }

  if (structure) {
    const structureSymbol = canonicalSymbolOf(structure);
    const confirmSymbol = canonicalSymbolOf(candidate);
    if (structureSymbol && confirmSymbol && structureSymbol !== confirmSymbol) {
      reasons.push("CONFIRM_WRONG_SYMBOL");
    }
    const structureExchange = exchangeOf(structure);
    const confirmExchange = exchangeOf(candidate);
    if (
      structureExchange &&
      confirmExchange &&
      structureExchange !== confirmExchange
    ) {
      reasons.push("CONFIRM_WRONG_EXCHANGE");
    }
    if (!sameInstrument(candidate, structure)) {
      if (!reasons.includes("CONFIRM_WRONG_SYMBOL") && !reasons.includes("CONFIRM_WRONG_EXCHANGE")) {
        reasons.push("CONFIRM_WRONG_SYMBOL");
      }
    }
  }

  const structureKey = normalizePlanSourceKey(structure?.planSourceKey ?? null);
  const confirmKey = normalizePlanSourceKey(candidate.planSourceKey ?? null);
  if (!structureKey || !confirmKey) {
    reasons.push("PLAN_KEY_MISSING");
  } else if (structureKey !== confirmKey) {
    reasons.push("PLAN_KEY_MISMATCH");
  }
  const structureKeyParts = parsePlanSourceKey(structureKey);
  const confirmKeyParts = parsePlanSourceKey(confirmKey);
  if (
    structureKeyParts?.planCloseTimeMs != null &&
    confirmKeyParts?.planCloseTimeMs != null &&
    confirmKeyParts.planCloseTimeMs < structureKeyParts.planCloseTimeMs
  ) {
    reasons.push("CONFIRM_PRE_PLAN");
  }

  const confirmationTime = parseTimestampMs(candidate.marketDataTime ?? candidate.generatedAt);
  const structureTime = parseTimestampMs(structure?.marketDataTime ?? structure?.generatedAt);
  if (confirmationTime == null) {
    reasons.push("CONFIRM_INCOMPLETE");
  } else if (structureTime != null && confirmationTime < structureTime) {
    // A 5M event from before the active 15M plan cannot confirm the newer plan.
    reasons.push("CONFIRM_PRE_PLAN");
  }

  return [...new Set(reasons)];
}

function selectLatestConfirmationDecisionDetailed(
  recent: DecisionRecord[],
  structure: DecisionRecord | null,
  nowMs = Date.now()
): ConfirmationSelection {
  const latest5m = recent.find((d) => d.timeframe === "5") ?? null;
  if (!latest5m) {
    return { decision: null, candidate: null, rejectionReasons: ["CONFIRM_5M_MISSING_OR_STALE"] };
  }
  const rejectionReasons = validateConfirmationCandidate(latest5m, structure, nowMs);
  if (rejectionReasons.length > 0) {
    return { decision: null, candidate: latest5m, rejectionReasons };
  }
  return { decision: latest5m, candidate: latest5m, rejectionReasons: [] };
}

export function selectLatestConfirmationDecision(
  recent: DecisionRecord[],
  structure: DecisionRecord | null,
  nowMs = Date.now()
): DecisionRecord | null {
  return selectLatestConfirmationDecisionDetailed(recent, structure, nowMs).decision;
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
  if (!d) return ["price", "ohlcv", "poc", "vah", "val", "trend"];
  const missing: string[] = [];
  if (positive(d.lastKnownPrice) == null && positive(d.ohlcv?.close) == null) missing.push("price");
  if (!d.ohlcv) missing.push("ohlcv");
  if (positive(d.marketStructure?.poc) == null) missing.push("poc");
  if (positive(d.marketStructure?.vah) == null) missing.push("vah");
  if (positive(d.marketStructure?.val) == null) missing.push("val");
  if (!d.marketStructure?.trend && !d.higherTimeframeBias) missing.push("trend");
  return missing;
}

export function resolveMarketStructureView(
  recent: DecisionRecord[],
  nowMs = Date.now()
): {
  latestQuote: DecisionRecord | null;
  latestCompleteStrategySignal: DecisionRecord | null;
  latestConfirmation: DecisionRecord | null;
  marketStructureMode: MarketStructureMode;
  diagnostics: MarketStructureDiagnostics;
  quoteDecision: DecisionRecord | null;
  structureDecision: DecisionRecord | null;
  confirmationDecision: DecisionRecord | null;
} {
  const latestQuote = selectLatestQuoteDecision(recent);
  const latestComplete = selectLatestCompleteStrategySignal(recent, nowMs);
  const confirmationSelection = selectLatestConfirmationDecisionDetailed(
    recent,
    latestComplete,
    nowMs
  );
  const latestConfirmation = confirmationSelection.decision;
  const confirmationCandidate = confirmationSelection.candidate;

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

    // Compare quote vs 15M close only as a broad price-regime/source-identity guard.
    // Do not compare current price to POC/VAH/VAL: valid structure can be far away.
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
      if (!latestConfirmation) {
        rejectionReasons.push(...confirmationSelection.rejectionReasons);
        if (!confirmationSelection.rejectionReasons.includes("CONFIRM_5M_MISSING_OR_STALE")) {
          rejectionReasons.push(
            "CONFIRM_5M_MISSING_OR_STALE — plan remains unconfirmed for short-term entry timing"
          );
        }
      }
    }
  } else if (latestComplete) {
    marketStructureMode = "COMPLETE";
    structureDecision = latestComplete;
    priceConsistencyOk = true;
    if (!latestConfirmation) {
      rejectionReasons.push(...confirmationSelection.rejectionReasons);
      if (!confirmationSelection.rejectionReasons.includes("CONFIRM_5M_MISSING_OR_STALE")) {
        rejectionReasons.push(
          "CONFIRM_5M_MISSING_OR_STALE — plan remains unconfirmed for short-term entry timing"
        );
      }
    }
  } else {
    marketStructureMode = "LIVE_RANGE_ONLY";
    rejectionReasons.push("NO_VALID_CONFIRMED_15M_PLAN_SIGNAL");
  }

  const quoteAge = ageSeconds(latestQuote?.marketDataTime ?? latestQuote?.generatedAt, nowMs);
  const signalAge = ageSeconds(latestComplete?.marketDataTime ?? latestComplete?.generatedAt, nowMs);
  const confirmationAge = ageSeconds(
    latestConfirmation?.marketDataTime ?? latestConfirmation?.generatedAt,
    nowMs
  );
  const quoteQualityOk =
    latestQuote != null &&
    latestQuote.dataQuality !== "STALE" &&
    latestQuote.dataQuality !== "CONFLICTED" &&
    latestQuote.dataQuality !== "INVALID" &&
    latestQuote.dataSourceLabel !== "STALE" &&
    latestQuote.dataSourceLabel !== "OFFLINE" &&
    latestQuote.dataSourceLabel !== "MOCK";
  const shortTermDataReady =
    marketStructureMode === "COMPLETE" &&
    priceConsistencyOk !== false &&
    latestQuote?.timeframe === "1" &&
    quoteQualityOk &&
    quoteAge != null &&
    quoteAge * 1000 <= decisionConfig.freshness.quoteStaleMs &&
    latestConfirmation != null;
  const oneHourBias = resolveOneHourBias(latestComplete, nowMs);
  if (latestComplete && !oneHourBias.valid && oneHourBias.reason) {
    rejectionReasons.push(oneHourBias.reason);
  }
  const dayTradeDataReady =
    marketStructureMode === "COMPLETE" &&
    priceConsistencyOk !== false &&
    oneHourBias.valid;
  const structurePlanKey = normalizePlanSourceKey(latestComplete?.planSourceKey ?? null);
  const confirmationPlanKey = normalizePlanSourceKey(
    (latestConfirmation ?? confirmationCandidate)?.planSourceKey ?? null
  );
  const confirmationPlanKeyMatch = Boolean(
    structurePlanKey && confirmationPlanKey && structurePlanKey === confirmationPlanKey
  );

  const diagnostics: MarketStructureDiagnostics = {
    lastWebhookOrDecisionAt: latestQuote?.generatedAt ?? latestQuote?.marketDataTime ?? null,
    lastCompleteSignalAt: latestComplete?.generatedAt ?? latestComplete?.marketDataTime ?? null,
    lastConfirmationAt: latestConfirmation?.generatedAt ?? latestConfirmation?.marketDataTime ?? null,
    schemaVersion: latestQuote?.schemaVersion ?? latestComplete?.schemaVersion ?? null,
    signalSource: latestComplete?.priceSources?.poc?.source ?? latestComplete?.dataSourceLabel ?? null,
    quoteSource: latestQuote?.priceSources?.alertClose?.source ?? latestQuote?.dataSourceLabel ?? null,
    canonicalSymbol: latestQuote?.symbolIdentity?.canonicalSymbol ?? latestQuote?.symbol ?? "XAUUSD",
    exchangeOrBroker: exchangeOf(latestQuote) ?? exchangeOf(latestComplete),
    timeframe: latestComplete?.timeframe ?? latestQuote?.timeframe ?? null,
    quoteTimeframe: latestQuote?.timeframe ?? null,
    structureTimeframe: latestComplete?.timeframe ?? null,
    confirmationTimeframe: latestConfirmation?.timeframe ?? null,
    planSourceKey: structurePlanKey,
    confirmationSourceKey: confirmationPlanKey,
    confirmationPlanKeyMatch,
    oneHourBiasSourceTime: oneHourBias.sourceTime,
    oneHourBiasConfirmed: oneHourBias.confirmed,
    oneHourBiasState: oneHourBias.state,
    oneHourBiasAgeSeconds: oneHourBias.ageSeconds,
    dayTradeBiasReason: oneHourBias.reason,
    fieldsReceived: listReceivedFields(latestComplete ?? latestQuote),
    fieldsMissing: listMissingStructureFields(latestComplete),
    fieldsRejected,
    rejectionReasons: [
      ...new Set(rejectionReasons),
      ...(latestQuote?.warnings ?? []).filter((w) => /PRICE_SOURCE|TEST_FIXTURE|MISMATCH/i.test(w))
    ],
    priceConsistencyOk,
    signalAgeSeconds: signalAge,
    quoteAgeSeconds: quoteAge,
    confirmationAgeSeconds: confirmationAge,
    shortTermDataReady,
    dayTradeDataReady,
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
    latestConfirmation,
    marketStructureMode,
    diagnostics,
    quoteDecision: latestQuote,
    structureDecision,
    confirmationDecision: latestConfirmation
  };
}
