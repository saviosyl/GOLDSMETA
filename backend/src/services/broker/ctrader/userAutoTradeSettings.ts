/**
 * Per-user AutoTrade settings — Demo and Live stored separately.
 * Path: users/{uid}/autotradeSettings/{demo|live}
 *
 * These are user-editable preferences. Server validation still enforces
 * structural safety (ownership, volume rules, no forged account IDs).
 * Order submission remains controlled by hard-false execution flags.
 */

import { getFirestore } from "firebase-admin/firestore";
import { recordSettingsChanges } from "./settingsAuditStore";
import { hardCapsFor } from "./liveRiskCaps";
import { newsProtectionBlocksLiveActivation } from "./liveNewsGate";

export type AutoTradeEnvironment = "demo" | "live";

export type LotSizingMode = "automatic_risk" | "manual_lots";

export type UserAutoTradeSettings = {
  uid: string;
  environment: AutoTradeEnvironment;
  updatedAt: string;
  /** Selected cTrader account id — must match an OAuth-returned account. */
  selectedAccountId: string | null;
  sizingMode: LotSizingMode;
  fixedRiskAmount: number;
  percentageRisk: number;
  manualLotSize: number;
  maxDailyLoss: number;
  maxTradesPerDay: number;
  maxOpenPositions: number;
  minConfidence: number;
  minRiskReward: number;
  maxSpread: number;
  maxQuoteAgeSeconds: number;
  stopLossDistance: number | null;
  takeProfitMethod: "fixed_rr" | "manual_levels" | "signal";
  tradeCooldownMinutes: number;
  pauseAfterConsecutiveLosses: number;
  allowedSessions: string[];
  allowedDays: string[];
  newsFilterEnabled: boolean;
  /** HIGH | MEDIUM | OFF — news impact filter for new entries. */
  newsImpactMode: "HIGH" | "MEDIUM" | "OFF";
  newsMinutesBefore: number;
  newsMinutesAfter: number;
  maxSlippage: number;
  /** Optional daily profit target (absolute currency units). */
  dailyProfitTarget: number | null;
  dailyProfitTargetEnabled: boolean;
  /** Pause new entries if daily P/L falls below this floor after a peak. */
  profitProtectionEnabled: boolean;
  profitProtectionFloor: number | null;
  maxPositionExposureLots: number | null;
  confirmationCandleRequired: boolean;
  trendConfirmationRequired: boolean;
  volumeConfirmationRequired: boolean;
  breakEvenEnabled: boolean;
  trailingStopEnabled: boolean;
  partialTakeProfitEnabled: boolean;
  /** Soft pause (distinct from Emergency Stop). */
  autoTradePaused: boolean;
  autoTradePausedReason: string | null;
  /** Live activation — never inherited from Demo. */
  liveActivationConfirmedAt: string | null;
  liveActivationPhraseConfirmed: boolean;
  /** Demo / Live AutoTrade enable intent — execution still gated by flags. */
  autoTradeEnabledIntent: boolean;
  emergencyStopActive: boolean;
};

const RECOMMENDED: Omit<
  UserAutoTradeSettings,
  | "uid"
  | "environment"
  | "updatedAt"
  | "selectedAccountId"
  | "liveActivationConfirmedAt"
  | "liveActivationPhraseConfirmed"
  | "autoTradeEnabledIntent"
  | "emergencyStopActive"
> = {
  sizingMode: "automatic_risk",
  fixedRiskAmount: 20,
  percentageRisk: 0.5,
  manualLotSize: 0.01,
  maxDailyLoss: 50,
  maxTradesPerDay: 3,
  maxOpenPositions: 1,
  minConfidence: 80,
  minRiskReward: 1.5,
  maxSpread: 2,
  maxQuoteAgeSeconds: 15,
  stopLossDistance: null,
  takeProfitMethod: "fixed_rr",
  tradeCooldownMinutes: 30,
  pauseAfterConsecutiveLosses: 3,
  allowedSessions: ["London", "NewYork"],
  allowedDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  newsFilterEnabled: true,
  newsImpactMode: "HIGH",
  newsMinutesBefore: 15,
  newsMinutesAfter: 15,
  maxSlippage: 1.5,
  dailyProfitTarget: null,
  dailyProfitTargetEnabled: false,
  profitProtectionEnabled: false,
  profitProtectionFloor: null,
  maxPositionExposureLots: null,
  confirmationCandleRequired: true,
  trendConfirmationRequired: false,
  volumeConfirmationRequired: false,
  breakEvenEnabled: false,
  trailingStopEnabled: false,
  partialTakeProfitEnabled: false,
  autoTradePaused: false,
  autoTradePausedReason: null
};

function settingsDoc(uid: string, environment: AutoTradeEnvironment) {
  return getFirestore().doc(`users/${uid}/autotradeSettings/${environment}`);
}

export function defaultUserAutoTradeSettings(
  uid: string,
  environment: AutoTradeEnvironment
): UserAutoTradeSettings {
  return {
    uid,
    environment,
    updatedAt: new Date().toISOString(),
    selectedAccountId: null,
    ...RECOMMENDED,
    liveActivationConfirmedAt: null,
    liveActivationPhraseConfirmed: false,
    autoTradeEnabledIntent: false,
    emergencyStopActive: false
  };
}

export function recommendedAutoTradeSettings(): typeof RECOMMENDED {
  return { ...RECOMMENDED };
}

export async function getUserAutoTradeSettings(
  uid: string,
  environment: AutoTradeEnvironment
): Promise<UserAutoTradeSettings> {
  const snap = await settingsDoc(uid, environment).get();
  if (!snap.exists) return defaultUserAutoTradeSettings(uid, environment);
  const data = snap.data() as Partial<UserAutoTradeSettings>;
  return {
    ...defaultUserAutoTradeSettings(uid, environment),
    ...data,
    uid,
    environment,
    // Never inherit Live activation from Demo docs
    liveActivationConfirmedAt:
      environment === "live" ? (data.liveActivationConfirmedAt ?? null) : null,
    liveActivationPhraseConfirmed:
      environment === "live" ? Boolean(data.liveActivationPhraseConfirmed) : false
  };
}

export type UserAutoTradeSettingsPatch = Partial<
  Omit<UserAutoTradeSettings, "uid" | "environment" | "updatedAt">
>;

export function validateSettingsPatch(
  patch: UserAutoTradeSettingsPatch,
  environment: AutoTradeEnvironment,
  existing?: UserAutoTradeSettings
): { ok: true; clean: UserAutoTradeSettingsPatch } | { ok: false; code: string; message: string } {
  const clean: UserAutoTradeSettingsPatch = { ...patch };

  // Demo must never carry Live activation flags
  if (environment === "demo") {
    clean.liveActivationConfirmedAt = null;
    clean.liveActivationPhraseConfirmed = false;
  }

  const num = (v: unknown, min: number, max: number, label: string) => {
    if (v === undefined) return null;
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
      return `${label} must be between ${min} and ${max}`;
    }
    return null;
  };

  // Absolute server ceilings (Live tighter than Demo user-editable ranges).
  const caps = hardCapsFor(environment);
  for (const [key, min, max] of [
    ["fixedRiskAmount", 1, caps.fixedRiskAmountMax],
    ["percentageRisk", 0.01, caps.percentageRiskMax],
    ["manualLotSize", 0.01, caps.manualLotSizeMax],
    ["maxDailyLoss", 1, caps.maxDailyLossMax],
    // Product: Max trades / day is 1–10 (user-editable).
    ["maxTradesPerDay", 1, Math.min(10, caps.maxTradesPerDayMax)],
    ["maxOpenPositions", 1, caps.maxOpenPositionsMax],
    ["minConfidence", 50, 100],
    ["minRiskReward", 1, 3],
    ["maxSpread", 0.01, caps.maxSpreadMax],
    ["maxSlippage", 0.01, caps.maxSlippageMax],
    ["maxQuoteAgeSeconds", 1, 300],
    ["tradeCooldownMinutes", 0, 1440],
    ["pauseAfterConsecutiveLosses", 1, 10],
    ["newsMinutesBefore", 0, 180],
    ["newsMinutesAfter", 0, 180],
    ["dailyProfitTarget", 1, 1_000_000],
    ["profitProtectionFloor", 0, 1_000_000],
    ["maxPositionExposureLots", 0.01, caps.maxPositionExposureLotsMax]
  ] as const) {
    const raw = clean[key as keyof UserAutoTradeSettingsPatch];
    if (raw === null && (key === "dailyProfitTarget" || key === "profitProtectionFloor" || key === "maxPositionExposureLots")) {
      continue;
    }
    const err = num(raw, min, max, key);
    if (err) {
      return {
        ok: false,
        code:
          environment === "live"
            ? "LIVE_HARD_CAP_EXCEEDED"
            : "SETTINGS_VALIDATION_FAILED",
        message: err
      };
    }
  }

  if (
    clean.newsImpactMode != null &&
    clean.newsImpactMode !== "HIGH" &&
    clean.newsImpactMode !== "MEDIUM" &&
    clean.newsImpactMode !== "OFF"
  ) {
    return { ok: false, code: "SETTINGS_VALIDATION_FAILED", message: "Invalid news impact mode" };
  }

  const allowedOpen =
    environment === "live" ? [1, 2] : [1, 2, 3];
  if (
    clean.maxOpenPositions != null &&
    !allowedOpen.includes(clean.maxOpenPositions)
  ) {
    return {
      ok: false,
      code:
        environment === "live"
          ? "LIVE_HARD_CAP_EXCEEDED"
          : "SETTINGS_VALIDATION_FAILED",
      message:
        environment === "live"
          ? "maxOpenPositions must be 1 or 2 for Live (server hard cap)"
          : "maxOpenPositions must be 1, 2, or 3"
    };
  }

  if (
    clean.tradeCooldownMinutes != null &&
    ![0, 15, 30, 60].includes(clean.tradeCooldownMinutes)
  ) {
    return {
      ok: false,
      code: "SETTINGS_VALIDATION_FAILED",
      message: "tradeCooldownMinutes must be 0, 15, 30, or 60"
    };
  }

  if (clean.sizingMode && clean.sizingMode !== "automatic_risk" && clean.sizingMode !== "manual_lots") {
    return { ok: false, code: "SETTINGS_VALIDATION_FAILED", message: "Invalid sizing mode" };
  }

  // Enabling Live intent requires phrase confirmation already stored or in patch
  if (environment === "live" && clean.autoTradeEnabledIntent === true) {
    const phraseOk =
      clean.liveActivationPhraseConfirmed === true ||
      existing?.liveActivationPhraseConfirmed === true;
    if (!phraseOk) {
      return {
        ok: false,
        code: "LIVE_ACTIVATION_REQUIRED",
        message: "Confirm Live activation before enabling Live AutoTrade intent."
      };
    }
  }

  // Demo activation must never imply Live activation
  if (environment === "demo" && clean.autoTradeEnabledIntent === true) {
    clean.liveActivationPhraseConfirmed = false;
    clean.liveActivationConfirmedAt = null;
  }

  return { ok: true, clean };
}

export async function saveUserAutoTradeSettings(
  uid: string,
  environment: AutoTradeEnvironment,
  patch: UserAutoTradeSettingsPatch
): Promise<UserAutoTradeSettings> {
  const current = await getUserAutoTradeSettings(uid, environment);
  const validated = validateSettingsPatch(patch, environment, current);
  if (!validated.ok) {
    throw Object.assign(new Error(validated.message), { code: validated.code });
  }
  const next: UserAutoTradeSettings = {
    ...current,
    ...validated.clean,
    uid,
    environment,
    updatedAt: new Date().toISOString()
  };
  // Structural: Demo enable never copies to Live
  if (environment === "demo") {
    next.liveActivationConfirmedAt = null;
    next.liveActivationPhraseConfirmed = false;
  }
  await settingsDoc(uid, environment).set(next, { merge: true });
  try {
    await recordSettingsChanges({
      uid,
      environment,
      before: current as unknown as Record<string, unknown>,
      after: next as unknown as Record<string, unknown>,
      fields: Object.keys(validated.clean)
    });
  } catch {
    /* audit must not block settings save */
  }
  return next;
}

/** Emergency STOP — scoped to one user + Demo/Live environment only. */
export async function setEmergencyStop(
  uid: string,
  environment: AutoTradeEnvironment,
  active: boolean
): Promise<UserAutoTradeSettings> {
  return saveUserAutoTradeSettings(uid, environment, {
    emergencyStopActive: active,
    autoTradeEnabledIntent: active ? false : undefined
  });
}

export async function confirmLiveActivation(
  uid: string,
  phrase: string
): Promise<UserAutoTradeSettings> {
  if (phrase.trim().toUpperCase() !== "ENABLE LIVE") {
    throw Object.assign(new Error("Type ENABLE LIVE to confirm"), {
      code: "LIVE_CONFIRMATION_PHRASE_MISMATCH"
    });
  }
  const liveSettings = await getUserAutoTradeSettings(uid, "live");
  // Prefer Live settings news filter; fall back to Demo intent if Live unset.
  const demoSettings = await getUserAutoTradeSettings(uid, "demo");
  const newsSettings =
    liveSettings.newsFilterEnabled != null
      ? liveSettings
      : demoSettings;
  const gate = newsProtectionBlocksLiveActivation({
    newsFilterEnabled:
      liveSettings.newsFilterEnabled || demoSettings.newsFilterEnabled,
    newsImpactMode:
      liveSettings.newsFilterEnabled
        ? liveSettings.newsImpactMode
        : demoSettings.newsImpactMode
  });
  void newsSettings;
  if (gate.blocked) {
    throw Object.assign(new Error(gate.reason ?? "NEWS_PROVIDER_REQUIRED"), {
      code: "LIVE_NEWS_PROVIDER_REQUIRED"
    });
  }
  return saveUserAutoTradeSettings(uid, "live", {
    liveActivationPhraseConfirmed: true,
    liveActivationConfirmedAt: new Date().toISOString()
  });
}
