/**
 * GOLD HUNTER Admin Tool — shared types.
 * DEMO_ONLY execution. Independent of Core Fast AutoTrade.
 */

export const GH_ADMIN_STRATEGY_ID = "GOLD_HUNTER" as const;
export const GH_ADMIN_EXECUTION_MODE = "DEMO_ONLY" as const;

export type GoldHunterMode = "RESEARCH" | "DEMO_AUTO" | "LIVE_LOCKED";

export type GoldHunterWaitReason =
  | "WAIT — MARKET CLOSED"
  | "WAIT — AUTOTRADE OFF"
  | "WAIT — FEED STALE"
  | "WAIT — DEPTH INVALID"
  | "WAIT — SPREAD TOO WIDE"
  | "WAIT — CAPITAL LIMIT"
  | "WAIT — DAILY LOSS LIMIT"
  | "WAIT — PROJECTED DAILY LOSS LIMIT"
  | "WAIT — DAILY RISK UNKNOWN"
  | "WAIT — MAX OPEN TRADES"
  | "WAIT — RUNTIME TIMEOUT"
  | "WAIT — DUPLICATE SIGNAL"
  | "WAIT — BROKER DISCONNECTED"
  | "WAIT — LIVE ENVIRONMENT REFUSED"
  | "WAIT — EMERGENCY STOP"
  | "WAIT — PAUSED"
  | "WAIT — NO SETUP SELECTED"
  | "WAIT — SIGNAL STALE"
  | "WAIT — UNAUTHORIZED"
  | "WAIT — CONFIG INVALID"
  | "WAIT — ACCOUNT SNAPSHOT INVALID"
  | "WAIT — ACCOUNT ENVIRONMENT UNKNOWN"
  | "WAIT — SIZING METADATA UNAVAILABLE"
  | "WAIT — PROTECTION GEOMETRY NOT CONNECTED"
  | "WAIT — COMMITTED CAPITAL UNKNOWN";

export type GoldHunterAdminConfig = {
  allocatedCapitalEur: number;
  riskPerTradePct: number;
  dailyLossLimitPct: number;
  maxOpenTrades: number;
  demoAutoTradeEnabled: boolean;
  pauseNewEntries: boolean;
  emergencyStopActive: boolean;
  mode: GoldHunterMode;
  updatedAt: string;
  updatedBy: string;
};

export const GH_ADMIN_DEFAULT_CONFIG: Omit<
  GoldHunterAdminConfig,
  "updatedAt" | "updatedBy"
> = {
  allocatedCapitalEur: 5000,
  riskPerTradePct: 1,
  dailyLossLimitPct: 5,
  maxOpenTrades: 1,
  demoAutoTradeEnabled: false,
  pauseNewEntries: false,
  emergencyStopActive: false,
  mode: "RESEARCH"
};

export const GH_ADMIN_ALLOCATION_PRESETS_EUR = [
  500, 1000, 2500, 5000, 10_000
] as const;

export type GoldHunterAuditEntry = {
  id: string;
  at: string;
  byUid: string;
  action: string;
  detail: string;
};

export type GoldHunterDemoTrade = {
  goldHunterTradeId: string;
  strategy: typeof GH_ADMIN_STRATEGY_ID;
  environment: "DEMO";
  setup: "A" | "B" | "C" | null;
  side: "BUY" | "SELL";
  signalTs: string | null;
  orderTs: string | null;
  fillTs: string | null;
  closeTs: string | null;
  entry: number | null;
  exit: number | null;
  stop: number | null;
  entrySpread: number | null;
  durationMs: number | null;
  mfe: number | null;
  mae: number | null;
  grossPnlEur: number | null;
  netPnlEur: number | null;
  /** Broker commission from closing deal aggregation (when settled). */
  commissionEur?: number | null;
  /** Broker swap from closing deal aggregation (when settled). */
  swapEur?: number | null;
  /** Broker closing deal id(s) when settled. */
  brokerDealId?: string | null;
  result: "WIN" | "LOSS" | "BREAKEVEN" | "OPEN" | null;
  exitReason: string | null;
  brokerOrderId: string | null;
  brokerPositionId: string | null;
  status:
    | "SIGNAL"
    | "ORDER_CREATED"
    | "SENT"
    | "FILLED"
    | "PROTECTED"
    | "CLOSE_REQUESTED"
    | "CLOSE_ACCEPTED_PENDING_SETTLEMENT"
    | "CLOSED"
    | "BROKER_REJECTED"
    | "BROKER_SUBMIT_ERROR"
    | "ACCEPTED_PENDING_FILL"
    | "PENDING_RECONCILIATION";
  signalId?: string | null;
  clientOrderId?: string | null;
  errorCode?: string | null;
  filledVolumeLots?: number | null;
  takeProfit?: number | null;
  /** Exit decision time (local strategy). */
  exitSignalTs?: string | null;
  /** Local close mutation request time. */
  closeRequestTs?: string | null;
  /** Broker accepted close / position proven absent. */
  closeAcceptedTs?: string | null;
  /** Authoritative closing-deal settlement time. */
  brokerSettlementTs?: string | null;
  /**
   * Additive diagnostic only — never invents P/L or fill prices.
   * Historical corrupt rows may be tagged without rewriting economics.
   */
  dataQuality?: "ENTRY_INVALID" | "MFE_MAE_CORRUPT" | null;
  /**
   * Forensic counters for ENTRY PENDING_RECONCILIATION watchdog.
   * Terminal never-found uses successfulEmptyProofCycles only.
   */
  entryReconcileEvidence?: {
    reconciliationAttempts: number;
    lastReconcileAt: string;
    lastBrokerReadOk: boolean;
    /** Complete empty-proof cycles in the SAME attempt (open+order+deal). */
    successfulEmptyProofCycles: number;
    firstSuccessfulEmptyProofAt: string | null;
    lastSuccessfulEmptyProofAt: string | null;
    /** Last history walk was exhaustive (hasMore fully resolved). */
    lastHistoryComplete?: boolean;
    terminalReason?: string | null;
    /** Legacy diagnostic counters (not used for terminal gating). */
    openPositionChecks?: number;
    orderHistoryChecks?: number;
    dealHistoryChecks?: number;
    firstReconcileAt?: string;
  } | null;
};

export type GoldHunterOrderGateResult = {
  ok: boolean;
  blockers: GoldHunterWaitReason[];
  executionMode: typeof GH_ADMIN_EXECUTION_MODE;
  liveExecutionEnabled: false;
};
