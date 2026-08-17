/**
 * Gold Hunter Clean Shadow Qualification — types (final integrity revision).
 */
import type { GhFastExitReason, GhFastSetupId } from "../abc/types";
import type { GoldHunterSetupLetter } from "../strategySelector";
import type { GhFastFeatureSnapshot } from "../abc/features";

export const GH_SHADOW_QUALIFICATION_VERSION = "GH_SHADOW_QUAL_V1" as const;
export const GH_SHADOW_QUALIFICATION_EPOCH_PREFIX = "GH-SQ" as const;

export type GhShadowOwnerLifecycle =
  | "UNINITIALIZED"
  | "INITIALIZING"
  | "READY"
  | "FAILED";

export type GhShadowDataQuality =
  | "FORMAL_ELIGIBLE"
  | "DIAGNOSTIC_EXCLUDED"
  | "WARMUP_NOT_QUALIFICATION";

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

export type GhShadowFrozenSizingSnapshot = {
  allocatedCapitalEur: number;
  riskPerTradePct: number;
  dailyLossLimitPct: number;
  maxOpenTrades: number;
  minLots: number;
  maxLots: number;
  lotStep: number;
  ozPerLot: number;
  valuePerPointPerLot: number;
  protocolCentsPerLot: number;
  mappingKey: string;
  quoteCurrency: string;
  depositCurrency: string;
  quoteToDepositRate: number | null;
  quoteToDepositRateSource: string | null;
  symbolMetadataProvenance: string;
  adminSizingConfigSha: string;
  snappedAt: string;
};

export type GhShadowEconomicExposure = {
  riskBudgetEur: number;
  stopDistance: number;
  hardStopPrice: number;
  displayedLots: number;
  ozPerLot: number;
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
  adminSizingConfigSha: string;
  frictionPrice: number;
  frictionSemantics: "ADDITIONAL_COMMISSION_SLIPPAGE_PRICE_UNITS_NOT_SPREAD";
  formula: string;
  eurPnlAvailable: boolean;
};

export type GhShadowLatencySensitivity = {
  signalExitPrice: number;
  nextEventPrice: number | null;
  nextEventReceiveSeq: number | null;
  priceAt100ms: number | null;
  priceAt250ms: number | null;
  priceAt500ms: number | null;
  signalTickPnlQuote: number;
  nextEventPnlQuote: number | null;
  pnl100msQuote: number | null;
  pnl250msQuote: number | null;
  pnl500msQuote: number | null;
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

  /** Primary formal unit: quote currency (USD). */
  simulatedGrossPnlQuote: number | null;
  simulatedFrictionPnlQuote: number | null;
  simulatedNetPnlQuote: number | null;
  quoteCurrency: string | null;
  /** R-multiple vs planned risk (quote / riskBudget when FX maps, else quote/risk in mixed note). */
  netR: number | null;

  simulatedGrossPnlEur: number | null;
  simulatedFrictionEur: number | null;
  simulatedNetPnlEur: number | null;
  eurPnlAvailable: boolean;

  economic: GhShadowEconomicExposure | null;
  latency: GhShadowLatencySensitivity | null;

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
  receiveSeqDuplicates: number;
  receiveSeqOutOfOrder: number;
  journalOverflowCount: number;
  journalPending: number;
  journalHighWaterMark: number;
  persistAcknowledgedEvents: number;
  persistFailures: number;
  lastProcessedReceiveSeq: number | null;
  lastResyncGeneration: number | null;
};

export type GhShadowActivityCounters = {
  newOpportunitiesDetected: number;
  formalTradesOpened: number;
  formalTradesClosed: number;
  opportunitiesWhileAlreadyOpen: number;
  opportunitiesExcludedDataQuality: number;
  opportunitiesRejectedSizing: number;
  opportunitiesWarmupIgnored: number;
  otherRejectionReasons: Record<string, number>;
  activeMarketMs: number;
  entryTimestampsMs: number[];
  openTradeDurationsMs: number[];
  flatIdleSegmentsMs: number[];
  lastActiveMarketAtMs: number | null;
  lastEntryAtMs: number | null;
  lastFlatStartMs: number | null;
  bySetupOpened: Record<"A" | "B" | "C", number>;
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
  frozenSizing: GhShadowFrozenSizingSnapshot;
  formalQualificationTrades: number;
  diagnosticExcludedTrades: number;
  openShadowTradeId: string | null;
  status: "ACTIVE" | "PAUSED" | "COMPLETED" | "DATA_QUALITY_FAILED";
  dataIntegrityFailure: string | null;
  persistFailureReason: string | null;
  runtimeGeneration: number;
  lastRestartReason: string | null;
  integrity: GhShadowIntegrityCounters;
  activity: GhShadowActivityCounters;
  lastReplayStatus:
    | "LIVE_REPLAY_OK"
    | "LIVE_REPLAY_DIVERGENCE"
    | "REPLAY_INCOMPLETE"
    | "NOT_RUN";
  lastReplayDetail: {
    capturedEvents: number;
    replayedEvents: number;
    expectedEvents: number | null;
    firstDivergenceSeq: number | null;
    divergenceDetail: string | null;
  } | null;
  updatedAt: string;
};

export type GhShadowDecisionRecord = {
  decisionId: string;
  qualificationId: string;
  at: string;
  kind:
    | "OPEN"
    | "HOLD"
    | "EXIT"
    | "EXCLUDE"
    | "INTEGRITY"
    | "WARMUP"
    | "CONFIG";
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
  /** Only true for events that belong to a formal open→exit path (replay scope). */
  inFormalTradePath: boolean;
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
