/**
 * GOLD HUNTER Admin — config + audit persistence.
 * Firestore-backed with in-memory fallback for tests / no-Firebase shells.
 * Namespace isolated from Core AutoTrade settings.
 */

import { randomUUID } from "crypto";
import { getFirestoreDb } from "../firebaseAdmin";
import {
  GH_ADMIN_ALLOCATION_PRESETS_EUR,
  GH_ADMIN_DEFAULT_CONFIG,
  type GoldHunterAdminConfig,
  type GoldHunterAuditEntry
} from "./types";
import {
  GH_DEMO_MAX_OPEN_TRADES_REQUIRED,
  validateGoldHunterConfigPatch
} from "./configValidation";

const memoryConfig = new Map<string, GoldHunterAdminConfig>();
const memoryAudit = new Map<string, GoldHunterAuditEntry[]>();

export function resetGoldHunterAdminMemory(): void {
  memoryConfig.clear();
  memoryAudit.clear();
}

function configPath(ownerUid: string): string {
  return `users/${ownerUid}/goldHunterAdmin/config`;
}

export function validateAllocationEur(value: number): {
  ok: boolean;
  reason?: string;
} {
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, reason: "allocation_must_be_positive" };
  }
  if (value > 1_000_000) {
    return { ok: false, reason: "allocation_too_large" };
  }
  return { ok: true };
}

function finitePositiveOrDefault(
  value: unknown,
  fallback: number
): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function normalizeConfig(
  d: Partial<GoldHunterAdminConfig> | undefined
): GoldHunterAdminConfig {
  const now = new Date().toISOString();
  // Do not accept NaN/Infinity into runtime config. Defaults are safe placeholders;
  // projected-risk / save validation still fail closed on invalid patches.
  const maxOpenRaw = d?.maxOpenTrades;
  const maxOpenTrades =
    typeof maxOpenRaw === "number" &&
    Number.isFinite(maxOpenRaw) &&
    Number.isInteger(maxOpenRaw) &&
    maxOpenRaw === GH_DEMO_MAX_OPEN_TRADES_REQUIRED
      ? maxOpenRaw
      : GH_DEMO_MAX_OPEN_TRADES_REQUIRED;
  return {
    allocatedCapitalEur: finitePositiveOrDefault(
      d?.allocatedCapitalEur,
      GH_ADMIN_DEFAULT_CONFIG.allocatedCapitalEur
    ),
    riskPerTradePct: finitePositiveOrDefault(
      d?.riskPerTradePct,
      GH_ADMIN_DEFAULT_CONFIG.riskPerTradePct
    ),
    dailyLossLimitPct: finitePositiveOrDefault(
      d?.dailyLossLimitPct,
      GH_ADMIN_DEFAULT_CONFIG.dailyLossLimitPct
    ),
    maxOpenTrades,
    demoAutoTradeEnabled: Boolean(d?.demoAutoTradeEnabled),
    pauseNewEntries: Boolean(d?.pauseNewEntries),
    emergencyStopActive: Boolean(d?.emergencyStopActive),
    mode:
      d?.mode === "DEMO_AUTO" || d?.mode === "RESEARCH" || d?.mode === "LIVE_LOCKED"
        ? d.mode
        : d?.demoAutoTradeEnabled
          ? "DEMO_AUTO"
          : "RESEARCH",
    updatedAt: typeof d?.updatedAt === "string" ? d.updatedAt : now,
    updatedBy: typeof d?.updatedBy === "string" ? d.updatedBy : "system"
  };
}

export async function loadGoldHunterConfig(
  ownerUid: string
): Promise<GoldHunterAdminConfig> {
  const db = getFirestoreDb();
  if (!db) {
    const mem = memoryConfig.get(ownerUid);
    return mem ?? normalizeConfig(undefined);
  }
  const snap = await db.doc(configPath(ownerUid)).get();
  if (!snap.exists) {
    return normalizeConfig(undefined);
  }
  return normalizeConfig(snap.data() as Partial<GoldHunterAdminConfig>);
}

export async function saveGoldHunterConfig(
  ownerUid: string,
  patch: Partial<GoldHunterAdminConfig>,
  updatedBy: string
): Promise<GoldHunterAdminConfig> {
  const current = await loadGoldHunterConfig(ownerUid);
  const patchCheck = validateGoldHunterConfigPatch(patch);
  if (!patchCheck.ok) {
    throw Object.assign(new Error("INVALID_GOLD_HUNTER_CONFIG"), {
      code: patchCheck.detail ?? "config_invalid",
      issues: patchCheck.issues
    });
  }
  if (patch.allocatedCapitalEur != null) {
    const v = validateAllocationEur(patch.allocatedCapitalEur);
    if (!v.ok) {
      throw Object.assign(new Error("INVALID_ALLOCATION"), {
        code: v.reason
      });
    }
  }
  if ((patch.mode as string) === "LIVE") {
    throw Object.assign(new Error("LIVE_MODE_FORBIDDEN"), {
      code: "live_execution_disabled"
    });
  }

  const next: GoldHunterAdminConfig = {
    ...current,
    ...patch,
    // Demo phase hard pin — never persist maxOpenTrades other than 1.
    maxOpenTrades:
      patch.maxOpenTrades !== undefined
        ? GH_DEMO_MAX_OPEN_TRADES_REQUIRED
        : current.maxOpenTrades === GH_DEMO_MAX_OPEN_TRADES_REQUIRED
          ? current.maxOpenTrades
          : GH_DEMO_MAX_OPEN_TRADES_REQUIRED,
    mode:
      patch.demoAutoTradeEnabled === true
        ? "DEMO_AUTO"
        : patch.demoAutoTradeEnabled === false
          ? "RESEARCH"
          : patch.mode === "DEMO_AUTO" || patch.mode === "RESEARCH"
            ? patch.mode
            : current.demoAutoTradeEnabled
              ? "DEMO_AUTO"
              : "RESEARCH",
    emergencyStopActive:
      patch.emergencyStopActive === true
        ? true
        : patch.emergencyStopActive === false
          ? false
          : current.emergencyStopActive,
    updatedAt: new Date().toISOString(),
    updatedBy
  };

  if (patch.demoAutoTradeEnabled === true) {
    next.emergencyStopActive = false;
    next.pauseNewEntries = false;
    next.mode = "DEMO_AUTO";
  }
  if (patch.emergencyStopActive === true) {
    next.demoAutoTradeEnabled = false;
    next.mode = "RESEARCH";
  }

  // LIVE is display-lock only — never an active execution mode.
  if (next.mode === "LIVE_LOCKED") {
    next.demoAutoTradeEnabled = false;
  }

  const db = getFirestoreDb();
  if (!db) {
    memoryConfig.set(ownerUid, next);
    return next;
  }
  await db.doc(configPath(ownerUid)).set(next, { merge: true });
  return next;
}

export async function appendGoldHunterAudit(
  ownerUid: string,
  entry: Omit<GoldHunterAuditEntry, "id">
): Promise<void> {
  const full: GoldHunterAuditEntry = { ...entry, id: randomUUID() };
  const db = getFirestoreDb();
  if (!db) {
    const list = memoryAudit.get(ownerUid) ?? [];
    list.unshift(full);
    memoryAudit.set(ownerUid, list.slice(0, 200));
    return;
  }
  await db
    .collection("users")
    .doc(ownerUid)
    .collection("goldHunterAdminAudit")
    .doc(full.id)
    .set(full);
}

export async function listGoldHunterAudit(
  ownerUid: string,
  limit = 40
): Promise<GoldHunterAuditEntry[]> {
  const n = Math.min(100, Math.max(1, limit));
  const db = getFirestoreDb();
  if (!db) {
    return (memoryAudit.get(ownerUid) ?? []).slice(0, n);
  }
  const snap = await db
    .collection("users")
    .doc(ownerUid)
    .collection("goldHunterAdminAudit")
    .orderBy("at", "desc")
    .limit(n)
    .get();
  return snap.docs.map((d) => d.data() as GoldHunterAuditEntry);
}

export { GH_ADMIN_ALLOCATION_PRESETS_EUR };
