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

const resolveVolumeProfile = (
  snapshot: MarketSnapshot
): { poc: number | null; vah: number | null; val: number | null } => {
  const poc = snapshot.levels?.pocAll ?? snapshot.sessionVolumeProfile?.poc ?? null;
  const vah = snapshot.levels?.vahAll ?? snapshot.sessionVolumeProfile?.vah ?? null;
  const val = snapshot.levels?.valAll ?? snapshot.sessionVolumeProfile?.val ?? null;
  return {
    poc: isPositivePrice(poc) ? poc : null,
    vah: isPositivePrice(vah) ? vah : null,
    val: isPositivePrice(val) ? val : null
  };
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

  const profile = resolveVolumeProfile(snapshot);
  if (profile.poc === null || profile.vah === null || profile.val === null) {
    missingInputs.push("volumeProfile");
  }
  if (!snapshot.trend?.direction) {
    missingInputs.push("trend.direction");
  }
  if (typeof snapshot.trend?.strength !== "number") {
    missingInputs.push("trend.strength");
  }
  if (!snapshot.confirmationCandle?.confirmed || !snapshot.confirmationCandle?.direction) {
    missingInputs.push("confirmationCandle");
  }
  if (
    !snapshot.ohlcv ||
    !isPositivePrice(snapshot.ohlcv.open) ||
    !isPositivePrice(snapshot.ohlcv.high) ||
    !isPositivePrice(snapshot.ohlcv.low) ||
    !isPositivePrice(snapshot.ohlcv.close)
  ) {
    missingInputs.push("ohlcv");
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
