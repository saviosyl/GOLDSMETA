/**
 * GoldMeta V6.0 AutoTrade — shared types and first-pilot defaults.
 * LIVE execution is blocked by server feature flag until Savio enables it.
 */

export const AUTOTRADE_STRATEGY_VERSION = "v6.0.0-pilot";

/** Server-side kill switch — must stay false for this preview release. */
export const LIVE_EXECUTION_FEATURE_FLAG = false;

export type AutoTradeMode = "OFF" | "SHADOW" | "IG_DEMO_AUTO" | "IG_LIVE_AUTO";

export type AutoTradeDisplayStatus =
  | "OFF"
  | "SHADOW"
  | "DEMO"
  | "LIVE"
  | "LOCKED";

export type BrokerEnvironment = "DEMO" | "LIVE";

export type StopProtectionMode =
  | "GUARANTEED_REQUIRED"
  | "GUARANTEED_PREFERRED"
  | "NORMAL_ALLOWED";

export type TradeIntentState =
  | "CREATED"
  | "ELIGIBILITY_CHECK"
  | "RISK_CHECK"
  | "APPROVED"
  | "SUBMITTING"
  | "CONFIRMING"
  | "ACCEPTED"
  | "REJECTED"
  | "OPEN"
  | "CLOSING"
  | "CLOSED"
  | "RECONCILIATION_REQUIRED"
  | "BLOCKED";

export type TradingSessionId =
  | "LONDON"
  | "NEW_YORK"
  | "LONDON_NY_OVERLAP"
  | "CUSTOM";

export interface AutoTradeRiskLimits {
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
  /** null until IG instrument rules are known */
  maxSpread: number | null;
  stopProtection: StopProtectionMode;
  allowedSessions: TradingSessionId[];
  currency: "EUR";
}

export interface AutoTradeRiskState {
  userId: string;
  mode: AutoTradeMode;
  locked: boolean;
  lockReason: string | null;
  emergencyStopActive: boolean;
  dailyRealisedPnl: number;
  dailyUnrealisedPnl: number;
  weeklyRealisedPnl: number;
  weeklyUnrealisedPnl: number;
  tradesUsedToday: number;
  consecutiveLosses: number;
  lastLossAt: string | null;
  dayKey: string;
  weekKey: string;
  updatedAt: string;
}

export interface AutoTradeConnectionStatus {
  connected: boolean;
  environment: BrokerEnvironment | null;
  accountIdMasked: string | null;
  accountName: string | null;
  currency: string | null;
  balance: number | null;
  available: number | null;
  marginUsed: number | null;
  marketStatus: "OPEN" | "CLOSED" | "TRADEABLE" | "UNKNOWN" | null;
  marketEpic: string | null;
  marketName: string | null;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  minDealSize: number | null;
  sizeIncrement: number | null;
  valuePerPoint: number | null;
  lastHeartbeatAt: string | null;
}

export interface AutoTradeSettings {
  userId: string;
  limits: AutoTradeRiskLimits;
  updatedAt: string;
}

export interface TradeIntent {
  intentId: string;
  userId: string;
  decisionId: string;
  accountId: string;
  environment: BrokerEnvironment;
  mode: AutoTradeMode;
  strategyVersion: string;
  state: TradeIntentState;
  direction: "BUY" | "SELL" | null;
  size: number | null;
  entry: number | null;
  stop: number | null;
  takeProfit: number | null;
  monetaryRisk: number | null;
  score: number | null;
  rejectionReason: string | null;
  dealReference: string | null;
  dealId: string | null;
  limitsSnapshot: AutoTradeRiskLimits;
  createdAt: string;
  updatedAt: string;
  history: Array<{ state: TradeIntentState; at: string; reason: string }>;
}

export interface BrokerExecutionRecord {
  executionId: string;
  intentId: string;
  userId: string;
  dealReference: string;
  dealId: string | null;
  accepted: boolean;
  status: string;
  reason: string | null;
  requestRedacted: Record<string, unknown>;
  responseRedacted: Record<string, unknown>;
  createdAt: string;
}

export interface AutoTradePositionView {
  positionId: string;
  environment: BrokerEnvironment;
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
  protectionStatus: "GUARANTEED" | "NORMAL" | "MISSING" | "UNKNOWN";
  openedAt: string;
}

export interface AutoTradeActivityEntry {
  id: string;
  at: string;
  message: string;
  level: "info" | "warn" | "error" | "success";
  technical?: Record<string, unknown>;
}

export interface AutoTradeAuditEntry {
  id: string;
  userId: string;
  at: string;
  action: string;
  detail: Record<string, unknown>;
}

export interface AutoTradeBudgetView {
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
}

export interface AutoTradeStatusPayload {
  displayStatus: AutoTradeDisplayStatus;
  mode: AutoTradeMode;
  locked: boolean;
  lockReason: string | null;
  emergencyStopActive: boolean;
  liveExecutionFeatureEnabled: boolean;
  connection: AutoTradeConnectionStatus;
  limits: AutoTradeRiskLimits;
  budget: AutoTradeBudgetView;
  positions: AutoTradePositionView[];
  activity: AutoTradeActivityEntry[];
  strategyVersion: string;
}

/** First live pilot defaults (EUR). Mode always starts OFF. */
export const FIRST_PILOT_LIMITS: AutoTradeRiskLimits = {
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
  maxSpread: null,
  stopProtection: "GUARANTEED_REQUIRED",
  allowedSessions: ["LONDON", "NEW_YORK", "LONDON_NY_OVERLAP"],
  currency: "EUR"
};

export function displayStatusFor(
  mode: AutoTradeMode,
  locked: boolean
): AutoTradeDisplayStatus {
  if (locked) return "LOCKED";
  if (mode === "OFF") return "OFF";
  if (mode === "SHADOW") return "SHADOW";
  if (mode === "IG_DEMO_AUTO") return "DEMO";
  return "LIVE";
}

export function dayKeyUtc(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function weekKeyUtc(d = new Date()): string {
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function maskAccountId(id: string | null | undefined): string | null {
  if (!id) return null;
  if (id.length <= 4) return "****";
  return `${"*".repeat(Math.max(0, id.length - 4))}${id.slice(-4)}`;
}

export function buildDealReference(args: {
  decisionId: string;
  accountId: string;
  strategyVersion: string;
  environment: BrokerEnvironment;
}): string {
  const raw = [
    args.decisionId,
    args.accountId,
    args.strategyVersion,
    args.environment
  ].join("|");
  // Deterministic, URL/deal-ref safe
  return `GM-${Buffer.from(raw).toString("base64url").slice(0, 48)}`;
}
