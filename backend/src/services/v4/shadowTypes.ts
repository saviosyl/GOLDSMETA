import type { V4StrategyFamily } from "./config";
import type {
  V4Bias,
  V4CostEstimate,
  V4GateCode,
  V4QualityScore,
  V4Regime,
  V4VolumeProfile
} from "./types";

export type V4ShadowMode = "SHADOW";

export type V4ShadowPlanStatus =
  | "WAITING_FOR_ENTRY"
  | "ENTERED"
  | "TP1_HIT"
  | "TP2_HIT"
  | "TP3_HIT"
  | "LOSS_SL"
  | "EXPIRED"
  | "CANCELLED"
  | "AMBIGUOUS_WORST_CASE_SL";

export type V4ShadowPlanRelation =
  | "SUPPORTS_SHADOW_PLAN"
  | "NEUTRAL_TO_SHADOW_PLAN"
  | "WEAKENS_SHADOW_PLAN"
  | "CONFLICTS_WITH_SHADOW_PLAN";

export interface V4ShadowAnalysisRecord {
  analysisId: string;
  strategyVersion: "4";
  mode: V4ShadowMode;
  environment: "LIVE" | "TEST";
  eventId: string;
  parentDecisionId: string | null;
  barTime: string;
  timeframe: string;
  ohlc: {
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
  };
  session: string;
  regime: V4Regime;
  bias: V4Bias;
  atr: number | null;
  atrPercentile: number | null;
  xauPoc: number | null;
  vah: number | null;
  val: number | null;
  profileSource: string;
  profileAsOf: string | null;
  gcConfirmation: "AVAILABLE" | "UNAVAILABLE";
  htfContext: string;
  gateFailures: V4GateCode[];
  rejectionReasons: string[];
  configVersion: string;
  profileVersion: string;
  engineVersion: string;
  generatedAt: string;
  actionable: false;
}

export interface V4ShadowCandidateRecord {
  candidateId: string;
  strategyVersion: "4";
  mode: V4ShadowMode;
  environment: "LIVE" | "TEST";
  strategyFamily: V4StrategyFamily;
  direction: "BUY" | "SELL";
  status: "CANDIDATE" | "CONFIRMATION" | "EXPIRED" | "CANCELLED" | "PROMOTED";
  createdAt: string;
  barTime: string;
  confirmationBarsRequired: number;
  confirmationBarsSeen: number;
  expiresAfterBars: number;
  barsOpen: number;
  cancelReason: string | null;
  structureRef: number | null;
  entryHint: number | null;
  parentAnalysisId: string;
  parentDecisionId: string | null;
  actionable: false;
  updatedAt: string;
}

export interface V4LockedShadowPlan {
  planId: string;
  strategyVersion: "4";
  mode: V4ShadowMode;
  environment: "LIVE" | "TEST";
  strategyFamily: V4StrategyFamily;
  direction: "BUY" | "SELL";
  /** Immutable locked fields */
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  riskDistance: number;
  quality: V4QualityScore;
  costs: V4CostEstimate;
  createdAt: string;
  barTime: string;
  expiryBarTime: string | null;
  session: string;
  regime: V4Regime;
  profileVersion: string;
  configVersion: string;
  engineVersion: string;
  locked: true;
  status: V4ShadowPlanStatus;
  candidateId: string;
  parentDecisionId: string | null;
  actionable: false;
  /** Lifecycle metrics (mutable tracking only — plan levels never change) */
  entryTriggeredAt: string | null;
  resolvedAt: string | null;
  barsToEntry: number | null;
  barsInTrade: number | null;
  grossR: number | null;
  netR: number | null;
  mfe: number | null;
  mae: number | null;
  appliedBarEventIds: string[];
  lastBarTime: string | null;
  mutationAttempts: number;
  updatedAt: string;
}

export interface V4PlanMutationAudit {
  id: string;
  planId: string;
  at: string;
  attemptedFields: string[];
  message: string;
}

export interface V4ShadowAnalytics {
  strategyVersion: "4";
  mode: V4ShadowMode;
  environment: "LIVE" | "TEST";
  sampleSize: number;
  sampleSizeBand: "extremely_small" | "small" | "preliminary" | "meaningful";
  sampleSizeWarning: string;
  totalAnalyses: number;
  buyBias: number;
  sellBias: number;
  neutralWait: number;
  candidates: number;
  rejectedCandidates: number;
  rejectionReasons: Record<string, number>;
  validatedShadowPlans: number;
  entriesTriggered: number;
  expiredBeforeEntry: number;
  tp1: number;
  tp2: number;
  tp3: number;
  stopLosses: number;
  ambiguous: number;
  grossExpectancyR: number | null;
  netExpectancyR: number | null;
  profitFactor: number | null;
  maxDrawdownR: number | null;
  maxLosingStreak: number;
  averageMfe: number | null;
  averageMae: number | null;
  byStrategy: Record<string, number>;
  byDirection: { BUY: number; SELL: number };
  bySession: Record<string, number>;
  byRegime: Record<string, number>;
  unsafePlanCount: number;
  planMutationCount: number;
  gcUnavailableCount: number;
}

export interface GcProfileSnapshot {
  provider: string;
  contract: string | null;
  contractExpiry: string | null;
  rolloverState: "UNKNOWN" | "FRONT" | "ROLLING" | "BACK";
  timestamp: string | null;
  delayStatus: "REALTIME" | "DELAYED" | "UNAVAILABLE";
  session: string | null;
  poc: number | null;
  vah: number | null;
  val: number | null;
  volume: number | null;
  profileQuality: "GOOD" | "PARTIAL" | "UNAVAILABLE";
  asVolumeProfile: V4VolumeProfile | null;
  note: string;
}
