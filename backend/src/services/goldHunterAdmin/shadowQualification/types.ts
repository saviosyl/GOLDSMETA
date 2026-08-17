/**
 * Gold Hunter Clean Shadow Qualification V1 — types (integrity revision).
 * Research only. No broker mutation.
 */
import type { GhFastExitReason, GhFastSetupId } from "../abc/types";
import type { GoldHunterSetupLetter } from "../strategySelector";
import type { GhFastFeatureSnapshot } from "../abc/features";

export const GH_SHADOW_QUALIFICATION_VERSION = "GH_SHADOW_QUAL_V1" as const;
export const GH_SHADOW_QUALIFICATION_EPOCH_PREFIX = "GH-SQ" as const;

export type GhShadowDataQuality =
  | "FORMAL_ELIGIBLE"
  | "DIAGNOSTIC_EXCLUDED";

export type GhShadowTradeStatus =
  | "OPEN"
  | "CLOSED"
  | "DIAGNOSTIC_EXCLUDED";

export type GhShadowExitReason =
  | GhFastExitReason
  | "MANUAL_END"
  | "SUPERSEDED"
  | "INVALID_ENTRY"
  | "INVALID_MARKET";

/**
 * Economic exposure mirroring production Demo sizing (not the retired 0.18×100 model).
 * Spread is embedded via Ask/Bid executable prices; frictionPrice is ADDITIONAL
 * frozen commission/slippage in price units — never a second spread subtraction.
 */
export type GhShadowEconomicExposure = {
  riskBudgetEur: number;
  stopDistance: number;
  hardStopPrice: number;
  /** Displayed lots from sizeGoldHunterDemoLots (production helper). */
  displayedLots: number;
  ozPerLot: number;
  /** displayedLots × ozPerLot */
  economicXauOz: number;
  rawProtocolVolumeEquivalent: number;
  quoteCurrency: string;
  depositCurrency: string;
  quoteToDepositRate: number | null;
  quoteToDepositRateSource: string | null;
  valuePerPointPerLot: number;
  minLots: number;
  maxLots: number;
  lotStep: number;
  sizingProvenance: string;
  mappingKey: string;
  /** Frozen strategy friction in price units (extra vs spread). */
  frictionPrice: number;
  frictionSemantics:
    "ADDITIONAL_COMMISSION_SLIPPAGE_PRICE_UNITS_NOT_SPREAD";
  formula: string;
  eurPnlAvailable: boolean;
};

export type GhShadowCashPnl = {
  signedPriceMove: number;
  frictionPrice: number;
  netPriceMove: number;
  grossQuote: number;
  frictionQuote: number;
  netQuote: number;
  quoteCurrency: string;
  /** null when quote→deposit conversion unavailable — never invent EUR. */
  simulatedGrossPnlEur: number | null;
  simulatedFrictionEur: number | null;
  simulatedNetPnlEur: number | null;
  eurPnlAvailable: boolean;
  quoteToDepositRate: number | null;
};

export type GhShadowTrade = {
  tradeId: string;
  qualificationId: string;
  opportunityId: string;
  signalId: string;
  setup: GoldHunterSetupLetter;
  setupId: GhFastSetupId;
  side: "BUY" | "SELL";
  status: GhShadowTradeStatus;
  dataQuality: GhShadowDataQuality;
  exclusionReason: string | null;

  signalTs: string;
  entryTs: string | null;
  entryBid: number | null;
  entryAsk: number | null;
  entryPrice: number | null;
  entrySpread: number | null;
  initialStop: number | null;

  exitTs: string | null;
  exitBid: number | null;
  exitAsk: number | null;
  exitPrice: number | null;
  exitReason: GhShadowExitReason | null;

  mfe: number;
  mae: number;
  durationMs: number | null;

  grossPriceMove: number | null;
  frictionPrice: number | null;
  netPriceMove: number | null;
  /** Quote-currency cash (always when closed cleanly). */
  simulatedGrossPnlQuote: number | null;
  simulatedFrictionPnlQuote: number | null;
  simulatedNetPnlQuote: number | null;
  quoteCurrency: string | null;
  /** EUR only when authoritative FX known. */
  simulatedGrossPnlEur: number | null;
  simulatedFrictionEur: number | null;
  simulatedNetPnlEur: number | null;
  eurPnlAvailable: boolean;

  economic: GhShadowEconomicExposure | null;

  profitLockActivatedAt: string | null;
  trailActivatedAt: string | null;
  trailUpdateCount: number;
  lockFloorAtActivation: number | null;
  lockFloorLatest: number | null;
  maxFavorableBeforeExit: number | null;
  maxAdverseBeforeExit: number | null;

  strategySha: string;
  configSha: string;
  receiveSeqAtEntry: number | null;
  receiveSeqAtExit: number | null;
  bookGeneration: number | null;
  resyncGeneration: number | null;
  runtimeGeneration: number;

  path: {
    profitLockActivateMfeAtActivation: number | null;
    lockFloorAtActivation: number | null;
    lockFloorAtExit: number | null;
    bestExitAtExit: number | null;
  };
};

export type GhShadowIntegrityCounters = {
  eventsSeen: number;
  eventsProcessed: number;
  eventsPersisted: number;
  eventsDropped: number;
  receiveSeqGaps: number;
  journalOverflowCount: number;
  lastProcessedReceiveSeq: number | null;
};

export type GhShadowQualificationEpoch = {
  qualificationId: string;
  qualificationStartTime: string;
  qualificationStartSequence: number;
  strategySha: string;
  configSha: string;
  strategyVersion: string;
  engineVersion: string;
  soakLabel: string;
  formalQualificationTrades: number;
  diagnosticExcludedTrades: number;
  openShadowTradeId: string | null;
  status: "ACTIVE" | "PAUSED" | "COMPLETED" | "DATA_QUALITY_FAILED";
  dataIntegrityFailure: string | null;
  runtimeGeneration: number;
  lastRestartReason: string | null;
  integrity: GhShadowIntegrityCounters;
  lastReplayStatus: "LIVE_REPLAY_OK" | "LIVE_REPLAY_DIVERGENCE" | "NOT_RUN";
  lastReplayDetail: {
    capturedEvents: number;
    replayedEvents: number;
    firstDivergenceSeq: number | null;
    divergenceDetail: string | null;
  } | null;
  updatedAt: string;
};

export type GhShadowDecisionRecord = {
  decisionId: string;
  qualificationId: string;
  at: string;
  kind: "OPEN" | "HOLD" | "EXIT" | "EXCLUDE" | "INTEGRITY";
  opportunityId: string | null;
  tradeId: string | null;
  setup: GoldHunterSetupLetter | null;
  side: "BUY" | "SELL" | null;
  bid: number;
  ask: number;
  receiveSeq: number;
  exitReason: GhShadowExitReason | null;
  detail: string | null;
};

/**
 * Normalized market event journal entry — enough to replay openTrade /
 * updateOpenTrade / evaluateOpenExit deterministically.
 */
export type GhShadowCapturedEvent = {
  eventId: string;
  qualificationId: string;
  receiveSeq: number;
  eventTs: string;
  eventTsMs: number;
  bid: number;
  ask: number;
  spread: number;
  features: GhFastFeatureSnapshot | null;
  dataOk: boolean;
  depthValidity: string;
  bookGeneration: number;
  resyncGeneration: number;
  newOpportunity: boolean;
  openMarker: {
    tradeId: string;
    opportunityId: string;
    signalId: string;
    setup: GoldHunterSetupLetter;
    setupId: GhFastSetupId;
    side: "BUY" | "SELL";
  } | null;
  strategySha: string;
  configSha: string;
};
