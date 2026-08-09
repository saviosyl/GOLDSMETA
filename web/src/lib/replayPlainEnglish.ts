/**
 * Translate replay / shadow enums into trader wording.
 * Raw values stay under Advanced only.
 */

import { looksLikeReasonCode, plainReason } from "./reasonCodePlain";

const BIAS: Record<string, string> = {
  BUY_BIAS: "Bullish",
  SELL_BIAS: "Bearish",
  BULLISH: "Bullish",
  BEARISH: "Bearish",
  NEUTRAL: "Neutral",
  NONE: "None"
};

const BEHAVIOUR: Record<string, string> = {
  BREAKOUT_EXPANSION: "Breakout expansion",
  BREAKOUT: "Breakout",
  RANGE: "Range",
  PULLBACK: "Pullback",
  TREND: "Trend continuation",
  HIGH_VOLATILITY: "High volatility",
  CONSOLIDATION: "Consolidation"
};

const WHY_NO_PLAN: Record<string, string> = {
  ACTIVE_PLAN_TRACKED: "Another active plan was already being tracked.",
  PLAN_ALREADY_ACTIVE: "Another active plan was already being tracked.",
  AWAITING_SIGNAL: "Waiting for the next verified strategy signal.",
  INSUFFICIENT_DATA: "Not enough verified data for a new plan.",
  MARKET_CLOSED: "Market is closed."
};

function tokenPlain(token: string): string {
  const key = token.trim().toUpperCase().replace(/\s+/g, "_");
  if (BIAS[key]) return BIAS[key];
  if (BEHAVIOUR[key]) return BEHAVIOUR[key];
  if (WHY_NO_PLAN[key]) return WHY_NO_PLAN[key];
  if (looksLikeReasonCode(token)) return plainReason(token);
  return token;
}

/** Replace known enum tokens and rejects=N noise in a free-text replay field. */
export function replayPlainEnglish(text: string | null | undefined): string {
  if (!text) return "—";
  let out = text;

  out = out.replace(/\brejects?\s*=\s*\d+\b/gi, "").trim();
  out = out.replace(/\b[A-Z][A-Z0-9_]{2,}\b/g, (m) => tokenPlain(m));
  out = out.replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
  return out || "—";
}

export function replayBiasLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  const key = raw.trim().toUpperCase().replace(/\s+/g, "_");
  return BIAS[key] ?? replayPlainEnglish(raw);
}

export function replayBehaviourLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  const key = raw.trim().toUpperCase().replace(/\s+/g, "_");
  return BEHAVIOUR[key] ?? replayPlainEnglish(raw);
}
