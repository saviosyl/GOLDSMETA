#!/usr/bin/env npx tsx
/**
 * Pre-deploy OWNER Auth health gate (read-only).
 *
 * Exit 0 = HEALTHY and safety flags ok.
 * Exit 2 = OWNER_AUTH_HEALTH_GATE_FAILED (stop deploy; do not auto-restore).
 * Exit 1 = unexpected error.
 *
 * Never mutates Auth. Never calls restorePinnedOwnerAuth.
 */

import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { loadOwnerAuthConfig, maskUid } from "../src/services/auth/ownerAuthConfig";
import { checkOwnerAuthIntegrity } from "../src/services/auth/authIntegrity";

function fail(code: string, detail?: string): never {
  console.error("OWNER_AUTH_HEALTH_GATE_FAILED");
  console.error(`GATE_CODE=${code}`);
  if (detail) console.error(`GATE_DETAIL=${detail}`);
  console.error("STOP — do not deploy. Do not auto-restore. Require explicit break-glass approval.");
  process.exit(2);
}

async function main(): Promise<void> {
  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      projectId: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "goldmeta-web"
    });
  }

  const config = loadOwnerAuthConfig();
  if (!config.pinnedOwnerUid || !config.ownerEmail) {
    fail("CONFIGURATION_MISSING", "GOLDMETA_PINNED_OWNER_UID / owner email required");
  }

  const auth = getAuth();
  const db = getFirestore();

  const integrity = await checkOwnerAuthIntegrity({
    config,
    auth: {
      async getUserByEmail(email) {
        try {
          const user = await auth.getUserByEmail(email);
          return { uid: user.uid, email: user.email };
        } catch (error) {
          if ((error as { code?: string }).code === "auth/user-not-found") return null;
          throw error;
        }
      },
      async getUser(uid) {
        try {
          const user = await auth.getUser(uid);
          return { uid: user.uid, email: user.email };
        } catch (error) {
          if ((error as { code?: string }).code === "auth/user-not-found") return null;
          throw error;
        }
      },
      async listWebhookConnectionsForUser(userId) {
        const snap = await db
          .collection("webhookConnections")
          .where("userId", "==", userId)
          .limit(50)
          .get();
        return snap.docs.map((d) => {
          const data = d.data() as { webhookId?: string; status?: string };
          return { webhookId: data.webhookId ?? d.id, status: data.status };
        });
      }
    }
  });

  console.log(`INTEGRITY_STATUS=${integrity.status}`);
  console.log(`PINNED_UID=${integrity.pinnedUidRedacted}`);
  console.log(`EMAIL_UID=${integrity.emailUidRedacted}`);
  console.log(`WEBHOOK_OWNED_BY_ORIGINAL=${integrity.webhookOwnedByOriginal}`);

  if (integrity.status !== "HEALTHY") {
    fail(integrity.status, integrity.notes.join("; "));
  }

  const pinned = config.pinnedOwnerUid!;
  const user = await auth.getUser(pinned);
  if (!user.emailVerified) fail("EMAIL_NOT_VERIFIED");
  if (user.disabled) fail("USER_DISABLED");

  const claims = (user.customClaims ?? {}) as Record<string, unknown>;
  if (claims.role !== "OWNER") fail("ROLE_NOT_OWNER");
  if (claims.owner !== true) fail("OWNER_CLAIM_MISSING");
  if (claims.approved !== true) fail("APPROVED_CLAIM_MISSING");
  if (claims.admin !== true) fail("ADMIN_CLAIM_MISSING");
  if (claims.brokerExecution === true) fail("BROKER_EXECUTION_MUST_BE_FALSE");
  if (claims.autoTrade === true) fail("AUTOTRADE_MUST_BE_FALSE");
  if (claims.liveTrading === true) fail("LIVE_TRADING_MUST_BE_FALSE");
  if (claims.demoOrderSubmission === true) fail("DEMO_ORDER_SUBMISSION_MUST_BE_FALSE");

  const profile = await db.doc(`users/${pinned}/profile/main`).get();
  if (!profile.exists) fail("FIRESTORE_PROFILE_MISSING");
  const pdata = profile.data() as Record<string, unknown>;
  if (pdata.role !== "OWNER") fail("FIRESTORE_ROLE_NOT_OWNER");
  if (pdata.autoTrade === true) fail("FIRESTORE_AUTOTRADE_TRUE");
  if (pdata.brokerExecution === true) fail("FIRESTORE_BROKER_EXECUTION_TRUE");
  if (pdata.liveTrading === true) fail("FIRESTORE_LIVE_TRADING_TRUE");
  if (pdata.demoOrderSubmission === true) fail("FIRESTORE_DEMO_ORDER_TRUE");

  const directory = await db.collection("userDirectory").doc(pinned).get();
  if (!directory.exists) fail("DIRECTORY_MAPPING_MISSING");
  if ((directory.data() as { role?: string }).role !== "OWNER") {
    fail("DIRECTORY_ROLE_NOT_OWNER");
  }

  if (integrity.webhookOwnedByOriginal !== true) {
    fail("WEBHOOK_NOT_ON_PINNED");
  }

  console.log("OWNER_AUTH_HEALTH_GATE=PASS");
  console.log(`OWNER_EMAIL=${config.ownerEmail}`);
  console.log(`PINNED_MASK=${maskUid(pinned)}`);
  console.log("MUTATED_AUTH=false");
  console.log("RESTORE_INVOKED=false");
}

main().catch((error) => {
  console.error("OWNER_AUTH_HEALTH_GATE_FAILED");
  console.error(`GATE_CODE=UNEXPECTED`);
  console.error(`GATE_DETAIL=${String(error instanceof Error ? error.message : error).slice(0, 200)}`);
  process.exit(1);
});
