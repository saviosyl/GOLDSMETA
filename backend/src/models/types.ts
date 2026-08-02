import { z } from "zod";
import { BACKEND_VERSION, RULE_CONFIG_VERSION } from "../config/decisionConfig";

export const directionSchema = z.enum(["BULLISH", "BEARISH", "NEUTRAL"]);
export const decisionDirectionSchema = z.enum(["BUY", "SELL", "WAIT"]);
export const dataQualitySchema = z.enum(["GOOD", "PARTIAL", "STALE", "CONFLICTED", "INVALID"]);

export const profileLevelSchema = z
  .object({
    price: z.number(),
    broken: z.boolean().nullable().optional(),
    ageBars: z.number().int().nullable().optional(),
    tests: z.number().int().nullable().optional(),
    distance: z.number().nullable().optional(),
    relation: z.enum(["ABOVE", "BELOW", "INTERACTING"]).nullable().optional()
  })
  .strict();

const ohlcvSchema = z
  .object({
    open: z.number().nullable().optional(),
    high: z.number().nullable().optional(),
    low: z.number().nullable().optional(),
    close: z.number().nullable().optional(),
    volume: z.number().nullable().optional()
  })
  .strict();

const levelsSchema = z
  .object({
    pocAll: z.number().nullable().optional(),
    vahAll: z.number().nullable().optional(),
    valAll: z.number().nullable().optional(),
    pocNonBroken: z.array(profileLevelSchema).optional(),
    vahNonBroken: z.array(profileLevelSchema).optional(),
    valNonBroken: z.array(profileLevelSchema).optional()
  })
  .strict();

const sessionVolumeProfileSchema = z
  .object({
    session: z.enum(["ASIA", "LONDON", "NEWYORK", "OVERLAP", "UNKNOWN"]).optional(),
    sessionStart: z.string().datetime().nullable().optional(),
    sessionEnd: z.string().datetime().nullable().optional(),
    poc: z.number().nullable().optional(),
    vah: z.number().nullable().optional(),
    val: z.number().nullable().optional(),
    hvn: z.array(z.number()).optional(),
    lvn: z.array(z.number()).optional(),
    acceptanceState: z.enum(["ACCEPTANCE", "REJECTION", "UNKNOWN"]).optional()
  })
  .strict();

const marketProfileSchema = z
  .object({
    tpoPoc: z.number().nullable().optional(),
    initialBalanceHigh: z.number().nullable().optional(),
    initialBalanceLow: z.number().nullable().optional(),
    poorHigh: z.number().nullable().optional(),
    poorLow: z.number().nullable().optional(),
    singlePrints: z.array(z.number()).optional(),
    valueMigration: z.enum(["UP", "DOWN", "BALANCED", "UNKNOWN"]).optional(),
    profileState: z.enum(["BALANCED", "IMBALANCED", "UNKNOWN"]).optional(),
    acceptanceState: z.enum(["ACCEPTANCE", "REJECTION", "UNKNOWN"]).optional()
  })
  .strict();

const trendComponentSchema = z
  .object({
    name: z.string(),
    direction: directionSchema,
    strength: z.number().min(0).max(100),
    sourceTimeframe: z.string()
  })
  .strict();

const trendSchema = z
  .object({
    components: z.array(trendComponentSchema).optional(),
    direction: directionSchema.optional(),
    strength: z.number().min(0).max(100).optional()
  })
  .strict();

const confirmationCandleSchema = z
  .object({
    confirmed: z.boolean().optional(),
    direction: directionSchema.optional(),
    candleType: z.string().nullable().optional(),
    classification: z
      .enum(["REJECTION", "BREAKOUT", "RETEST", "CONTINUATION", "NONE"])
      .optional(),
    open: z.number().nullable().optional(),
    high: z.number().nullable().optional(),
    low: z.number().nullable().optional(),
    close: z.number().nullable().optional(),
    bodyPercent: z.number().nullable().optional(),
    upperWickPercent: z.number().nullable().optional(),
    lowerWickPercent: z.number().nullable().optional(),
    volume: z.number().nullable().optional(),
    isClosed: z.boolean().nullable().optional(),
    relatedLevel: z.string().nullable().optional()
  })
  .strict();

export const tradingViewPayloadSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    source: z.enum(["tradingview", "proprietary_alert", "manual"]),
    eventId: z.string().min(8),
    webhookSecret: z.string().nullable().optional(),
    symbol: z.literal("XAUUSD"),
    exchange: z.string().nullable().optional(),
    timeframe: z.enum(["1", "5", "15", "30", "60", "240"]),
    eventType: z.enum(["BAR_CLOSE", "BAR_UPDATE", "INDICATOR_UPDATE", "TEST"]),
    barTime: z.string().datetime(),
    sentAt: z.string().datetime(),
    isConfirmedBar: z.boolean(),
    indicatorName: z.string().nullable().optional(),
    ohlcv: ohlcvSchema.nullable().optional(),
    levels: levelsSchema.nullable().optional(),
    sessionVolumeProfile: sessionVolumeProfileSchema.nullable().optional(),
    marketProfile: marketProfileSchema.nullable().optional(),
    trend: trendSchema.nullable().optional(),
    confirmationCandle: confirmationCandleSchema.nullable().optional(),
    optionalIndicators: z.record(z.string(), z.unknown()).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional()
  })
  .strict();

export type TradingViewPayload = z.infer<typeof tradingViewPayloadSchema>;
export type DecisionDirection = z.infer<typeof decisionDirectionSchema>;
export type DataQuality = z.infer<typeof dataQualitySchema>;
export type TrendDirection = z.infer<typeof directionSchema>;

export interface MarketSnapshot {
  id: string;
  sourceEventId: string;
  symbol: "XAUUSD";
  exchange: string | null;
  timeframe: TradingViewPayload["timeframe"];
  marketDataTime: string;
  receivedAt: string;
  price: number | null;
  ohlcv: TradingViewPayload["ohlcv"];
  levels: TradingViewPayload["levels"];
  sessionVolumeProfile: TradingViewPayload["sessionVolumeProfile"];
  marketProfile: TradingViewPayload["marketProfile"];
  trend: TradingViewPayload["trend"];
  confirmationCandle: TradingViewPayload["confirmationCandle"];
  isConfirmedBar: boolean;
  metadata: TradingViewPayload["metadata"];
}

export interface DataQualityResult {
  quality: DataQuality;
  warnings: string[];
  missingInputs: string[];
}

export interface EntryPlan {
  type: "MARKET" | "LIMIT" | "ENTRY_ZONE" | "WAIT_FOR_CONFIRMATION" | "NONE";
  price: number | null;
  zoneLow: number | null;
  zoneHigh: number | null;
  condition: string | null;
}

export interface StopLossPlan {
  price: number | null;
  reason: string | null;
}

export interface TakeProfitPlan {
  label: "TP1" | "TP2" | "TP3";
  price: number;
  reason: string;
}

export interface TradePlan {
  entry: EntryPlan;
  stopLoss: StopLossPlan;
  takeProfits: TakeProfitPlan[];
  riskReward: {
    tp1: number | null;
    tp2: number | null;
    tp3: number | null;
  };
  breakeven: {
    state: "NOT_APPLICABLE" | "HOLD_ORIGINAL_STOP" | "MOVE_TO_BREAKEVEN" | "LOCK_PARTIAL_PROFIT";
    trigger: string | null;
    newStop: number | null;
    reason: string | null;
  };
  earlyExit: {
    exitNow: boolean;
    conditions: string[];
  };
}

export interface ScoreResult {
  score: number;
  bullishEvidence: string[];
  bearishEvidence: string[];
  reasonCodes: string[];
  marketRegime: "TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "TRANSITION" | "UNKNOWN";
  confirmations?: number;
}

export interface GuardResult {
  passed: boolean;
  reasonCodes: string[];
  warnings: string[];
}

export interface AiExplanation {
  summary: string[];
  warnings: string[];
  recommendWait: boolean;
  modelId: string | null;
  promptVersion: string | null;
  safetyDowngraded: boolean;
}

/** Display-oriented market structure stored on every new decision. */
export interface DecisionMarketStructure {
  trend: TrendDirection | null;
  trendStrength: number | null;
  poc: number | null;
  vah: number | null;
  val: number | null;
  confirmationClassification:
    | "REJECTION"
    | "BREAKOUT"
    | "RETEST"
    | "CONTINUATION"
    | "NONE"
    | null;
  confirmationDirection: TrendDirection | null;
  confirmationCandleType: string | null;
}

/** Provenance for a single numeric market value. */
export interface PricePointMeta {
  source: string;
  symbol: string;
  exchangeOrBroker: string | null;
  timeframe: string | null;
  timestamp: string | null;
  receivedAt: string;
  quoteAgeSeconds: number | null;
  value: number | null;
}

/** One canonical gold identity across TradingView / cTrader / GoldMeta. */
export interface CanonicalSymbolIdentity {
  tradingViewSymbol: string;
  exchange: string | null;
  ctraderSymbolId: string | null;
  canonicalSymbol: "XAUUSD";
}

export interface DecisionRecord {
  schemaVersion: "1.0";
  decisionId: string;
  userId: string;
  symbol: "XAUUSD";
  /** Chart timeframe from the webhook payload. Null only on legacy records. */
  timeframe: TradingViewPayload["timeframe"] | null;
  /** Closed-bar time (ISO). Mirrors marketDataTime for explicit completeness. */
  barTime: string;
  generatedAt: string;
  marketDataTime: string;
  validUntil: string;
  decision: DecisionDirection;
  confidence: number;
  confidenceLabel: "LOW" | "MODERATE" | "HIGH" | "VERY_HIGH";
  marketRegime: ScoreResult["marketRegime"];
  dataQuality: DataQuality;
  isProvisional: boolean;
  setupScore: number;
  entry: EntryPlan;
  stopLoss: StopLossPlan;
  takeProfits: TakeProfitPlan[];
  riskReward: TradePlan["riskReward"];
  breakeven: TradePlan["breakeven"];
  earlyExit: TradePlan["earlyExit"];
  bullishEvidence: string[];
  bearishEvidence: string[];
  reasonCodes: string[];
  reasonSummary: string[];
  warnings: string[];
  missingInputs: string[];
  invalidation: string;
  disclaimer: string;
  lifecycleState: "ACTIVE" | "INCOMPLETE" | "INVALIDATED" | "EXPIRED" | "SUPERSEDED";
  snapshotId: string | null;
  ruleConfigVersion: typeof RULE_CONFIG_VERSION;
  pineScriptVersion: string | null;
  backendVersion: typeof BACKEND_VERSION;
  aiModelId: string | null;
  aiPromptVersion: string | null;
  aiSafetyDowngraded: boolean;
  notificationSent: boolean;
  currentSession: string | null;
  higherTimeframeBias: TrendDirection | null;
  lastKnownPrice: number | null;
  ohlcv: TradingViewPayload["ohlcv"];
  marketStructure: DecisionMarketStructure | null;
  dataSourceLabel: "LIVE" | "DELAYED" | "STALE" | "MOCK" | "OFFLINE" | "TEST";
  environment: "LIVE" | "TEST";
  isTestDecision: boolean;
  /** Canonical XAUUSD identity for this decision's price sources. */
  symbolIdentity?: CanonicalSymbolIdentity;
  /** Provenance for key prices — never mix incompatible regimes without checking these. */
  priceSources?: {
    alertClose?: PricePointMeta;
    barHigh?: PricePointMeta;
    barLow?: PricePointMeta;
    poc?: PricePointMeta;
    vah?: PricePointMeta;
    val?: PricePointMeta;
  };
}

export const deviceRegistrationSchema = z
  .object({
    deviceId: z.string().min(3),
    fcmToken: z.string().min(10),
    platform: z.enum(["ios", "web"]),
    appVersion: z.string().min(1).optional()
  })
  .strict();

export type DeviceRegistration = z.infer<typeof deviceRegistrationSchema>;

export interface DeviceRecord extends DeviceRegistration {
  userId: string;
  registeredAt: string;
}

export const webPushSubscriptionSchema = z
  .object({
    endpoint: z.string().url(),
    expirationTime: z.number().nullable().optional(),
    keys: z
      .object({
        p256dh: z.string().min(8),
        auth: z.string().min(8)
      })
      .strict(),
    userAgent: z.string().max(500).optional()
  })
  .strict();

export type WebPushSubscriptionInput = z.infer<typeof webPushSubscriptionSchema>;

export interface WebPushSubscriptionRecord extends WebPushSubscriptionInput {
  userId: string;
  subscriptionId: string;
  registeredAt: string;
  updatedAt: string;
}

export const journalCreateSchema = z
  .object({
    decisionId: z.string().optional(),
    setupId: z.string().optional(),
    symbol: z.literal("XAUUSD").default("XAUUSD"),
    direction: z.enum(["BUY", "SELL", "WAIT"]),
    outcome: z.enum(["WIN", "LOSS", "BREAKEVEN", "OPEN"]).default("OPEN"),
    riskReward: z.number().nullable().optional(),
    pnl: z.number().nullable().optional(),
    notes: z.string().max(2000).optional(),
    tags: z
      .array(
        z.enum([
          "followed",
          "ignored",
          "entered_manually",
          "avoided",
          "news_risk",
          "poor_spread",
          "discretionary_override"
        ])
      )
      .max(12)
      .optional()
  })
  .strict();

export const journalPatchSchema = journalCreateSchema.partial().strict();

export type JournalCreate = z.infer<typeof journalCreateSchema>;
export type JournalPatch = z.infer<typeof journalPatchSchema>;

export interface JournalEntry extends JournalCreate {
  journalId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export const settingsPatchSchema = z
  .object({
    aiEnabled: z.boolean().optional(),
    notificationsEnabled: z.boolean().optional(),
    provisionalSignalsEnabled: z.boolean().optional(),
    riskProfile: z.enum(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"]).optional(),
    liveForwardAckAt: z.string().datetime().nullable().optional(),
    manualRisk: z
      .object({
        currency: z.enum(["EUR", "USD", "GBP"]).optional(),
        maxCashRiskPerTrade: z.number().positive().max(10_000).optional(),
        maxSimultaneousManualTrades: z.number().int().min(1).max(5).optional(),
        maxDailyRealisedLoss: z.number().positive().max(50_000).optional(),
        stopAfterConsecutiveLosses: z.number().int().min(1).max(20).optional(),
        valuePerPoint: z.number().positive().nullable().optional(),
        estimatedSpreadPoints: z.number().nonnegative().nullable().optional()
      })
      .strict()
      .optional()
  })
  .strict();

export interface UserSettings {
  userId: string;
  aiEnabled: boolean;
  notificationsEnabled: boolean;
  provisionalSignalsEnabled: boolean;
  riskProfile: "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
  /** ISO timestamp when user acknowledged LIVE forward-testing banner; null = not yet. */
  liveForwardAckAt: string | null;
  manualRisk: {
    currency: "EUR" | "USD" | "GBP";
    maxCashRiskPerTrade: number;
    maxSimultaneousManualTrades: number;
    maxDailyRealisedLoss: number;
    stopAfterConsecutiveLosses: number;
    valuePerPoint: number | null;
    estimatedSpreadPoints: number | null;
    noAveragingDown: true;
    noMartingale: true;
    noAutomaticRecovery: true;
  };
  manualRiskLimitChangeLog: Array<{
    at: string;
    field: string;
    from: string | number | boolean | null;
    to: string | number | boolean | null;
  }>;
  updatedAt: string;
}
