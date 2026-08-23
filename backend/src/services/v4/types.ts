import type { V4StrategyFamily } from "./config";

export type V4Bias = "BUY_BIAS" | "SELL_BIAS" | "NEUTRAL";

export type V4Regime =
  | "STRONG_UPTREND"
  | "UPTREND"
  | "BALANCED_RANGE"
  | "DOWNTREND"
  | "STRONG_DOWNTREND"
  | "BREAKOUT_EXPANSION"
  | "EXTREME_VOLATILITY"
  | "LOW_LIQUIDITY"
  | "NEWS_BLACKOUT";

export type V4ProfileSource = "XAUUSD_TV" | "COMEX_GC" | "SYNTHETIC" | "UNKNOWN";

export type V4CandidateStatus =
  | "OBSERVATION"
  | "CANDIDATE"
  | "CONFIRMATION"
  | "VALIDATED_PLAN"
  | "WAITING_FOR_ENTRY"
  | "ENTERED"
  | "RESOLVED"
  | "EXPIRED"
  | "CANCELLED";

export type V4GateCode =
  | "UNCONFIRMED_BAR"
  | "INVALID_MARKET_DATA"
  | "INVALID_PROFILE"
  | "REGIME_NOT_PERMITTED"
  | "SESSION_NOT_PERMITTED"
  | "NO_STRATEGY_PATTERN"
  | "CONFIRMATION_INCOMPLETE"
  | "INVALID_ATR"
  | "NO_TRADE_INVALID_RISK_GEOMETRY"
  | "INSUFFICIENT_REWARD_AFTER_COSTS"
  | "ACTIVE_LOCKED_SETUP"
  | "NEWS_BLACKOUT"
  | "STALE_EVENT"
  | "DUPLICATE_EVENT"
  | "ML_ABSTAIN"
  | "ML_REJECT";

export type V4PlanRelation =
  | "SUPPORTS_ACTIVE_PLAN"
  | "NEUTRAL_TO_ACTIVE_PLAN"
  | "WEAKENS_ACTIVE_PLAN"
  | "CONFLICTS_WITH_ACTIVE_PLAN";

export interface V4Bar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
  confirmed: boolean;
  timeframe: "1" | "5" | "15" | "60";
}

export interface V4VolumeProfile {
  source: V4ProfileSource;
  session: string;
  poc: number | null;
  vah: number | null;
  val: number | null;
  /** Zone half-width around POC. */
  pocZoneWidth: number;
  valueAreaWidth: number | null;
  hvn: number[];
  lvn: number[];
  sessionHigh: number | null;
  sessionLow: number | null;
  priorDayHigh: number | null;
  priorDayLow: number | null;
  pocMigration: "UP" | "DOWN" | "FLAT" | "UNKNOWN";
  barCount: number;
  volumeObservations: number;
  asOf: string;
  valid: boolean;
  invalidReasons: string[];
}

export interface V4MarketAnalysis {
  strategyVersion: "4";
  generatedAt: string;
  barTime: string;
  symbol: string;
  timeframe: string;
  regime: V4Regime;
  bias: V4Bias;
  atr: number | null;
  atrPercentile: number | null;
  session: string;
  xauProfile: V4VolumeProfile | null;
  gcProfile: V4VolumeProfile | null;
  profileConflict: boolean;
  newsBlackout: boolean;
  notes: string[];
}

export interface V4StopResult {
  price: number | null;
  distance: number | null;
  reason: string | null;
  structuralCandidates: number[];
  rejected: boolean;
  rejectCode: V4GateCode | null;
  rejectReason: string | null;
}

export interface V4TargetSet {
  theoreticalR: { tp1: number; tp2: number; tp3: number };
  structureAware: { tp1: number | null; tp2: number | null; tp3: number | null };
  selected: { tp1: number; tp2: number; tp3: number };
  rejected: boolean;
  rejectReason: string | null;
}

export interface V4CostEstimate {
  estimateOnly: true;
  spreadPoints: number;
  slippagePoints: number;
  overnightPoints: number;
  totalCostPoints: number;
  totalCostR: number | null;
  netRrTp1: number | null;
  netRrTp2: number | null;
  notes: string[];
}

export interface V4QualityScore {
  total: number;
  max: 100;
  components: Record<string, number>;
  disclaimer: "This is a rules-based setup quality score, not the probability of profit.";
}

export interface V4LockedPlan {
  planId: string;
  strategyVersion: "4";
  strategyFamily: V4StrategyFamily;
  profileVersion: string;
  configVersion: string;
  direction: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  riskDistance: number;
  createdAt: string;
  barTime: string;
  expiryBarTime: string | null;
  session: string;
  regime: V4Regime;
  quality: V4QualityScore;
  costs: V4CostEstimate;
  netRrTp2: number | null;
  locked: true;
  environment: "LIVE" | "TEST" | "RESEARCH";
  shadow: boolean;
}

export interface V4SetupCandidate {
  candidateId: string;
  strategyVersion: "4";
  strategyFamily: V4StrategyFamily;
  status: V4CandidateStatus;
  direction: "BUY" | "SELL";
  observedAt: string;
  barTime: string;
  levelsHint: {
    entryZoneLow: number | null;
    entryZoneHigh: number | null;
    structureRef: number | null;
  };
  confirmationBars: number;
  cancelReason: string | null;
  gateFailures: V4GateCode[];
  lockedPlan: V4LockedPlan | null;
  parentDecisionId: string | null;
  environment: "LIVE" | "TEST" | "RESEARCH";
  shadow: boolean;
}

export interface V4EngineResult {
  strategyVersion: "4";
  engineVersion: string;
  configVersion: string;
  deploymentStage: string;
  actionable: false;
  analysis: V4MarketAnalysis;
  candidate: V4SetupCandidate | null;
  lockedPlan: V4LockedPlan | null;
  gateFailures: V4GateCode[];
  noTradeReasons: string[];
  relationToActivePlan: V4PlanRelation | null;
  generatedAt: string;
}

export interface V4BacktestTrade {
  planId: string;
  strategyFamily: V4StrategyFamily;
  direction: "BUY" | "SELL";
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  outcome: "TP1" | "TP2" | "TP3" | "SL" | "EXPIRED" | "MISSED_ENTRY" | "AMBIGUOUS";
  rawR: number;
  netR: number;
  session: string;
  regime: V4Regime;
  quality: number;
  costsPoints: number;
}

export interface V4BacktestReport {
  strategyVersion: "4";
  configVersion: string;
  sample: "in_sample" | "out_of_sample" | "walk_forward_fold";
  foldId?: string;
  resolvedTrades: number;
  rejectedCandidates: number;
  unsafePlanCount: number;
  planMutationCount: number;
  netExpectancyR: number | null;
  profitFactor: number | null;
  maxDrawdownR: number | null;
  maxLosingStreak: number;
  winRate: number | null;
  byStrategy: Record<string, number>;
  bySession: Record<string, number>;
  byRegime: Record<string, number>;
  byDirection: { BUY: number; SELL: number };
  trades: V4BacktestTrade[];
  notes: string[];
  meetsAcceptanceGates: boolean;
  acceptanceFailures: string[];
}
