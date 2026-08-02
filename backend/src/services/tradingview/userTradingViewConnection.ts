/**
 * Per-user TradingView connection profile + hashed webhook secret helpers.
 * Path: users/{uid}/tradingViewConnection/current
 *
 * Raw webhook tokens are shown only on create/rotate — stored as SHA-256 hashes.
 * Never copies admin webhook secrets or signal history.
 */

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import {
  getActiveStandardTemplate,
  STANDARD_TEMPLATE_ID,
  type FieldMapping,
  type TemplateSetupMode
} from "./standardTemplate";

export type { FieldMapping, TemplateSetupMode };

export type TradingViewConnectionStatus =
  | "not_connected"
  | "waiting_for_alert"
  | "connected"
  | "error";

export type UserTradingViewConnection = {
  uid: string;
  templateMode: TemplateSetupMode;
  templateId: string;
  templateVersion: string;
  /** Opaque webhook path id — not a secret by itself once revoked, but unique per user. */
  webhookId: string | null;
  webhookTokenHash: string | null;
  webhookCreatedAt: string | null;
  webhookRotatedAt: string | null;
  connectionStatus: TradingViewConnectionStatus;
  lastSignalAt: string | null;
  lastValidSignalAt: string | null;
  lastRejectedSignalAt: string | null;
  lastRejectReason: string | null;
  customMappingId: string | null;
  selectedSymbolAlias: string;
  selectedTimeframes: string[];
  customFieldMappings: FieldMapping[];
  staleSignalLimitSeconds: number;
  updatedAt: string;
};

export type CustomMappingRecord = {
  id: string;
  uid: string;
  name: string;
  fieldMappings: FieldMapping[];
  staleSignalLimitSeconds: number;
  updatedAt: string;
};

/** In-memory fallback when Firestore Admin is unavailable (tests / local). */
const memoryProfiles = new Map<string, UserTradingViewConnection>();
const memoryMappings = new Map<string, CustomMappingRecord>();

function skipFirestore(): boolean {
  return process.env.NODE_ENV === "test" && !process.env.GOLDMETA_TV_PROFILE_FIRESTORE;
}

async function profileGet(uid: string): Promise<UserTradingViewConnection | null> {
  if (memoryProfiles.has(uid)) {
    return memoryProfiles.get(uid) ?? null;
  }
  if (skipFirestore()) {
    return null;
  }
  try {
    const { getFirestore } = await import("firebase-admin/firestore");
    const snap = await getFirestore().doc(`users/${uid}/tradingViewConnection/current`).get();
    if (!snap.exists) return null;
    return snap.data() as UserTradingViewConnection;
  } catch {
    return null;
  }
}

async function profileSet(uid: string, next: UserTradingViewConnection): Promise<void> {
  memoryProfiles.set(uid, next);
  if (skipFirestore()) {
    return;
  }
  try {
    const { getFirestore } = await import("firebase-admin/firestore");
    await getFirestore().doc(`users/${uid}/tradingViewConnection/current`).set(next, { merge: true });
  } catch {
    /* memory already updated */
  }
}

export function hashWebhookToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function verifyWebhookToken(token: string, hash: string | null | undefined): boolean {
  if (!hash || !token) return false;
  const a = Buffer.from(hashWebhookToken(token), "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function generateWebhookId(): string {
  return randomBytes(18).toString("base64url");
}

export function generateWebhookSecret(): string {
  return randomBytes(24).toString("base64url");
}

export function defaultUserTradingViewConnection(uid: string): UserTradingViewConnection {
  const tpl = getActiveStandardTemplate();
  return {
    uid,
    templateMode: "standard",
    templateId: tpl.id,
    templateVersion: tpl.version,
    webhookId: null,
    webhookTokenHash: null,
    webhookCreatedAt: null,
    webhookRotatedAt: null,
    connectionStatus: "not_connected",
    lastSignalAt: null,
    lastValidSignalAt: null,
    lastRejectedSignalAt: null,
    lastRejectReason: null,
    customMappingId: null,
    selectedSymbolAlias: "XAUUSD",
    selectedTimeframes: ["15"],
    customFieldMappings: [],
    staleSignalLimitSeconds: tpl.validationRules.staleSignalLimitSeconds,
    updatedAt: new Date().toISOString()
  };
}

export async function getUserTradingViewConnection(
  uid: string
): Promise<UserTradingViewConnection> {
  const data = await profileGet(uid);
  if (!data) return defaultUserTradingViewConnection(uid);
  return {
    ...defaultUserTradingViewConnection(uid),
    ...data,
    uid,
    templateMode: data.templateMode === "custom" ? "custom" : "standard",
    templateId: data.templateId ?? STANDARD_TEMPLATE_ID
  };
}

export async function saveUserTradingViewConnection(
  uid: string,
  patch: Partial<UserTradingViewConnection>
): Promise<UserTradingViewConnection> {
  const current = await getUserTradingViewConnection(uid);
  const next: UserTradingViewConnection = {
    ...current,
    ...patch,
    uid,
    updatedAt: new Date().toISOString()
  };
  await profileSet(uid, next);
  return next;
}

/** Test helper */
export function resetTradingViewProfileMemory(): void {
  memoryProfiles.clear();
  memoryMappings.clear();
}

export async function ensureStandardDefaults(uid: string): Promise<UserTradingViewConnection> {
  const current = await getUserTradingViewConnection(uid);
  if (current.webhookId) return current;
  const tpl = getActiveStandardTemplate();
  return saveUserTradingViewConnection(uid, {
    templateMode: "standard",
    templateId: tpl.id,
    templateVersion: tpl.version,
    connectionStatus: "not_connected"
  });
}

export async function restoreStandardSetup(uid: string): Promise<UserTradingViewConnection> {
  const tpl = getActiveStandardTemplate();
  return saveUserTradingViewConnection(uid, {
    templateMode: "standard",
    templateId: tpl.id,
    templateVersion: tpl.version,
    customMappingId: null,
    customFieldMappings: [],
    staleSignalLimitSeconds: tpl.validationRules.staleSignalLimitSeconds
  });
}

export function validateCustomMappings(
  mappings: FieldMapping[],
  staleLimit: number
): { ok: true } | { ok: false; code: string; message: string } {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return { ok: false, code: "CUSTOM_MAPPING_EMPTY", message: "Add at least one field mapping." };
  }
  const tpl = getActiveStandardTemplate();
  if (
    staleLimit < 60 ||
    staleLimit > tpl.validationRules.staleSignalLimitSeconds
  ) {
    return {
      ok: false,
      code: "STALE_LIMIT_OUT_OF_RANGE",
      message: `Stale-signal limit must be between 60 and ${tpl.validationRules.staleSignalLimitSeconds} seconds.`
    };
  }
  for (const m of mappings) {
    if (!m.tradingViewField?.trim() || !m.goldMetaField) {
      return {
        ok: false,
        code: "CUSTOM_MAPPING_INVALID",
        message: "Each mapping needs a TradingView field and a GoldMeta field."
      };
    }
  }
  return { ok: true };
}

export async function saveCustomMapping(
  uid: string,
  mappings: FieldMapping[],
  staleSignalLimitSeconds: number,
  name = "Custom mapping"
): Promise<{ profile: UserTradingViewConnection; mapping: CustomMappingRecord }> {
  const validated = validateCustomMappings(mappings, staleSignalLimitSeconds);
  if (!validated.ok) {
    throw Object.assign(new Error(validated.message), { code: validated.code });
  }
  const id = `custom-${randomBytes(8).toString("hex")}`;
  const mapping: CustomMappingRecord = {
    id,
    uid,
    name,
    fieldMappings: mappings,
    staleSignalLimitSeconds,
    updatedAt: new Date().toISOString()
  };
  memoryMappings.set(`${uid}:${id}`, mapping);
  if (process.env.NODE_ENV !== "test" || process.env.GOLDMETA_TV_PROFILE_FIRESTORE) {
    try {
      const { getFirestore } = await import("firebase-admin/firestore");
      await getFirestore().doc(`users/${uid}/tradingViewCustomMappings/${id}`).set(mapping);
    } catch {
      /* memory already updated */
    }
  }
  const profile = await saveUserTradingViewConnection(uid, {
    templateMode: "custom",
    customMappingId: id,
    customFieldMappings: mappings,
    staleSignalLimitSeconds
  });
  return { profile, mapping };
}

/**
 * Apply custom field mappings onto a payload object before schema validation.
 * Cannot set uid, broker, AutoTrade, or risk fields — only known GoldMeta signal paths.
 */
export function applyCustomFieldMappings(
  raw: Record<string, unknown>,
  mappings: FieldMapping[]
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  const getPath = (obj: unknown, path: string): unknown => {
    return path.split(".").reduce<unknown>((acc, key) => {
      if (acc && typeof acc === "object" && !Array.isArray(acc) && key in (acc as object)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
  };
  const setPath = (obj: Record<string, unknown>, path: string, value: unknown) => {
    const parts = path.split(".");
    let cur: Record<string, unknown> = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]!;
      if (typeof cur[p] !== "object" || cur[p] === null || Array.isArray(cur[p])) {
        cur[p] = {};
      }
      cur = cur[p] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]!] = value;
  };

  const targetPath: Record<string, string> = {
    symbol: "symbol",
    exchange: "exchange",
    timeframe: "timeframe",
    timestamp: "barTime",
    open: "ohlcv.open",
    high: "ohlcv.high",
    low: "ohlcv.low",
    close: "ohlcv.close",
    volume: "ohlcv.volume",
    confidence: "metadata.confidence",
    poc: "levels.pocAll",
    vah: "levels.vahAll",
    val: "levels.valAll",
    trendMeter: "trend.strength",
    confirmationCandle: "confirmationCandle.confirmed",
    vwap: "optionalIndicators.vwap",
    ema21: "optionalIndicators.ema21",
    ema50: "optionalIndicators.ema50",
    ema200: "optionalIndicators.ema200",
    rsi: "optionalIndicators.rsi",
    atr: "optionalIndicators.atr.value",
    session: "sessionVolumeProfile.session",
    strategyId: "metadata.strategyId",
    alertId: "eventId",
    entry: "metadata.entry",
    stopLoss: "metadata.stopLoss",
    tp1: "metadata.tp1",
    tp2: "metadata.tp2",
    tp3: "metadata.tp3"
  };

  for (const m of mappings) {
    const value = getPath(raw, m.tradingViewField) ?? raw[m.tradingViewField];
    if (value === undefined) continue;
    const path = targetPath[m.goldMetaField];
    if (!path) continue;
    setPath(out, path, value);
  }

  // Strip any attempt to forge identity / execution controls
  delete out.uid;
  delete out.userId;
  delete out.brokerAccountId;
  delete out.autoTrade;
  delete out.riskSettings;
  delete out.executionPermission;
  return out;
}

export function publicConnectionView(profile: UserTradingViewConnection) {
  return {
    templateMode: profile.templateMode,
    templateId: profile.templateId,
    templateVersion: profile.templateVersion,
    connectionStatus: profile.connectionStatus,
    setupLabel: profile.templateMode === "custom" ? "Custom" : "GoldMeta Standard",
    selectedSymbolAlias: profile.selectedSymbolAlias,
    selectedTimeframes: profile.selectedTimeframes,
    lastSignalAt: profile.lastSignalAt,
    lastValidSignalAt: profile.lastValidSignalAt,
    lastRejectedSignalAt: profile.lastRejectedSignalAt,
    lastRejectReason: profile.lastRejectReason,
    hasWebhook: Boolean(profile.webhookId),
    webhookIdMasked: profile.webhookId
      ? `···${profile.webhookId.slice(-6)}`
      : null,
    customMappingId: profile.customMappingId,
    staleSignalLimitSeconds: profile.staleSignalLimitSeconds,
    updatedAt: profile.updatedAt
    // Never: webhookTokenHash, secrets, admin tokens
  };
}
