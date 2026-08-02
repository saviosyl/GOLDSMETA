/** Shared API types mirroring backend / iOS envelopes. Decisions always come from the backend. */

export type DecisionAction = "BUY" | "SELL" | "WAIT";
export type DataSourceLabel = "LIVE" | "DELAYED" | "STALE" | "MOCK" | "OFFLINE" | "TEST";
export type DataQuality = "GOOD" | "PARTIAL" | "STALE" | "CONFLICTED" | "INVALID";

export interface EntryPlan {
  type: string;
  price: number | null;
  zoneLow: number | null;
  zoneHigh: number | null;
  condition: string | null;
}

export interface StopLossPlan {
  price: number | null;
  reason: string | null;
}

export interface TakeProfitPlan {
  label: string;
  price: number;
  reason: string;
}

export interface RiskReward {
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
}

export interface MarketStructure {
  trend: string | null;
  trendStrength?: number | null;
  poc: number | null;
  vah: number | null;
  val: number | null;
  confirmationClassification?: string | null;
  confirmationDirection?: string | null;
  confirmationCandleType?: string | null;
}

export interface Decision {
  schemaVersion: string;
  decisionId: string;
  symbol: string;
  /** Present on Phase-2+ decisions; legacy records may omit → UI shows "—". */
  timeframe?: string | null;
  barTime?: string | null;
  generatedAt: string;
  marketDataTime: string;
  validUntil: string;
  decision: DecisionAction;
  confidence: number;
  confidenceLabel: string;
  marketRegime: string;
  dataQuality: DataQuality;
  isProvisional: boolean;
  isTestDecision?: boolean | null;
  environment?: string | null;
  setupScore: number;
  tradeScore?: number | null;
  setupGrade?: string | null;
  analysisOnly?: boolean | null;
  recommendedManagementAction?: string | null;
  explanation?: string | null;
  entry: EntryPlan;
  stopLoss: StopLossPlan;
  takeProfits: TakeProfitPlan[];
  riskReward: RiskReward;
  bullishEvidence: string[];
  bearishEvidence: string[];
  reasonCodes: string[];
  reasonSummary: string[];
  warnings: string[];
  missingInputs: string[];
  invalidation: string;
  disclaimer: string;
  lifecycleState: string;
  ruleConfigVersion: string;
  backendVersion: string;
  notificationSent: boolean;
  currentSession?: string | null;
  higherTimeframeBias?: string | null;
  lastKnownPrice?: number | null;
  ohlcv?: {
    open?: number | null;
    high?: number | null;
    low?: number | null;
    close?: number | null;
    volume?: number | null;
  } | null;
  dataSourceLabel: DataSourceLabel;
  marketStructure?: MarketStructure | null;
  recommendedActions?: string[] | null;
  scenarioName?: string | null;
  safetyFlags?: string[] | null;
  symbolIdentity?: {
    tradingViewSymbol: string;
    exchange: string | null;
    ctraderSymbolId: string | null;
    canonicalSymbol: "XAUUSD";
  } | null;
  priceSources?: {
    alertClose?: { source: string; value: number | null; exchangeOrBroker?: string | null };
    barHigh?: { source: string; value: number | null };
    barLow?: { source: string; value: number | null };
    poc?: { source: string; value: number | null };
    vah?: { source: string; value: number | null };
    val?: { source: string; value: number | null };
  } | null;
}

export type ManualRiskCurrency = "EUR" | "USD" | "GBP";

export interface ManualRiskSettings {
  currency: ManualRiskCurrency;
  maxCashRiskPerTrade: number;
  maxSimultaneousManualTrades: number;
  maxDailyRealisedLoss: number;
  stopAfterConsecutiveLosses: number;
  valuePerPoint: number | null;
  estimatedSpreadPoints: number | null;
  noAveragingDown: true;
  noMartingale: true;
  noAutomaticRecovery: true;
}

export type ManualExecutionAction =
  | "ENTERED"
  | "SKIPPED"
  | "ENTERED_LATE"
  | "INCORRECT_SIZE"
  | "SPREAD_TOO_HIGH"
  | "NEWS_RISK"
  | "SETUP_NOT_CLEAR"
  | "OTHER";

export interface ManualExecutionRecord {
  action: ManualExecutionAction;
  skipReason?: string;
  actualEntryPrice?: number;
  positionSize?: number;
  broker?: string;
  tradedAt?: string;
  cashRiskIntended?: number;
  actualStop?: number;
  actualTp1?: number;
  actualTp2?: number;
  actualTp3?: number;
  actualExitPrice?: number;
  actualPnl?: number;
  feesSpreadSlippage?: number;
  notes?: string;
  screenshotRef?: string;
  updatedAt: string;
  systemOutcomeUntouched: true;
}

export interface ManualRiskLimitChange {
  at: string;
  field: string;
  from: string | number | boolean | null;
  to: string | number | boolean | null;
}

export interface BackendSettings {
  aiEnabled: boolean;
  notificationsEnabled: boolean;
  provisionalSignalsEnabled: boolean;
  riskProfile: "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
  liveForwardAckAt?: string | null;
  manualRisk?: ManualRiskSettings;
  manualRiskLimitChangeLog?: ManualRiskLimitChange[];
  updatedAt?: string;
}

export interface SetupSkipRecord {
  id: string;
  userId: string;
  decisionId: string;
  environment: "LIVE" | "TEST";
  reason: string;
  at: string;
}

export interface JournalEntry {
  journalId?: string;
  id?: string;
  decisionId?: string | null;
  setupId?: string | null;
  symbol: string;
  direction: DecisionAction;
  outcome: string;
  riskReward?: number | null;
  pnl?: number | null;
  notes?: string | null;
  tags?: JournalTag[] | null;
  createdAt?: string;
}

export type JournalTag =
  | "followed"
  | "ignored"
  | "entered_manually"
  | "avoided"
  | "news_risk"
  | "poor_spread"
  | "discretionary_override";

export type SetupStatus =
  | "SIGNAL_CREATED"
  | "WAITING_FOR_ENTRY"
  | "ENTRY_TRIGGERED"
  | "TP1_HIT"
  | "TP2_HIT"
  | "TP3_HIT"
  | "STOP_LOSS_HIT"
  | "BREAKEVEN"
  | "EXPIRED"
  | "CANCELLED"
  | "INVALIDATED"
  | "CLOSED"
  | "AMBIGUOUS_INTRABAR";

export interface SetupStatusTransition {
  at: string;
  from: SetupStatus;
  to: SetupStatus;
  barTime: string | null;
  eventId: string | null;
  reason: string;
}

export interface SetupRecord {
  setupId: string;
  decisionId: string;
  symbol: string;
  timeframe: string;
  direction: "BUY" | "SELL";
  environment: "LIVE" | "TEST";
  isTestSetup: boolean;
  createdAt: string;
  barTime: string;
  session: string | null;
  levels: {
    entryPrice: number | null;
    entryType: string | null;
    stopLoss: number | null;
    tp1: number | null;
    tp2: number | null;
    tp3: number | null;
  };
  initialRisk: number | null;
  expectedRR: { tp1: number | null; tp2: number | null; tp3: number | null };
  confidence: number;
  status: SetupStatus;
  statusHistory: SetupStatusTransition[];
  entryTriggeredAt: string | null;
  resolvedAt: string | null;
  resolution: string;
  barsToEntry: number | null;
  barsToResolution: number | null;
  barsOpen: number;
  excursion: {
    mfe: number | null;
    mae: number | null;
    highestPriceSeen: number | null;
    lowestPriceSeen: number | null;
  };
  outcome: {
    rawResolution: string;
    rawRealisedR: number | null;
    modelledResolution: string;
    modelledRealisedR: number | null;
    managementNotes: string[];
  };
  ruleConfigVersion: string;
  pineScriptVersion: string | null;
  backendVersion: string;
  updatedAt: string;
  /** Journal only — never mutates system outcome. */
  manualExecution?: ManualExecutionRecord | null;
}

export interface SetupAnalyticsSummary {
  environment: "LIVE" | "TEST";
  sampleSize: number;
  sampleSizeWarning: string | null;
  sampleSizeBand?: "extremely_small" | "small" | "preliminary" | "meaningful";
  totalSetups: number;
  activeSetups: number;
  completedSetups: number;
  entriesTriggered?: number;
  expiredBeforeEntry?: number;
  wins: number;
  losses: number;
  breakeven: number;
  expired: number;
  cancelled: number;
  ambiguous: number;
  tp1Hits?: number;
  tp2Hits?: number;
  tp3Hits?: number;
  stopped?: number;
  winRate: number | null;
  lossRate: number | null;
  averageR: number | null;
  medianR: number | null;
  cumulativeR: number;
  profitFactorR: number | null;
  averageBarsToEntry: number | null;
  averageBarsToResolution: number | null;
  tp1HitRate: number | null;
  tp2HitRate: number | null;
  tp3HitRate: number | null;
  slHitRate: number | null;
  averageMfe: number | null;
  averageMae: number | null;
  expectancyR: number | null;
  maxLosingStreak?: number;
  maxDrawdownR?: number;
  byDirection: { BUY: number; SELL: number };
  bySession: Record<string, number>;
  byDayOfWeek?: Record<string, number>;
  byConfidenceBand?: Record<string, number>;
  manual?: {
    entered: number;
    skipped: number;
    withPnl: number;
    totalManualPnl: number | null;
  };
}

export interface SystemStatus {
  backendVersion: string;
  decisionBackendVersion: string;
  ruleConfigVersion: string;
  setupRuleConfigVersion: string;
  flags: Record<string, unknown>;
  tradingView: {
    connectionStatus: string;
    webhookId: string | null;
    lastAlertAt: string | null;
  };
  latestDecision: {
    decisionId: string;
    decision: string;
    generatedAt: string;
    barTime: string;
    environment: string;
    dataQuality: string;
  } | null;
  activeSetups: Array<{
    setupId: string;
    status: string;
    direction: string;
    environment: string;
  }>;
  brokerLiveExecutionEnabled: boolean;
  brokerExecutionEnabled?: boolean;
  brokerMode?: string;
  latestSetupSkip?: SetupSkipRecord | null;
  liveForwardAckAt?: string | null;
  manualRisk?: ManualRiskSettings | null;
}

export interface AdminDiagnostics {
  apiHealth: string;
  backendVersion: string;
  ruleConfigVersion: string;
  setupRuleConfigVersion: string;
  pineVersionLastReceived: string | null;
  flags: Record<string, unknown>;
  webhookConnections: Array<{
    webhookId: string;
    status: string;
    lastAlertAt: string | null;
    hasSecret: boolean;
  }>;
  latestDecision: {
    decisionId: string;
    decision: string;
    generatedAt: string;
    environment: string;
  } | null;
  latestSetupTransition: SetupStatusTransition | null;
  recentRejects: Array<{
    id: string;
    at: string;
    code: string;
    message: string;
  }>;
  igDemoPlan: Record<string, unknown>;
  mockBrokerReady: string;
  v4?: {
    strategyVersion?: string;
    engineVersion?: string;
    deploymentStage?: string;
    mode?: string;
    actionable?: boolean;
    flags?: Record<string, unknown>;
  };
}

export interface TradingViewConnection {
  id: string;
  webhookId?: string;
  webhookURL?: string | null;
  webhookUrl?: string | null;
  payloadSecret?: string | null;
  secret?: string | null;
  status: string;
  connected?: boolean;
  lastAlertAt?: string | null;
  createdAt?: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export interface HealthResponse {
  ok: boolean;
  backendVersion: string;
  ruleConfigVersion: string;
  appEnv: string;
  storageBackend: string;
}

export interface WebPushSubscriptionPayload {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
}


/** V6 Signal Outcome Tracking — hypothetical only. */
export interface SignalOutcomeSnapshot {
  signalId: string;
  decisionId: string;
  direction: DecisionAction;
  confidence: number;
  timeframe: string | null;
  createdAt: string;
  proposedEntryPrice: number | null;
  entryZoneLow: number | null;
  entryZoneHigh: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  dataQuality: string;
}

export interface SignalOutcomeRecord {
  schemaVersion: "1.0";
  snapshot: SignalOutcomeSnapshot;
  entry: {
    entryReached: boolean;
    entryTimestamp: string | null;
    entryPrice: number | null;
    expiredWithoutEntry: boolean;
  };
  monitoring: {
    lifecycle: string;
    currentPrice: number | null;
    currentGrossPoints: number | null;
    currentRMultiple: number | null;
    timeInTradeMs: number | null;
    tp1Status: string;
    tp2Status: string;
    tp3Status: string;
    stopStatus: string;
  };
  finalResult: {
    outcome: string | null;
    exitReason: string | null;
    exitTimestamp: string | null;
    exitPrice: number | null;
    entryPrice: number | null;
    grossPoints: number | null;
    netPoints: number | null;
    netR: number | null;
    holdingDurationMs: number | null;
    targetsReached: string[];
    label: string;
    disclaimer: string;
  } | null;
}

export interface SignalPerformanceSummary {
  label: string;
  disclaimer: string;
  totalConfirmedBuySell: number;
  pendingEntries: number;
  openSignals: number;
  closedSignals: number;
  wins: number;
  losses: number;
  breakeven: number;
  expired: number;
  cancelled: number;
  ambiguousIntrabar: number;
  dataUnavailable: number;
  waitOnly: number;
  winRate: number | null;
  netPoints: number;
  netR: number;
  averageWin: number | null;
  averageLoss: number | null;
  profitFactor: number | null;
  maximumDrawdownR: number;
  maximumConsecutiveLosses: number;
  averageHoldingTimeMs: number | null;
  tp1HitRate: number | null;
  tp2HitRate: number | null;
  tp3HitRate: number | null;
  stopLossRate: number | null;
  byDirection: { BUY: number; SELL: number };
  byConfidenceRange?: Record<string, { count: number; wins: number; losses: number }>;
}
