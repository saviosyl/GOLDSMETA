import { decisionConfig } from "../../config/decisionConfig";
import type { DataQualityResult, MarketSnapshot } from "../../models/types";
import { isPositivePrice } from "../../utils/money";
import { evaluatePriceConsistency } from "./priceConsistency";

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

  const exchange = snapshot.exchange?.toUpperCase() ?? null;
  const fixtureExchange =
    exchange === "TEST_FIXTURE" || exchange === "MOCK" || exchange === "UI_REVIEW";
  const fixtureMeta =
    typeof snapshot.metadata?.fixtureLabel === "string" ||
    snapshot.metadata?.source === "goldmeta-api-test-fixture";
  const eventType =
    typeof snapshot.metadata?.eventType === "string"
      ? String(snapshot.metadata.eventType).toUpperCase()
      : null;
  const isTestEvent = eventType === "TEST";
  // Flag fixture provenance so LIVE consumers never treat it as broker live.
  if (fixtureExchange || fixtureMeta) {
    warnings.push("TEST_FIXTURE_EXCHANGE");
  }
  // Fixture OHLC/levels on a non-TEST alert is a production leak — conflict.
  if ((fixtureExchange || fixtureMeta) && !isTestEvent) {
    return {
      quality: "CONFLICTED",
      warnings: [
        "Fallback/test fixture values must not appear as LIVE market data.",
        "PRICE_SOURCE_MISMATCH",
        "TEST_FIXTURE_LEAK"
      ],
      missingInputs
    };
  }

  const profileForConsistency = resolveVolumeProfile(snapshot);
  const priceConsistency = evaluatePriceConsistency({
    symbol: snapshot.symbol,
    alertClose: snapshot.price,
    ohlc: snapshot.ohlcv,
    poc: profileForConsistency.poc,
    vah: profileForConsistency.vah,
    val: profileForConsistency.val,
    tolerance: decisionConfig.priceConsistencyTolerance
  });
  if (!priceConsistency.ok && priceConsistency.code === "PRICE_SOURCE_MISMATCH") {
    return {
      quality: "CONFLICTED",
      warnings: [priceConsistency.message, "PRICE_SOURCE_MISMATCH"],
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
    // Soft disagreement — 15M vs 5M direction conflict is a forming delay,
    // not corrupt / mismatched price-source data.
    warnings.push("SOFT_DISAGREEMENT");
    warnings.push("Trend and confirmation candle disagree — setup may still be forming");
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
