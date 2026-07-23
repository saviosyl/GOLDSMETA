/** Client-side AutoTrade types mirroring backend status payload (no secrets). */

export type AutoTradeMode = "OFF" | "SHADOW" | "IG_DEMO_AUTO" | "IG_LIVE_AUTO";
export type AutoTradeDisplayStatus = "OFF" | "SHADOW" | "DEMO" | "LIVE" | "LOCKED";

export type SelectedBrokerId = "MANUAL" | "T212_INVEST" | "IG_DEMO";
export type T212Environment = "PRACTICE" | "LIVE";
export type T212ConnectionMode =
  | "TRADING_212_PRACTICE_READ_ONLY"
  | "TRADING_212_LIVE_LOCKED";

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

export const DEFAULT_T212_RISK_LIMITS_CLIENT: T212RiskLimits = {
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

export const T212_PROXY_DISCLAIMER_CLIENT =
  "GoldMeta analyses XAUUSD and executes through the selected Trading 212 Invest gold instrument. This is not direct XAUUSD trading.";

export interface T212SelectedInstrument {
  instrumentId: string;
  ticker: string;
  name: string;
  currency: string;
  isin: string | null;
  exchange: string | null;
  fractionalSupported: boolean | null;
  minOrderQuantity: number | null;
  minOrderValue: number | null;
  confirmedAt: string;
  confirmedBy: string;
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

export interface IgGoldMarketCandidate {
  epic: string;
  instrumentName: string;
  instrumentType: string | null;
  expiry: string | null;
  marketStatus: string;
  currencyCode: string | null;
  bid: number | null;
  offer: number | null;
  proposedPrimary: boolean;
  reason: string;
}

export interface IgDemoDiagnosticReport {
  ok: boolean;
  environment: "DEMO";
  readOnly: true;
  ordersEnabled: false;
  liveExecutionEnabled: boolean;
  connected: boolean;
  accountIdMasked: string | null;
  accountName: string | null;
  currency: string | null;
  balance: number | null;
  available: number | null;
  marginUsed: number | null;
  accountMatch: string;
  configuredAccountIdMasked: string | null;
  goldCandidates: IgGoldMarketCandidate[];
  proposedEpic: string | null;
  selectionRequired: boolean;
  selectedMarket: {
    epic: string;
    instrumentName: string;
    marketStatus: string;
    bid: number;
    offer: number;
    spread: number;
    minDealSize: number;
    dealSizeIncrement: number;
    valueOfOnePip: number;
    minNormalStopDistance: number | null;
    minGuaranteedStopDistance: number | null;
    guaranteedStopAvailable: boolean;
    marginRequirement: number | null;
  } | null;
  openPositionsCount: number;
  sessionRenewal: string;
  heartbeatAt: string | null;
  dealingEndpointsCalled: false;
  errors: string[];
  notes: string[];
}

export interface AutoTradeStatus {
  displayStatus: AutoTradeDisplayStatus;
  mode: AutoTradeMode;
  locked: boolean;
  lockReason: string | null;
  emergencyStopActive: boolean;
  liveExecutionFeatureEnabled: boolean;
  demoOrderSubmissionEnabled?: boolean;
  brokerExecutionEnabled?: false;
  t212PaperOrderSubmissionEnabled?: false;
  t212LiveExecutionFeatureEnabled?: false;
  readOnly?: true;
  ordersEnabled?: false;
  selectedBroker: SelectedBrokerId;
  brokerBadge: BrokerBadge | string;
  igParked: boolean;
  t212: T212ConnectionView | null;
  t212RiskLimits: T212RiskLimits;
  t212GoldCandidates: T212InstrumentCandidate[];
  t212LastDiagnosticReport: T212DiagnosticReport | null;
  t212PendingProposal: T212ExecutionProposal | null;
  t212Disclaimer: string;
  connection: {
    connected: boolean;
    environment: "DEMO" | "LIVE" | null;
    environmentLabel?: string;
    accountIdMasked: string | null;
    accountName: string | null;
    currency: string | null;
    balance: number | null;
    available: number | null;
    marginUsed: number | null;
    marketStatus: string | null;
    marketEpic: string | null;
    marketName: string | null;
    instrumentType?: string | null;
    expiry?: string | null;
    bid: number | null;
    ask: number | null;
    spread: number | null;
    minDealSize: number | null;
    sizeIncrement: number | null;
    valuePerPoint: number | null;
    minNormalStopDistance?: number | null;
    minGuaranteedStopDistance?: number | null;
    guaranteedStopAvailable?: boolean | null;
    marginRequirement?: number | null;
    lastHeartbeatAt: string | null;
    accountMatch?: string | null;
    connectionState?: "Connected" | "Disconnected" | "Error";
  };
  limits: {
    maxLossPerTrade: number;
    maxMarginPerPosition: number;
    maxDailyLoss: number;
    maxWeeklyLoss: number;
    maxOpenPositions: number;
    maxTradesPerDay: number;
    maxConsecutiveLosses: number;
    cooldownAfterLossMinutes: number;
    minGoldMetaScore: number;
    minRiskReward: number;
    maxSpread: number | null;
    stopProtection: string;
    allowedSessions: string[];
    currency: string;
  };
  budget: {
    dailyLossLimit: number;
    weeklyLossLimit: number;
    dailyRealisedPnl: number;
    dailyUnrealisedPnl: number;
    weeklyRealisedPnl: number;
    weeklyUnrealisedPnl: number;
    remainingDailyLossCapacity: number;
    remainingWeeklyLossCapacity: number;
    marginUsed: number;
    tradesUsed: number;
    tradesMax: number;
    currency: string;
  };
  positions: Array<{
    positionId: string;
    environment: "DEMO" | "LIVE";
    direction: "BUY" | "SELL";
    marketName: string;
    epic: string;
    entry: number;
    size: number;
    stop: number | null;
    takeProfit: number | null;
    monetaryRisk: number | null;
    currentBid: number | null;
    currentAsk: number | null;
    unrealisedPnl: number | null;
    score: number | null;
    decisionId: string | null;
    dealId: string | null;
    protectionStatus: string;
    openedAt: string;
  }>;
  activity: Array<{
    id: string;
    at: string;
    message: string;
    level: "info" | "warn" | "error" | "success";
  }>;
  strategyVersion: string;
  goldCandidates?: IgGoldMarketCandidate[];
  proposedEpic?: string | null;
  selectionRequired?: boolean;
  lastDiagnosticReport?: IgDemoDiagnosticReport | null;
}

export const FIRST_PILOT_LIMITS_CLIENT = {
  maxLossPerTrade: 5,
  maxMarginPerPosition: 100,
  maxDailyLoss: 10,
  maxWeeklyLoss: 30,
  maxOpenPositions: 1,
  maxTradesPerDay: 1,
  maxConsecutiveLosses: 2,
  cooldownAfterLossMinutes: 60,
  minGoldMetaScore: 85,
  minRiskReward: 2,
  maxSpread: null as number | null,
  stopProtection: "GUARANTEED_REQUIRED",
  allowedSessions: ["LONDON", "NEW_YORK", "LONDON_NY_OVERLAP"],
  currency: "EUR"
};

export function buildReviewAutoTradeStatus(
  overrides: Partial<AutoTradeStatus> = {}
): AutoTradeStatus {
  return {
    displayStatus: "OFF",
    mode: "OFF",
    locked: false,
    lockReason: null,
    emergencyStopActive: false,
    liveExecutionFeatureEnabled: false,
    demoOrderSubmissionEnabled: false,
    brokerExecutionEnabled: false,
    t212PaperOrderSubmissionEnabled: false,
    t212LiveExecutionFeatureEnabled: false,
    readOnly: true,
    ordersEnabled: false,
    selectedBroker: "MANUAL",
    brokerBadge: "MANUAL",
    igParked: true,
    t212: null,
    t212RiskLimits: { ...DEFAULT_T212_RISK_LIMITS_CLIENT },
    t212GoldCandidates: [],
    t212LastDiagnosticReport: null,
    t212PendingProposal: null,
    t212Disclaimer: T212_PROXY_DISCLAIMER_CLIENT,
    connection: {
      connected: false,
      environment: "DEMO",
      environmentLabel: "IG DEMO — PARKED",
      accountIdMasked: null,
      accountName: null,
      currency: "EUR",
      balance: null,
      available: null,
      marginUsed: null,
      marketStatus: null,
      marketEpic: null,
      marketName: "Spot Gold",
      instrumentType: null,
      expiry: null,
      bid: null,
      ask: null,
      spread: null,
      minDealSize: 0.1,
      sizeIncrement: 0.1,
      valuePerPoint: 1,
      minNormalStopDistance: null,
      minGuaranteedStopDistance: null,
      guaranteedStopAvailable: null,
      marginRequirement: null,
      lastHeartbeatAt: null,
      accountMatch: null,
      connectionState: "Disconnected"
    },
    limits: { ...FIRST_PILOT_LIMITS_CLIENT },
    budget: {
      dailyLossLimit: 10,
      weeklyLossLimit: 30,
      dailyRealisedPnl: 0,
      dailyUnrealisedPnl: 0,
      weeklyRealisedPnl: 0,
      weeklyUnrealisedPnl: 0,
      remainingDailyLossCapacity: 10,
      remainingWeeklyLossCapacity: 30,
      marginUsed: 0,
      tradesUsed: 0,
      tradesMax: 1,
      currency: "EUR"
    },
    positions: [],
    activity: [
      {
        id: "review-1",
        at: new Date().toISOString(),
        message: "AutoTrade Control Centre ready. Mode OFF. Broker MANUAL.",
        level: "info"
      }
    ],
    strategyVersion: "v6.0.0-pilot",
    goldCandidates: [],
    proposedEpic: null,
    selectionRequired: false,
    lastDiagnosticReport: null,
    ...overrides
  };
}
