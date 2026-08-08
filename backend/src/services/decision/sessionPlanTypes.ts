/**
 * Stable session plan — Pine Bridge 3.0.0 lifecycle.
 * Quotes never overwrite direction/entry/stop/TP. CONFIRM_5M updates status only.
 */

import type {
  DecisionDirection,
  EntryPlan,
  StopLossPlan,
  TakeProfitPlan,
  TradePlan,
  TrendDirection
} from "../../models/types";
import type { MarketStructureMode } from "./strategySignal";

export type SessionPlanLifecycleState =
  | "NO_VALID_PLAN"
  | "BUILDING"
  | "WAITING_FOR_ENTRY_ZONE"
  | "ARMED"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "TP1_REACHED"
  | "TP2_REACHED"
  | "INVALIDATED"
  | "EXPIRED"
  | "NO_TRADE";

export type PlanMutation =
  | "CREATED"
  | "REPLACED"
  | "STATUS_UPDATED"
  | "PLAN_UNCHANGED"
  | "NO_VALID_PLAN"
  | "NO_TRADE"
  | "INVALIDATED"
  | "EXPIRED";

export type PlanQualityGrade = "A" | "B" | "C" | "NO_PLAN";

export type FourHourContext = {
  direction: TrendDirection | null;
  strength: number | null;
  structureState: string | null;
  ema21: number | null;
  ema50: number | null;
  ema200: number | null;
  atr: number | null;
  swingHigh: number | null;
  swingLow: number | null;
  sourceCloseTime: string | null;
  neverTriggersEntry: true;
};

export type QuickTargetDayTrade = {
  enabled: true;
  tp1: number | null;
  tp1Label: string | null;
  tp1Reason: string | null;
  roomPoints: number | null;
  roomOk: boolean;
  riskReward: number | null;
  rrOk: boolean;
  structuralLevelUsed: number | null;
};

export type PlanQuality = {
  grade: PlanQualityGrade;
  reasons: string[];
};

export type SessionPlanRecord = {
  planId: string;
  planSourceKey: string | null;
  userId: string;
  symbol: "XAUUSD";
  schemaVersion: "1.0" | "1.1";
  pineScriptVersion: string | null;
  alertRole: string | null;
  lifecycleState: SessionPlanLifecycleState;
  planMutation: PlanMutation;
  /** Human-readable: "PLAN UNCHANGED" when quotes refresh price only. */
  planStabilityLabel:
    | "PLAN UNCHANGED"
    | "PLAN CREATED"
    | "PLAN REPLACED"
    | "STATUS UPDATED"
    | "NO VALID PLAN"
    | "NO TRADE"
    | "INVALIDATED"
    | "EXPIRED"
    | "VALID PLAN — WAITING"
    | "PLAN READY — WAIT FOR ENTRY ZONE";
  /** Soft geometry / quality limitations that do not erase levels. */
  softLimitationCodes?: string[];
  direction: DecisionDirection | null;
  entry: EntryPlan | null;
  stopLoss: StopLossPlan | null;
  takeProfits: TakeProfitPlan[];
  riskReward: TradePlan["riskReward"];
  confirmationState: string | null;
  fourHourContext: FourHourContext | null;
  chartMatchesRole: boolean | null;
  testMode: boolean;
  currentPrice: number | null;
  distanceToEntryPoints: number | null;
  distanceToStopPoints: number | null;
  distanceToTp1Points: number | null;
  quoteAgeSeconds: number | null;
  signalAgeSeconds: number | null;
  lastQuoteAt: string | null;
  lastPlanAt: string | null;
  lastConfirmAt: string | null;
  planQuality: PlanQuality;
  quickTarget: QuickTargetDayTrade;
  sourceDecisionId: string | null;
  marketStructureMode: MarketStructureMode | null;
  session: string | null;
  higherTimeframeBias: TrendDirection | null;
  invalidation: string | null;
  /** Geometry safety — set by central validator before save / API return. */
  geometryValid?: boolean;
  geometryReasonCodes?: string[];
  geometryMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  validUntil: string | null;
  environment: "LIVE" | "TEST";
  isTestPlan: boolean;
  safety: {
    autoTrade: "OFF";
    demoOrderSubmission: false;
    liveTrading: false;
    analysisOnly: true;
    brokerOrders: "NONE";
  };
  disclaimer: string;
};

export const SESSION_PLAN_DISCLAIMER =
  "GoldMeta provides market analysis and decision support only. Manual trading. AutoTrade OFF. No broker orders.";

export const EMPTY_QUICK_TARGET = (): QuickTargetDayTrade => ({
  enabled: true,
  tp1: null,
  tp1Label: null,
  tp1Reason: null,
  roomPoints: null,
  roomOk: false,
  riskReward: null,
  rrOk: false,
  structuralLevelUsed: null
});

export const EMPTY_PLAN_QUALITY = (): PlanQuality => ({
  grade: "NO_PLAN",
  reasons: ["NO_VALID_15M_PLAN"]
});
