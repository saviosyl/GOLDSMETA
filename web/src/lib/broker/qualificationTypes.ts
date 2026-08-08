/** Mirrors backend QualificationPublicView — UI-only types. */

export type QualificationState =
  | "SETUP_REQUIRED"
  | "READY_TO_QUALIFY"
  | "PREVIEW_QUALIFICATION"
  | "CONTROLLED_DEMO_QUALIFICATION"
  | "OBSERVATION_PERIOD"
  | "DEMO_AUTO_READY"
  | "DEMO_AUTO_ENABLED"
  | "LIVE_QUALIFICATION"
  | "LIVE_AUTO_ELIGIBLE"
  | "LIVE_ACTIVATION_REQUIRED"
  | "LIVE_AUTO_ENABLED"
  | "PAUSED"
  | "BLOCKED";

export type QualificationBlocker = {
  id: string;
  label: string;
  ok: boolean;
  action?: string | null;
};

export type SafetyCheckRecord = {
  id: string;
  label: string;
  ok: boolean;
  source: "SYSTEM_CERTIFIED" | "ACCOUNT_EVENT";
  detail: string;
  verifiedAt: string | null;
};

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
  at: string;
  closedAt: string | null;
  direction: "BUY" | "SELL";
  status: "SUBMITTED" | "OPEN" | "CLOSED" | "REJECTED";
  pnl: number | null;
  counted: boolean;
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
  preview: { completed: number; required: number };
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
  demoAuto: { enabled: boolean; ready: boolean };
  liveOrders: "LOCKED";
  recentPreviews: QualificationPreviewRecord[];
  recentControlledTrades: ControlledDemoTradeRecord[];
  startedAt: string | null;
  updatedAt: string | null;
};
