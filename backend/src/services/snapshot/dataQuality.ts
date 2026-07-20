import { decisionConfig } from "../../config/decisionConfig";
import type { DataQualityResult, MarketSnapshot } from "../../models/types";
import { isPositivePrice } from "../../utils/money";

const hasImpossiblePrice = (snapshot: MarketSnapshot): boolean => {
  const prices = [
    snapshot.price,
    snapshot.ohlcv?.open,
    snapshot.ohlcv?.high,
    snapshot.ohlcv?.low,
    snapshot.ohlcv?.close,
    snapshot.levels?.pocAll,
    snapshot.levels?.vahAll,
    snapshot.levels?.valAll,
    snapshot.sessionVolumeProfile?.poc,
    snapshot.sessionVolumeProfile?.vah,
    snapshot.sessionVolumeProfile?.val
  ].filter((price): price is number => typeof price === "number");

  return prices.some((price) => !Number.isFinite(price) || price <= 0);
};

const hasDirectionalConflict = (snapshot: MarketSnapshot): boolean => {
  const trend = snapshot.trend?.direction;
  const candle = snapshot.confirmationCandle?.direction;
  if (!trend || !candle || trend === "NEUTRAL" || candle === "NEUTRAL") {
    return false;
  }
  return trend !== candle;
};

export const evaluateDataQuality = (
  snapshot: MarketSnapshot,
  now = Date.now()
): DataQualityResult => {
  const warnings: string[] = [];
  const missingInputs: string[] = [];

  if (!isPositivePrice(snapshot.price)) {
    missingInputs.push("price");
    return {
      quality: "INVALID",
      warnings: ["Missing or invalid last known price"],
      missingInputs
    };
  }

  if (hasImpossiblePrice(snapshot)) {
    return {
      quality: "INVALID",
      warnings: ["Payload contains impossible prices"],
      missingInputs
    };
  }

  const marketDataTime = new Date(snapshot.marketDataTime).getTime();
  if (!Number.isFinite(marketDataTime) || now - marketDataTime > decisionConfig.thresholds.staleAfterMs) {
    return {
      quality: "STALE",
      warnings: ["Market data is stale"],
      missingInputs
    };
  }

  if (hasDirectionalConflict(snapshot)) {
    return {
      quality: "CONFLICTED",
      warnings: ["Trend and confirmation candle conflict"],
      missingInputs
    };
  }

  if (!snapshot.trend?.direction) {
    missingInputs.push("trend.direction");
  }
  if (!snapshot.confirmationCandle?.direction) {
    missingInputs.push("confirmationCandle.direction");
  }
  if (!snapshot.levels && !snapshot.sessionVolumeProfile && !snapshot.marketProfile) {
    missingInputs.push("market levels");
  }

  if (!snapshot.isConfirmedBar) {
    warnings.push("Signal is provisional");
  }

  if (missingInputs.length > 0 || warnings.length > 0) {
    return {
      quality: "PARTIAL",
      warnings,
      missingInputs
    };
  }

  return {
    quality: "GOOD",
    warnings,
    missingInputs
  };
};
