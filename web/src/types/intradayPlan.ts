/** Mirrors backend Issue #50 intraday plan — UI must not invent levels or reasons. */

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

export type LevelSide = "UPSIDE" | "DOWNSIDE" | "AT_PRICE";
export type LevelKind =
  | "SUPPORT"
  | "RESISTANCE"
  | "TARGET"
  | "BREAKDOWN"
  | "BREAKOUT"
  | "STRETCH"
  | "RECLAIM"
  | "MAGNET"
  | "INVALIDATION";
export type LevelRoleAtPrice =
  | "SUPPORT"
  | "RESISTANCE"
  | "RECLAIM_LEVEL"
  | "BREAKDOWN_LEVEL"
  | "BREAKOUT_LEVEL"
  | "MAGNET"
  | "TARGET"
  | "INVALIDATION"
  | "STRETCH_ESTIMATE"
  | "PREVIOUS_SUPPORT_NOW_RESISTANCE"
  | "PREVIOUS_RESISTANCE_NOW_SUPPORT";
export type LevelProximity = "ABOVE" | "NEAR" | "BELOW";
export type LevelStrength = "MINOR" | "MODERATE" | "STRONG" | "MAJOR";
export type ValueLocation = "BELOW_VALUE" | "INSIDE_VALUE" | "ABOVE_VALUE" | "UNKNOWN";

export type ImportantLevelReason = {
  code: string;
  label: string;
  explanation: string;
  sourceTimeframe?: string | null;
};

export type ImportantLevel = {
  id: string;
  side: LevelSide;
  kind: LevelKind;
  roleAtCurrentPrice: LevelRoleAtPrice;
  proximity: LevelProximity;
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
  triggerPrice?: number | null;
  firstTarget: string;
  firstTargetPrice?: number | null;
  secondTarget: string;
  secondTargetPrice?: number | null;
  invalidation: string;
  invalidationPrice?: number | null;
};

export type SetupChecklistItem = {
  id: string;
  label: string;
  complete: boolean;
  detail: string;
};

export type ConditionalPlanRef = {
  label: string;
  direction: "BUY" | "SELL";
  trigger: string;
  entryZone: string | null;
  stopLoss: number | null;
  tp1: number | null;
  invalidation: string;
  confirmationRequired: string[];
};

export type ManualTradePlanCard = {
  cardKind: "ACTIVE_PLAN" | "CONDITIONAL_REFERENCE" | "NONE";
  title: string;
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
  orderingValid: boolean;
  orderingNote: string | null;
  bullishConditional: ConditionalPlanRef | null;
  bearishConditional: ConditionalPlanRef | null;
};

export type ExpectedRange = {
  rangeAvailable: boolean;
  unavailableReason: string | null;
  valueLocation: ValueLocation;
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
  valueLocation: ValueLocation;
  bestBuyZone: string | null;
  bestBuyImmediate: boolean;
  bestBuyConfirmation: string | null;
  bestBuyInvalidation: string | null;
  bestSellZone: string | null;
  bestSellImmediate: boolean;
  bestSellConfirmation: string | null;
  bestSellInvalidation: string | null;
  noTradeZone: string | null;
  nearestSupport: number | null;
  nearestResistance: number | null;
};

export type IntradayPlan = {
  schemaVersion: "1.0" | "1.1";
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
  valueLocation?: ValueLocation;
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
