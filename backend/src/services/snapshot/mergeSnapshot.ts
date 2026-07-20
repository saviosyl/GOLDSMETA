import { createHash } from "crypto";
import type { MarketSnapshot, TradingViewPayload } from "../../models/types";
import { nowIso } from "../../utils/time";

export const mergeSnapshot = (
  payload: TradingViewPayload,
  stableEventId = payload.eventId
): MarketSnapshot => {
  const snapshotId = createHash("sha256")
    .update(`${stableEventId}|${payload.barTime}|${payload.timeframe}`)
    .digest("hex");

  return {
    id: snapshotId,
    sourceEventId: stableEventId,
    symbol: payload.symbol,
    timeframe: payload.timeframe,
    marketDataTime: payload.barTime,
    receivedAt: nowIso(),
    price: payload.ohlcv?.close ?? payload.confirmationCandle?.close ?? null,
    ohlcv: payload.ohlcv ?? null,
    levels: payload.levels ?? null,
    sessionVolumeProfile: payload.sessionVolumeProfile ?? null,
    marketProfile: payload.marketProfile ?? null,
    trend: payload.trend ?? null,
    confirmationCandle: payload.confirmationCandle ?? null,
    isConfirmedBar: payload.isConfirmedBar,
    metadata: payload.metadata ?? null
  };
};
