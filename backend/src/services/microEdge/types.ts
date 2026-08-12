import type { MicroHorizon } from "./config";

export type MicroSession =
  | "ASIA"
  | "LONDON"
  | "NEW_YORK"
  | "LONDON_NY_OVERLAP"
  | "OTHER";

export type MicroRegime = "TREND" | "RANGE" | "BREAKOUT" | "DANGER";

export type MicroClass = "UP_TRADEABLE" | "DOWN_TRADEABLE" | "NO_EDGE";

export type MicroHorizonDecision =
  | "STRONG_UP_EDGE"
  | "UP_EDGE"
  | "STRONG_DOWN_EDGE"
  | "DOWN_EDGE"
  | "NO_EDGE"
  | "WAIT";

export type MicroOverallDecision = MicroHorizonDecision;

export type MicroDataFreshness = "LIVE" | "DELAYED" | "STALE" | "MARKET_CLOSED" | "UNAVAILABLE";

export type MicroQuote = {
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  brokerTimestamp: string;
  receivedAt: string;
  ageMs: number;
  freshness: MicroDataFreshness;
};

export type MicroBar = {
  timeframe: "M1" | "M5" | "M15";
  openTimeMs: number;
  closeTimeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** cTrader tick volume — not exchange traded volume. */
  tickVolume: number;
};

export type MicroDepthLevel = { price: number; size: number };

export type MicroDepthSnapshot = {
  at: string;
  bids: MicroDepthLevel[];
  asks: MicroDepthLevel[];
  available: boolean;
};

export type MicroHorizonForecast = {
  horizon: MicroHorizon;
  pUp: number;
  pDown: number;
  pNoEdge: number;
  expectedSignedMove: number;
  expectedAbsoluteMove: number;
  estimatedFriction: number;
  netEdgeUp: number;
  netEdgeDown: number;
  confidence: number;
  decision: MicroHorizonDecision;
  eligibleOpportunity: boolean;
  eligibilityReasons: string[];
};

export type MicroPrediction = {
  predictionId: string;
  symbol: string;
  candleCloseTs: string;
  candleCloseEpochMs: number;
  createdAt: string;
  quoteTs: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  quoteAgeMs: number;
  dataFreshness: MicroDataFreshness;
  featureRef: string;
  featureVersion: string;
  modelVersion: string;
  calibrationVersion: string;
  costModelVersion: string;
  labelVersion: string;
  regimeVersion: string;
  sessionVersion: string;
  session: MicroSession;
  regime: MicroRegime;
  regimeReasons: string[];
  shadowOnly: true;
  brokerExecutionEnabled: false;
  dataQuality: {
    ok: boolean;
    flags: string[];
  };
  strongestHorizon: MicroHorizon;
  overallMicroDecision: MicroOverallDecision;
  forecastAgreementState: string;
  topFactors: string[];
  horizons: Record<MicroHorizon, MicroHorizonForecast>;
  primaryResearchHorizon: MicroHorizon;
};

export type MicroFeatureSnapshot = {
  featureRef: string;
  predictionId: string;
  featureVersion: string;
  scalerVersion: string;
  cutoffTs: string;
  createdAt: string;
  raw: Record<string, number | string | boolean | null>;
  values: Record<string, number>;
  missingFlags: Record<string, boolean>;
  experimentalAvailable: Record<string, boolean>;
};

export type MicroOutcome = {
  predictionId: string;
  horizon: MicroHorizon;
  targetTs: string;
  scoredAt: string;
  scorable: boolean;
  unscorableReason: string | null;
  exitQuoteTs: string | null;
  exitBid: number | null;
  exitAsk: number | null;
  exitMid: number | null;
  actualSignedMove: number | null;
  actualAbsoluteMove: number | null;
  actualClass: MicroClass | null;
  grossLong: number | null;
  grossShort: number | null;
  netLong: number | null;
  netShort: number | null;
  estimatedCosts: number | null;
  slippageProxy: number | null;
  executionBuffer: number | null;
  predictedClass: MicroClass;
  directionCorrect: boolean | null;
  classCorrect: boolean | null;
  brierComponents: number | null;
  logLossComponent: number | null;
  modelVersion: string;
  costModelVersion: string;
  labelVersion: string;
  mfeLong: number | null;
  maeLong: number | null;
  mfeShort: number | null;
  maeShort: number | null;
  pathCoverage: number | null;
};

export type MicroPendingOutcome = {
  predictionId: string;
  horizon: MicroHorizon;
  dueAt: string;
  createdAt: string;
  status: "PENDING" | "SCORED" | "UNSCORABLE";
};

export type MicroPerformanceSlice = {
  key: string;
  predictions: number;
  scorable: number;
  unscorable: number;
  eligible: number;
  directionAccuracy: number | null;
  classAccuracy: number | null;
  brier: number | null;
  logLoss: number | null;
  netHypotheticalPl: number;
  estimatedCosts: number;
  winRate: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  maxDrawdown: number | null;
};
