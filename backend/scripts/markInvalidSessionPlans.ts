#!/usr/bin/env npx tsx
/**
 * Scan active session plans for invalid trade geometry.
 * Marks invalid active plans NO_VALID_PLAN — does NOT delete user history.
 *
 * Usage:
 *   npx tsx scripts/markInvalidSessionPlans.ts --dry-run
 *   npx tsx scripts/markInvalidSessionPlans.ts --apply
 *
 * Never prints secrets. Never touches Firebase Auth users.
 */
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type Credential
} from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { applyGeometrySafetyGate } from "../src/services/decision/sessionPlanLifecycle";
import type { SessionPlanRecord } from "../src/services/decision/sessionPlanTypes";
import { validateTradePlanGeometry } from "../src/services/decision/tradePlanGeometry";

const dryRun = !process.argv.includes("--apply");
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "goldmeta-web";

/** Refresh FIREBASE_TOKEN (CI refresh token) into a short-lived access token. */
async function credentialFromFirebaseToken(refreshToken: string): Promise<Credential> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
    client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi"
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!json.access_token) {
    throw new Error(`FIREBASE_TOKEN exchange failed: ${json.error ?? res.status}`);
  }
  const accessToken = json.access_token;
  const expiresIn = json.expires_in ?? 3600;
  return {
    getAccessToken: async () => ({
      access_token: accessToken,
      expires_in: expiresIn
    })
  };
}

async function initDb(): Promise<Firestore> {
  if (!getApps().length) {
    let credential: Credential;
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      credential = applicationDefault();
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      credential = cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
    } else if (process.env.FIREBASE_TOKEN) {
      credential = await credentialFromFirebaseToken(process.env.FIREBASE_TOKEN);
    } else {
      credential = applicationDefault();
    }
    initializeApp({ credential, projectId: PROJECT_ID });
  }
  return getFirestore();
}

async function resolveUserIds(db: Firestore): Promise<string[]> {
  const ids = new Set<string>();
  for (const ref of await db.collection("users").listDocuments()) ids.add(ref.id);
  const directory = await db.collection("userDirectory").select().get();
  for (const doc of directory.docs) ids.add(doc.id);
  // Collection-group fallback for active pointers under users/{uid}/sessionPlans/active
  try {
    const group = await db.collectionGroup("sessionPlans").get();
    for (const doc of group.docs) {
      if (doc.id !== "active") continue;
      const userId = doc.ref.parent.parent?.id;
      if (userId) ids.add(userId);
    }
  } catch {
    // Ignore missing collection-group index — userDirectory/users paths are enough.
  }
  return [...ids];
}

async function main(): Promise<void> {
  const db = await initDb();
  const userIds = await resolveUserIds(db);
  let scanned = 0;
  let invalid = 0;
  let marked = 0;
  const findings: Array<{ userId: string; planId: string; reasons: string[] }> = [];

  for (const userId of userIds) {
    const activeSnap = await db.doc(`users/${userId}/sessionPlans/active`).get();
    if (!activeSnap.exists) continue;
    const data = activeSnap.data() as SessionPlanRecord | undefined;
    if (!data || !data.planId) continue;
    scanned += 1;

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

    // Skip pure wait / empty plans that never claimed BUY/SELL levels.
    if (!claimedTrade && !hasHardGeometry && !qualityBlocked && !alreadyMarked) {
      continue;
    }
    if (geometry.actionable && !qualityBlocked && !alreadyMarked) continue;
    if (!hasHardGeometry && !missingOnClaimedTrade && !qualityBlocked && !alreadyMarked) {
      continue;
    }

    invalid += 1;
    findings.push({
      userId,
      planId: data.planId,
      reasons: geometry.reasonCodes.length
        ? geometry.reasonCodes
        : qualityBlocked
          ? ["STRUCTURE_ONLY_OR_INCOMPLETE_TRADE_PLAN"]
          : ["GEOMETRY_INVALID"]
    });
    if (dryRun || alreadyMarked) continue;

    const gated = applyGeometrySafetyGate({
      ...data,
      userId,
      planId: data.planId
    });

    const batch = db.batch();
    const planRef = db.doc(`users/${userId}/sessionPlans/${data.planId}`);
    const activeRef = db.doc(`users/${userId}/sessionPlans/active`);
    batch.set(planRef, { ...gated, diagnosticsPreserved: true }, { merge: true });
    batch.set(
      activeRef,
      { ...gated, activePointer: true, diagnosticsPreserved: true },
      { merge: true }
    );
    await batch.commit();
    marked += 1;
  }

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "dry-run" : "apply",
        scanned,
        invalid,
        marked,
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
