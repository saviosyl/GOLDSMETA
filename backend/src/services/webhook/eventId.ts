import { createHash } from "crypto";
import type { TradingViewPayload } from "../../models/types";

export const buildStableEventId = (payload: TradingViewPayload): string => {
  const material = [
    payload.source,
    payload.symbol,
    payload.timeframe,
    payload.barTime,
    payload.indicatorName ?? "primary",
    payload.eventType
  ].join("|");

  return createHash("sha256").update(material).digest("hex");
};
