import { z } from "zod";

export const tradingModeSchema = z.enum(["MANUAL", "CONFIRM", "DEMO_AUTO", "LIVE_AUTO"]);
export type TradingMode = z.infer<typeof tradingModeSchema>;

export const brokerIdSchema = z.enum(["none", "trading212_manual", "demo_simulated"]);
export type BrokerId = z.infer<typeof brokerIdSchema>;

export const riskControlsSchema = z
  .object({
    maxRiskPerTradePercent: z.number().min(0.05).max(1),
    maxDailyLossPercent: z.number().min(0.1).max(10),
    maxTradesPerDay: z.number().int().min(1).max(50),
    minConfidence: z.number().min(0).max(100),
    maxSpread: z.number().min(0).max(20),
    slippageTolerance: z.number().min(0).max(10),
    blockStaleData: z.boolean(),
    blockDuplicateSignals: z.boolean(),
    blockHighImpactNews: z.boolean()
  })
  .strict();

export type RiskControls = z.infer<typeof riskControlsSchema>;

export const DEFAULT_RISK_CONTROLS: RiskControls = {
  maxRiskPerTradePercent: 0.5,
  maxDailyLossPercent: 2,
  maxTradesPerDay: 5,
  minConfidence: 70,
  maxSpread: 0.8,
  slippageTolerance: 0.35,
  blockStaleData: true,
  blockDuplicateSignals: true,
  blockHighImpactNews: true
};

export const DEFAULT_DEMO_REQUIRED_CLOSED_TRADES = 20;
export const DEFAULT_DEMO_REQUIRED_DAYS = 7;

export const demoTestingSchema = z
  .object({
    requiredClosedTrades: z.number().int().min(1).default(DEFAULT_DEMO_REQUIRED_CLOSED_TRADES),
    closedTrades: z.number().int().min(0).default(0),
    requiredDays: z.number().int().min(1).default(DEFAULT_DEMO_REQUIRED_DAYS),
    startedAt: z.string().datetime().nullable().default(null),
    completedAt: z.string().datetime().nullable().default(null)
  })
  .strict();

export type DemoTestingProgress = z.infer<typeof demoTestingSchema>;

export const tradingControlsSchema = z
  .object({
    mode: tradingModeSchema.default("MANUAL"),
    autoTradingEnabled: z.boolean().default(false),
    emergencyStopActive: z.boolean().default(false),
    liveAutoUnlocked: z.boolean().default(false),
    liveAutoEnabledByUser: z.boolean().default(false),
    selectedBrokerId: brokerIdSchema.default("trading212_manual"),
    riskControls: riskControlsSchema.default(DEFAULT_RISK_CONTROLS),
    demoTesting: demoTestingSchema.default({
      requiredClosedTrades: DEFAULT_DEMO_REQUIRED_CLOSED_TRADES,
      closedTrades: 0,
      requiredDays: DEFAULT_DEMO_REQUIRED_DAYS,
      startedAt: null,
      completedAt: null
    }),
    disclaimerAcknowledged: z.boolean().default(false)
  })
  .strict();

export type TradingControls = z.infer<typeof tradingControlsSchema> & {
  userId: string;
  updatedAt: string;
};

export const tradingControlsPatchSchema = z
  .object({
    mode: tradingModeSchema.optional(),
    autoTradingEnabled: z.boolean().optional(),
    liveAutoEnabledByUser: z.boolean().optional(),
    selectedBrokerId: brokerIdSchema.optional(),
    riskControls: riskControlsSchema.partial().optional(),
    disclaimerAcknowledged: z.boolean().optional(),
    emergencyStopActive: z.boolean().optional()
  })
  .strict();

export type TradingControlsPatch = z.infer<typeof tradingControlsPatchSchema>;

export const brokerActionSchema = z.enum([
  "ENTER",
  "SET_STOP_LOSS",
  "SET_TAKE_PROFIT",
  "PARTIAL_CLOSE",
  "MOVE_BREAKEVEN",
  "EARLY_EXIT",
  "CANCEL_PENDING"
]);
export type BrokerAction = z.infer<typeof brokerActionSchema>;

export const proposedOrderSchema = z
  .object({
    proposalId: z.string().min(8),
    decisionId: z.string().min(4),
    symbol: z.literal("XAUUSD"),
    side: z.enum(["BUY", "SELL"]),
    orderType: z.enum(["MARKET", "LIMIT"]),
    quantity: z.number().positive(),
    entryPrice: z.number().positive().nullable(),
    stopLoss: z.number().positive().nullable(),
    takeProfits: z.array(
      z.object({
        label: z.string(),
        price: z.number().positive(),
        closeFraction: z.number().min(0).max(1)
      })
    ),
    riskPercent: z.number().positive(),
    confidence: z.number().min(0).max(100),
    mode: tradingModeSchema,
    brokerId: brokerIdSchema,
    status: z.enum(["PROPOSED", "CONFIRMED", "REJECTED", "EXPIRED", "EXECUTED", "BLOCKED"]),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    instructions: z.array(z.string()),
    blockedReasons: z.array(z.string()).default([])
  })
  .strict();

export type ProposedOrder = z.infer<typeof proposedOrderSchema>;

export const proposeOrderRequestSchema = z
  .object({
    decisionId: z.string().min(4),
    side: z.enum(["BUY", "SELL"]),
    orderType: z.enum(["MARKET", "LIMIT"]).default("MARKET"),
    quantity: z.number().positive(),
    entryPrice: z.number().positive().nullable().optional(),
    stopLoss: z.number().positive().nullable().optional(),
    takeProfits: z
      .array(
        z.object({
          label: z.string(),
          price: z.number().positive(),
          closeFraction: z.number().min(0).max(1).default(0.33)
        })
      )
      .default([]),
    riskPercent: z.number().positive().max(1),
    confidence: z.number().min(0).max(100),
    spread: z.number().min(0).optional(),
    expectedPrice: z.number().positive().optional(),
    fillPrice: z.number().positive().optional(),
    dataQuality: z.enum(["GOOD", "PARTIAL", "STALE", "CONFLICTED", "INVALID"]).optional(),
    signalKey: z.string().min(4).optional(),
    highImpactNewsActive: z.boolean().optional(),
    confirmationToken: z.string().min(8).optional()
  })
  .strict();

export type ProposeOrderRequest = z.infer<typeof proposeOrderRequestSchema>;

export interface DemoOrderRecord {
  orderId: string;
  userId: string;
  proposalId?: string;
  decisionId: string;
  symbol: "XAUUSD";
  side: "BUY" | "SELL";
  status: "PENDING" | "FILLED" | "PARTIAL" | "CANCELLED" | "REJECTED";
  quantity: number;
  filledQuantity: number;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfits: Array<{ label: string; price: number; closeFraction: number; filled: boolean }>;
  realizedR: number;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
}

export interface DemoPerformanceSnapshot {
  userId: string;
  equity: number;
  startingEquity: number;
  peakEquity: number;
  drawdownPercent: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  averageR: number;
  expectancyR: number;
  updatedAt: string;
}

export const DEFAULT_DEMO_STARTING_EQUITY = 10_000;
