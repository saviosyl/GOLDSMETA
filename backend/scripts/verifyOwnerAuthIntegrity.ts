#!/usr/bin/env npx tsx
/**
 * Production deployment guard — owner Auth integrity (READ-ONLY).
 *
 * Usage (production ADC / service account):
 *   GOLDMETA_PINNED_OWNER_UID=... GOLDMETA_OWNER_EMAIL=saviosyl@gmail.com \
 *     npx tsx scripts/verifyOwnerAuthIntegrity.ts
 *
 * Exit codes:
 *   0 = HEALTHY
 *   2 = OWNER_UID_MISMATCH / OWNER_AUTH_MISSING / DUPLICATE_OWNER_EMAIL / CONFIGURATION_MISSING
 *   1 = unexpected error
 *
 * HARD RULES — this script must NEVER:
 *   - call deleteUser / createUser / updateUser / setCustomUserClaims for repair
 *   - rotate passwords or call SetAccountInfo
 *   - send password-reset / OOB emails
 *   - migrate or rewrite Firestore owner documents
 *
 * Deleting and recreating the owner by email creates the WRONG UID.
 * If STATUS != HEALTHY: stop deploy verification; use break-glass restore only
 * with explicit approval (scripts/restorePinnedOwnerAuth.ts).
 *
 * Do not run mutating Auth operations against production from ordinary unit tests.
 */

import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { loadOwnerAuthConfig, maskUid } from "../src/services/auth/ownerAuthConfig";
import { checkOwnerAuthIntegrity } from "../src/services/auth/authIntegrity";

async function main(): Promise<void> {
  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      projectId: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "goldmeta-web"
    });
  }

  const config = loadOwnerAuthConfig();
  if (!config.pinnedOwnerUid) {
    console.error("STATUS=CONFIGURATION_MISSING");
    console.error("Pinned owner UID is not configured (GOLDMETA_PINNED_OWNER_UID).");
    process.exit(2);
  }

  const auth = getAuth();
  const db = getFirestore();

  const result = await checkOwnerAuthIntegrity({
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
          return {
            webhookId: data.webhookId ?? d.id,
            status: data.status
          };
        });
      }
    }
  });

  console.log(`STATUS=${result.status}`);
  console.log(`OWNER_EMAIL=${result.ownerEmail}`);
  console.log(`EMAIL_UID=${result.emailUidRedacted ?? "null"}`);
  console.log(`PINNED_UID=${result.pinnedUidRedacted ?? maskUid(config.pinnedOwnerUid)}`);
  console.log(`ORIGINAL_EXISTS=${result.originalOwnerExists}`);
  console.log(`WEBHOOK_OWNED_BY_ORIGINAL=${result.webhookOwnedByOriginal}`);
  console.log(`MUTATED_AUTH=${result.mutatedAuth}`);
  for (const note of result.notes) {
    console.log(`NOTE=${note}`);
  }

  if (result.status !== "HEALTHY") {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error("STATUS=ERROR");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
