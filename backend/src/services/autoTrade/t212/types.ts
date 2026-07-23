/**
 * Trading 212 Invest AutoTrade types — long-only gold ETF/ETC/ETP proxy.
 * Order submission stays hard-disabled in this release.
 */

import {
  T212_LIVE_EXECUTION_FEATURE_FLAG,
  T212_PAPER_ORDER_SUBMISSION_ENABLED
} from "../types";

export type SelectedBrokerId = "MANUAL" | "T212_INVEST" | "IG_DEMO";

export type T212Environment = "PRACTICE" | "LIVE";

/** Initial usable connection mode — read-only practice only. */
export const T212_INITIAL_MODE = "TRADING_212_PRACTICE_READ_ONLY" as const;
export type T212ConnectionMode = typeof T212_INITIAL_MODE | "TRADING_212_LIVE_LOCKED";

export type BrokerBadge =
  | "MANUAL"
  | "T212 PRACTICE — READ ONLY"
  | "T212 LIVE — LOCKED"
  | "IG DEMO — PARKED";

export type T212ProposalStatus =
  | "CREATED"
  | "BLOCKED"
  | "AWAITING_CONFIRMATION"
  | "DRY_RUN_APPROVED"
  | "SUBMISSION_DISABLED"
  | "SUBMITTED"
  | "FILLED"
  | "PARTIALLY_FILLED"
  | "CANCELLED"
  | "REJECTED"
  | "FAILED";

export type T212ProxyAction = "BUY" | "SELL_CLOSE" | "WAIT";

export interface T212RiskLimits {
  maxOrderValue: number;
  maxDailyInvestedAmount: number;
  maxOpenGoldAllocationPct: number;
  minGoldMetaConfidence: number;
  maxSignalAgeSeconds: number;
  maxQuoteAgeSeconds: number;
  maxTradesPerDay: number;
  cooldownAfterOrderMinutes: number;
  requireMarketHours: boolean;
  requireSelectedInstrument: boolean;
  requireSufficientCash: boolean;
  currency: string;
}

export const DEFAULT_T212_RISK_LIMITS: T212RiskLimits = {
  maxOrderValue: 50,
  maxDailyInvestedAmount: 100,
  maxOpenGoldAllocationPct: 20,
  minGoldMetaConfidence: 85,
  maxSignalAgeSeconds: 15 * 60,
  maxQuoteAgeSeconds: 60,
  maxTradesPerDay: 1,
  cooldownAfterOrderMinutes: 60,
  requireMarketHours: true,
  requireSelectedInstrument: true,
  requireSufficientCash: true,
  currency: "EUR"
};

export interface BrokerSelectionDoc {
  userId: string;
  selectedBroker: SelectedBrokerId;
  updatedAt: string;
}

export interface T212SelectedInstrument {
  instrumentId: string;
  ticker: string;
  name: string;
  currency: string;
  isin: string | null;
  exchange: string | null;
  type: string | null;
  fractionalSupported: boolean | null;
  minOrderQuantity: number | null;
  minOrderValue: number | null;
  confirmedAt: string;
  confirmedBy: string;
  environment?: T212Environment | null;
}

export interface T212InstrumentCandidate {
  instrumentId: string;
  ticker: string;
  name: string;
  currency: string | null;
  isin: string | null;
  exchange: string | null;
  type: string | null;
  fractionalSupported: boolean | null;
  minOrderQuantity: number | null;
  minOrderValue: number | null;
  marketOpen: boolean | null;
  goldMatchReason: string;
}

export interface T212AccountSummary {
  environment: T212Environment;
  currency: string | null;
  freeCash: number | null;
  investedValue: number | null;
  totalValue: number | null;
  accountIdMasked: string | null;
}

export interface T212HoldingView {
  instrumentId: string;
  ticker: string;
  quantity: number;
  averagePrice: number | null;
  currentPrice: number | null;
  currency: string | null;
}

export interface T212ConnectionView {
  connected: boolean;
  environment: T212Environment | null;
  mode: T212ConnectionMode | null;
  currency: string | null;
  freeCash: number | null;
  investedValue: number | null;
  totalValue: number | null;
  selectedInstrument: T212SelectedInstrument | null;
  holdingQuantity: number | null;
  lastHeartbeatAt: string | null;
  connectionState: "Connected" | "Disconnected" | "Error" | "Parked";
  ordersEnabled: false;
  paperOrderSubmissionEnabled: boolean;
  liveExecutionFeatureEnabled: boolean;
}

export interface T212ExecutionProposal {
  proposalId: string;
  userId: string;
  decisionId: string;
  broker: "T212_INVEST";
  environment: T212Environment;
  instrumentId: string;
  instrumentTicker: string;
  instrumentName: string;
  action: T212ProxyAction;
  side: "BUY" | "SELL" | null;
  quantity: number | null;
  orderValue: number | null;
  estimatedPrice: number | null;
  accountCurrency: string | null;
  fxConversionWarning: string | null;
  confidence: number | null;
  goldMetaDecision: string;
  reasonCodes: string[];
  rejectionReason: string | null;
  idempotencyKey: string;
  status: T212ProposalStatus;
  riskEvaluation: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
}

export interface T212DryRunPreview {
  broker: "T212_INVEST";
  environment: T212Environment;
  selectedInstrument: {
    ticker: string;
    name: string;
    currency: string;
  } | null;
  side: "BUY" | "SELL" | null;
  quantity: number | null;
  orderValue: number | null;
  estimatedPrice: number | null;
  accountCurrency: string | null;
  fxConversionWarning: string | null;
  decisionId: string;
  confidence: number | null;
  riskGates: string[];
  rejectionReason: string | null;
  status: T212ProposalStatus;
  disclaimer: string;
}

export interface T212DiagnosticReport {
  ok: boolean;
  environment: T212Environment;
  readOnly: true;
  ordersEnabled: false;
  paperOrderSubmissionEnabled: boolean;
  liveExecutionFeatureEnabled: boolean;
  connected: boolean;
  account: T212AccountSummary | null;
  holdingsCount: number;
  goldCandidates: T212InstrumentCandidate[];
  selectedInstrument: T212SelectedInstrument | null;
  holdingForSelected: T212HoldingView | null;
  heartbeatAt: string | null;
  orderEndpointsCalled: false;
  errors: string[];
  notes: string[];
}

export function badgeForBroker(
  broker: SelectedBrokerId,
  t212Env: T212Environment | null
): BrokerBadge {
  if (broker === "MANUAL") return "MANUAL";
  if (broker === "IG_DEMO") return "IG DEMO — PARKED";
  if (t212Env === "LIVE") return "T212 LIVE — LOCKED";
  return "T212 PRACTICE — READ ONLY";
}

export function assertT212OrderFlagsDisabled(): void {
  if (T212_PAPER_ORDER_SUBMISSION_ENABLED || T212_LIVE_EXECUTION_FEATURE_FLAG) {
    throw new Error("T212_ORDER_FLAGS_MUST_REMAIN_FALSE");
  }
}

export const T212_PROXY_DISCLAIMER =
  "GoldMeta analyses XAUUSD and executes through the selected Trading 212 Invest gold instrument. This is not direct XAUUSD trading.";

export const SHORT_UNSUPPORTED_REASON = "SHORT_UNSUPPORTED_ON_T212_INVEST";
