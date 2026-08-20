/**
 * Friendly broker / Gold Hunter / TradingView copy for ordinary UI.
 * Technical codes stay available under diagnostics only.
 */

const REJECT_MAP: Record<string, string> = {
  MARGIN_ELIGIBILITY_UNKNOWN:
    "Margin information is not available yet. Trading remains locked.",
  VOLUME_BELOW_MINIMUM_AFTER_ROUNDING:
    "Your selected risk is too low for the broker’s minimum trade size.",
  VOLUME_BELOW_MINIMUM:
    "Your selected risk is too low for the broker’s minimum trade size.",
  BROKER_EXECUTION_ENABLED_FALSE:
    "Order submission is currently disabled in this preview.",
  BROKER_EXECUTION_DISABLED:
    "Order submission is currently disabled in this preview.",
  CTRADER_DEMO_ORDER_SUBMISSION_MUST_REMAIN_FALSE:
    "Order submission is currently disabled in this preview.",
  CTRADER_LIVE_MUST_REMAIN_FALSE:
    "Live order execution is currently disabled in this preview.",
  SIGNAL_STALE: "This alert is too old to use. Send a fresh TradingView alert.",
  CONFIDENCE_TOO_LOW: "Confidence is below your Gold Hunter setting.",
  CANDLE_CONFIRMATION_REQUIRED: "Waiting for a confirmed candle before trading.",
  MARKET_CLOSED: "The gold market is closed right now.",
  QUOTE_UNAVAILABLE: "A live price quote is not available yet.",
  QUOTE_NOT_LIVE: "The price quote is not live yet.",
  QUOTE_STALE: "The price quote is out of date. Wait for a fresh quote.",
  SYMBOL_METADATA_INCOMPLETE: "Broker symbol details are incomplete. Trading stays locked.",
  MAX_OPEN_POSITIONS: "You already have the maximum number of open positions.",
  MAX_TRADES_PER_DAY: "Today’s trade limit has been reached.",
  SPREAD_TOO_WIDE: "The spread is wider than your Gold Hunter setting allows.",
  DUPLICATE_SIGNAL: "This alert was already received. No duplicate decision was created.",
  UNSUPPORTED_SYMBOL: "This symbol is not supported. Use an XAUUSD / gold alias.",
  PAYLOAD_TOO_LARGE: "The alert message is too large. Use the standard GoldMeta alert body.",
  INVALID_SECRET: "The webhook secret did not match. Rotate the secret or paste the correct one.",
  WEBHOOK_REVOKED: "This webhook was revoked. Create a new private webhook.",
  AUTH_SETUP_REQUIRED: "Account security checks must pass before connecting a broker.",
  LIVE_SELECTION_CONFIRMATION_REQUIRED:
    "Live accounts need an explicit confirmation because they use real money."
};

/** Map a raw code or underscore phrase to friendly UI copy. */
export function friendlyBrokerReason(
  code: string | null | undefined,
  fallback?: string
): string {
  if (!code) return fallback ?? "Something needs attention. Open diagnostics for details.";
  const key = code.trim().toUpperCase().replace(/\s+/g, "_");
  if (REJECT_MAP[key]) return REJECT_MAP[key];
  if (key.includes("MARGIN") && key.includes("UNKNOWN")) {
    return REJECT_MAP.MARGIN_ELIGIBILITY_UNKNOWN;
  }
  if (key.includes("VOLUME") && (key.includes("MINIMUM") || key.includes("BELOW"))) {
    return REJECT_MAP.VOLUME_BELOW_MINIMUM;
  }
  if (key.includes("BROKER_EXECUTION") || key.includes("ORDER_SUBMISSION")) {
    return REJECT_MAP.BROKER_EXECUTION_DISABLED;
  }
  if (key.includes("STALE")) return REJECT_MAP.SIGNAL_STALE;
  if (key.includes("DUPLICATE")) return REJECT_MAP.DUPLICATE_SIGNAL;
  // Already human-readable sentence
  if (!/[A-Z]{3,}_[A-Z0-9_]+/.test(code) && code.length < 160) return code;
  return fallback ?? code.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function friendlyPreviewNote(raw: string | null | undefined): string {
  if (!raw) return "Preview only — no order will be submitted.";
  if (/BROKER_EXECUTION|ORDER_SUBMISSION|mutationFlagsHardFalse/i.test(raw)) {
    return "Order submission is currently disabled in this preview.";
  }
  return friendlyBrokerReason(raw, raw);
}
