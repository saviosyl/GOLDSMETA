import { z } from "zod";

const optionalNumber = z.number().finite().nullable().optional();

export const trendMeterStateSchema = z.enum(["BULLISH", "BEARISH", "NEUTRAL", "UNKNOWN"]);
export const confirmationStateSchema = z.enum([
  "NONE",
  "BULLISH_REJECTION",
  "BEARISH_REJECTION",
  "BULLISH_BREAKOUT",
  "BEARISH_BREAKOUT",
  "BULLISH_RETEST",
  "BEARISH_RETEST",
  "BULLISH_CONTINUATION",
  "BEARISH_CONTINUATION"
]);

export const marketAnalysisInputSchema = z
  .object({
    symbol: z.literal("XAUUSD"),
    timeframe: z.string().min(1),
    currentPrice: z.number().positive(),
    candle: z
      .object({
        open: optionalNumber,
        high: optionalNumber,
        low: optionalNumber,
        close: optionalNumber
      })
      .strict(),
    poc: optionalNumber,
    vah: optionalNumber,
    val: optionalNumber,
    hvnLevels: z.array(z.number().finite()).default([]),
    trendMeter: z
      .object({
        state: trendMeterStateSchema,
        strength: z.number().min(0).max(100)
      })
      .strict(),
    confirmationCandle: z
      .object({
        state: confirmationStateSchema,
        confirmed: z.boolean()
      })
      .strict(),
    volume: optionalNumber,
    relativeVolume: optionalNumber,
    vwap: optionalNumber,
    ema21: optionalNumber,
    ema50: optionalNumber,
    ema200: optionalNumber,
    rsi: optionalNumber,
    atr: optionalNumber,
    spread: optionalNumber,
    session: z.string().nullable().optional(),
    nearbySupport: optionalNumber,
    nearbyResistance: optionalNumber,
    highImpactNewsActive: z.boolean().default(false),
    marketDataTime: z.string().datetime(),
    evaluatedAt: z.string().datetime().optional(),
    missingFields: z.array(z.string()).default([]),
    isStale: z.boolean().default(false)
  })
  .strict();

export type MarketAnalysisInput = z.infer<typeof marketAnalysisInputSchema>;

export const primaryActionSchema = z.enum(["BUY", "SELL", "WAIT"]);
export type PrimaryAction = z.infer<typeof primaryActionSchema>;

export const setupGradeSchema = z.enum(["A+", "A", "B", "C", "No Trade"]);
export type SetupGrade = z.infer<typeof setupGradeSchema>;

export const entryTypeSchema = z.enum(["market", "limit", "breakout", "retest", "none"]);
export type EngineEntryType = z.infer<typeof entryTypeSchema>;

export const managementActionSchema = z.enum([
  "WAIT_FOR_CLOSE",
  "ENTER",
  "HOLD",
  "TAKE_PARTIAL",
  "MOVE_SL_TO_BREAKEVEN",
  "EXIT_EARLY"
]);
export type ManagementAction = z.infer<typeof managementActionSchema>;

export const scoreFactorSchema = z
  .object({
    factor: z.string(),
    weight: z.number(),
    awarded: z.number(),
    side: z.enum(["BULLISH", "BEARISH", "NEUTRAL", "PENALTY"]),
    note: z.string()
  })
  .strict();

export type ScoreFactor = z.infer<typeof scoreFactorSchema>;

export const decisionEngineResultSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    configVersion: z.string(),
    symbol: z.literal("XAUUSD"),
    timeframe: z.string(),
    evaluatedAt: z.string().datetime(),
    primaryAction: primaryActionSchema,
    confidence: z.number().min(0).max(100),
    tradeScore: z.number().min(0).max(100),
    setupGrade: setupGradeSchema,
    trend: trendMeterStateSchema,
    entryType: entryTypeSchema,
    entryRange: z
      .object({
        low: z.number().nullable(),
        high: z.number().nullable(),
        reference: z.number().nullable()
      })
      .strict(),
    stopLoss: z.number().nullable(),
    takeProfits: z.object({
      tp1: z.number().nullable(),
      tp2: z.number().nullable(),
      tp3: z.number().nullable()
    }),
    riskReward: z.object({
      tp1: z.number().nullable(),
      tp2: z.number().nullable(),
      tp3: z.number().nullable()
    }),
    invalidationLevel: z.number().nullable(),
    supportingReasons: z.array(z.string()),
    opposingReasons: z.array(z.string()),
    missingDataWarnings: z.array(z.string()),
    recommendedManagementAction: managementActionSchema,
    explanation: z.string(),
    scoreBreakdown: z.array(scoreFactorSchema),
    bullishScore: z.number(),
    bearishScore: z.number(),
    safetyFlags: z.array(z.string()),
    analysisOnly: z.literal(true)
  })
  .strict();

export type DecisionEngineResult = z.infer<typeof decisionEngineResultSchema>;

export const openPositionInputSchema = z
  .object({
    side: z.enum(["BUY", "SELL"]),
    entryPrice: z.number().positive(),
    stopLoss: z.number().positive(),
    currentPrice: z.number().positive(),
    takeProfits: z.object({
      tp1: z.number().nullable(),
      tp2: z.number().nullable(),
      tp3: z.number().nullable()
    }),
    tp1Hit: z.boolean().default(false),
    trendMeter: z
      .object({
        state: trendMeterStateSchema,
        strength: z.number().min(0).max(100)
      })
      .strict(),
    confirmationCandle: z
      .object({
        state: confirmationStateSchema,
        confirmed: z.boolean()
      })
      .strict(),
    poc: optionalNumber,
    vwap: optionalNumber,
    relativeVolume: optionalNumber,
    spread: optionalNumber,
    isStale: z.boolean().default(false),
    highImpactNewsActive: z.boolean().default(false)
  })
  .strict();

export type OpenPositionInput = z.infer<typeof openPositionInputSchema>;

export const managementResultSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    configVersion: z.string(),
    action: z.enum(["HOLD", "TAKE_PARTIAL", "MOVE_SL_TO_BREAKEVEN", "EXIT_EARLY"]),
    currentR: z.number(),
    reasons: z.array(z.string()),
    explanation: z.string(),
    analysisOnly: z.literal(true)
  })
  .strict();

export type ManagementResult = z.infer<typeof managementResultSchema>;

export const decisionEngineConfigSchema = z
  .object({
    version: z.string(),
    schemaVersion: z.string(),
    thresholds: z.record(z.string(), z.number()),
    weights: z.object({
      trendMeter: z.object({ bullish: z.number(), bearish: z.number() }),
      marketStructure: z.object({ bullish: z.number(), bearish: z.number() }),
      pocPosition: z.object({ bullish: z.number(), bearish: z.number() }),
      valueArea: z.object({ bullish: z.number(), bearish: z.number() }),
      vwapAlignment: z.object({ bullish: z.number(), bearish: z.number() }),
      emaAlignment: z.object({ bullish: z.number(), bearish: z.number() }),
      confirmationCandle: z.object({ bullish: z.number(), bearish: z.number() }),
      volumeConfirmation: z.object({ bullish: z.number(), bearish: z.number() }),
      rsiCondition: z.object({ bullish: z.number(), bearish: z.number() }),
      supportResistance: z.object({ bullish: z.number(), bearish: z.number() }),
      atrVolatility: z.object({ bullish: z.number(), bearish: z.number() }),
      spread: z.object({ bullish: z.number(), bearish: z.number() }),
      newsRisk: z.object({ bullish: z.number(), bearish: z.number() }),
      dataCompleteness: z.object({ bullish: z.number(), bearish: z.number() })
    }),
    penalties: z.record(z.string(), z.number()),
    gradeBands: z.object({
      aPlus: z.number(),
      a: z.number(),
      b: z.number(),
      c: z.number()
    }),
    management: z.object({
      partialProfitR: z.number(),
      breakevenAfterR: z.number(),
      earlyExitAdverseR: z.number(),
      trendDeteriorationStrength: z.number()
    })
  })
  .strict();

export type DecisionEngineConfig = z.infer<typeof decisionEngineConfigSchema>;
