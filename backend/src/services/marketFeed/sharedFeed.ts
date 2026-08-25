import type { AlertRole, TradingViewPayload } from "../../models/types";
import { nowIso } from "../../utils/time";
import {
  extractPlanSourceKey,
  metadataBool,
  metadataString,
  normalizePlanSourceKey,
  resolveAlertRole
} from "../decision/alertRole";
import type {
  GoldMetaStore,
  SharedMarketFeedRoleTraffic,
  SharedMarketFeedState
} from "../storage/types";

const SHARED_FEED_TEST_UID = "shared-market-feed";
const ROLE_SET = new Set<AlertRole>(["PLAN_15M", "CONFIRM_5M", "QUOTE_1M"]);

let memoryState: SharedMarketFeedState | undefined;

export const resolveSharedFeedUserId = (): string =>
  process.env.GOLDMETA_PINNED_OWNER_UID?.trim() ||
  process.env.GOLDMETA_SHARED_FEED_UID?.trim() ||
  (process.env.APP_ENV === "test" || process.env.NODE_ENV === "test"
    ? SHARED_FEED_TEST_UID
    : "shared-market-feed");

export const isSharedFeedSourceUser = (userId: string): boolean =>
  userId.trim() === resolveSharedFeedUserId();

const emptyState = (feedUserId = resolveSharedFeedUserId()): SharedMarketFeedState => ({
  feedUserId,
  webhookId: null,
  lastByRole: {},
  lastAcceptedAt: null,
  lastRejectedAt: null,
  lastRejectReason: null,
  lastLegacyAt: null,
  updatedAt: nowIso()
});

const newerState = (
  left: SharedMarketFeedState | undefined,
  right: SharedMarketFeedState | undefined
): SharedMarketFeedState | undefined => {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(right.updatedAt) > Date.parse(left.updatedAt) ? right : left;
};

const redactWebhookId = (webhookId: string | undefined | null): string | null => {
  if (!webhookId) return null;
  if (webhookId.length <= 10) return `${webhookId.slice(0, 2)}...`;
  return `${webhookId.slice(0, 6)}...${webhookId.slice(-4)}`;
};

const isRole = (role: string): role is AlertRole => ROLE_SET.has(role as AlertRole);

const isLegacyPayload = (payload: TradingViewPayload): boolean => {
  const role = resolveAlertRole(payload);
  const scriptVersion = metadataString(payload, "scriptVersion");
  return role === "LEGACY_STRATEGY" || role === "LEGACY_QUOTE" || /^2\./.test(scriptVersion ?? "");
};

export interface RecordSharedFeedAcceptedInput {
  store: GoldMetaStore;
  userId: string;
  webhookId?: string;
  payload: TradingViewPayload;
  eventId: string;
  at?: string;
}

export interface RecordSharedFeedRejectedInput {
  store: GoldMetaStore;
  userId: string;
  webhookId?: string;
  reason: string;
  payload?: unknown;
  eventId?: string | null;
  at?: string;
}

const payloadRecordString = (payload: unknown, key: string): string | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const metadata = (payload as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

const payloadRecordBool = (payload: unknown, key: string): boolean | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const metadata = (payload as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : null;
};

const rawString = (payload: unknown, key: string): string | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

const acceptedTraffic = (
  payload: TradingViewPayload,
  eventId: string,
  at: string
): SharedMarketFeedRoleTraffic => ({
  at,
  schemaVersion: payload.schemaVersion,
  scriptVersion: metadataString(payload, "scriptVersion"),
  timeframe: payload.timeframe,
  chartMatchesRole: metadataBool(payload, "chartMatchesRole"),
  planSourceKey: extractPlanSourceKey(payload),
  accepted: true,
  eventId
});

const rejectedTraffic = (
  payload: unknown,
  eventId: string | null,
  at: string
): SharedMarketFeedRoleTraffic => ({
  at,
  schemaVersion: rawString(payload, "schemaVersion") ?? "unknown",
  scriptVersion: payloadRecordString(payload, "scriptVersion"),
  timeframe: rawString(payload, "timeframe"),
  chartMatchesRole: payloadRecordBool(payload, "chartMatchesRole"),
  planSourceKey: normalizePlanSourceKey(payloadRecordString(payload, "planSourceKey")),
  accepted: false,
  eventId
});

export const loadSharedFeedState = async (
  store?: GoldMetaStore
): Promise<SharedMarketFeedState | undefined> => {
  const persistent = store?.getSharedMarketFeedState
    ? await store.getSharedMarketFeedState()
    : undefined;
  const selected = newerState(memoryState, persistent);
  if (selected) {
    memoryState = selected;
  }
  return selected;
};

const persistState = async (
  store: GoldMetaStore,
  state: SharedMarketFeedState
): Promise<SharedMarketFeedState> => {
  memoryState = JSON.parse(JSON.stringify(state)) as SharedMarketFeedState;
  if (store.saveSharedMarketFeedState) {
    await store.saveSharedMarketFeedState(memoryState);
  }
  return memoryState;
};

export const recordSharedFeedAccepted = async (
  input: RecordSharedFeedAcceptedInput
): Promise<SharedMarketFeedState | undefined> => {
  if (!isSharedFeedSourceUser(input.userId)) {
    return undefined;
  }
  const at = input.at ?? nowIso();
  const state = {
    ...emptyState(input.userId),
    ...((await loadSharedFeedState(input.store)) ?? {}),
    feedUserId: input.userId,
    webhookId: redactWebhookId(input.webhookId),
    lastAcceptedAt: at,
    updatedAt: at
  };
  const role = resolveAlertRole(input.payload);
  if (isRole(role)) {
    state.lastByRole = {
      ...state.lastByRole,
      [role]: acceptedTraffic(input.payload, input.eventId, at)
    };
  }
  if (isLegacyPayload(input.payload)) {
    state.lastLegacyAt = at;
  }
  return persistState(input.store, state);
};

export const recordSharedFeedRejected = async (
  input: RecordSharedFeedRejectedInput
): Promise<SharedMarketFeedState | undefined> => {
  if (!isSharedFeedSourceUser(input.userId)) {
    return undefined;
  }
  const at = input.at ?? nowIso();
  const state = {
    ...emptyState(input.userId),
    ...((await loadSharedFeedState(input.store)) ?? {}),
    feedUserId: input.userId,
    webhookId: redactWebhookId(input.webhookId),
    lastRejectedAt: at,
    lastRejectReason: input.reason,
    updatedAt: at
  };
  const role = payloadRecordString(input.payload, "alertRole");
  if (role && isRole(role)) {
    state.lastByRole = {
      ...state.lastByRole,
      [role]: rejectedTraffic(input.payload, input.eventId ?? null, at)
    };
  }
  const scriptVersion = payloadRecordString(input.payload, "scriptVersion");
  const alertKind = payloadRecordString(input.payload, "alertKind");
  if (/^2\./.test(scriptVersion ?? "") || alertKind === "STRATEGY" || alertKind === "QUOTE") {
    state.lastLegacyAt = at;
  }
  return persistState(input.store, state);
};

export const __resetSharedFeedMemoryForTests = (): void => {
  memoryState = undefined;
};

export const __setSharedFeedMemoryForTests = (state: SharedMarketFeedState | undefined): void => {
  memoryState = state;
};
