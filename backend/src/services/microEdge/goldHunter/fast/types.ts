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
  | "DATA_STALE"
  | "SPREAD_UNSAFE";

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
  reason: GhFastResyncReason | string;
  bookGenerationAfter: number;
  closedTradeIds: string[];
};

export type GhFastStreamEvent = GhFastMarketEvent | GhFastResyncMarkerEvent;

/** Per-specialist raw evaluation (before best-of selection). */
export type GhFastSpecialistRawEval = {
  setup: GhFastSetupId;
  eligible: boolean;
  quality: number;
  side: GhFastSide | null;
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
  resyncReason?: GhFastResyncReason | string;
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
  momentumVelMin: number;
  breakoutTouchCount: number;
  pullbackRetraceMax: number;
};
