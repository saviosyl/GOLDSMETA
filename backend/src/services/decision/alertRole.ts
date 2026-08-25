/**
 * Resolve Pine Bridge alert role for 2.1.0 (alertKind) and 3.0.0 (alertRole).
 */

import type { AlertKind, AlertRole, TradingViewPayload } from "../../models/types";

export type ResolvedAlertRole = AlertRole | "LEGACY_STRATEGY" | "LEGACY_QUOTE" | "UNKNOWN";

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const asBool = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

export const metadataString = (payload: TradingViewPayload, key: string): string | null =>
  asString(payload.metadata?.[key]);

export const metadataBool = (payload: TradingViewPayload, key: string): boolean | null =>
  asBool(payload.metadata?.[key]);

/**
 * Canonical key format:
 *   EXCHANGE:SYMBOL|SESSION|PLAN_CLOSE_MS|PLAN_15M
 * Normalization is strict but non-destructive: trim + uppercase + pipe-segment cleanup.
 */
export const normalizePlanSourceKey = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const cleaned = raw
    .split("|")
    .map((segment) => segment.trim().replace(/\s+/g, ""))
    .filter((segment) => segment.length > 0)
    .join("|")
    .toUpperCase();
  return cleaned.length > 0 ? cleaned : null;
};

export type ParsedPlanSourceKey = {
  normalized: string;
  market: string | null;
  exchange: string | null;
  symbol: string | null;
  session: string | null;
  planCloseTimeMs: number | null;
  role: string | null;
};

export const parsePlanSourceKey = (
  raw: string | null | undefined
): ParsedPlanSourceKey | null => {
  const normalized = normalizePlanSourceKey(raw);
  if (!normalized) return null;
  const parts = normalized.split("|");
  const market = parts[0] ?? null;
  const session = parts[1] ?? null;
  const closeRaw = parts[2] ?? null;
  const role = parts[3] ?? null;

  let exchange: string | null = null;
  let symbol: string | null = null;
  if (market) {
    const [maybeExchange, maybeSymbol] = market.split(":");
    if (maybeSymbol) {
      exchange = maybeExchange || null;
      symbol = maybeSymbol || null;
    } else {
      symbol = maybeExchange || null;
    }
  }

  const planCloseTimeMs =
    closeRaw && /^\d{10,16}$/.test(closeRaw) ? Number.parseInt(closeRaw, 10) : null;

  return {
    normalized,
    market,
    exchange,
    symbol,
    session,
    planCloseTimeMs: Number.isFinite(planCloseTimeMs) ? planCloseTimeMs : null,
    role
  };
};

export const resolveAlertKind = (payload: TradingViewPayload): AlertKind | null => {
  const kind = metadataString(payload, "alertKind");
  if (kind === "STRATEGY" || kind === "QUOTE") return kind;
  return null;
};

export const resolveAlertRole = (payload: TradingViewPayload): ResolvedAlertRole => {
  const role = metadataString(payload, "alertRole");
  if (role === "PLAN_15M" || role === "CONFIRM_5M" || role === "QUOTE_1M") {
    return role;
  }

  const kind = resolveAlertKind(payload);
  if (kind === "QUOTE" || metadataBool(payload, "quoteOnly") === true) {
    return "LEGACY_QUOTE";
  }
  if (kind === "STRATEGY") {
    return "LEGACY_STRATEGY";
  }

  // Infer from timeframe + event shape when metadata is sparse.
  if (payload.timeframe === "1" && payload.eventType === "BAR_UPDATE") {
    return "LEGACY_QUOTE";
  }
  if (payload.timeframe === "15" && payload.isConfirmedBar) {
    return "LEGACY_STRATEGY";
  }
  return "UNKNOWN";
};

/** True when this alert may create/replace a stable session plan. */
export const isPlanSourceAlert = (role: ResolvedAlertRole): boolean =>
  role === "PLAN_15M" || role === "LEGACY_STRATEGY";

/** True when this alert may only update confirmation status (never levels). */
export const isConfirmAlert = (role: ResolvedAlertRole): boolean => role === "CONFIRM_5M";

/** True when this alert may only refresh price/distances/freshness. */
export const isQuoteAlert = (role: ResolvedAlertRole): boolean =>
  role === "QUOTE_1M" || role === "LEGACY_QUOTE";

export const extractPlanSourceKey = (payload: TradingViewPayload): string | null =>
  normalizePlanSourceKey(metadataString(payload, "planSourceKey"));

export const extractConfirmationState = (payload: TradingViewPayload): string | null =>
  metadataString(payload, "confirmationState");

export const extractFourHourContext = (
  payload: TradingViewPayload
): Record<string, unknown> | null => {
  const fromOptional = payload.optionalIndicators?.fourHourContext;
  if (fromOptional && typeof fromOptional === "object" && !Array.isArray(fromOptional)) {
    return fromOptional as Record<string, unknown>;
  }
  const fromMeta = payload.metadata?.fourHourContext;
  if (fromMeta && typeof fromMeta === "object" && !Array.isArray(fromMeta)) {
    return fromMeta as Record<string, unknown>;
  }
  return null;
};
