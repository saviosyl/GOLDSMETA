/**
 * Absolute server safety ceilings for Live AutoTrade preferences.
 * User-editable ranges must never be the only Live protection.
 * Live order submission remains hard-locked separately in flags.ts.
 */

export const LIVE_HARD_CAPS = {
  percentageRiskMax: 2,
  fixedRiskAmountMax: 500,
  manualLotSizeMax: 1,
  maxDailyLossMax: 2_000,
  maxTradesPerDayMax: 10,
  maxOpenPositionsMax: 2,
  maxPositionExposureLotsMax: 2,
  maxSlippageMax: 5,
  maxSpreadMax: 5
} as const;

export const DEMO_HARD_CAPS = {
  percentageRiskMax: 100,
  fixedRiskAmountMax: 10_000,
  manualLotSizeMax: 5_000,
  maxDailyLossMax: 100_000,
  maxTradesPerDayMax: 10,
  maxOpenPositionsMax: 3,
  maxPositionExposureLotsMax: 100,
  maxSlippageMax: 20,
  maxSpreadMax: 20
} as const;

export type RiskCapKey = keyof typeof LIVE_HARD_CAPS;

export function hardCapsFor(environment: "demo" | "live") {
  return environment === "live" ? LIVE_HARD_CAPS : DEMO_HARD_CAPS;
}

export function exceedsLiveHardCap(
  key: RiskCapKey,
  value: number | null | undefined
): boolean {
  if (value == null || !Number.isFinite(value)) return false;
  return value > LIVE_HARD_CAPS[key];
}
