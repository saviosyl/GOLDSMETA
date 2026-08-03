/**
 * Issue #50 — structured intraday plan types.
 * Generated on the server; UI must not invent levels or reasons.
 */

export type IntradayAction =
  | "BUY_NOW"
  | "BUY_ON_PULLBACK"
  | "BUY_ABOVE"
  | "SELL_NOW"
  | "SELL_ON_REJECTION"
  | "SELL_BELOW"
  | "RANGE_TRADE"
  | "PREPARE"
  | "NO_TRADE";

export type LevelSide = "UPSIDE" | "DOWNSIDE";
export type LevelKind =
  | "SUPPORT"
  | "RESISTANCE"
  | "TARGET"
  | "BREAKDOWN"
  | "BREAKOUT"
  | "STRETCH";
export type LevelStrength = "MINOR" | "MODERATE" | "STRONG" | "MAJOR";

export type LevelReasonCode =
  | "POC"
  | "VAH"
  | "VAL"
  | "DEVELOPING_POC"
  | "DEVELOPING_VAH"
  | "DEVELOPING_VAL"
  | "PREV_DAY_HIGH"
  | "PREV_DAY_LOW"
  | "SESSION_HIGH"
  | "SESSION_LOW"
  | "DAY_HIGH"
  | "DAY_LOW"
  | "SWING_HIGH"
  | "SWING_LOW"
  | "REPEATED_REJECTION"
  | "TRENDLINE_INTERSECTION"
  | "CHANNEL_INTERSECTION"
  | "VWAP"
  | "EMA_21"
  | "EMA_50"
  | "EMA_200"
  | "OPENING_RANGE_HIGH"
  | "OPENING_RANGE_LOW"
  | "ATR_PROJECTION"
  | "VOLUME_NODE"
  | "BREAKOUT_RETEST"
  | "ROUND_NUMBER"
  | "CONFLUENCE"
  | "PLAN_ENTRY"
  | "PLAN_STOP"
  | "PLAN_TARGET";

export type ImportantLevelReason = {
  code: LevelReasonCode;
  label: string;
  explanation: string;
  sourceTimeframe?: string | null;
};

export type ImportantLevel = {
  id: string;
  side: LevelSide;
  kind: LevelKind;
  price: number | null;
  zoneLow: number | null;
  zoneHigh: number | null;
  strength: LevelStrength;
  distancePoints: number | null;
  distancePercent: number | null;
  shortMeaning: string;
  reasons: ImportantLevelReason[];
  whatToWatch: string[];
  ifHolds: string;
  ifBreaks: string;
  confirmationRequired: string[];
  nextLevelId: string | null;
  riskWarning: string;
  simpleExplanation: string;
  confidence: number;
};

export type ScenarioPlan = {
  label: string;
  trigger: string;
  firstTarget: string;
  secondTarget: string;
  invalidation: string;
};

export type SetupChecklistItem = {
  id: string;
  label: string;
  complete: boolean;
  detail: string;
};

export type ManualTradePlanCard = {
  actionable: boolean;
  direction: "BUY" | "SELL" | "NONE";
  entryZone: string | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  riskReward: string | null;
  maxCashRiskNote: string;
  positionSizeNote: string;
  invalidation: string;
  management: string;
};

export type ExpectedRange = {
  probableLow: number | null;
  probableHigh: number | null;
  stretchLow: number | null;
  stretchHigh: number | null;
  currentPrice: number | null;
  remainingAbovePoints: number | null;
  remainingBelowPoints: number | null;
  remainingAbovePercent: number | null;
  remainingBelowPercent: number | null;
  confidence: number;
  reasons: string[];
  invalidation: string;
  estimateDisclaimer: string;
};

export type ZoneGuide = {
  bestBuyZone: string | null;
  bestSellZone: string | null;
  noTradeZone: string | null;
  nearestSupport: number | null;
  nearestResistance: number | null;
};

export type IntradayPlan = {
  schemaVersion: "1.0";
  action: IntradayAction;
  actionLabel: string;
  oneSentence: string;
  trigger: string | null;
  triggerPrice: number | null;
  distanceToTriggerPoints: number | null;
  entryConfirmation: string[];
  invalidation: string;
  nextTarget: string | null;
  whyNotReady: string | null;
  setupProgress: {
    complete: number;
    total: number;
    label: string;
    items: SetupChecklistItem[];
  };
  directionBias: "BULLISH" | "SLIGHTLY_BULLISH" | "NEUTRAL" | "SLIGHTLY_BEARISH" | "BEARISH";
  marketType: "TREND" | "RANGE" | "BREAKOUT" | "PULLBACK" | "HIGH_VOLATILITY" | "UNKNOWN";
  session: string | null;
  confidence: number;
  expectedRange: ExpectedRange;
  bullishScenario: ScenarioPlan;
  bearishScenario: ScenarioPlan;
  zones: ZoneGuide;
  importantLevels: ImportantLevel[];
  tradePlan: ManualTradePlanCard;
  freshness: {
    quoteAgeSeconds: number | null;
    signalAgeSeconds: number | null;
    marketStructureMode: string;
    sourceLabel: string;
    dataQuality: string | null;
  };
  safety: {
    autoTrade: "OFF";
    demoOrderSubmission: false;
    liveTrading: false;
    analysisOnly: true;
  };
  disclaimer: string;
};
