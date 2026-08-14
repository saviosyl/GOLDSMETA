import type { GhHorizonSec } from "./config";

export type GhSession =
  | "ASIA"
  | "LONDON"
  | "NEW_YORK"
  | "OVERLAP"
  | "OFF_HOURS";

export type GhRegime = "TREND" | "RANGE" | "BREAKOUT" | "DANGER";

export type GhClass = "UP_TRADEABLE" | "DOWN_TRADEABLE" | "NO_EDGE";

export type GhAction = "BUY" | "SELL" | "WAIT";

export type GhHuntState =
  | "HUNTING"
  | "TARGET_FOUND"
  | "ARMED"
  | "SHADOW_BUY"
  | "SHADOW_SELL"
  | "COOLDOWN"
  | "DATA_STALE"
  | "MARKET_CLOSED";

export type GhQuoteBook = {
  timestampMs: number;
  brokerTimestampMs: number;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  bidAgeMs: number;
  askAgeMs: number;
  quoteAgeMs: number;
  valid: boolean;
  invalidReason: string | null;
};

export type GhMicrostructureInterval = {
  spotEventCount: number;
  bidUpdateCount: number;
  askUpdateCount: number;
  bidPriceChangeCount: number;
  askPriceChangeCount: number;
  upTickCount: number;
  downTickCount: number;
};

export type GhTickAudit = {
  side: "BID" | "ASK";
  totalWireTicks: number;
  validTicks: number;
  invalidPriceTicks: number;
  outOfWindowTicks: number;
  malformedTimestampTicks: number;
};

export type GhDataQualityReport = {
  bid: GhTickAudit;
  ask: GhTickAudit;
  invalidPriceRate: number;
  outOfWindowRate: number;
  datasetStatus: "OK" | "DATA_QUALITY_FAILED";
  invalidPriceRateThreshold: number;
};

export type GhFeatureVector = {
  timestampMs: number;
  mid: number;
  spread: number;
  spreadOverMedian: number;
  ret1: number;
  ret2: number;
  ret3: number;
  ret5: number;
  ret10: number;
  ret15: number;
  ret30: number;
  ret60: number;
  mom3: number;
  mom5: number;
  mom10: number;
  mom15: number;
  mom30: number;
  velocity: number;
  acceleration: number;
  range5: number;
  range15: number;
  range30: number;
  range60: number;
  dist15High: number;
  dist15Low: number;
  dist60High: number;
  dist60Low: number;
  spotEventCount: number;
  bidUpdateCount: number;
  askUpdateCount: number;
  tickImbalance: number;
  spreadChange: number;
  spreadPercentile: number;
  m1Open: number;
  m1High: number;
  m1Low: number;
  m1Close: number;
  m1Range: number;
  m1Body: number;
  m1UpperWick: number;
  m1LowerWick: number;
  m1TickVolume: number;
  m1DistClose: number;
  m5Return: number;
  m5Range: number;
  m5TickVolume: number;
  m15Return: number;
  m15Range: number;
  m15TickVolume: number;
  shortVol: number;
  m1VolProxy: number;
  session: GhSession;
  regime: GhRegime;
  danger: boolean;
};

export const GH_FEATURE_KEYS = [
  "mid",
  "spread",
  "spreadOverMedian",
  "ret1",
  "ret2",
  "ret3",
  "ret5",
  "ret10",
  "ret15",
  "ret30",
  "ret60",
  "mom3",
  "mom5",
  "mom10",
  "mom15",
  "mom30",
  "velocity",
  "acceleration",
  "range5",
  "range15",
  "range30",
  "range60",
  "dist15High",
  "dist15Low",
  "dist60High",
  "dist60Low",
  "spotEventCount",
  "bidUpdateCount",
  "askUpdateCount",
  "tickImbalance",
  "spreadChange",
  "spreadPercentile",
  "m1Range",
  "m1Body",
  "m1UpperWick",
  "m1LowerWick",
  "m1TickVolume",
  "m1DistClose",
  "m5Return",
  "m5Range",
  "m5TickVolume",
  "m15Return",
  "m15Range",
  "m15TickVolume",
  "shortVol",
  "m1VolProxy",
  "sessionAsia",
  "sessionLondon",
  "sessionNY",
  "sessionOverlap",
  "regimeTrend",
  "regimeRange",
  "regimeBreakout",
  "regimeDanger"
] as const;

export type GhFeatureKey = (typeof GH_FEATURE_KEYS)[number];

export type GhLabel = {
  horizonSec: GhHorizonSec;
  classLabel: GhClass | "UNSCORABLE_DATA_GAP";
  midMove: number | null;
  grossLong: number | null;
  grossShort: number | null;
  netLong: number | null;
  netShort: number | null;
  targetTimestampMs: number | null;
};

export type GhHorizonProb = {
  horizonSec: GhHorizonSec;
  pUp: number;
  pDown: number;
  pNoEdge: number;
  expectedNetBuy: number;
  expectedNetSell: number;
};

export type GhForecast = {
  timestampMs: number;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  quoteAgeMs: number;
  session: GhSession;
  regime: GhRegime;
  dataQuality: "OK" | "DATA_STALE" | "INVALID";
  modelVersion: string;
  strategyVersion: string;
  horizons: Record<GhHorizonSec, GhHorizonProb>;
  action: GhAction;
  huntState: GhHuntState;
  shadowOnly: true;
  brokerExecutionEnabled: false;
  mutationSurface: "NONE";
};

export type GhShadowSide = "BUY" | "SELL";

export type GhExitReason =
  | "EDGE_GONE"
  | "EDGE_FLIPPED"
  | "TAKE_PROFIT_SIGNAL"
  | "PROTECTIVE_STOP"
  | "MAX_HOLD"
  | "DATA_STALE"
  | "MARKET_CLOSED";

export type GhShadowTrade = {
  tradeId: string;
  date: string;
  strategyVersion: string;
  modelVersion: string;
  entryTimestampMs: number;
  exitTimestampMs: number;
  durationSeconds: number;
  side: GhShadowSide;
  entryBid: number;
  entryAsk: number;
  entryPrice: number;
  exitBid: number;
  exitAsk: number;
  exitPrice: number;
  entrySpread: number;
  grossMove: number;
  additionalFriction: number;
  netMove: number;
  mfe: number;
  mae: number;
  entryProbs: Record<GhHorizonSec, GhHorizonProb>;
  exitProbs: Record<GhHorizonSec, GhHorizonProb> | null;
  entryReason: string;
  exitReason: GhExitReason;
  session: GhSession;
  regime: GhRegime;
  result: "WIN" | "LOSS" | "BREAKEVEN";
};

export type GhDailySummary = {
  date: string;
  strategyVersion: string;
  modelVersion: string;
  startingEquity: number;
  endingEquity: number;
  grossProfit: number;
  grossLoss: number;
  estimatedFriction: number;
  netPnl: number;
  returnPct: number;
  tradeCount: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;
  expectancy: number;
  bestTrade: number;
  worstTrade: number;
  maxDrawdown: number;
  maxLosingStreak: number;
  averageDuration: number;
  buyPnl: number;
  sellPnl: number;
  sessionBreakdown: Record<string, number>;
  regimeBreakdown: Record<string, number>;
};

export type GhModelArtifact = {
  modelVersion: string;
  featureSchemaVersion: string;
  strategyVersion: string;
  trainingRange: { fromMs: number; toMs: number };
  validationRange: { fromMs: number; toMs: number };
  holdoutRange: { fromMs: number; toMs: number };
  labelConfig: {
    theta: number;
    entrySlippage: number;
    exitSlippage: number;
    executionBuffer: number;
    targetToleranceMs: number;
  };
  entryPolicy: {
    pUp5: number;
    pUp15: number;
    pUp30: number;
    consecutiveEvals: number;
    maxHoldSec: number;
    protectiveStop: number;
  };
  normalization: { mean: number[]; std: number[] };
  weightsByHorizon: Record<
    GhHorizonSec,
    { up: number[]; down: number[]; noEdge: number[]; bias: number[] }
  >;
  calibration: Record<
    GhHorizonSec,
    { bins: { lo: number; hi: number; avgNetBuy: number; avgNetSell: number; n: number }[] }
  >;
  datasetHash: string;
  createdAt: string;
  qualificationStatus:
    | "NOT_TRAINED"
    | "TRAINED_RESEARCH"
    | "HOLDOUT_POSITIVE"
    | "HOLDOUT_NEGATIVE"
    | "INSUFFICIENT_DATA";
};

export type GhHorizonMetrics = {
  horizonSec: GhHorizonSec;
  sampleCount: number;
  classBalance: Record<string, number>;
  directionAccuracy: number;
  precisionUp: number;
  recallUp: number;
  precisionDown: number;
  recallDown: number;
  brierScore: number;
  tradeableCoverage: number;
  avgNetLong: number;
  avgNetShort: number;
};

export type GhPolicyBacktest = {
  tradeCount: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  grossPnl: number;
  friction: number;
  netPnl: number;
  profitFactor: number;
  expectancy: number;
  maxDrawdown: number;
  averageDuration: number;
  buyPnl: number;
  sellPnl: number;
  sessionPnl: Record<string, number>;
  regimePnl: Record<string, number>;
};
