/**
 * FAST_AUTOTRADE_V1 types — Demo AutoTrade decision engine only.
 * Does not alter Gold Hunter, manual trading, or the V3 dashboard pipeline.
 */

export const FAST_AUTOTRADE_STRATEGY_ID = "FAST_AUTOTRADE_V1" as const;
export type FastAutoTradeStrategyId = typeof FAST_AUTOTRADE_STRATEGY_ID;

export type FastRegime = "FAST" | "NORMAL" | "CHOP" | "DANGEROUS" | "QUIET";
export type FastBias = "BULLISH" | "BEARISH" | "NEUTRAL";
export type FastSetupType =
  | "PULLBACK_CONTINUATION"
  | "BREAKOUT"
  | "BREAKOUT_RETEST"
  | "MOMENTUM_CONTINUATION"
  | "REVERSAL";
export type FastGrade = "A+" | "A" | "B+" | "BELOW";
export type FastAction = "BUY" | "SELL" | "WAIT";

export type FastLifecycleState =
  | "SCANNING"
  | "SETUP_FOUND"
  | "TRIGGER_PENDING"
  | "ENTRY_PENDING"
  | "OPEN"
  | "MANAGING"
  | "EXIT_PENDING"
  | "CLOSED"
  | "RESET";

export type FastWaitReason =
  | "WAIT_NO_SETUP"
  | "WAIT_CHOP"
  | "WAIT_LOW_MOMENTUM"
  | "WAIT_SPREAD"
  | "WAIT_RISK_LIMIT"
  | "WAIT_NEWS"
  | "WAIT_EXTENDED"
  | "WAIT_NO_TRADE_SPACE"
  | "WAIT_TRIGGER_NOT_CONFIRMED"
  | "WAIT_DUPLICATE_SETUP"
  | "WAIT_REENTRY_DELAY"
  | "WAIT_SAME_CANDLE"
  | "WAIT_NEUTRAL_BIAS"
  | "WAIT_LOW_QUALITY"
  | "WAIT_DANGEROUS"
  | "WAIT_STALE_PRICE"
  | "WAIT_MARKET_CLOSED"
  | "WAIT_MALFORMED_DATA"
  | "WAIT_PENDING_TIMEOUT"
  | "WAIT_FLAP_GUARD"
  | "WAIT_M1_UNAVAILABLE"
  | "WAIT_M1_STALE"
  | "WAIT_EXTENSION_VOLATILITY_UNAVAILABLE"
  | "FAST_AUTOTRADE_V1_DEMO_ONLY";

export type FastM1Availability = "OK" | "UNAVAILABLE" | "STALE";

/**
 * Extension-model sample sizes. ATR14 needs 15 completed M1s (14 true ranges).
 * Fewer than FAST_EXTENSION_ATR_MIN_SAMPLES true ranges is not a valid local
 * volatility estimate — production must WAIT rather than use one M1 range.
 */
export const FAST_EXTENSION_ATR_PERIOD = 14;
export const FAST_EXTENSION_ATR_MIN_SAMPLES = 5;
export const FAST_EXTENSION_M1_HISTORY = 20;

export type FastExtensionAnchorType =
  | "VWAP"
  | "EMA21"
  | "BROKEN_RESISTANCE"
  | "BROKEN_VAH"
  | "BROKEN_SUPPORT"
  | "BROKEN_VAL"
  | "POC"
  | "LOCAL_STRUCTURE"
  | "NONE";

export type FastExtensionAtrSource =
  | "M1_ATR14"
  | "M1_ROLLING_TR"
  | "DECISION_ATR"
  | "NONE";

export type FastExtensionDiagnostic = {
  extensionAnchorType: FastExtensionAnchorType;
  extensionAnchorPrice: number | null;
  extensionDistance: number | null;
  extensionAtr: number | null;
  extensionAtrSource: FastExtensionAtrSource;
  extensionDistanceAtr: number | null;
  extensionLimitAtr: number;
};

export type FastOhlc = {
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

export type FastSetupIdentity = {
  direction: "BUY" | "SELL";
  setupType: FastSetupType;
  structureAnchor: string;
  triggerCandle: string;
  timestamp: string;
};

export type FastSafetyContext = {
  accountIsLive: boolean;
  accountEnvironment: "DEMO" | "LIVE" | null;
  spreadLimit: number;
  maxQuoteAgeSeconds: number;
  dailyLossBreached: boolean;
  maxOpenReached: boolean;
  newsBlocked: boolean;
  disconnected: boolean;
  duplicateActiveOrder: boolean;
  riskLimitBreached: boolean;
};

export type FastReentryContext = {
  lastSetup: FastSetupIdentity | null;
  lastExitAtMs: number | null;
  lastSignalKey: string | null;
  currentCandleKey: string | null;
  lastAction: FastAction | null;
  lastActionAtMs: number | null;
};

export type FastLifecycleContext = {
  state: FastLifecycleState;
  stateEnteredAtMs: number;
};

export type FastAutoTradeInput = {
  nowMs: number;
  price: number;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  quoteAgeSeconds: number | null;
  quoteStale: boolean;
  marketStatus: string | null;
  timeframe: string | null;
  ohlcv: FastOhlc | null;
  priorOhlcv: FastOhlc | null;
  trendDirection: FastBias | null;
  trendStrength: number | null;
  htfBias: FastBias | null;
  vwap: number | null;
  ema21: number | null;
  ema50: number | null;
  atr: number | null;
  poc: number | null;
  vah: number | null;
  val: number | null;
  nearbyResistance: number | null;
  nearbySupport: number | null;
  marketRegimeHint: string | null;
  setupScore: number | null;
  v3Decision: FastAction;
  bullishEvidence: string[];
  bearishEvidence: string[];
  reasonCodes: string[];
  confirmationClassification: string | null;
  confirmationDirection: FastBias | null;
  dataQuality: string | null;
  sessionPlanState: string | null;
  safety: FastSafetyContext;
  reentry: FastReentryContext;
  lifecycle: FastLifecycleContext;
  /**
   * Qualification / 1-minute scan always requires a fresh completed M1.
   * Direct engine unit tests omit this and supply ohlcv themselves.
   */
  requireCompletedM1?: boolean;
  m1Availability?: FastM1Availability;
  m1CompletedAtMs?: number | null;
  /**
   * Completed M1 bars oldest → newest (forming bar excluded).
   * Used only for the extension-model local ATR — not for geometry ATR.
   */
  m1History?: FastOhlc[] | null;
};

export type FastGeometry = {
  entry: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit2: number | null;
  riskReward: number;
};

export type FastAutoTradeDecision = {
  strategyId: FastAutoTradeStrategyId;
  action: FastAction;
  regime: FastRegime;
  bias: FastBias;
  setupType: FastSetupType | null;
  trigger: string | null;
  qualityScore: number;
  grade: FastGrade;
  waitReason: FastWaitReason | null;
  hardVeto: string | null;
  accepted: string[];
  rejected: string[];
  missing: string[];
  supporting: string[];
  identity: FastSetupIdentity | null;
  geometry: FastGeometry | null;
  lifecycleState: FastLifecycleState;
  signalId: string | null;
  telemetry: FastMissedOpportunity;
  /** True when a genuine forward barrier has enough room, or none exists. */
  tradeSpaceOk: boolean;
  /** Independent of trade-space — true when the move is already stretched. */
  extended: boolean;
  /** Backend-only extension classification diagnostics. */
  extension: FastExtensionDiagnostic;
};

export type FastMissedOpportunity = {
  direction: FastAction;
  setupType: FastSetupType | null;
  score: number;
  grade: FastGrade;
  regime: FastRegime;
  price: number;
  timestamp: string;
  rejectionReason: FastWaitReason | null;
  supportingEvidence: string[];
  missingEvidence: string[];
  hardVeto: string | null;
  tradeSpaceOk: boolean;
  extended: boolean;
  extensionAnchorType: FastExtensionAnchorType;
  extensionAnchorPrice: number | null;
  extensionDistance: number | null;
  extensionAtr: number | null;
  extensionAtrSource: FastExtensionAtrSource;
  extensionDistanceAtr: number | null;
  extensionLimitAtr: number;
};

export type FastManagementAction =
  | "HOLD"
  | "MOVE_SL_TO_BREAKEVEN"
  | "TRAIL_STOP"
  | "EXIT_MOMENTUM"
  | "EXIT_STALE"
  | "EXIT_STRUCTURE";

export type FastManagementInput = {
  side: "BUY" | "SELL";
  entry: number;
  currentPrice: number;
  currentSl: number | null;
  initialSl: number | null;
  tp1: number | null;
  openedAtMs: number;
  nowMs: number;
  atr: number | null;
  regime: FastRegime | null;
  momentumCollapsed: boolean;
  oppositeStructureBreak: boolean;
  alreadyBreakeven: boolean;
};

export type FastManagementResult = {
  action: FastManagementAction;
  newStopLoss: number | null;
  reason: string;
};
