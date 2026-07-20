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
    timeframe: z.enum(["1", "5", "15", "60", "240"]),
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

export interface DecisionRecord {
  schemaVersion: "1.0";
  decisionId: string;
  userId: string;
  symbol: "XAUUSD";
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
  dataSourceLabel: "LIVE" | "DELAYED" | "STALE" | "MOCK" | "OFFLINE";
}

export const deviceRegistrationSchema = z
  .object({
    deviceId: z.string().min(3),
    fcmToken: z.string().min(10),
    platform: z.literal("ios"),
    appVersion: z.string().min(1).optional()
  })
  .strict();

export type DeviceRegistration = z.infer<typeof deviceRegistrationSchema>;

export interface DeviceRecord extends DeviceRegistration {
  userId: string;
  registeredAt: string;
}

export const journalCreateSchema = z
  .object({
    decisionId: z.string().optional(),
    symbol: z.literal("XAUUSD").default("XAUUSD"),
    direction: z.enum(["BUY", "SELL", "WAIT"]),
    outcome: z.enum(["WIN", "LOSS", "BREAKEVEN", "OPEN"]).default("OPEN"),
    riskReward: z.number().nullable().optional(),
    pnl: z.number().nullable().optional(),
    notes: z.string().max(2000).optional()
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
    riskProfile: z.enum(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"]).optional()
  })
  .strict();

export interface UserSettings {
  userId: string;
  aiEnabled: boolean;
  notificationsEnabled: boolean;
  provisionalSignalsEnabled: boolean;
  riskProfile: "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
  updatedAt: string;
}
