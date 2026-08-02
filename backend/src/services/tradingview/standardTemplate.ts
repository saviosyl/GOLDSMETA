/**
 * GoldMeta Standard TradingView Template — application configuration.
 * Derived from the approved admin Pine/JSON schema (schemaVersion 1.0 /
 * GoldMetaBridge alert contract). Never includes admin webhook secrets,
 * broker credentials, UIDs, or private signal history.
 */

export const STANDARD_TEMPLATE_ID = "goldmeta-standard-v1";
export const STANDARD_TEMPLATE_NAME = "GoldMeta Standard TradingView Template";

export type TemplateSetupMode = "standard" | "custom";

export type GoldMetaFieldKey =
  | "symbol"
  | "exchange"
  | "timeframe"
  | "timestamp"
  | "open"
  | "high"
  | "low"
  | "close"
  | "volume"
  | "action"
  | "confidence"
  | "poc"
  | "vah"
  | "val"
  | "hvn"
  | "trendMeter"
  | "confirmationCandle"
  | "vwap"
  | "ema21"
  | "ema50"
  | "ema200"
  | "rsi"
  | "atr"
  | "support"
  | "resistance"
  | "session"
  | "strategyId"
  | "alertId"
  | "entry"
  | "stopLoss"
  | "tp1"
  | "tp2"
  | "tp3";

export type FieldMapping = {
  tradingViewField: string;
  goldMetaField: GoldMetaFieldKey;
  required: boolean;
};

export type StandardTradingViewTemplate = {
  id: string;
  name: string;
  version: string;
  schemaVersion: "1.0";
  status: "published" | "deprecated";
  releaseNotes: string;
  publishedAt: string;
  supportedSymbols: string[];
  symbolAliases: Record<string, string>;
  supportedTimeframes: Array<{ value: string; label: string }>;
  requiredFields: string[];
  optionalFields: string[];
  payloadFieldNames: Record<string, string>;
  acceptedValueFormats: Record<string, string>;
  validationRules: {
    staleSignalLimitSeconds: number;
    duplicateSignalWindowSeconds: number;
    maxPayloadBytes: number;
    requireConfirmedBar: boolean;
  };
  indicatorMapping: FieldMapping[];
  defaultDecisionEngineMapping: {
    buySellWaitSource: string;
    confidenceSource: string;
    levelsSource: string;
    trendSource: string;
    confirmationSource: string;
  };
  defaultAlertNameFormat: string;
  defaultAlertMessageBody: string;
  pineMessagePlaceholder: "{{alert_message}}";
  instructions: string[];
};

/** Canonical published v1 — matches shared schema + GoldMetaBridge Pine contract. */
export const GOLD_META_STANDARD_V1: StandardTradingViewTemplate = {
  id: STANDARD_TEMPLATE_ID,
  name: STANDARD_TEMPLATE_NAME,
  version: "1",
  schemaVersion: "1.0",
  status: "published",
  releaseNotes:
    "Initial platform standard based on the approved GoldMetaBridge TradingView alert schema used by the administrator. Standard formatting only — no shared webhook or trading data.",
  publishedAt: "2026-08-02T00:00:00.000Z",
  supportedSymbols: ["XAUUSD"],
  symbolAliases: {
    XAUUSD: "XAUUSD",
    "OANDA:XAUUSD": "XAUUSD",
    "FOREXCOM:XAUUSD": "XAUUSD",
    "PEPPERSTONE:XAUUSD": "XAUUSD",
    "CAPITALCOM:GOLD": "XAUUSD",
    GOLD: "XAUUSD",
    "TVC:GOLD": "XAUUSD"
  },
  supportedTimeframes: [
    { value: "1", label: "1 minute" },
    { value: "5", label: "5 minutes" },
    { value: "15", label: "15 minutes" },
    { value: "30", label: "30 minutes" },
    { value: "60", label: "1 hour" },
    { value: "240", label: "4 hours" }
  ],
  requiredFields: [
    "schemaVersion",
    "source",
    "eventId",
    "symbol",
    "timeframe",
    "eventType",
    "barTime",
    "sentAt",
    "isConfirmedBar"
  ],
  optionalFields: [
    "exchange",
    "indicatorName",
    "ohlcv",
    "levels",
    "sessionVolumeProfile",
    "marketProfile",
    "trend",
    "confirmationCandle",
    "optionalIndicators",
    "metadata",
    "webhookSecret"
  ],
  payloadFieldNames: {
    schemaVersion: "schemaVersion",
    symbol: "symbol",
    exchange: "exchange",
    timeframe: "timeframe",
    barTime: "barTime",
    sentAt: "sentAt",
    eventType: "eventType",
    eventId: "eventId",
    close: "ohlcv.close",
    high: "ohlcv.high",
    low: "ohlcv.low",
    open: "ohlcv.open",
    volume: "ohlcv.volume",
    poc: "levels.pocAll / sessionVolumeProfile.poc",
    vah: "levels.vahAll / sessionVolumeProfile.vah",
    val: "levels.valAll / sessionVolumeProfile.val",
    hvn: "sessionVolumeProfile.hvn",
    trendMeter: "trend.direction + trend.strength",
    confirmationCandle: "confirmationCandle",
    atr: "optionalIndicators.atr.value",
    vwap: "optionalIndicators.vwap",
    ema21: "optionalIndicators.ema21",
    ema50: "optionalIndicators.ema50",
    ema200: "optionalIndicators.ema200",
    rsi: "optionalIndicators.rsi",
    session: "sessionVolumeProfile.session",
    strategyId: "metadata.strategyId",
    alertId: "eventId",
    templateVersion: "metadata.templateVersion"
  },
  acceptedValueFormats: {
    schemaVersion: '"1.0"',
    symbol: "XAUUSD (aliases normalised server-side)",
    timeframe: "1 | 5 | 15 | 60 | 240 (30 accepted when mapped)",
    barTime: "ISO-8601 datetime",
    sentAt: "ISO-8601 datetime",
    eventType: "BAR_CLOSE | BAR_UPDATE | INDICATOR_UPDATE | TEST",
    "trend.direction": "BULLISH | BEARISH | NEUTRAL",
    numbers: "JSON number (not string)"
  },
  validationRules: {
    staleSignalLimitSeconds: 1800,
    duplicateSignalWindowSeconds: 300,
    maxPayloadBytes: 64_000,
    requireConfirmedBar: true
  },
  indicatorMapping: [
    { tradingViewField: "trend.strength", goldMetaField: "trendMeter", required: false },
    { tradingViewField: "trend.direction", goldMetaField: "action", required: false },
    { tradingViewField: "confirmationCandle.confirmed", goldMetaField: "confirmationCandle", required: false },
    { tradingViewField: "levels.pocAll", goldMetaField: "poc", required: false },
    { tradingViewField: "levels.vahAll", goldMetaField: "vah", required: false },
    { tradingViewField: "levels.valAll", goldMetaField: "val", required: false },
    { tradingViewField: "ohlcv.close", goldMetaField: "close", required: false },
    { tradingViewField: "optionalIndicators.atr.value", goldMetaField: "atr", required: false },
    { tradingViewField: "optionalIndicators.rsi", goldMetaField: "rsi", required: false },
    { tradingViewField: "optionalIndicators.vwap", goldMetaField: "vwap", required: false },
    { tradingViewField: "optionalIndicators.ema21", goldMetaField: "ema21", required: false },
    { tradingViewField: "optionalIndicators.ema50", goldMetaField: "ema50", required: false },
    { tradingViewField: "optionalIndicators.ema200", goldMetaField: "ema200", required: false }
  ],
  defaultDecisionEngineMapping: {
    buySellWaitSource: "decisionPipeline from trend + confirmation + levels",
    confidenceSource: "calculateConfidence",
    levelsSource: "levels / sessionVolumeProfile",
    trendSource: "trend",
    confirmationSource: "confirmationCandle + isConfirmedBar"
  },
  defaultAlertNameFormat: "GoldMeta {{ticker}} {{interval}}",
  defaultAlertMessageBody: "{{alert_message}}",
  pineMessagePlaceholder: "{{alert_message}}",
  instructions: [
    "Install the GoldMetaBridge indicator (or compatible alert that emits schemaVersion 1.0).",
    "Create an alert with condition: Any alert() function call.",
    "Paste your private GoldMeta webhook URL.",
    "Set the alert message to {{alert_message}} so Pine can send the full JSON payload.",
    "Use Send test alert in GoldMeta, then wait for the first accepted signal."
  ]
};

const TEMPLATE_REGISTRY: Record<string, StandardTradingViewTemplate> = {
  [STANDARD_TEMPLATE_ID]: GOLD_META_STANDARD_V1
};

let activeTemplateId = STANDARD_TEMPLATE_ID;

export function getActiveStandardTemplate(): StandardTradingViewTemplate {
  return TEMPLATE_REGISTRY[activeTemplateId] ?? GOLD_META_STANDARD_V1;
}

export function getStandardTemplateById(id: string): StandardTradingViewTemplate | null {
  return TEMPLATE_REGISTRY[id] ?? null;
}

export function listStandardTemplates(): StandardTradingViewTemplate[] {
  return Object.values(TEMPLATE_REGISTRY);
}

/** Admin publish helper — keeps prior versions for compatibility. Does not touch user webhooks. */
export function publishStandardTemplateVersion(
  next: Omit<StandardTradingViewTemplate, "status" | "publishedAt"> & {
    status?: "published" | "deprecated";
  }
): StandardTradingViewTemplate {
  const published: StandardTradingViewTemplate = {
    ...next,
    status: next.status ?? "published",
    publishedAt: new Date().toISOString()
  };
  // Deprecate previous active if id differs
  const prev = TEMPLATE_REGISTRY[activeTemplateId];
  if (prev && prev.id !== published.id) {
    TEMPLATE_REGISTRY[prev.id] = { ...prev, status: "deprecated" };
  }
  TEMPLATE_REGISTRY[published.id] = published;
  activeTemplateId = published.id;
  return published;
}

export function normalizeSymbolAlias(raw: string): string | null {
  const key = raw.trim().toUpperCase();
  const tpl = getActiveStandardTemplate();
  if (tpl.symbolAliases[key]) return tpl.symbolAliases[key];
  if (tpl.supportedSymbols.includes(key)) return key;
  // Bare exchange:symbol
  const bare = key.includes(":") ? key.split(":").pop()! : key;
  if (bare === "GOLD") return "XAUUSD";
  if (tpl.supportedSymbols.includes(bare)) return bare;
  return null;
}

/**
 * User-facing alert message instructions. Pine builds JSON into {{alert_message}}.
 * Does not embed UID, secrets, or admin tokens.
 */
export function buildStandardAlertMessageGuide(args: {
  templateVersion: string;
  symbolAlias: string;
  timeframe: string;
}): {
  alertName: string;
  messageBody: string;
  pineReminder: string;
  metadataHint: Record<string, string>;
} {
  const tpl = getActiveStandardTemplate();
  return {
    alertName: `GoldMeta ${args.symbolAlias} ${args.timeframe}`,
    messageBody: tpl.defaultAlertMessageBody,
    pineReminder:
      "Use condition “Any alert() function call” and message {{alert_message}}. The GoldMetaBridge indicator fills the JSON payload automatically.",
    metadataHint: {
      templateId: tpl.id,
      templateVersion: args.templateVersion,
      schemaVersion: tpl.schemaVersion
    }
  };
}

export function publicTemplateSummary(tpl: StandardTradingViewTemplate = getActiveStandardTemplate()) {
  return {
    id: tpl.id,
    name: tpl.name,
    version: tpl.version,
    status: tpl.status,
    releaseNotes: tpl.releaseNotes,
    recommended: tpl.id === activeTemplateId && tpl.status === "published",
    description:
      "Uses the same standard GoldMeta alert structure and analysis mapping as the platform administrator. You only need to create the alert in TradingView and use your private webhook URL.",
    supportedSymbols: tpl.supportedSymbols,
    symbolAliases: tpl.symbolAliases,
    supportedTimeframes: tpl.supportedTimeframes,
    instructions: tpl.instructions,
    defaultAlertMessageBody: tpl.defaultAlertMessageBody,
    validationRules: tpl.validationRules,
    indicatorMapping: tpl.indicatorMapping,
    requiredFields: tpl.requiredFields,
    optionalFields: tpl.optionalFields
  };
}
