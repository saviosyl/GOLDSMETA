/**
 * Gold Hunter Clean Shadow Qualification V1 — types.
 * Research only. brokerExecutionEnabled always false.
 */
import type { GhFastExitReason, GhFastSetupId } from "../abc/types";
import type { GoldHunterSetupLetter } from "../strategySelector";

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

export type GhShadowEconomicExposure = {
  /** Deposit-currency risk budget for this trade (€). */
  riskBudgetEur: number;
  hardStopPrice: number;
  /** € value per 1.0 price point per 1.0 XAU oz (Pepperstone EUR cash approx). */
  valuePerPointPerOzEur: number;
  /** Economic XAU ounces (trading units under Pepperstone 1 TU ≈ 1 oz). */
  economicXauOz: number;
  /** Conventional 100-oz lots equivalent (documentation only). */
  conventionalLotsEquivalent: number;
  /** Friction in price units from frozen strategy config. */
  frictionPrice: number;
  formula: string;
};

export type GhShadowTrade = {
  tradeId: string;
  qualificationId: string;
  opportunityId: string;
  signalId: string;
  setup: GoldHunterSetupLetter;
  setupId: GhFastSetupId | string;
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
  simulatedGrossPnlEur: number | null;
  simulatedFrictionEur: number | null;
  simulatedNetPnlEur: number | null;

  economic: GhShadowEconomicExposure | null;

  profitLockActivatedAt: string | null;
  trailActivatedAt: string | null;
  trailUpdateCount: number;
  maxFavorableBeforeExit: number | null;
  maxAdverseBeforeExit: number | null;

  strategySha: string;
  configSha: string;
  receiveSeqAtEntry: number | null;
  receiveSeqAtExit: number | null;
  bookGeneration: number | null;
  resyncGeneration: number | null;

  /** Forensic path samples for payoff diagnostics. */
  path: {
    profitLockActivateMfeAtActivation: number | null;
    lockFloorAtActivation: number | null;
    lockFloorAtExit: number | null;
    bestExitAtExit: number | null;
  };
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
  status: "ACTIVE" | "PAUSED" | "COMPLETED";
  brokerMutationCount: number;
  lastReplayStatus: "LIVE_REPLAY_OK" | "LIVE_REPLAY_DIVERGENCE" | "NOT_RUN";
  updatedAt: string;
};

export type GhShadowDecisionRecord = {
  decisionId: string;
  qualificationId: string;
  at: string;
  kind: "OPEN" | "HOLD" | "EXIT" | "EXCLUDE";
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
