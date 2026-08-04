import { createHash } from "crypto";
import type { TradingViewPayload } from "../../models/types";

/**
 * Deterministic processing id. Includes alertRole/alertKind when present so
 * PLAN_15M / CONFIRM_5M / QUOTE_1M on overlapping windows do not collide.
 */
export const buildStableEventId = (payload: TradingViewPayload): string => {
  const meta = payload.metadata ?? {};
  const role =
    typeof meta.alertRole === "string"
      ? meta.alertRole
      : typeof meta.alertKind === "string"
        ? meta.alertKind
        : "UNKNOWN";
  const material = [
    payload.source,
    payload.symbol,
    payload.timeframe,
    payload.barTime,
    payload.indicatorName ?? "primary",
    payload.eventType,
    role
  ].join("|");

  return createHash("sha256").update(material).digest("hex");
};
