/**
 * Pure gates for qualification previews / controlled Demo candidates.
 */

export type QualCandidateInput = {
  direction: string;
  signalId: string;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  confidence: number | null;
  minConfidence: number;
  minRiskReward?: number;
  quoteBid: number | null;
  quoteAsk: number | null;
  quoteSpread: number | null;
  quoteStale: boolean;
  marketStatus: string | null;
  maxSpread: number;
  maxQuoteAgeSeconds: number;
  quoteAgeSeconds: number | null;
  alreadyCountedSignal: boolean;
  /** When true, market-closed does not fail preview qualification counting gates that are setup-only. */
  requireMarketOpen?: boolean;
};

export type QualCandidateResult = {
  ok: boolean;
  failed: string[];
  passed: string[];
};

export function evaluateQualificationCandidate(input: QualCandidateInput): QualCandidateResult {
  const failed: string[] = [];
  const passed: string[] = [];
  const d = String(input.direction).toUpperCase();

  if (d !== "BUY" && d !== "SELL") {
    failed.push("NOT_ACTIONABLE");
  } else passed.push("ACTIONABLE");

  if (input.alreadyCountedSignal) failed.push("DUPLICATE_SIGNAL");
  else passed.push("UNIQUE_SIGNAL");

  if (
    input.entry == null ||
    input.stopLoss == null ||
    input.takeProfit == null ||
    !Number.isFinite(input.entry) ||
    !Number.isFinite(input.stopLoss) ||
    !Number.isFinite(input.takeProfit)
  ) {
    failed.push("INCOMPLETE_GEOMETRY");
  } else {
    passed.push("GEOMETRY_OK");
    if (d === "BUY" && !(input.stopLoss < input.entry && input.takeProfit > input.entry)) {
      failed.push("GEOMETRY_DIRECTION_INVALID");
    }
    if (d === "SELL" && !(input.stopLoss > input.entry && input.takeProfit < input.entry)) {
      failed.push("GEOMETRY_DIRECTION_INVALID");
    }
  }

  if (input.quoteBid == null || input.quoteAsk == null) failed.push("QUOTE_UNAVAILABLE");
  else passed.push("QUOTE_PRESENT");

  const requireOpen = input.requireMarketOpen !== false;
  const status = String(input.marketStatus ?? "").toUpperCase();
  const marketOpen = status.includes("OPEN") || status.includes("TRADEABLE");
  if (requireOpen && !marketOpen) {
    failed.push("MARKET_NOT_OPEN");
  } else if (marketOpen) passed.push("MARKET_OPEN");

  if (requireOpen && input.quoteStale) failed.push("QUOTE_STALE");
  else if (!input.quoteStale) passed.push("QUOTE_FRESH_FLAG");

  if (
    requireOpen &&
    input.quoteAgeSeconds != null &&
    input.quoteAgeSeconds > input.maxQuoteAgeSeconds
  ) {
    failed.push("QUOTE_AGE");
  } else if (input.quoteAgeSeconds != null) passed.push("QUOTE_AGE_OK");

  if (input.quoteSpread != null && input.quoteSpread > input.maxSpread) {
    failed.push("SPREAD_TOO_WIDE");
  } else if (input.quoteSpread != null) passed.push("SPREAD_OK");

  if (input.confidence == null || input.confidence < input.minConfidence) {
    failed.push("CONFIDENCE_TOO_LOW");
  } else passed.push("CONFIDENCE_OK");

  if (
    input.minRiskReward != null &&
    input.entry != null &&
    input.stopLoss != null &&
    input.takeProfit != null &&
    Number.isFinite(input.entry) &&
    Number.isFinite(input.stopLoss) &&
    Number.isFinite(input.takeProfit)
  ) {
    const risk = Math.abs(input.entry - input.stopLoss);
    const reward = Math.abs(input.takeProfit - input.entry);
    const rr = risk > 0 ? reward / risk : 0;
    if (rr + 1e-9 < input.minRiskReward) failed.push("RR_TOO_LOW");
    else passed.push("RR_OK");
  }

  return { ok: failed.length === 0, failed, passed };
}
