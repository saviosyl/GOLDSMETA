import type { AlertRole } from "../../models/types";
import type {
  GoldMetaStore,
  SharedMarketFeedRoleTraffic,
  SharedMarketFeedState
} from "../storage/types";
import { loadSharedFeedState, resolveSharedFeedUserId } from "./sharedFeed";

export const PLAN_15M_STALE_MS = 20 * 60 * 1000;
export const CONFIRM_5M_STALE_MS = 12 * 60 * 1000;
export const QUOTE_1M_STALE_MS = 3 * 60 * 1000;
export const LEGACY_MONITORING_WINDOW_MS = 24 * 60 * 60 * 1000;

export type MarketFeedStatus = "green" | "amber" | "red";
export type QuoteStatus = "live" | "limited" | "unknown";

export interface PublicMarketFeedHealth {
  status: MarketFeedStatus;
  title: string;
  subtitle: string;
  quoteStatus: QuoteStatus;
  lastVerifiedAt: string | null;
  lastVerifiedLabel: string | null;
}

interface RoleDiagnostic {
  role: AlertRole;
  received: boolean;
  healthy: boolean;
  stale: boolean;
  accepted: boolean;
  lastReceivedAt: string | null;
  schemaVersion: string | null;
  scriptVersion: string | null;
  timeframe: string | null;
  chartMatchesRole: boolean | null;
  planSourceKey: string | null;
  eventId: string | null;
  reasons: string[];
}

export interface AdminMarketFeedHealth extends PublicMarketFeedHealth {
  feedUserId: string;
  pineBridge3Detected: boolean;
  schema11Detected: boolean;
  plan15m: RoleDiagnostic;
  confirm5m: RoleDiagnostic;
  quote1m: RoleDiagnostic;
  chartMatchesRole: boolean | null;
  planSourceKey: string | null;
  confirmationSourceKeyMatch: boolean;
  latestAccepted: { at: string; role: AlertRole | null; eventId: string | null } | null;
  latestRejected: { at: string; reason: string | null } | null;
  sharedWebhookActive: boolean;
  noRecentLegacyTraffic: boolean;
  geometrySafetyGateOperational: true;
}

const ROLE_WINDOW_MS: Record<AlertRole, number> = {
  PLAN_15M: PLAN_15M_STALE_MS,
  CONFIRM_5M: CONFIRM_5M_STALE_MS,
  QUOTE_1M: QUOTE_1M_STALE_MS
};

const EXPECTED_TIMEFRAME: Record<AlertRole, string> = {
  PLAN_15M: "15",
  CONFIRM_5M: "5",
  QUOTE_1M: "1"
};

const isRecent = (iso: string | null | undefined, windowMs: number, nowMs: number): boolean => {
  if (!iso) return false;
  const at = Date.parse(iso);
  return Number.isFinite(at) && nowMs - at <= windowMs;
};

const isBridge3 = (traffic: SharedMarketFeedRoleTraffic | undefined): boolean =>
  traffic?.schemaVersion === "1.1" || /^3\./.test(traffic?.scriptVersion ?? "");

const roleDiagnostic = (
  role: AlertRole,
  traffic: SharedMarketFeedRoleTraffic | undefined,
  nowMs: number,
  matchingPlanSource = true
): RoleDiagnostic => {
  const reasons: string[] = [];
  if (!traffic) {
    reasons.push("MISSING");
  }
  if (traffic && !traffic.accepted) {
    reasons.push("LAST_TRAFFIC_REJECTED");
  }
  if (traffic && !isRecent(traffic.at, ROLE_WINDOW_MS[role], nowMs)) {
    reasons.push("STALE");
  }
  if (traffic && traffic.schemaVersion !== "1.1") {
    reasons.push("SCHEMA_NOT_1_1");
  }
  if (traffic && traffic.timeframe !== EXPECTED_TIMEFRAME[role]) {
    reasons.push("TIMEFRAME_MISMATCH");
  }
  if (traffic && traffic.chartMatchesRole !== true) {
    reasons.push("CHART_ROLE_MISMATCH");
  }
  if (!matchingPlanSource) {
    reasons.push("PLAN_SOURCE_KEY_MISMATCH");
  }

  const healthy = Boolean(
    traffic &&
      traffic.accepted &&
      isRecent(traffic.at, ROLE_WINDOW_MS[role], nowMs) &&
      traffic.schemaVersion === "1.1" &&
      traffic.timeframe === EXPECTED_TIMEFRAME[role] &&
      traffic.chartMatchesRole === true &&
      matchingPlanSource
  );

  return {
    role,
    received: Boolean(traffic),
    healthy,
    stale: traffic ? !isRecent(traffic.at, ROLE_WINDOW_MS[role], nowMs) : true,
    accepted: traffic?.accepted ?? false,
    lastReceivedAt: traffic?.at ?? null,
    schemaVersion: traffic?.schemaVersion ?? null,
    scriptVersion: traffic?.scriptVersion ?? null,
    timeframe: traffic?.timeframe ?? null,
    chartMatchesRole: traffic?.chartMatchesRole ?? null,
    planSourceKey: traffic?.planSourceKey ?? null,
    eventId: traffic?.eventId ?? null,
    reasons
  };
};

const latestAccepted = (
  state: SharedMarketFeedState | undefined
): { at: string; role: AlertRole | null; eventId: string | null } | null => {
  if (!state?.lastAcceptedAt) return null;
  let role: AlertRole | null = null;
  let eventId: string | null = null;
  for (const [candidateRole, traffic] of Object.entries(state.lastByRole) as Array<
    [AlertRole, SharedMarketFeedRoleTraffic | undefined]
  >) {
    if (traffic?.at === state.lastAcceptedAt) {
      role = candidateRole;
      eventId = traffic.eventId;
      break;
    }
  }
  return { at: state.lastAcceptedAt, role, eventId };
};

const lastVerified = (
  status: MarketFeedStatus,
  plan: RoleDiagnostic,
  confirm: RoleDiagnostic
): { at: string | null; label: string | null } => {
  if (status === "green") {
    return { at: confirm.lastReceivedAt ?? plan.lastReceivedAt, label: "Plan + 5M confirmation" };
  }
  if (status === "amber") {
    return { at: plan.lastReceivedAt, label: "15M plan verified" };
  }
  return { at: null, label: null };
};

const publicCopy = (
  status: MarketFeedStatus,
  quoteStatus: QuoteStatus,
  lastVerifiedAt: string | null,
  lastVerifiedLabel: string | null
): PublicMarketFeedHealth => {
  if (status === "green") {
    return {
      status,
      title: "Market feed operational",
      subtitle: "Shared XAUUSD plan and 5-minute confirmation are live.",
      quoteStatus,
      lastVerifiedAt,
      lastVerifiedLabel
    };
  }
  if (status === "amber") {
    return {
      status,
      title: "Market feed partially available",
      subtitle: "The 15-minute plan feed is live; 5-minute confirmation is missing or stale.",
      quoteStatus,
      lastVerifiedAt,
      lastVerifiedLabel
    };
  }
  return {
    status,
    title: "Market feed unavailable",
    subtitle: "No recent safe 15-minute shared plan feed has been verified.",
    quoteStatus,
    lastVerifiedAt,
    lastVerifiedLabel
  };
};

export const evaluateSharedFeedHealth = async (
  store: GoldMetaStore,
  options: { now?: number } = {}
): Promise<AdminMarketFeedHealth> => {
  const nowMs = options.now ?? Date.now();
  const state = await loadSharedFeedState(store);
  const planTraffic = state?.lastByRole.PLAN_15M;
  const confirmTraffic = state?.lastByRole.CONFIRM_5M;
  const quoteTraffic = state?.lastByRole.QUOTE_1M;
  const confirmationSourceKeyMatch = Boolean(
    planTraffic?.planSourceKey &&
      confirmTraffic?.planSourceKey &&
      planTraffic.planSourceKey === confirmTraffic.planSourceKey
  );
  const plan = roleDiagnostic("PLAN_15M", planTraffic, nowMs, true);
  const confirm = roleDiagnostic("CONFIRM_5M", confirmTraffic, nowMs, confirmationSourceKeyMatch);
  const quote = roleDiagnostic("QUOTE_1M", quoteTraffic, nowMs, true);

  const status: MarketFeedStatus = plan.healthy ? (confirm.healthy ? "green" : "amber") : "red";
  const quoteStatus: QuoteStatus = quote.healthy ? "live" : state ? "limited" : "unknown";
  const verified = lastVerified(status, plan, confirm);
  const publicHealth = publicCopy(status, quoteStatus, verified.at, verified.label);
  const allTraffic = [planTraffic, confirmTraffic, quoteTraffic].filter(Boolean);
  const feedUserId = state?.feedUserId ?? resolveSharedFeedUserId();
  const sharedWebhookActive =
    (await store.listWebhookConnections(feedUserId)).some((connection) => connection.status === "ACTIVE");
  const noRecentLegacyTraffic = !isRecent(
    state?.lastLegacyAt ?? null,
    LEGACY_MONITORING_WINDOW_MS,
    nowMs
  );

  return {
    ...publicHealth,
    feedUserId,
    pineBridge3Detected: allTraffic.some(isBridge3),
    schema11Detected: allTraffic.some((traffic) => traffic?.schemaVersion === "1.1"),
    plan15m: plan,
    confirm5m: confirm,
    quote1m: quote,
    chartMatchesRole: planTraffic?.chartMatchesRole ?? null,
    planSourceKey: planTraffic?.planSourceKey ?? null,
    confirmationSourceKeyMatch,
    latestAccepted: latestAccepted(state),
    latestRejected: state?.lastRejectedAt
      ? { at: state.lastRejectedAt, reason: state.lastRejectReason ?? null }
      : null,
    sharedWebhookActive,
    noRecentLegacyTraffic,
    geometrySafetyGateOperational: true
  };
};

export const publicMarketFeedHealth = (
  health: AdminMarketFeedHealth
): PublicMarketFeedHealth => ({
  status: health.status,
  title: health.title,
  subtitle: health.subtitle,
  quoteStatus: health.quoteStatus,
  lastVerifiedAt: health.lastVerifiedAt,
  lastVerifiedLabel: health.lastVerifiedLabel
});
