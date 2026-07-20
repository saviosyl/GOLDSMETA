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
  trend: string;
  poc: number | null;
  vah: number | null;
  val: number | null;
}

export interface Decision {
  schemaVersion: string;
  decisionId: string;
  symbol: string;
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
  dataSourceLabel: DataSourceLabel;
  marketStructure?: MarketStructure | null;
  recommendedActions?: string[] | null;
  scenarioName?: string | null;
  safetyFlags?: string[] | null;
}

export interface BackendSettings {
  aiEnabled: boolean;
  notificationsEnabled: boolean;
  provisionalSignalsEnabled: boolean;
  riskProfile: "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
}

export interface JournalEntry {
  journalId?: string;
  id?: string;
  decisionId?: string | null;
  symbol: string;
  direction: DecisionAction;
  outcome: string;
  riskReward?: number | null;
  pnl?: number | null;
  notes?: string | null;
  createdAt?: string;
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
