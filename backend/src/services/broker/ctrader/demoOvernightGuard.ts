/**
 * Temporary DEMO-only overnight execution overlay.
 *
 * DEMO_OVERNIGHT_MODE=true applies conservative runtime caps without
 * permanently mutating saved AutoTrade settings.
 *
 * LIVE execution remains impossible via flags.ts hard locks.
 * This module only gates Demo order entry.
 */

import { CTRADER_RECOMMENDED_DEFAULTS } from "./flags";
import type { UserAutoTradeSettings } from "./userAutoTradeSettings";

export const DEMO_OVERNIGHT_RUN_ID_DEFAULT = "overnight-demo-20260812";

export type DemoOvernightConfig = {
  enabled: boolean;
  runId: string;
  runUntilIso: string | null;
  maxNewTrades: number;
  maxOpenPositions: number;
  /** Absolute deposit-currency risk ceiling (EUR-equivalent). */
  maxRiskAmount: number;
  minConfidenceFloor: number;
  requireConfirmation: boolean;
};

export type DemoOvernightOverlayResult = {
  enabled: boolean;
  runId: string | null;
  runUntilIso: string | null;
  entriesAllowed: boolean;
  blockReason: "OVERNIGHT_WINDOW_ENDED" | null;
  savedRisk: number;
  overnightRiskCap: number | null;
  effectiveRisk: number;
  riskCapReason: string | null;
  effectiveSettings: UserAutoTradeSettings;
};

function envTrue(name: string, source: NodeJS.ProcessEnv): boolean {
  return String(source[name] ?? "").trim().toLowerCase() === "true";
}

export function loadDemoOvernightConfig(
  source: NodeJS.ProcessEnv = process.env
): DemoOvernightConfig {
  const enabled = envTrue("DEMO_OVERNIGHT_MODE", source);
  const runUntilRaw = String(source.DEMO_OVERNIGHT_RUN_UNTIL ?? "").trim();
  const runId =
    String(source.DEMO_OVERNIGHT_RUN_ID ?? "").trim() ||
    DEMO_OVERNIGHT_RUN_ID_DEFAULT;
  return {
    enabled,
    runId,
    runUntilIso: runUntilRaw || null,
    maxNewTrades: CTRADER_RECOMMENDED_DEFAULTS.maxTradesPerDay,
    maxOpenPositions: CTRADER_RECOMMENDED_DEFAULTS.maxOpenPositions,
    maxRiskAmount: CTRADER_RECOMMENDED_DEFAULTS.maxRiskPerTradeEur,
    minConfidenceFloor: CTRADER_RECOMMENDED_DEFAULTS.minConfidence,
    requireConfirmation: CTRADER_RECOMMENDED_DEFAULTS.confirmedCandleRequired
  };
}

/**
 * True when overnight mode is on and now is at/after the configured cutoff.
 * Missing/invalid cutoff → fail closed (entries blocked) while mode is on.
 */
export function isDemoOvernightWindowEnded(
  config: DemoOvernightConfig,
  now: Date = new Date()
): boolean {
  if (!config.enabled) return false;
  if (!config.runUntilIso) return true;
  const untilMs = Date.parse(config.runUntilIso);
  if (!Number.isFinite(untilMs)) return true;
  return now.getTime() >= untilMs;
}

/**
 * Apply temporary DEMO overnight caps to a settings clone.
 * Never mutates the caller's saved settings object in place.
 */
export function applyDemoOvernightOverlay(
  saved: UserAutoTradeSettings,
  opts?: { now?: Date; env?: NodeJS.ProcessEnv }
): DemoOvernightOverlayResult {
  const now = opts?.now ?? new Date();
  const config = loadDemoOvernightConfig(opts?.env ?? process.env);
  if (!config.enabled) {
    return {
      enabled: false,
      runId: null,
      runUntilIso: null,
      entriesAllowed: true,
      blockReason: null,
      savedRisk: saved.fixedRiskAmount,
      overnightRiskCap: null,
      effectiveRisk: saved.fixedRiskAmount,
      riskCapReason: null,
      effectiveSettings: saved
    };
  }

  const windowEnded = isDemoOvernightWindowEnded(config, now);
  const savedRisk = saved.fixedRiskAmount;
  const overnightRiskCap = config.maxRiskAmount;
  let effectiveRisk = savedRisk;
  let riskCapReason: string | null = null;
  if (savedRisk > overnightRiskCap) {
    effectiveRisk = overnightRiskCap;
    riskCapReason = "OVERNIGHT_RISK_CAP";
  }

  const effectiveSettings: UserAutoTradeSettings = {
    ...saved,
    fixedRiskAmount: effectiveRisk,
    maxTradesPerDay: Math.min(saved.maxTradesPerDay, config.maxNewTrades),
    maxOpenPositions: Math.min(
      saved.maxOpenPositions,
      config.maxOpenPositions
    ),
    minConfidence: Math.max(saved.minConfidence, config.minConfidenceFloor),
    confirmationCandleRequired:
      config.requireConfirmation || saved.confirmationCandleRequired
  };

  return {
    enabled: true,
    runId: config.runId,
    runUntilIso: config.runUntilIso,
    entriesAllowed: !windowEnded,
    blockReason: windowEnded ? "OVERNIGHT_WINDOW_ENDED" : null,
    savedRisk,
    overnightRiskCap,
    effectiveRisk,
    riskCapReason,
    effectiveSettings
  };
}
