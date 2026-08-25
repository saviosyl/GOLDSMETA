/** Frontend types for Broker Control Centre / cTrader Demo preview. */

export type BrokerOptionId =
  | "manual"
  | "trading212_invest"
  | "pepperstone_ctrader";

export interface BrokerControlCentreResponse {
  defaultBroker: BrokerOptionId;
  autoTrade: "ON" | "OFF" | "PAUSED" | "LOCKED";
  orderSubmissionEnabled?: boolean;
  brokers: Array<{
    id: BrokerOptionId;
    name: string;
    status: string;
    detail: string;
    badge: string;
  }>;
  automationModes: Array<{
    id: string;
    available: boolean;
    note?: string;
  }>;
  readiness: {
    setupRequired: boolean;
    authSetupRequired: boolean;
    oauthConfigured: boolean;
    /** Human-readable, non-secret missing server configuration items. */
    missingConfigurationItems?: string[];
    connected: boolean;
    demonstrationAvailable: true;
    automationMode: string;
    autoTrade: "ON" | "OFF" | "PAUSED" | "LOCKED";
    orderSubmissionEnabled: boolean;
    liveEnabled: false;
    wizardSteps: Array<{
      step: number;
      title: string;
      status: string;
      detail: string;
    }>;
    label: string;
    connectionSummary?: {
      accountMasked: string | null;
      brokerName: string | null;
      pepperstoneConfirmed: boolean;
      symbolName: string | null;
      lastSyncAt: string | null;
      lastQuoteAt: string | null;
    };
    auth: {
      status: string;
      brokerSetupEnabled: boolean;
      notes: string[];
    };
    qualification: {
      unlocked: boolean;
      canActivate: false;
      failed: string[];
      progress: {
        completedPreviews: number;
        requiredPreviews: number;
        approvedControlledDemoTrades: number;
        requiredTrades: number;
        daysSinceFirstTrade: number | null;
        requiredDays: number;
        source?: "recommended_qualification_defaults";
        sourceLabel?: string;
      };
    };
  };
}

export interface CTraderDiagnosticsReport {
  credentialsConfigured: boolean;
  oauthConnected: boolean;
  demoAccountSelected: boolean;
  accountSelected?: boolean;
  selectedAccountIsLive?: boolean;
  pepperstoneConfirmed: boolean;
  goldSymbolFound: boolean;
  liveQuoteReceived: boolean;
  spreadAvailable: boolean;
  volumeRulesAvailable: boolean;
  marginMetadataAvailable: boolean;
  marketStatusAvailable: boolean;
  tradingSafelyLocked: true;
  autoTrade: "ON" | "OFF" | "PAUSED" | "LOCKED";
  orderSubmissionEnabled?: boolean;
  environment: "DEMO" | "LIVE";
  connection: {
    accountMasked: string | null;
    brokerName: string | null;
    currency: string | null;
    symbolName: string | null;
    lastSyncAt: string | null;
    lastQuoteAt: string | null;
    tokenRefreshHealthy: boolean | null;
    oauthScope?: "accounts" | "trading" | null;
    tradingScopeGrantedAt?: string | null;
    oauthScopeVersion?: string | null;
  };
  quote: {
    bid: number | null;
    ask: number | null;
    spread: number | null;
    timestamp?: string;
    marketStatus?: string;
    stale?: boolean;
    source?: string;
  } | null;
  account: {
    accountIdMasked: string;
    currency: string;
    balance: number | null;
    equity: number | null;
    freeMargin: number | null;
    usedMargin: number | null;
    leverage: number | null;
    brokerName: string | null;
  } | null;
  symbol: {
    symbolId?: string;
    symbolName: string;
    description?: string | null;
    digits?: number | null;
    minVolume?: number | null;
    maxVolume?: number | null;
    volumeStep?: number | null;
    lotSize?: number | null;
  } | null;
  technical?: Record<string, unknown>;
  label?: string;
}

export interface CTraderDemoAccountOption {
  ctidTraderAccountId: string;
  accountIdMasked: string;
  brokerNameTitle: string | null;
  depositCurrency: string | null;
  leverage: number | null;
  isLive: boolean;
  accountType?: "Demo" | "Live";
  fundsLabel?: string;
  selected?: boolean;
  connectionStatus?: string;
  tradingPermission?: string;
  balance?: number | null;
}

/** Demo + Live authorised accounts for the signed-in user. */
export type CTraderBrokerAccountOption = CTraderDemoAccountOption;

export interface UserAutoTradeSettingsDto {
  uid: string;
  environment: "demo" | "live";
  updatedAt: string;
  selectedAccountId: string | null;
  sizingMode: "automatic_risk" | "manual_lots";
  fixedRiskAmount: number;
  percentageRisk: number;
  manualLotSize: number;
  maxDailyLoss: number;
  maxTradesPerDay: number;
  maxOpenPositions: number;
  minConfidence: number;
  minRiskReward: number;
  maxSpread: number;
  maxQuoteAgeSeconds: number;
  stopLossDistance: number | null;
  takeProfitMethod: string;
  tradeCooldownMinutes: number;
  pauseAfterConsecutiveLosses: number;
  allowedSessions: string[];
  allowedDays: string[];
  newsFilterEnabled: boolean;
  newsImpactMode?: "HIGH" | "MEDIUM" | "OFF";
  newsMinutesBefore?: number;
  newsMinutesAfter?: number;
  maxSlippage?: number;
  dailyProfitTarget?: number | null;
  dailyProfitTargetEnabled?: boolean;
  profitProtectionEnabled?: boolean;
  profitProtectionFloor?: number | null;
  maxPositionExposureLots?: number | null;
  confirmationCandleRequired: boolean;
  trendConfirmationRequired: boolean;
  volumeConfirmationRequired: boolean;
  breakEvenEnabled: boolean;
  trailingStopEnabled: boolean;
  partialTakeProfitEnabled: boolean;
  autoTradePaused?: boolean;
  autoTradePausedReason?: string | null;
  liveActivationConfirmedAt: string | null;
  liveActivationPhraseConfirmed: boolean;
  autoTradeEnabledIntent: boolean;
  emergencyStopActive: boolean;
}

export type DailySafetyPublicView = {
  environment: "demo" | "live";
  tradingDay: string;
  tradesToday: number;
  tradesMax: number;
  tradesLimitReached: boolean;
  dailyPnl: number;
  dailyLossLimit: number;
  dailyLossUsed: number;
  dailyLossRemaining: number;
  dailyLossLimitReached: boolean;
  consecutiveLosses: number;
  consecutiveLossMax: number;
  consecutiveLossPaused: boolean;
  openPositions: number;
  openPositionsMax: number;
  cooldownActive: boolean;
  cooldownRemainingMs: number | null;
  cooldownLabel: string;
  emergencyStopActive: boolean;
  emergencyStopLabel: string;
  autoTradeLabel: string;
  dailyProfitTarget: number | null;
  dailyProfitTargetEnabled: boolean;
  dailyProfitTargetReached: boolean;
  profitProtectionEnabled: boolean;
  profitProtectionPaused: boolean;
  peakDailyPnl: number;
  protectedMinimumPnl: number | null;
  entriesBlocked: boolean;
  entriesBlockedReason: string | null;
  currency: string;
};

export type SystemHealthView = {
  marketFeed: { tone: string; label: string };
  strategyFeed: { tone: string; label: string };
  broker: { tone: string; label: string };
  autoTradeEngine: { tone: string; label: string };
  riskEngine: { tone: string; label: string };
  notifications: { tone: string; label: string };
  qualificationWorker: { tone: string; label: string };
  overall: string;
  plainSummary: string;
};

export interface CTraderDemonstrationBundle {
  banner: string;
  notice: string;
  autoTrade: "OFF";
  orderSubmissionEnabled: false;
  account: {
    accountIdMasked: string;
    currency: string;
    balance: number | null;
    equity: number | null;
    freeMargin: number | null;
    leverage: number | null;
    brokerName: string | null;
    brokerNameSource: string;
  };
  symbol: {
    symbolName: string;
    baseAsset: string | null;
    quoteAsset: string | null;
    minVolume: number | null;
    volumeStep: number | null;
    lotSize: number | null;
    metadataComplete: boolean;
  };
  quote: {
    bid: number | null;
    ask: number | null;
    spread: number | null;
    marketStatus: string;
    source: string;
  };
  buyPreview: {
    state: string;
    action: string;
    proposedVolume: number | null;
    riskAmount: number | null;
    failedGates: string[];
    passedGates: string[];
    label: string;
  };
  sellPreview: {
    state: string;
    action: string;
    proposedVolume: number | null;
    label: string;
  };
  blockedPreview: {
    state: string;
    failedGates: string[];
    label: string;
  };
}
