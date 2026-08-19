/**
 * GOLD_HUNTER FAST types — event-driven state machine + setups.
 */

export type GhFastHuntState =
  | "HUNTING"
  | "PRESSURE_DETECTED"
  | "ARMED"
  | "STRIKE_BUY"
  | "STRIKE_SELL"
  | "RUNNER"
  | "HARVEST"
  | "ABORT"
  | "REHUNT"
  | "DATA_STALE"
  | "BOOK_REBUILDING"
  | "SPREAD_BLOCKED";

export type GhFastSetupId =
  | "A_MOMENTUM_IGNITION"
  | "B_FAST_BREAKOUT"
  | "C_PULLBACK_REACCEL";

export type GhFastSide = "BUY" | "SELL";

export type GhFastExitReason =
  | "RAPID_ABORT"
  | "HARD_PROTECTION"
  | "PROFIT_LOCK"
  | "TRAIL_HIT"
  | "HARVEST_FADE"
  | "SMART_HARVEST_MOMENTUM_DEPTH_REVERSAL"
  | "SMART_SOFT_MAX_LOSS"
  | "SMART_EARLY_THESIS_FAILURE"
  | "SMART_SMALL_PROFIT_HARVEST"
  | "DATA_STALE"
  | "SPREAD_UNSAFE";

/** Monotonic profit-management states (SMART_POSITION_MANAGER_V1). */
export type SmartPmState =
  | "UNPROTECTED"
  | "PROTECTED"
  | "LOCKED"
  | "RUNNER"
  | "HARVEST";

export type SmartPmStopAdjustReason =
  | "NONE"
  | "SPM_BREAK_EVEN_AFTER_COSTS"
  | "SPM_PROTECT_0_4R"
  | "SPM_LOCK_0_9R"
  | "SPM_RUNNER_MIN_FLOOR"
  | "SPM_RUNNER_TRAIL"
  | "MONOTONIC_HOLD"
  | "LEGACY_PROFIT_LOCK";

export type GhFastSpotEvent = {
  kind: "SPOT";
  /** Monotonic local receive sequence (preferred duplicate identity). */
  receiveSeq: number;
  eventId: string;
  receivedAtMs: number;
  brokerTimestampMs: number | null;
  bid: number | null;
  ask: number | null;
  symbolId?: string | number;
};

export type GhFastDepthQuote = {
  id?: string | number;
  /** 1 = BID, 2 = ASK (cTrader convention) or string. */
  type: "BID" | "ASK" | 1 | 2;
  price: number;
  size: number;
};

export type GhFastDeletedQuoteRef =
  | { id: string | number }
  | GhFastDepthQuote
  | number
  | string;

export type GhFastDepthEvent = {
  kind: "DEPTH";
  receiveSeq: number;
  eventId: string;
  receivedAtMs: number;
  brokerTimestampMs: number | null;
  symbolId?: string | number;
  newQuotes?: GhFastDepthQuote[];
  deletedQuotes?: GhFastDeletedQuoteRef[];
};

export type GhFastMarketEvent = GhFastSpotEvent | GhFastDepthEvent;

export type GhFastLatencySample = {
  marketEventReceivedMs: number;
  featuresCalculatedMs: number;
  decisionProducedMs: number;
  shadowOrderProducedMs: number | null;
  /** Feature/decision compute latency only — not network or broker. */
  eventToDecisionMs: number;
};

/** Ops / market-data resync trigger classification (not strategy). */
export type GhFastResyncReason =
  | "stale_spot"
  | "stale_depth"
  | "stale_spot_and_depth"
  | "ages_null"
  | "invalid_crossed_book"
  | "invalid_no_bids"
  | "invalid_no_asks"
  | "invalid_book"
  | "transport_reconnect"
  | "timeout"
  | "other"
  | "test"
  | "market_data_resync";

/** Deterministic replay marker — occupies a receiveSeq slot. */
export type GhFastResyncMarkerEvent = {
  kind: "RESYNC";
  receiveSeq: number;
  eventId: string;
  receivedAtMs: number;
  reason: GhFastResyncReason;
  bookGenerationAfter: number;
  closedTradeIds: string[];
};

/**
 * Non-market audit row for a force-closed trade.
 * NEVER a GhFastMarketEvent — must not affect spot freshness, features, or replay ticks.
 */
export type GhFastResyncExitAuditEvent = {
  kind: "RESYNC_EXIT_AUDIT";
  receiveSeq: number;
  eventId: string;
  receivedAtMs: number;
  tradeId: string;
  reason: GhFastResyncReason;
};

export type GhFastStreamEvent =
  | GhFastMarketEvent
  | GhFastResyncMarkerEvent
  | GhFastResyncExitAuditEvent;

/** Per-specialist raw evaluation (before best-of selection). */
export type GhFastSpecialistRawEval = {
  setup: GhFastSetupId;
  eligible: boolean;
  /** True only for the selected best-of hit (at most one). */
  selected: boolean;
  /** Side when determinable from structural gates / hit. */
  candidateSide: GhFastSide | null;
  /**
   * Candidate quality when calculable.
   * null when structural gates failed so quality was never computed.
   * May be below minSetupQuality with eligible=false + quality_below_min.
   */
  rawQuality: number | null;
  failedConditions: string[];
  reasons: string[];
};

export type GhFastDecision = {
  state: GhFastHuntState;
  action: "WAIT" | "ENTER_BUY" | "ENTER_SELL" | "HOLD" | "EXIT" | "RESYNC";
  setup: GhFastSetupId | null;
  setupQuality: number;
  side: GhFastSide | null;
  exitReason: GhFastExitReason | null;
  latency: GhFastLatencySample;
  reasons: string[];
  /** Raw A/B/C specialist scores for telemetry (Phase 0B). */
  specialists?: GhFastSpecialistRawEval[];
  /** Selected setup after best-of (may differ from raw eligibles). */
  selectedSetup?: GhFastSetupId | null;
  selectedQuality?: number;
};

export type GhFastShadowOrder = {
  orderId: string;
  kind: "ENTER" | "EXIT";
  side: GhFastSide;
  price: number;
  timestampMs: number;
  setup: GhFastSetupId | null;
  exitReason: GhFastExitReason | null;
  shadowOnly: true;
  brokerExecutionEnabled: false;
  mutationSurface: "NONE";
};

export type GhFastOpenTrade = {
  tradeId: string;
  side: GhFastSide;
  setup: GhFastSetupId;
  entryTs: number;
  entryBid: number;
  entryAsk: number;
  entryPrice: number;
  bestExit: number;
  mfe: number;
  mae: number;
  profitLockActive: boolean;
  /** Executable exit floor/ceiling — never loosens once set. */
  lockFloor: number | null;
  trailDistance: number;
  harvestRunner: boolean;
  /** SMART_POSITION_MANAGER_V1 fields (additive; optional for legacy restores). */
  brainVersion?: string;
  positionManagerVersion?: string;
  smartPmState?: SmartPmState;
  highestProtectionStage?: SmartPmState;
  initialStopPrice?: number;
  initialRiskPrice?: number;
  initialRiskR?: number;
  currentPrice?: number;
  currentR?: number;
  currentUnrealisedPnlEur?: number | null;
  maxFavourablePrice?: number;
  maxFavourableR?: number;
  maxFavourablePnlEur?: number | null;
  maxAdversePrice?: number;
  maxAdverseR?: number;
  maxAdversePnlEur?: number | null;
  protectedProfitR?: number;
  /**
   * R locked by the current executable lockFloor/stop (0 if none placed yet).
   * May lag targetProtectedProfitR / protectedProfitR when broker min-distance
   * prevents placing the theoretical floor. Never exceeds protectedProfitR.
   * Monotonic once advanced.
   */
  executableProtectedProfitR?: number;
  protectedStopPrice?: number | null;
  lastStopAdjustReason?: SmartPmStopAdjustReason | null;
  lastHarvestAssessment?: {
    mfeR: number;
    currentR: number;
    retraceR: number;
    momentumAgainst: boolean;
    depthAgainst: boolean;
    velocityAgainst: boolean;
  } | null;
  /** SMART_LOSS_CONTROLLER_V1 fields (additive). */
  lossControllerVersion?: string;
  lastLossControllerAssessment?: {
    lossControllerVersion: string;
    mfeR: number;
    maeR: number;
    currentR: number;
    handedOffToSmartPm: boolean;
    softMaxLossHit: boolean;
    earlyFailureConfirms: number;
    earlyFailureFlags: {
      accelerationAgainst: boolean;
      imbalanceAgainst: boolean;
      depthAgainst: boolean;
      velocityAgainst: boolean;
    };
    smallProfitEligible: boolean;
    smallProfitStillProfitable: boolean;
    momentumDeteriorating: boolean;
    depthAgainst: boolean;
    surrenderingFavourable: boolean;
  } | null;
  spread?: number;
  timeInTradeMs?: number;
  opportunityId?: string | null;
  signalId?: string | null;
  /** EUR P/L per 1.0 price unit (from sizing); null → R-only diagnostics. */
  pnlScaleEurPerPrice?: number | null;
};

export type GhFastClosedTrade = GhFastOpenTrade & {
  exitTs: number;
  exitBid: number;
  exitAsk: number;
  exitPrice: number;
  grossMove: number;
  additionalFriction: number;
  netMove: number;
  durationMs: number;
  exitReason: GhFastExitReason;
  result: "WIN" | "LOSS" | "BREAKEVEN";
  /**
   * Qualification integrity tag. PRE_FIX_DIAGNOSTIC trades are preserved
   * for analysis but excluded from the formal >=250 sample.
   */
  sampleTag?: "PRE_FIX_DIAGNOSTIC" | "QUALIFICATION" | null;
  /** Present when force-closed by market-data resync (auditable EXIT). */
  resyncReason?: GhFastResyncReason;
  /** Receive / reset sequence at force-close. */
  resetSequence?: number;
  bookGeneration?: number;
};

export type GhFastConfig = {
  rearmFloorMs: number;
  maxSpread: number;
  sideFreshnessMs: number;
  depthFreshnessMs: number;
  friction: number;
  safetyBuffer: number;
  hardStop: number;
  profitLockActivateMfe: number;
  profitLockFraction: number;
  trailDistance: number;
  /** Top-N depth levels for imbalance. */
  depthTopN: number;
  /** Setup quality thresholds (interpretable, not ML confidence). */
  minSetupQuality: number;
  /**
   * B-only quality floor (Brain V2). Higher than global minSetupQuality so
   * mediocre breakouts cannot pass on a large unconditional base score.
   */
  minSetupQualityB: number;
  /** B-only minimum path efficiency over 1s (chop filter). */
  breakoutMinEfficiency1s: number;
  /** B-only minimum |signedImbalance1s| for directional confirmation. */
  breakoutImbalanceMin: number;
  /** B-only minimum supportive |depthImbalance| (sign must match side). */
  breakoutDepthImbalanceMin: number;
  /**
   * B-only secondary re-arm time floor (ms) after a B opportunity ends.
   * Structural reset is primary; this is a backstop only.
   */
  breakoutBRearmFloorMs: number;
  momentumVelMin: number;
  breakoutTouchCount: number;
  pullbackRetraceMax: number;
  /**
   * SMART_POSITION_MANAGER_V1 — when true, R-based protection supersedes
   * legacy early profit-lock / HARVEST_FADE. Hard stop + RAPID_ABORT retained.
   * Set false to roll back to Brain V2 legacy exits without code revert.
   */
  smartPositionManagerEnabled: boolean;
  /** Tick size for stop geometry (XAUUSD typically 0.01). */
  spmTickSize: number;
  /** Minimum broker stop distance from market (price units). */
  spmMinStopDistance: number;
  /** MFE R to enter PROTECTED (cost-aware break-even). */
  spmProtectMfeR: number;
  /** MFE R to protect ~spmProtect15FloorR. */
  spmProtect15MfeR: number;
  spmProtect15FloorR: number;
  /** MFE R to enter LOCKED. */
  spmLockMfeR: number;
  /** Locked floor R (safer mid of +0.8R..+1.0R). */
  spmLockFloorR: number;
  /** MFE R to enter RUNNER. */
  spmRunnerMfeR: number;
  /** Minimum runner protected profit R (mid of +1.5R..+1.75R). */
  spmRunnerMinFloorR: number;
  /** Runner trail distance from best exit, in R. */
  spmRunnerTrailR: number;
  /** Min MFE R before smart harvest may fire. */
  spmHarvestMinMfeR: number;
  /** Min retrace from MFE (R) required with momentum+depth confirmation. */
  spmHarvestMinRetraceR: number;
  /**
   * After a LOSS close: minimum ms before same/opposite re-entry (structure
   * reset is still required). Not a large idle cooldown.
   */
  antiChurnLossMinMs: number;
  /** Extra ms floor for immediate opposite-side flip after a LOSS. */
  antiChurnOppositeFlipMinMs: number;
  /**
   * SMART_LOSS_CONTROLLER_V1 — when true, owns soft-max / early-failure /
   * small-profit harvest below +1R MFE. Smart PM still owns >= +1R winners.
   * Set false to roll back without code revert.
   */
  smartLossControllerEnabled: boolean;
  /** Soft strategy max loss in R (hard stop remains cfg.hardStop = 1.0R). */
  slcSoftMaxLossR: number;
  /** MFE R at which LC hands off to Smart PM (default +1.0R). */
  slcHandoffMfeR: number;
  /** Early thesis failure only while MFE stays below this R. */
  slcEarlyFailureMaxMfeR: number;
  /** Minimum adverse excursion (R) before early-failure may fire. */
  slcEarlyFailureMinMaeR: number;
  /** Independent microstructure confirms required for early failure. */
  slcEarlyFailureMinConfirms: number;
  /** Min MFE R before small-profit harvest may consider. */
  slcSmallHarvestMinMfeR: number;
  /** Min surrender from MFE (R) with deteriorating flow to harvest. */
  slcSmallHarvestMinSurrenderR: number;
  /** Consecutive realised losses to activate LOSS_STREAK_GUARD. */
  slcLossStreakCount: number;
  /** Minimum ms reset while LOSS_STREAK_GUARD is active. */
  slcLossStreakResetMs: number;
  /** Absolute rolling realised R that activates the entry circuit breaker. */
  slcRollingCircuitBreakerR: number;
  /** Rolling window length for realised R circuit breaker. */
  slcRollingWindowTrades: number;
  /** Minimum ms recovery after rolling circuit breaker trips. */
  slcCircuitBreakerResetMs: number;
};
