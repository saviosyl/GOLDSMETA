/**
 * Fail-closed validation for Gold Hunter Demo risk-critical config.
 * Never silently coerce NaN / Infinity into usable risk numbers.
 */
import type { GoldHunterAdminConfig, GoldHunterWaitReason } from "./types";

/** Demo phase: only single-position execution is atomically safe. */
export const GH_DEMO_MAX_OPEN_TRADES_REQUIRED = 1;

/** Approved risk-per-trade % range for Gold Hunter Demo. */
export const GH_DEMO_RISK_PER_TRADE_PCT_RANGE = {
  minExclusive: 0,
  maxInclusive: 10
} as const;

/** Approved daily loss limit % range for Gold Hunter Demo. */
export const GH_DEMO_DAILY_LOSS_LIMIT_PCT_RANGE = {
  minExclusive: 0,
  maxInclusive: 50
} as const;

export type GoldHunterConfigValidation = {
  ok: boolean;
  blocker: GoldHunterWaitReason | null;
  detail: string | null;
  issues: string[];
};

function isPositiveFinite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Validate risk-critical fields. Any non-finite / out-of-range → fail closed.
 */
export function validateGoldHunterRiskConfig(
  config: Partial<GoldHunterAdminConfig> | null | undefined
): GoldHunterConfigValidation {
  const issues: string[] = [];
  if (!config) {
    return {
      ok: false,
      blocker: "WAIT — CONFIG INVALID",
      detail: "config_missing",
      issues: ["config_missing"]
    };
  }

  if (!isPositiveFinite(config.allocatedCapitalEur)) {
    issues.push("allocatedCapitalEur_invalid");
  }

  if (
    !isFiniteNumber(config.riskPerTradePct) ||
    !(config.riskPerTradePct > GH_DEMO_RISK_PER_TRADE_PCT_RANGE.minExclusive) ||
    config.riskPerTradePct > GH_DEMO_RISK_PER_TRADE_PCT_RANGE.maxInclusive
  ) {
    issues.push("riskPerTradePct_invalid");
  }

  if (
    !isFiniteNumber(config.dailyLossLimitPct) ||
    !(config.dailyLossLimitPct > GH_DEMO_DAILY_LOSS_LIMIT_PCT_RANGE.minExclusive) ||
    config.dailyLossLimitPct > GH_DEMO_DAILY_LOSS_LIMIT_PCT_RANGE.maxInclusive
  ) {
    issues.push("dailyLossLimitPct_invalid");
  }

  if (
    !isFiniteNumber(config.maxOpenTrades) ||
    !Number.isInteger(config.maxOpenTrades)
  ) {
    issues.push("maxOpenTrades_invalid");
  } else if (config.maxOpenTrades !== GH_DEMO_MAX_OPEN_TRADES_REQUIRED) {
    issues.push(
      `maxOpenTrades_must_equal_${GH_DEMO_MAX_OPEN_TRADES_REQUIRED}`
    );
  }

  if (issues.length > 0) {
    return {
      ok: false,
      blocker: "WAIT — CONFIG INVALID",
      detail: issues.join(","),
      issues
    };
  }

  return { ok: true, blocker: null, detail: null, issues: [] };
}

/**
 * Validate a partial config patch before save. Rejects maxOpenTrades > 1.
 */
export function validateGoldHunterConfigPatch(
  patch: Partial<GoldHunterAdminConfig>
): GoldHunterConfigValidation {
  const issues: string[] = [];

  if (patch.allocatedCapitalEur !== undefined) {
    if (!isPositiveFinite(patch.allocatedCapitalEur)) {
      issues.push("allocatedCapitalEur_invalid");
    } else if (patch.allocatedCapitalEur > 1_000_000) {
      issues.push("allocatedCapitalEur_too_large");
    }
  }

  if (patch.riskPerTradePct !== undefined) {
    if (
      !isFiniteNumber(patch.riskPerTradePct) ||
      !(patch.riskPerTradePct > GH_DEMO_RISK_PER_TRADE_PCT_RANGE.minExclusive) ||
      patch.riskPerTradePct > GH_DEMO_RISK_PER_TRADE_PCT_RANGE.maxInclusive
    ) {
      issues.push("riskPerTradePct_invalid");
    }
  }

  if (patch.dailyLossLimitPct !== undefined) {
    if (
      !isFiniteNumber(patch.dailyLossLimitPct) ||
      !(
        patch.dailyLossLimitPct >
        GH_DEMO_DAILY_LOSS_LIMIT_PCT_RANGE.minExclusive
      ) ||
      patch.dailyLossLimitPct >
        GH_DEMO_DAILY_LOSS_LIMIT_PCT_RANGE.maxInclusive
    ) {
      issues.push("dailyLossLimitPct_invalid");
    }
  }

  if (patch.maxOpenTrades !== undefined) {
    if (
      !isFiniteNumber(patch.maxOpenTrades) ||
      !Number.isInteger(patch.maxOpenTrades)
    ) {
      issues.push("maxOpenTrades_invalid");
    } else if (patch.maxOpenTrades !== GH_DEMO_MAX_OPEN_TRADES_REQUIRED) {
      issues.push(
        `maxOpenTrades_must_equal_${GH_DEMO_MAX_OPEN_TRADES_REQUIRED}_until_atomic_multi_position_reservation`
      );
    }
  }

  if (issues.length > 0) {
    return {
      ok: false,
      blocker: "WAIT — CONFIG INVALID",
      detail: issues.join(","),
      issues
    };
  }
  return { ok: true, blocker: null, detail: null, issues: [] };
}
