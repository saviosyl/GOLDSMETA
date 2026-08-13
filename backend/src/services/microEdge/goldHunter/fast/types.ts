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

export type GhFastDepthEvent = {
  kind: "DEPTH";
  receivedAtMs: number;
  brokerTimestampMs: number | null;
  symbolId?: string | number;
  newQuotes?: GhFastDepthQuote[];
  deletedQuotes?: Array<GhFastDepthQuote | { id: string | number }>;
};

export type GhFastMarketEvent = GhFastSpotEvent | GhFastDepthEvent;

export type GhFastLatencySample = {
  marketEventReceivedMs: number;
  featuresCalculatedMs: number;
  decisionProducedMs: number;
  shadowOrderProducedMs: number | null;
  eventToDecisionMs: number;
};

export type GhFastDecision = {
  state: GhFastHuntState;
  action: "WAIT" | "ENTER_BUY" | "ENTER_SELL" | "HOLD" | "EXIT";
  setup: GhFastSetupId | null;
  setupQuality: number;
  side: GhFastSide | null;
  exitReason: GhFastExitReason | null;
  latency: GhFastLatencySample;
  reasons: string[];
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
