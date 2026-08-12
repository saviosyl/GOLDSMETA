/**
 * Server-side daily safety gates for Demo / Live AutoTrade entries.
 */

import {
  getUserAutoTradeSettings,
  type AutoTradeEnvironment,
  type UserAutoTradeSettings
} from "./userAutoTradeSettings";
import {
  getDailySafetyDoc,
  saveDailySafetyDoc,
  tradingDayKey
} from "./dailySafetyStore";
import type { DailySafetyDocument, DailySafetyPublicView } from "./dailySafetyTypes";
import { reconcileDemoOpenPositionCounters } from "./openPositionReconcile";
import { resolveDemoAutoAuthorityForUser } from "./demoAutoExecutionAuthority";

export type EntryGateResult = {
  allowed: boolean;
  code: string | null;
  label: string | null;
};

function remainingMs(until: string | null, now = Date.now()): number | null {
  if (!until) return null;
  const ms = Date.parse(until) - now;
  return Number.isFinite(ms) ? Math.max(0, ms) : null;
}

export function evaluateEntryGates(args: {
  settings: UserAutoTradeSettings;
  daily: DailySafetyDocument;
  now?: Date;
}): EntryGateResult {
  const now = args.now ?? new Date();
  const s = args.settings;
  const d = args.daily;

  if (s.emergencyStopActive) {
    return { allowed: false, code: "EMERGENCY_STOP", label: "Emergency Stop active" };
  }
  if (d.pausedReason) {
    return { allowed: false, code: "ENTRIES_PAUSED", label: d.pausedReason };
  }
  if (d.dailyLossLocked || Math.abs(Math.min(0, d.realisedPnl)) >= s.maxDailyLoss) {
    return { allowed: false, code: "DAILY_LOSS_LIMIT", label: "Daily loss limit reached" };
  }
  if (d.tradesUsed >= s.maxTradesPerDay) {
    return { allowed: false, code: "DAILY_TRADE_LIMIT", label: "Daily trade limit reached" };
  }
  if (d.openPositions >= s.maxOpenPositions) {
    return { allowed: false, code: "MAX_OPEN_POSITIONS", label: "Max open positions reached" };
  }
  if (d.consecutiveLosses >= s.pauseAfterConsecutiveLosses) {
    return {
      allowed: false,
      code: "CONSECUTIVE_LOSS_PAUSE",
      label: `${d.consecutiveLosses} consecutive losses reached`
    };
  }
  const coolMs = remainingMs(d.cooldownUntil, now.getTime());
  if (coolMs != null && coolMs > 0) {
    return { allowed: false, code: "COOLDOWN_ACTIVE", label: "Cooldown after losing trade" };
  }
  if (s.dailyProfitTargetEnabled && s.dailyProfitTarget != null && d.dailyProfitTargetHit) {
    return { allowed: false, code: "PROFIT_TARGET", label: "Daily profit target reached" };
  }
  if (s.profitProtectionEnabled && d.profitProtectionPaused) {
    return { allowed: false, code: "PROFIT_PROTECTION", label: "Daily profit protection pause" };
  }
  return { allowed: true, code: null, label: null };
}

export async function getDailySafetyView(
  uid: string,
  environment: AutoTradeEnvironment,
  opts?: { autoTradeLabel?: string; currency?: string }
): Promise<DailySafetyPublicView> {
  const [settings, daily] = await Promise.all([
    getUserAutoTradeSettings(uid, environment),
    getDailySafetyDoc(uid, environment)
  ]);
  const gate = evaluateEntryGates({ settings, daily });
  const coolMs = remainingMs(daily.cooldownUntil);
  const lossUsed = Math.abs(Math.min(0, daily.realisedPnl));
  let autoTradeLabel = opts?.autoTradeLabel ?? "OFF";
  if (!opts?.autoTradeLabel && environment === "demo") {
    try {
      const authority = await resolveDemoAutoAuthorityForUser(uid);
      if (authority.emergencyStop) autoTradeLabel = "EMERGENCY STOP";
      else if (authority.paused || daily.pausedReason) autoTradeLabel = "PAUSED";
      else if (authority.enabled) autoTradeLabel = "DEMO AUTO";
      else if (authority.qualificationState === "DEMO_AUTO_READY")
        autoTradeLabel = "DEMO AUTO READY";
      else if (authority.startedAt) autoTradeLabel = "QUALIFYING";
      else autoTradeLabel = "DEMO AUTO NOT ACTIVE";
    } catch {
      /* keep default */
    }
  }

  return {
    environment,
    tradingDay: daily.tradingDay || tradingDayKey(),
    tradesToday: daily.tradesUsed,
    tradesMax: settings.maxTradesPerDay,
    tradesLimitReached: daily.tradesUsed >= settings.maxTradesPerDay,
    dailyPnl: daily.realisedPnl,
    dailyLossLimit: settings.maxDailyLoss,
    dailyLossUsed: lossUsed,
    dailyLossRemaining: Math.max(0, settings.maxDailyLoss - lossUsed),
    dailyLossLimitReached: lossUsed >= settings.maxDailyLoss || daily.dailyLossLocked,
    consecutiveLosses: daily.consecutiveLosses,
    consecutiveLossMax: settings.pauseAfterConsecutiveLosses,
    consecutiveLossPaused: daily.consecutiveLosses >= settings.pauseAfterConsecutiveLosses,
    openPositions: daily.openPositions,
    openPositionsMax: settings.maxOpenPositions,
    cooldownActive: coolMs != null && coolMs > 0,
    cooldownRemainingMs: coolMs != null && coolMs > 0 ? coolMs : null,
    cooldownLabel:
      coolMs != null && coolMs > 0
        ? `${Math.ceil(coolMs / 60_000)} min`
        : settings.tradeCooldownMinutes > 0
          ? "Ready"
          : "Off",
    emergencyStopActive: settings.emergencyStopActive,
    emergencyStopLabel: settings.emergencyStopActive ? "ACTIVE" : "READY",
    autoTradeLabel,
    dailyProfitTarget: settings.dailyProfitTarget,
    dailyProfitTargetEnabled: Boolean(settings.dailyProfitTargetEnabled),
    dailyProfitTargetReached: daily.dailyProfitTargetHit,
    profitProtectionEnabled: Boolean(settings.profitProtectionEnabled),
    profitProtectionPaused: daily.profitProtectionPaused,
    peakDailyPnl: daily.peakDailyPnl,
    protectedMinimumPnl: settings.profitProtectionFloor,
    entriesBlocked: !gate.allowed,
    entriesBlockedReason: gate.label,
    currency: opts?.currency ?? "EUR"
  };
}

export async function assertEntryAllowed(
  uid: string,
  environment: AutoTradeEnvironment,
  opts?: { settingsOverride?: UserAutoTradeSettings }
): Promise<EntryGateResult> {
  // Demo: reconcile ghost open-position counters before gating (lifecycle/broker).
  if (environment === "demo") {
    try {
      await reconcileDemoOpenPositionCounters(uid);
    } catch {
      /* fail closed — evaluate gates on current counters */
    }
  }
  const [loadedSettings, daily] = await Promise.all([
    opts?.settingsOverride
      ? Promise.resolve(opts.settingsOverride)
      : getUserAutoTradeSettings(uid, environment),
    getDailySafetyDoc(uid, environment)
  ]);
  const settings = opts?.settingsOverride ?? loadedSettings;
  // Persist day rollover if needed
  if (daily.tradingDay !== tradingDayKey()) {
    await saveDailySafetyDoc(daily);
  }
  return evaluateEntryGates({ settings, daily });
}

export async function markTradeOpened(args: {
  uid: string;
  environment: AutoTradeEnvironment;
  tradeId: string;
}): Promise<void> {
  const daily = await getDailySafetyDoc(args.uid, args.environment);
  if (daily.countedTradeIds.includes(`open:${args.tradeId}`)) return;
  daily.openPositions += 1;
  daily.tradesUsed += 1;
  daily.countedTradeIds = [...daily.countedTradeIds, `open:${args.tradeId}`].slice(-200);
  await saveDailySafetyDoc(daily);
}

export async function markTradeClosed(args: {
  uid: string;
  environment: AutoTradeEnvironment;
  tradeId: string;
  pnl: number;
}): Promise<void> {
  const [settings, daily] = await Promise.all([
    getUserAutoTradeSettings(args.uid, args.environment),
    getDailySafetyDoc(args.uid, args.environment)
  ]);
  if (daily.countedTradeIds.includes(`close:${args.tradeId}`)) return;

  daily.openPositions = Math.max(0, daily.openPositions - 1);
  daily.realisedPnl += args.pnl;
  daily.peakDailyPnl = Math.max(daily.peakDailyPnl, daily.realisedPnl);
  daily.lastTradeClosedAt = new Date().toISOString();
  const loss = args.pnl < 0;
  daily.lastTradeWasLoss = loss;
  if (loss) {
    daily.consecutiveLosses += 1;
    if (settings.tradeCooldownMinutes > 0) {
      daily.cooldownUntil = new Date(
        Date.now() + settings.tradeCooldownMinutes * 60_000
      ).toISOString();
    }
    if (daily.consecutiveLosses >= settings.pauseAfterConsecutiveLosses) {
      daily.pausedReason = `${daily.consecutiveLosses} consecutive losses reached`;
      daily.pausedAt = new Date().toISOString();
    }
  } else {
    daily.consecutiveLosses = 0;
  }

  const lossUsed = Math.abs(Math.min(0, daily.realisedPnl));
  if (lossUsed >= settings.maxDailyLoss) {
    daily.dailyLossLocked = true;
  }

  if (
    settings.dailyProfitTargetEnabled &&
    settings.dailyProfitTarget != null &&
    daily.realisedPnl >= settings.dailyProfitTarget
  ) {
    daily.dailyProfitTargetHit = true;
  }

  if (
    settings.profitProtectionEnabled &&
    settings.profitProtectionFloor != null &&
    daily.peakDailyPnl > 0 &&
    daily.realisedPnl < settings.profitProtectionFloor
  ) {
    daily.profitProtectionPaused = true;
    daily.pausedReason =
      daily.pausedReason ??
      "Daily profit protection — new entries paused after drawdown from peak";
    daily.pausedAt = daily.pausedAt ?? new Date().toISOString();
  }

  daily.countedTradeIds = [...daily.countedTradeIds, `close:${args.tradeId}`].slice(-200);
  await saveDailySafetyDoc(daily);
}

export async function clearSoftPause(
  uid: string,
  environment: AutoTradeEnvironment
): Promise<DailySafetyDocument> {
  const daily = await getDailySafetyDoc(uid, environment);
  daily.pausedReason = null;
  daily.pausedAt = null;
  daily.profitProtectionPaused = false;
  // Consecutive losses require an explicit reset by clearing counter on resume.
  daily.consecutiveLosses = 0;
  await saveDailySafetyDoc(daily);
  return daily;
}
