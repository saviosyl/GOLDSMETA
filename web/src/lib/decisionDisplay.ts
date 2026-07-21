/** Display-only helpers for dashboard / history. Never invent BUY/SELL/WAIT. */

import type { Decision, DecisionAction } from "../types/models";
import {
  entryDisplay,
  formatPercent,
  formatPrice,
  formatRatio,
  formatWhen,
  isStaleDecision,
  isTestDecision,
  tpPrice
} from "./format";

export const humanizeToken = (value: string): string =>
  value
    .replaceAll("_", " ")
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
    .trim();

/** Quality badge for UI — never duplicates the TEST badge. */
export const displayQualityLabel = (
  decision: Decision,
  source: "live" | "cached" | "offline" = "live"
): "LIVE" | "STALE" | "PARTIAL" | "OFFLINE" | "DELAYED" => {
  if (source === "offline" || decision.dataSourceLabel === "OFFLINE") {
    return "OFFLINE";
  }
  if (isStaleDecision(decision) || source === "cached") {
    return "STALE";
  }
  if (decision.dataQuality === "PARTIAL" || decision.dataQuality === "CONFLICTED") {
    return "PARTIAL";
  }
  if (decision.dataQuality === "INVALID") {
    return "PARTIAL";
  }
  if (decision.dataSourceLabel === "DELAYED") {
    return "DELAYED";
  }
  return "LIVE";
};

export const recommendedActionLabel = (decision: Decision): string => {
  const codes = [
    ...(decision.reasonCodes ?? []),
    ...(decision.safetyFlags ?? []),
    ...(decision.warnings ?? []),
    ...(decision.reasonSummary ?? [])
  ]
    .join(" ")
    .toUpperCase();

  const has = (token: string): boolean => codes.includes(token.toUpperCase());

  if (decision.decision === "WAIT") {
    if (decision.dataQuality === "STALE" || has("STALE_DATA") || has("STALE")) {
      return "Wait for fresh market data";
    }
    if (
      decision.isProvisional ||
      has("PROVISIONAL") ||
      has("WAIT_FOR_CONFIRMATION") ||
      has("MISSING_CONFIRMATION")
    ) {
      return "Wait for confirmation";
    }
    if (
      decision.confidence < 45 ||
      has("LOW_CONFIDENCE") ||
      decision.confidenceLabel === "LOW"
    ) {
      return "No trade — confidence too low";
    }
    if (
      (decision.missingInputs?.length ?? 0) > 0 ||
      decision.dataQuality === "PARTIAL" ||
      decision.dataQuality === "INVALID" ||
      decision.dataQuality === "CONFLICTED" ||
      has("INCOMPLETE") ||
      has("MISSING")
    ) {
      return "Wait for complete market data";
    }
    if (decision.recommendedManagementAction) {
      return humanizeToken(decision.recommendedManagementAction);
    }
    if (decision.reasonSummary?.[0] && !/^[A-Z0-9_]+$/.test(decision.reasonSummary[0])) {
      return decision.reasonSummary[0];
    }
    return "Wait for complete market data";
  }

  const explicit =
    decision.recommendedManagementAction ?? decision.recommendedActions?.[0] ?? null;
  if (explicit) {
    return humanizeToken(explicit);
  }
  return decision.decision === "BUY" ? "Review long setup" : "Review short setup";
};

export const tradePlanEntryLabel = (decision: Decision): string => {
  if (decision.decision === "WAIT") return "Wait";
  return entryDisplay(decision.entry);
};

export const tradePlanStopLabel = (decision: Decision): string => {
  if (decision.decision === "WAIT") return "Not applicable";
  return formatPrice(decision.stopLoss?.price);
};

export const tradePlanTpLabel = (decision: Decision, label: "TP1" | "TP2" | "TP3"): string => {
  if (decision.decision === "WAIT") return "Not applicable";
  return tpPrice(decision.takeProfits ?? [], label);
};

export const tradePlanRrLabel = (decision: Decision): string => {
  if (decision.decision === "WAIT") return "Not applicable";
  return formatRatio(
    decision.riskReward?.tp2 ?? decision.riskReward?.tp1 ?? decision.riskReward?.tp3
  );
};

export const trendLabel = (decision: Decision): string =>
  decision.marketStructure?.trend ??
  decision.higherTimeframeBias ??
  decision.marketRegime ??
  "—";

export const timeframeLabel = (decision: Decision & { timeframe?: string | null }): string => {
  const raw = decision.timeframe;
  if (!raw) return "—";
  if (/^\d+$/.test(raw)) return `${raw}m`;
  return raw;
};

export const primaryReason = (decision: Decision): string => {
  const summary = decision.reasonSummary?.find((line) => line && line.trim().length > 0);
  if (summary && !/^[A-Z0-9_]+$/.test(summary.trim())) {
    return summary;
  }
  if (decision.explanation?.trim()) {
    return decision.explanation.trim();
  }
  if (decision.decision === "WAIT") {
    return recommendedActionLabel(decision);
  }
  const evidence =
    decision.decision === "SELL"
      ? decision.bearishEvidence?.[0]
      : decision.bullishEvidence?.[0];
  return evidence ?? `${decision.decision} setup`;
};

export const explainReasonCode = (code: string): string => {
  const map: Record<string, string> = {
    STALE_DATA: "Market data is stale",
    INCOMPLETE_DATA: "Market data is incomplete",
    MISSING_VOLUME_PROFILE: "Volume profile (POC/VAH/VAL) is missing",
    MISSING_TREND: "Trend direction is missing",
    MISSING_CONFIRMATION: "Confirmation candle is missing",
    CONFLICTING_TREND: "Trend conflicts with value-area structure",
    LOW_CONFIDENCE: "Confidence is too low for a trade",
    POOR_RISK_REWARD: "Risk/reward is below the minimum threshold",
    MIN_RR_TO_TP2_NOT_MET: "Risk/reward to TP2 is below the minimum",
    INSUFFICIENT_EVIDENCE: "Need agreement from more than one indicator family",
    TREND_BULLISH: "Bullish trend alignment",
    TREND_BEARISH: "Bearish trend alignment",
    TREND_COMPONENTS: "Multi-timeframe trend components",
    PRICE_ABOVE_POC: "Price trading above POC",
    PRICE_BELOW_POC: "Price trading below POC",
    ABOVE_VAH: "Price accepted above VAH",
    BELOW_VAL: "Price accepted below VAL",
    INSIDE_VALUE_AREA: "Price inside value area",
    LEVEL_INTERACTION: "Interacting with a key level",
    BREAKOUT_OR_RETEST: "Breakout or retest confirmation",
    CONTINUATION_CONFIRMATION: "Continuation confirmation candle",
    CANDLE_BULLISH: "Bullish confirmation candle",
    CANDLE_BEARISH: "Bearish confirmation candle",
    VALUE_MIGRATION_UP: "Value migrating higher",
    VALUE_MIGRATION_DOWN: "Value migrating lower",
    ACCEPTANCE_BULLISH: "Bullish acceptance",
    ACCEPTANCE_BEARISH: "Bearish acceptance",
    MTF_BULLISH_AGREE: "Higher timeframes agree bullish",
    MTF_BEARISH_AGREE: "Higher timeframes agree bearish",
    MTF_CONFLICT: "Timeframes conflict",
    PROVISIONAL_DISABLED: "Provisional signals disabled",
    WAIT: "Waiting for a clearer setup"
  };
  return map[code] ?? humanizeToken(code);
};

export {
  formatPercent,
  formatPrice,
  formatWhen,
  isStaleDecision,
  isTestDecision,
  entryDisplay,
  tpPrice,
  formatRatio
};

export type HistoryFilter = "ALL" | DecisionAction;

export const filterHistory = (items: Decision[], filter: HistoryFilter): Decision[] => {
  if (filter === "ALL") return items;
  return items.filter((item) => item.decision === filter);
};
