#!/usr/bin/env npx tsx
/**
 * Scan active session plans for invalid trade geometry.
 * Marks invalid active plans NO_VALID_PLAN — does NOT delete user history.
 *
 * Usage:
 *   npx tsx scripts/markInvalidSessionPlans.ts --dry-run
 *   npx tsx scripts/markInvalidSessionPlans.ts --apply
 *
 * Auth: FIREBASE_TOKEN (CI refresh token) or GOOGLE_APPLICATION_CREDENTIALS.
 * Never prints secrets. Never touches Firebase Auth users.
 */
import { applyGeometrySafetyGate } from "../src/services/decision/sessionPlanLifecycle";
import type { SessionPlanRecord } from "../src/services/decision/sessionPlanTypes";
import { validateTradePlanGeometry } from "../src/services/decision/tradePlanGeometry";

const dryRun = !process.argv.includes("--apply");
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "goldmeta-web";
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function getAccessToken(): Promise<string> {
  if (process.env.FIREBASE_TOKEN) {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: process.env.FIREBASE_TOKEN,
      client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
      client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi"
    });
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    const json = (await res.json()) as { access_token?: string; error?: string };
    if (!json.access_token) {
      throw new Error(`FIREBASE_TOKEN exchange failed: ${json.error ?? res.status}`);
    }
    return json.access_token;
  }
  throw new Error("Set FIREBASE_TOKEN or provide credentials for Firestore access");
}

/** Minimal Firestore value decoder. */
function decodeValue(v: unknown): unknown {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if ("nullValue" in o) return null;
  if ("stringValue" in o) return o.stringValue;
  if ("booleanValue" in o) return o.booleanValue;
  if ("integerValue" in o) return Number(o.integerValue);
  if ("doubleValue" in o) return Number(o.doubleValue);
  if ("mapValue" in o) {
    const fields = (o.mapValue as { fields?: Record<string, unknown> })?.fields ?? {};
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(fields)) out[k] = decodeValue(val);
    return out;
  }
  if ("arrayValue" in o) {
    const values = (o.arrayValue as { values?: unknown[] })?.values ?? [];
    return values.map(decodeValue);
  }
  return null;
}

function decodeDoc(fields: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields ?? {})) out[k] = decodeValue(v);
  return out;
}

function encodeValue(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(encodeValue) } };
  }
  if (typeof v === "object") {
    const fields: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      fields[k] = encodeValue(val);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

async function fsGet(token: string, path: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${FS}/${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}

async function fsPatch(
  token: string,
  path: string,
  data: Record<string, unknown>
): Promise<void> {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) fields[k] = encodeValue(v);
  const res = await fetch(`${FS}/${path}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fields })
  });
  if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status} ${await res.text()}`);
}

async function listUserIds(token: string): Promise<string[]> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  do {
    const url = new URL(`${FS}/userDirectory`);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`list userDirectory failed: ${res.status}`);
    const json = (await res.json()) as {
      documents?: Array<{ name: string }>;
      nextPageToken?: string;
    };
    for (const doc of json.documents ?? []) {
      const id = doc.name.split("/").pop();
      if (id) ids.add(id);
    }
    pageToken = json.nextPageToken;
  } while (pageToken);

  // Collection-group scan for sessionPlans/active
  const qRes = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "sessionPlans", allDescendants: true }]
        }
      })
    }
  );
  if (qRes.ok) {
    const rows = (await qRes.json()) as Array<{ document?: { name?: string } }>;
    for (const row of rows) {
      const name = row.document?.name ?? "";
      if (!name.endsWith("/sessionPlans/active")) continue;
      const parts = name.split("/");
      const usersIdx = parts.indexOf("users");
      if (usersIdx >= 0 && parts[usersIdx + 1]) ids.add(parts[usersIdx + 1]);
    }
  }
  return [...ids];
}

function isInvalidCandidate(data: SessionPlanRecord): {
  invalid: boolean;
  reasons: string[];
  alreadyMarked: boolean;
} {
  const claimedTrade = data.direction === "BUY" || data.direction === "SELL";
  const geometry = validateTradePlanGeometry({
    direction: data.direction,
    entryPrice: data.entry?.price ?? null,
    entryZoneLow: data.entry?.zoneLow ?? null,
    entryZoneHigh: data.entry?.zoneHigh ?? null,
    stop: data.stopLoss?.price ?? null,
    tp1:
      data.quickTarget?.tp1 ??
      data.takeProfits?.find((t) => t.label === "TP1")?.price ??
      null,
    tp2: data.takeProfits?.find((t) => t.label === "TP2")?.price ?? null,
    currentPrice: data.currentPrice,
    invalidationText: data.invalidation,
    quickTargetOk: claimedTrade ? data.quickTarget?.rrOk ?? false : data.quickTarget?.rrOk ?? null,
    marketStructureMode: data.marketStructureMode
  });

  const hardCodes = new Set([
    "ENTRY_EQUALS_STOP",
    "STOP_WRONG_SIDE",
    "TP1_WRONG_SIDE",
    "TP1_EQUALS_ENTRY",
    "ZERO_RISK",
    "INVALID_TARGET_ORDER",
    "PRICE_ALREADY_AT_TARGET",
    "INVALIDATION_STOP_MISMATCH",
    "ENTRY_ZONE_INVALID",
    "QUICK_TARGET_FAILED",
    "STRUCTURE_MISMATCH"
  ]);
  const hasHardGeometry = geometry.reasonCodes.some((c) => hardCodes.has(c));
  const missingOnClaimedTrade =
    claimedTrade && geometry.reasonCodes.includes("MISSING_REQUIRED_LEVEL");
  const qualityBlocked = ["C", "NO_PLAN"].includes(
    String(data.planQuality?.grade ?? "").toUpperCase()
  );
  const alreadyMarked =
    data.lifecycleState === "NO_VALID_PLAN" && data.geometryValid === false;

  if (!claimedTrade && !hasHardGeometry && !qualityBlocked && !alreadyMarked) {
    return { invalid: false, reasons: [], alreadyMarked };
  }
  if (geometry.actionable && !qualityBlocked && !alreadyMarked) {
    return { invalid: false, reasons: [], alreadyMarked };
  }
  if (!hasHardGeometry && !missingOnClaimedTrade && !qualityBlocked && !alreadyMarked) {
    return { invalid: false, reasons: [], alreadyMarked };
  }

  return {
    invalid: true,
    alreadyMarked,
    reasons: geometry.reasonCodes.length
      ? geometry.reasonCodes
      : qualityBlocked
        ? ["STRUCTURE_ONLY_OR_INCOMPLETE_TRADE_PLAN"]
        : ["GEOMETRY_INVALID"]
  };
}

async function main(): Promise<void> {
  const token = await getAccessToken();
  const userIds = await listUserIds(token);
  let scanned = 0;
  let invalid = 0;
  let marked = 0;
  const findings: Array<{ userId: string; planId: string; reasons: string[] }> = [];

  for (const userId of userIds) {
    const snap = await fsGet(token, `users/${userId}/sessionPlans/active`);
    if (!snap?.fields) continue;
    const data = decodeDoc(snap.fields as Record<string, unknown>) as unknown as SessionPlanRecord;
    if (!data.planId) continue;
    scanned += 1;

    const verdict = isInvalidCandidate(data);
    if (!verdict.invalid) continue;

    invalid += 1;
    findings.push({ userId, planId: data.planId, reasons: verdict.reasons });
    if (dryRun || verdict.alreadyMarked) continue;

    const gated = applyGeometrySafetyGate({
      ...data,
      userId,
      planId: data.planId
    });
    const payload = { ...gated, diagnosticsPreserved: true };
    await fsPatch(token, `users/${userId}/sessionPlans/${data.planId}`, payload);
    await fsPatch(token, `users/${userId}/sessionPlans/active`, {
      ...payload,
      activePointer: true
    });
    marked += 1;
  }

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "dry-run" : "apply",
        scanned,
        invalid,
        marked,
        userIdsConsidered: userIds.length,
        findings: findings.slice(0, 50),
        note: "User history preserved. Auth untouched. AutoTrade remains OFF."
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("markInvalidSessionPlans failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
