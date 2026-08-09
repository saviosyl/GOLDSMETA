/**
 * Hide raw gm_* engine feature names from normal Full Analysis UI.
 */

import { looksLikeReasonCode, plainReason } from "./reasonCodePlain";

const FEATURE_HINTS: Array<[RegExp, string]> = [
  [/gm_direction_1h/i, "1-hour direction"],
  [/gm_structure_15m/i, "15-minute structure"],
  [/gm_entry_5m/i, "5-minute entry confirmation"],
  [/gm_bias_/i, "Higher-timeframe bias"],
  [/gm_trend_/i, "Trend context"],
  [/gm_vol_/i, "Volatility context"],
  [/gm_/i, "Engine feature"]
];

export function isRawEngineEvidence(text: string): boolean {
  return /\bgm_[a-z0-9_]+/i.test(text) || looksLikeReasonCode(text);
}

/** Human label for supporting/opposing evidence lines. */
export function evidencePlain(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  for (const [re, label] of FEATURE_HINTS) {
    if (re.test(trimmed)) {
      const paren = trimmed.match(/\(([^)]+)\)/);
      const detail = paren?.[1]?.trim();
      if (detail && !/^gm_/i.test(detail)) {
        return `${label}: ${detail}`;
      }
      const after = trimmed.replace(/gm_[a-z0-9_]+/gi, "").replace(/[()]/g, " ").trim();
      return after ? `${label} (${after})` : label;
    }
  }

  if (looksLikeReasonCode(trimmed)) return plainReason(trimmed);
  return trimmed;
}
