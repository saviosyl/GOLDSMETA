import { z } from "zod";

export type ManualRiskSettings = {
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

/** Manual cash-risk planner defaults (€20 personal risk mode). Not broker execution. */
export const DEFAULT_MANUAL_RISK: ManualRiskSettings = {
  currency: "EUR",
  maxCashRiskPerTrade: 20,
  maxSimultaneousManualTrades: 1,
  maxDailyRealisedLoss: 40,
  stopAfterConsecutiveLosses: 2,
  /** User-supplied broker value-per-point / point value — never guessed. */
  valuePerPoint: null,
  estimatedSpreadPoints: null,
  noAveragingDown: true,
  noMartingale: true,
  noAutomaticRecovery: true
};

export const manualRiskSettingsSchema = z
  .object({
    currency: z.enum(["EUR", "USD", "GBP"]).optional(),
    maxCashRiskPerTrade: z.number().positive().max(10_000).optional(),
    maxSimultaneousManualTrades: z.number().int().min(1).max(5).optional(),
    maxDailyRealisedLoss: z.number().positive().max(50_000).optional(),
    stopAfterConsecutiveLosses: z.number().int().min(1).max(20).optional(),
    valuePerPoint: z.number().positive().nullable().optional(),
    estimatedSpreadPoints: z.number().nonnegative().nullable().optional(),
    noAveragingDown: z.literal(true).optional(),
    noMartingale: z.literal(true).optional(),
    noAutomaticRecovery: z.literal(true).optional()
  })
  .strict();

export const manualExecutionActionSchema = z.enum([
  "ENTERED",
  "SKIPPED",
  "ENTERED_LATE",
  "INCORRECT_SIZE",
  "SPREAD_TOO_HIGH",
  "NEWS_RISK",
  "SETUP_NOT_CLEAR",
  "OTHER"
]);

export type ManualExecutionAction = z.infer<typeof manualExecutionActionSchema>;

export const manualExecutionSchema = z
  .object({
    action: manualExecutionActionSchema,
    skipReason: z.string().max(500).optional(),
    actualEntryPrice: z.number().positive().optional(),
    positionSize: z.number().positive().optional(),
    broker: z.string().max(80).optional(),
    tradedAt: z.string().datetime().optional(),
    cashRiskIntended: z.number().positive().optional(),
    actualStop: z.number().positive().optional(),
    actualTp1: z.number().positive().optional(),
    actualTp2: z.number().positive().optional(),
    actualTp3: z.number().positive().optional(),
    actualExitPrice: z.number().positive().optional(),
    actualPnl: z.number().optional(),
    feesSpreadSlippage: z.number().optional(),
    notes: z.string().max(2000).optional(),
    screenshotRef: z.string().max(500).optional()
  })
  .strict();

export type ManualExecutionInput = z.infer<typeof manualExecutionSchema>;

export interface ManualExecutionRecord extends ManualExecutionInput {
  updatedAt: string;
  /** Never mutates system outcome — journal only. */
  systemOutcomeUntouched: true;
}

export interface SetupSkipRecord {
  id: string;
  userId: string;
  decisionId: string;
  environment: "LIVE" | "TEST";
  reason: string;
  at: string;
}

export interface ManualRiskLimitChange {
  at: string;
  field: string;
  from: string | number | boolean | null;
  to: string | number | boolean | null;
}
