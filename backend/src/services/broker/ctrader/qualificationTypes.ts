/**
 * Persistent AutoTrade qualification state machine types.
 * Per-user + per Demo account. Never shared across UIDs or accounts.
 */

export const QUALIFICATION_STATES = [
  "SETUP_REQUIRED",
  "READY_TO_QUALIFY",
  "PREVIEW_QUALIFICATION",
  "CONTROLLED_DEMO_QUALIFICATION",
  "OBSERVATION_PERIOD",
  "DEMO_AUTO_READY",
  "DEMO_AUTO_ENABLED",
  "LIVE_QUALIFICATION",
  "LIVE_AUTO_ELIGIBLE",
  "LIVE_ACTIVATION_REQUIRED",
  "LIVE_AUTO_ENABLED",
  "PAUSED",
  "BLOCKED"
] as const;

export type QualificationState = (typeof QUALIFICATION_STATES)[number];

export const QUALIFICATION_GATES = {
  requiredPreviews: 20,
  requiredControlledTrades: 5,
  requiredObservationDays: 7,
  requiredDemoAutoTrades: 20,
  requiredLiveObservationDays: 7,
  requiredSafetyChecks: 6
} as const;

export type QualificationPreviewRecord = {
  id: string;
  signalId: string;
  at: string;
  direction: "BUY" | "SELL";
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  confidence: number | null;
  riskResult: "PASS" | "BLOCK";
  status: "PASSED";
};

export type ControlledDemoTradeRecord = {
  id: string;
  correlationId: string;
  signalId: string;
  at: string;
  closedAt: string | null;
  direction: "BUY" | "SELL";
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  lots: number | null;
  brokerOrderId: string | null;
  brokerPositionId: string | null;
  ctidTraderAccountId?: string | null;
  traderLogin?: string | null;
  symbol?: string | null;
  requestedVolumeLots?: number | null;
  filledVolumeLots?: number | null;
  requestedEntry?: number | null;
  fillPrice?: number | null;
  brokerStopLoss?: number | null;
  brokerTakeProfit?: number | null;
  openTimestamp?: string | null;
  status: "SUBMITTED" | "OPEN" | "CLOSED" | "REJECTED";
  pnl: number | null;
  counted: boolean;
  rejectionReason?: string | null;
  grossPnl?: number | null;
  commission?: number | null;
  swap?: number | null;
  netPnl?: number | null;
  closePrice?: number | null;
  closeReason?: string | null;
  brokerDealId?: string | null;
};

export type DemoAutoTradeRecord = {
  id: string;
  correlationId: string;
  signalId: string;
  at: string;
  closedAt: string | null;
  direction: "BUY" | "SELL";
  status: "SUBMITTED" | "OPEN" | "CLOSED" | "REJECTED";
  pnl: number | null;
  counted: boolean;
  /** Authoritative broker linkage — required after successful Demo fill. */
  brokerOrderId?: string | null;
  brokerPositionId?: string | null;
  /** Open API ctidTraderAccountId used for Auth/orders. */
  ctidTraderAccountId?: string | null;
  /** Pepperstone/Spotware trader login (UI / push notification account). */
  traderLogin?: string | null;
  symbol?: string | null;
  requestedVolumeLots?: number | null;
  filledVolumeLots?: number | null;
  requestedEntry?: number | null;
  fillPrice?: number | null;
  brokerStopLoss?: number | null;
  brokerTakeProfit?: number | null;
  openTimestamp?: string | null;
  entry?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  lots?: number | null;
  /** Broker close accounting (idempotent). */
  grossPnl?: number | null;
  commission?: number | null;
  swap?: number | null;
  netPnl?: number | null;
  closePrice?: number | null;
  closeReason?: string | null;
  brokerDealId?: string | null;
};

export type SafetyCheckId =
  | "emergency_stop"
  | "daily_loss_lock"
  | "duplicate_order_protection"
  | "restart_recovery"
  | "stale_quote_spread_guards"
  | "sl_risk_sizing";

export type SafetyCheckRecord = {
  id: SafetyCheckId;
  label: string;
  ok: boolean;
  source: "SYSTEM_CERTIFIED" | "ACCOUNT_EVENT";
  detail: string;
  verifiedAt: string | null;
};

export type QualificationTransition = {
  at: string;
  from: QualificationState;
  to: QualificationState;
  reason: string;
  buildSha: string | null;
};

export type QualificationDocument = {
  uid: string;
  accountId: string;
  accountMasked: string | null;
  environment: "DEMO";
  state: QualificationState;
  /** State before PAUSED — resume returns here. */
  pausedFrom: QualificationState | null;
  startedAt: string | null;
  updatedAt: string;
  previewCount: number;
  previewSignalIds: string[];
  previews: QualificationPreviewRecord[];
  controlledTradeCount: number;
  controlledBlockedAttempts: number;
  controlledOpenCount: number;
  controlledTrades: ControlledDemoTradeRecord[];
  firstControlledDemoTradeAt: string | null;
  demoAutoEnabledAt: string | null;
  firstDemoAutoTradeAt: string | null;
  demoAutoTradeCount: number;
  demoAutoTrades: DemoAutoTradeRecord[];
  criticalSafetyFailures: number;
  safetyChecks: SafetyCheckRecord[];
  transitions: QualificationTransition[];
  lastError: string | null;
  buildSha: string | null;
};

export type QualificationBlocker = {
  id: string;
  label: string;
  ok: boolean;
  action?: string | null;
};

export type QualificationPublicView = {
  state: QualificationState;
  overallLabel: string;
  accountMasked: string | null;
  accountIdPresent: boolean;
  environment: "DEMO";
  nextAction: string;
  nextRequirement: string;
  blockers: QualificationBlocker[];
  canStart: boolean;
  canPause: boolean;
  canResume: boolean;
  canEnableDemoAuto: boolean;
  canBeginLiveActivation: boolean;
  preview: {
    completed: number;
    required: number;
  };
  controlledDemo: {
    completed: number;
    required: number;
    open: number;
    blockedAttempts: number;
  };
  observation: {
    day: number | null;
    requiredDays: number;
    firstTradeAt: string | null;
    remainingMs: number | null;
  };
  safety: {
    completed: number;
    required: number;
    checks: SafetyCheckRecord[];
  };
  liveEligibility: {
    demoAutoTrades: number;
    requiredTrades: number;
    observationDay: number | null;
    requiredDays: number;
    criticalSafetyFailures: number;
    status: "LOCKED" | "QUALIFYING" | "ELIGIBLE" | "ACTIVATION_REQUIRED" | "ENABLED";
  };
  demoAuto: {
    enabled: boolean;
    ready: boolean;
  };
  liveOrders: "LOCKED";
  recentPreviews: QualificationPreviewRecord[];
  recentControlledTrades: ControlledDemoTradeRecord[];
  /** Today's qualification evaluation activity (server-side). */
  todayActivity: {
    evaluated: number;
    qualified: number;
    rejected: number;
  };
  recentEvaluations: Array<{
    at: string;
    direction: string;
    outcome: string;
    reasonCode?: string;
    reasonLabel: string;
    finalReason?: string | null;
    confidence: number | null;
    spread: number | null;
    maxSpread: number | null;
    riskReward: number | null;
    passed: string[];
    failed: string[];
  }>;
  startedAt: string | null;
  updatedAt: string | null;
};
