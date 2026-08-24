import { z } from "zod";
import type { DecisionEnvironment } from "../services/storage/types";

export const setupStatusSchema = z.enum([
  "SIGNAL_CREATED",
  "WAITING_FOR_ENTRY",
  "ENTRY_TRIGGERED",
  "TP1_HIT",
  "TP2_HIT",
  "TP3_HIT",
  "STOP_LOSS_HIT",
  "BREAKEVEN",
  "EXPIRED",
  "CANCELLED",
  "INVALIDATED",
  "CLOSED",
  "AMBIGUOUS_INTRABAR"
]);

export type SetupStatus = z.infer<typeof setupStatusSchema>;

export const setupResolutionSchema = z.enum([
  "WIN_TP1",
  "WIN_TP2",
  "WIN_TP3",
  "LOSS_SL",
  "BREAKEVEN",
  "EXPIRED",
  "CANCELLED",
  "INVALIDATED",
  "AMBIGUOUS_WORST_CASE_SL",
  "OPEN"
]);

export type SetupResolution = z.infer<typeof setupResolutionSchema>;

export interface SetupStatusTransition {
  at: string;
  from: SetupStatus;
  to: SetupStatus;
  barTime: string | null;
  eventId: string | null;
  reason: string;
}

export interface SetupLevels {
  entryPrice: number | null;
  entryType: string | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
}

export interface SetupExcursion {
  mfe: number | null;
  mae: number | null;
  highestPriceSeen: number | null;
  lowestPriceSeen: number | null;
}

export interface SetupOutcome {
  /** Deterministic market path without management assumptions. */
  rawResolution: SetupResolution;
  rawRealisedR: number | null;
  /** Modelled under selected management policy (separate from raw). */
  modelledResolution: SetupResolution;
  modelledRealisedR: number | null;
  managementNotes: string[];
}

export interface SetupRecord {
  schemaVersion: "1.0";
  setupId: string;
  decisionId: string;
  userId: string;
  symbol: "XAUUSD";
  timeframe: string;
  direction: "BUY" | "SELL";
  environment: DecisionEnvironment;
  isTestSetup: boolean;
  createdAt: string;
  barTime: string;
  session: string | null;
  levels: SetupLevels;
  initialRisk: number | null;
  expectedRR: { tp1: number | null; tp2: number | null; tp3: number | null };
  confidence: number;
  trend: string | null;
  poc: number | null;
  vah: number | null;
  val: number | null;
  confirmationType: string | null;
  status: SetupStatus;
  statusHistory: SetupStatusTransition[];
  entryTriggeredAt: string | null;
  resolvedAt: string | null;
  resolution: SetupResolution;
  barsToEntry: number | null;
  barsToResolution: number | null;
  barsOpen: number;
  excursion: SetupExcursion;
  outcome: SetupOutcome;
  appliedBarEventIds: string[];
  ruleConfigVersion: string;
  pineScriptVersion: string | null;
  backendVersion: string;
  updatedAt: string;
  /**
   * User manual trade journal — never mutates outcome / rawResolution / modelledResolution.
   */
  manualExecution?: import("./manualRisk").ManualExecutionRecord | null;
}

export const ACTIVE_SETUP_STATUSES: SetupStatus[] = [
  "SIGNAL_CREATED",
  "WAITING_FOR_ENTRY",
  "ENTRY_TRIGGERED",
  "TP1_HIT",
  "TP2_HIT",
  "BREAKEVEN"
];

export const isActiveSetupStatus = (status: SetupStatus): boolean =>
  ACTIVE_SETUP_STATUSES.includes(status);
