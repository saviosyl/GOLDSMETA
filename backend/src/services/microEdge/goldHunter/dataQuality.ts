/**
 * Historical invalid-tick audit — never hide skipped-data counts.
 */
import { GH_INVALID_PRICE_RATE_THRESHOLD } from "./config";
import type { GhDataQualityReport, GhTickAudit } from "./types";

export function emptyTickAudit(side: "BID" | "ASK"): GhTickAudit {
  return {
    side,
    totalWireTicks: 0,
    validTicks: 0,
    invalidPriceTicks: 0,
    outOfWindowTicks: 0,
    malformedTimestampTicks: 0
  };
}

export function finalizeDataQualityReport(
  bid: GhTickAudit,
  ask: GhTickAudit,
  threshold = GH_INVALID_PRICE_RATE_THRESHOLD
): GhDataQualityReport {
  const totalWire = bid.totalWireTicks + ask.totalWireTicks;
  const invalidPrice = bid.invalidPriceTicks + ask.invalidPriceTicks;
  const outOfWindow = bid.outOfWindowTicks + ask.outOfWindowTicks;
  const malformed =
    bid.malformedTimestampTicks + ask.malformedTimestampTicks;
  const invalidPriceRate = totalWire > 0 ? invalidPrice / totalWire : 0;
  const outOfWindowRate = totalWire > 0 ? outOfWindow / totalWire : 0;
  const structuralCorruption = totalWire > 0 && malformed / totalWire > 0.05;
  const failed =
    structuralCorruption || invalidPriceRate > threshold;
  return {
    bid,
    ask,
    invalidPriceRate,
    outOfWindowRate,
    datasetStatus: failed ? "DATA_QUALITY_FAILED" : "OK",
    invalidPriceRateThreshold: threshold
  };
}
