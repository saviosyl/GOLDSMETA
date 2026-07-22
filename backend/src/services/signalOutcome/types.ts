/**
 * V6 Signal Outcome Tracking — types.
 * Hypothetical signal performance only. Never places broker orders.
 */

export type SignalDirection = "BUY" | "SELL" | "WAIT";

export type SignalLifecycle =
  | "WAIT_ONLY"
  | "PENDING_ENTRY"
  | "OPEN"
  | "TP1_HIT"
  | "TP2_HIT"
  | "TP3_HIT"
  | "STOP_HIT"
  | "BREAKEVEN"
  | "CLOSED"
  | "EXPIRED"
  | "CANCELLED"
  | "DATA_UNAVAILABLE"
  | "AMBIGUOUS_INTRABAR"
  | "ENTRY_SEQUENCE_AMBIGUOUS";

export type SignalFinalOutcome =
  | "WIN"
  | "LOSS"
  | "BREAKEVEN"
  | "EXPIRED"
  | "CANCELLED"
  | "DATA_UNAVAILABLE"
  | "AMBIGUOUS"
  | null;

export type ManagementEventType =
  | "ENTRY"
  | "TP1"
  | "TP2"
  | "TP3"
  | "STOP"
  | "BREAKEVEN_MOVE"
  | "TRAIL_STOP"
  | "PARTIAL_CLOSE"
  | "INVALIDATION"
  | "EXPIRE"
  | "AMBIGUOUS"
  | "DATA_STALE"
  | "MONITOR"
  | "BAR_SKIPPED"
  | "ENTRY_SEQUENCE_DEFERRED"
  | "ENTRY_SEQUENCE_AMBIGUOUS";

/** Immutable freeze at signal creation — never rewritten. */
export interface SignalSnapshot {
  signalId: string;
  decisionId: string;
  userId: string;
  symbol: "XAUUSD";
  market: "XAUUSD";
  timeframe: string | null;
  direction: SignalDirection;
  createdAt: string;
  marketDataTimestamp: string;
  entryType: string | null;
  proposedEntryPrice: number | null;
  entryZoneLow: number | null;
  entryZoneHigh: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  initialRiskDistance: number | null;
  riskReward: { tp1: number | null; tp2: number | null; tp3: number | null };
  confidence: number;
  setupScore: number;
  strategy: string | null;
  reasons: string[];
  blockingReasons: string[];
  dataQuality: string;
  signalSource: string;
  decisionVersion: string;
  environment: "LIVE" | "TEST";
  session: string | null;
}

export interface SignalManagementEvent {
  eventId: string;
  type: ManagementEventType;
  at: string;
  barTime: string | null;
  price: number | null;
  oldStop: number | null;
  newStop: number | null;
  targetReached: "TP1" | "TP2" | "TP3" | null;
  quantityPctClosed: number | null;
  reason: string;
  priceSource: string;
}

/** One notional exit leg — tracked independently for partial PnL. */
export interface SignalExitLeg {
  legId: string;
  reason: "TP1" | "TP2" | "TP3" | "STOP" | "BREAKEVEN" | "INVALIDATION" | "AMBIGUOUS";
  quantityPct: number;
  exitPrice: number;
  /** Already weighted: (quantityPct/100) × points at this exit. */
  grossPointsContribution: number;
  /** Already weighted spread+slippage allocated to this leg. */
  spreadSlippageContribution: number;
  /** Already weighted: (quantityPct/100) × R at this exit (before spread allocation). */
  realizedRContribution: number;
  at: string;
  barTime: string;
}

export interface SignalMonitoringState {
  lifecycle: SignalLifecycle;
  currentPrice: number | null;
  latestMarketDataTimestamp: string | null;
  highestFavourablePrice: number | null;
  lowestAdversePrice: number | null;
  mfe: number | null;
  mae: number | null;
  stopStatus: "ACTIVE" | "HIT" | "MOVED_BREAKEVEN" | "TRAILED" | "N/A";
  tp1Status: "PENDING" | "HIT" | "N/A";
  tp2Status: "PENDING" | "HIT" | "N/A";
  tp3Status: "PENDING" | "HIT" | "N/A";
  currentGrossPoints: number | null;
  currentNetPoints: number | null;
  currentRMultiple: number | null;
  timeInTradeMs: number | null;
  lastMonitoringAt: string | null;
  workingStop: number | null;
  quantityRemainingPct: number;
}

export interface SignalEntryState {
  entryReached: boolean;
  entryTimestamp: string | null;
  entryPrice: number | null;
  entrySpreadEstimate: number | null;
  entrySlippageEstimate: number | null;
  entryMarketDataSource: string | null;
  entryBlockedByStaleData: boolean;
  expiredWithoutEntry: boolean;
}

export interface SignalFinalResult {
  outcome: SignalFinalOutcome;
  exitReason: string | null;
  exitTimestamp: string | null;
  exitPrice: number | null;
  entryPrice: number | null;
  holdingDurationMs: number | null;
  grossPoints: number | null;
  estimatedSpread: number | null;
  estimatedSlippage: number | null;
  estimatedFees: number | null;
  netPoints: number | null;
  percentageResult: number | null;
  grossR: number | null;
  netR: number | null;
  mfe: number | null;
  mae: number | null;
  targetsReached: Array<"TP1" | "TP2" | "TP3">;
  dataQualityAtEntry: string | null;
  dataQualityAtExit: string | null;
  label: "HYPOTHETICAL SIGNAL PERFORMANCE";
  disclaimer: "Past hypothetical results do not guarantee future trading performance.";
}

export interface AmbiguityRecord {
  candleTimestamp: string;
  candleHigh: number;
  candleLow: number;
  stop: number;
  target: number;
  missingDataRequired: string;
}

export interface SignalOutcomeRecord {
  schemaVersion: "1.0";
  snapshot: SignalSnapshot;
  entry: SignalEntryState;
  monitoring: SignalMonitoringState;
  managementEvents: SignalManagementEvent[];
  /** Independent notional exit legs for correct partial PnL. */
  exitLegs: SignalExitLeg[];
  finalResult: SignalFinalResult | null;
  ambiguity: AmbiguityRecord | null;
  appliedBarEventIds: string[];
  /** Last chronologically applied confirmed bar time (ISO). */
  lastAppliedBarTime: string | null;
  leaseOwnerId: string | null;
  leaseUntil: string | null;
  updatedAt: string;
}

/** Ordered intrabar ticks — when present, resolve entry vs stop/target sequence. */
export interface SignalOrderedTick {
  /** Milliseconds from bar open (or absolute epoch ms). */
  t: number;
  price: number;
}

export interface SignalBarInput {
  eventId: string;
  barTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  isConfirmedBar: boolean;
  symbol: string;
  timeframe: string | null;
  environment: "LIVE" | "TEST";
  dataQuality?: string;
  stale?: boolean;
  source?: string;
  /** Optional ordered ticks/prices proving intrabar sequence. */
  orderedTicks?: SignalOrderedTick[];
}

export type OutcomeMonitorJobState =
  | "QUEUED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "DEAD_LETTER";

export type SignalBarApplyStatus =
  | "APPLIED"
  | "DUPLICATE"
  | "TERMINAL"
  | "IDENTITY_MISMATCH"
  | "LEASE_BUSY"
  | "OUT_OF_ORDER_WAIT"
  | "SAME_CANDLE_SKIP"
  | "NOT_FOUND";

export interface ApplyBarResult {
  record: SignalOutcomeRecord | null;
  status: SignalBarApplyStatus;
  signalId: string;
}

/** Durable bar-monitoring job — retries independently of the decision job. */
export interface OutcomeMonitorJob {
  jobId: string;
  userId: string;
  /** Per-signal child jobs always set this; chronological gate uses it. */
  signalId: string;
  eventId: string;
  bar: SignalBarInput;
  barTime: string;
  symbol: string;
  timeframe: string | null;
  state: OutcomeMonitorJobState;
  retryCount: number;
  maxRetries: number;
  nextAttemptAt: string;
  leaseOwnerId: string | null;
  leaseUntil: string | null;
  auditReason: string | null;
  errorMessage: string | null;
  lastApplyStatus: SignalBarApplyStatus | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** Daily aggregate for complete performance history beyond newest-N. */
export interface SignalPerformanceDailyAggregate {
  day: string;
  userId: string;
  environment: "LIVE" | "TEST" | "ALL";
  wins: number;
  losses: number;
  breakeven: number;
  expired: number;
  cancelled: number;
  ambiguousIntrabar: number;
  dataUnavailable: number;
  waitOnly: number;
  netPoints: number;
  netR: number;
  closedTradeCount: number;
  updatedAt: string;
}

export const TERMINAL_LIFECYCLES: SignalLifecycle[] = [
  "CLOSED",
  "EXPIRED",
  "CANCELLED",
  "DATA_UNAVAILABLE",
  "AMBIGUOUS_INTRABAR",
  "ENTRY_SEQUENCE_AMBIGUOUS",
  "WAIT_ONLY"
];

export const ACTIVE_MONITOR_LIFECYCLES: SignalLifecycle[] = [
  "PENDING_ENTRY",
  "OPEN",
  "TP1_HIT",
  "TP2_HIT",
  "BREAKEVEN"
];

export const TRADE_COUNTABLE_OUTCOMES: SignalFinalOutcome[] = [
  "WIN",
  "LOSS",
  "BREAKEVEN"
];

export const HYPOTHETICAL_LABEL = "HYPOTHETICAL SIGNAL PERFORMANCE" as const;
export const HYPOTHETICAL_DISCLAIMER =
  "Past hypothetical results do not guarantee future trading performance." as const;
