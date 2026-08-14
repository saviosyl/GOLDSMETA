/**
 * Centralised FAST_AUTOTRADE_V1 tunables.
 *
 * Defaults are starting calibration for Demo testing — not claimed optimal.
 * Invalid env values fail closed to these defaults.
 *
 * Grade bands:
 *   A+  88–100  very strong
 *   A   78–87   good trade
 *   B+  70–77   allowed mainly in FAST when core criteria are strong
 *   <70 WAIT
 */

import { FAST_AUTOTRADE_STRATEGY_ID } from "./types";

export type FastAutoTradeConfig = {
  strategyId: typeof FAST_AUTOTRADE_STRATEGY_ID;
  /** Range/price ratio that helps classify FAST (XAUUSD ~0.08%+). */
  fastRegimeRangePct: number;
  /** Close-to-open / range efficiency for FAST. */
  fastRegimeEfficiency: number;
  /** Efficiency at or below this is CHOP. */
  chopEfficiencyMax: number;
  /** Quiet range/price ceiling. */
  quietRangePct: number;
  /** Candle range vs ATR above this is DANGEROUS. */
  dangerousAtrMult: number;
  normalEntryScore: number;
  fastEntryScore: number;
  chopEntryScore: number;
  aPlusMin: number;
  aMin: number;
  bPlusMin: number;
  minimumTradeSpaceAtr: number;
  maximumExtensionAtr: number;
  reentryDelayMs: number;
  duplicateSetupWindowMs: number;
  flapGuardMs: number;
  breakEvenTriggerR: number;
  trailingTriggerR: number;
  staleTradeDurationMs: number;
  atrStopMultiplier: number;
  atrTpMultiplierFast: number;
  atrTpMultiplierNormal: number;
  minRiskReward: number;
  /** Demo-only daily trade ceiling while FAST is active. Live caps untouched. */
  demoMaxTradesPerDay: number;
  /** Demo-only cooldown after a loss (minutes). Live settings untouched. */
  demoReentryDelayMinutes: number;
  pendingSetupTimeoutMs: number;
  pendingTriggerTimeoutMs: number;
  pendingEntryTimeoutMs: number;
  typicalAtrPricePct: number;
  /** Max age of the latest completed M1 close before WAIT_M1_STALE. */
  maxCompletedM1AgeMs: number;
};

export const DEFAULT_FAST_AUTOTRADE_CONFIG: FastAutoTradeConfig = {
  strategyId: FAST_AUTOTRADE_STRATEGY_ID,
  fastRegimeRangePct: 0.0008,
  fastRegimeEfficiency: 0.52,
  chopEfficiencyMax: 0.28,
  quietRangePct: 0.00028,
  dangerousAtrMult: 4,
  normalEntryScore: 78,
  fastEntryScore: 70,
  chopEntryScore: 88,
  aPlusMin: 88,
  aMin: 78,
  bPlusMin: 70,
  minimumTradeSpaceAtr: 0.55,
  maximumExtensionAtr: 2.2,
  reentryDelayMs: 45_000,
  duplicateSetupWindowMs: 180_000,
  flapGuardMs: 20_000,
  breakEvenTriggerR: 1.2,
  trailingTriggerR: 1.8,
  staleTradeDurationMs: 8 * 60_000,
  atrStopMultiplier: 1.15,
  atrTpMultiplierFast: 0.9,
  atrTpMultiplierNormal: 1.4,
  minRiskReward: 1,
  demoMaxTradesPerDay: 48,
  demoReentryDelayMinutes: 1,
  pendingSetupTimeoutMs: 4 * 60_000,
  pendingTriggerTimeoutMs: 3 * 60_000,
  pendingEntryTimeoutMs: 90_000,
  typicalAtrPricePct: 0.0012,
  maxCompletedM1AgeMs: 180_000
};

function parseBounded(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

function envFlagTrue(raw: string | undefined, defaultOn: boolean): boolean {
  if (raw == null || String(raw).trim() === "") return defaultOn;
  const v = String(raw).trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  if (v === "1" || v === "true" || v === "on") return true;
  return defaultOn;
}

/**
 * FAST is the replacement Demo AutoTrade strategy when enabled.
 * Default OFF in unit tests (unset env). Production sets FAST_AUTOTRADE_V1_ENABLED=true.
 */
export function isFastAutoTradeV1Enabled(
  source: NodeJS.ProcessEnv = process.env
): boolean {
  const explicit = source.FAST_AUTOTRADE_V1_ENABLED;
  if (explicit != null && String(explicit).trim() !== "") {
    return envFlagTrue(explicit, true);
  }
  const mode = String(source.DEMO_OPPORTUNITY_MODE ?? "")
    .trim()
    .toUpperCase();
  return mode === "FAST_AUTOTRADE_V1";
}

export function loadFastAutoTradeConfig(
  source: NodeJS.ProcessEnv = process.env
): FastAutoTradeConfig {
  const d = DEFAULT_FAST_AUTOTRADE_CONFIG;
  const aPlusMin = Math.floor(parseBounded(source.FAST_A_PLUS_MIN, d.aPlusMin, 50, 100));
  const aMin = Math.floor(parseBounded(source.FAST_A_MIN, d.aMin, 50, 100));
  const bPlusMin = Math.floor(parseBounded(source.FAST_B_PLUS_MIN, d.bPlusMin, 50, 100));
  const normalEntryScore = Math.floor(
    parseBounded(source.FAST_NORMAL_ENTRY_SCORE, d.normalEntryScore, 50, 100)
  );
  const fastEntryScore = Math.floor(
    parseBounded(source.FAST_ENTRY_SCORE, d.fastEntryScore, 50, 100)
  );
  const chopEntryScore = Math.floor(
    parseBounded(source.FAST_CHOP_ENTRY_SCORE, d.chopEntryScore, 50, 100)
  );
  if (!(bPlusMin <= aMin && aMin < aPlusMin)) {
    return { ...d };
  }
  return {
    ...d,
    aPlusMin,
    aMin,
    bPlusMin,
    normalEntryScore,
    fastEntryScore,
    chopEntryScore,
    minimumTradeSpaceAtr: parseBounded(
      source.FAST_MIN_TRADE_SPACE_ATR,
      d.minimumTradeSpaceAtr,
      0.2,
      3
    ),
    maximumExtensionAtr: parseBounded(
      source.FAST_MAX_EXTENSION_ATR,
      d.maximumExtensionAtr,
      0.8,
      6
    ),
    reentryDelayMs: Math.floor(
      parseBounded(source.FAST_REENTRY_DELAY_MS, d.reentryDelayMs, 5_000, 600_000)
    ),
    duplicateSetupWindowMs: Math.floor(
      parseBounded(
        source.FAST_DUPLICATE_SETUP_WINDOW_MS,
        d.duplicateSetupWindowMs,
        15_000,
        1_800_000
      )
    ),
    breakEvenTriggerR: parseBounded(
      source.FAST_BE_TRIGGER_R,
      d.breakEvenTriggerR,
      0.6,
      3
    ),
    trailingTriggerR: parseBounded(
      source.FAST_TRAIL_TRIGGER_R,
      d.trailingTriggerR,
      0.8,
      5
    ),
    staleTradeDurationMs: Math.floor(
      parseBounded(
        source.FAST_STALE_TRADE_MS,
        d.staleTradeDurationMs,
        60_000,
        3_600_000
      )
    ),
    atrStopMultiplier: parseBounded(
      source.FAST_ATR_STOP_MULT,
      d.atrStopMultiplier,
      0.5,
      3
    ),
    atrTpMultiplierFast: parseBounded(
      source.FAST_ATR_TP_MULT,
      d.atrTpMultiplierFast,
      0.4,
      3
    ),
    minRiskReward: parseBounded(source.FAST_MIN_RR, d.minRiskReward, 0.8, 3),
    demoMaxTradesPerDay: Math.floor(
      parseBounded(source.FAST_DEMO_MAX_TRADES_PER_DAY, d.demoMaxTradesPerDay, 3, 80)
    ),
    demoReentryDelayMinutes: Math.floor(
      parseBounded(
        source.FAST_DEMO_REENTRY_DELAY_MINUTES,
        d.demoReentryDelayMinutes,
        0,
        30
      )
    ),
    maxCompletedM1AgeMs: Math.floor(
      parseBounded(
        source.FAST_MAX_COMPLETED_M1_AGE_MS,
        d.maxCompletedM1AgeMs,
        60_000,
        900_000
      )
    )
  };
}

export function gradeForScore(
  score: number,
  config: FastAutoTradeConfig = DEFAULT_FAST_AUTOTRADE_CONFIG
): import("./types").FastGrade {
  if (score >= config.aPlusMin) return "A+";
  if (score >= config.aMin) return "A";
  if (score >= config.bPlusMin) return "B+";
  return "BELOW";
}

export function entryThresholdForRegime(
  regime: import("./types").FastRegime,
  config: FastAutoTradeConfig = DEFAULT_FAST_AUTOTRADE_CONFIG
): number {
  if (regime === "FAST") return config.fastEntryScore;
  if (regime === "CHOP" || regime === "DANGEROUS") return config.chopEntryScore;
  return config.normalEntryScore;
}
