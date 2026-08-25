#!/usr/bin/env npx tsx
/**
 * Read-only pre-restore safety check. Never mutates Auth.
 */
import { createHash } from "crypto";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  loadOwnerAuthConfig,
  maskUid,
  normalizeEmail
} from "../src/services/auth/ownerAuthConfig";

function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16);
}

function uidHash(uid: string): string {
  return createHash("sha256").update(uid).digest("hex").slice(0, 16);
}

async function main(): Promise<void> {
  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      projectId: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "goldmeta-web"
    });
  }
  const auth = getAuth();
  const db = getFirestore();
  const cfg = loadOwnerAuthConfig();
  if (!cfg.pinnedOwnerUid) {
    console.log(JSON.stringify({ error: "CONFIGURATION_MISSING" }));
    process.exit(2);
  }
  const pinned = cfg.pinnedOwnerUid;
  const ownerEmail = cfg.ownerEmail;

  let pinnedExists = false;
  try {
    await auth.getUser(pinned);
    pinnedExists = true;
  } catch (e: unknown) {
    if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
  }

  const emailUsers: Array<Record<string, unknown>> = [];
  try {
    const u = await auth.getUserByEmail(ownerEmail);
    emailUsers.push({
      uidMasked: maskUid(u.uid),
      uidHash: uidHash(u.uid),
      isPinned: u.uid === pinned,
      emailNormalizedMatch: normalizeEmail(u.email) === ownerEmail,
      emailVerified: u.emailVerified,
      disabled: u.disabled,
      claims: u.customClaims ?? {},
      created: u.metadata.creationTime,
      hasOwnerRoleClaim: (u.customClaims as { role?: string } | undefined)?.role === "OWNER"
    });
  } catch (e: unknown) {
    console.log(JSON.stringify({ emailLookup: (e as { code?: string }).code || String(e) }));
  }

  const decisions = await db.collection("users").doc(pinned).collection("decisions").limit(3).get();
  const webhooks = await db
    .collection("webhookConnections")
    .where("userId", "==", pinned)
    .limit(5)
    .get();

  const safeToProceed =
    !pinnedExists &&
    emailUsers.length === 1 &&
    emailUsers[0]?.isPinned === false &&
    emailUsers[0]?.emailNormalizedMatch === true &&
    emailUsers[0]?.emailVerified === false &&
    emailUsers[0]?.hasOwnerRoleClaim !== true;

  console.log(
    JSON.stringify(
      {
        pinnedExists,
        pinnedMasked: maskUid(pinned),
        pinnedHash: uidHash(pinned),
        ownerEmailHash: hashEmail(ownerEmail),
        emailUserCount: emailUsers.length,
        emailUsers,
        firestoreDecisionsUnderPinned: decisions.size,
        webhooksUnderPinned: webhooks.docs.map((d) => ({
          idPrefix: `${d.id.slice(0, 6)}…`,
          status: d.data().status,
          userId: maskUid(d.data().userId as string)
        })),
        safeToProceed
      },
      null,
      2
    )
  );
  process.exit(safeToProceed ? 0 : pinnedExists ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
