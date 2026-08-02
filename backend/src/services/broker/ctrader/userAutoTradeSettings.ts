/**
 * Per-user AutoTrade settings — Demo and Live stored separately.
 * Path: users/{uid}/autotradeSettings/{demo|live}
 *
 * These are user-editable preferences. Server validation still enforces
 * structural safety (ownership, volume rules, no forged account IDs).
 * Order submission remains controlled by hard-false execution flags.
 */

import { getFirestore } from "firebase-admin/firestore";

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
  confirmationCandleRequired: boolean;
  trendConfirmationRequired: boolean;
  volumeConfirmationRequired: boolean;
  breakEvenEnabled: boolean;
  trailingStopEnabled: boolean;
  partialTakeProfitEnabled: boolean;
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
  confirmationCandleRequired: true,
  trendConfirmationRequired: false,
  volumeConfirmationRequired: false,
  breakEvenEnabled: false,
  trailingStopEnabled: false,
  partialTakeProfitEnabled: false
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

  for (const [key, min, max] of [
    ["fixedRiskAmount", 1, 10_000],
    ["percentageRisk", 0.01, 100],
    ["manualLotSize", 0.01, 5000],
    ["maxDailyLoss", 1, 100_000],
    ["maxTradesPerDay", 1, 100],
    ["maxOpenPositions", 1, 20],
    ["minConfidence", 0, 100],
    ["minRiskReward", 0.1, 20],
    ["maxSpread", 0.01, 100],
    ["maxQuoteAgeSeconds", 1, 300],
    ["tradeCooldownMinutes", 0, 1440],
    ["pauseAfterConsecutiveLosses", 1, 50]
  ] as const) {
    const err = num(clean[key as keyof UserAutoTradeSettingsPatch], min, max, key);
    if (err) return { ok: false, code: "SETTINGS_VALIDATION_FAILED", message: err };
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
  return saveUserAutoTradeSettings(uid, "live", {
    liveActivationPhraseConfirmed: true,
    liveActivationConfirmedAt: new Date().toISOString()
  });
}
