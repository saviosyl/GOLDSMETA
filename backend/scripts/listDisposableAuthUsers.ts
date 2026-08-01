#!/usr/bin/env npx tsx
/**
 * Read-only listing of likely disposable Auth users (masked).
 * Does NOT delete. Never touches pinned owner.
 *
 * Usage (with ADC that can list Auth users):
 *   npx tsx scripts/listDisposableAuthUsers.ts
 */

import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { loadOwnerAuthConfig, maskUid } from "../src/services/auth/ownerAuthConfig";

const DISPOSABLE_PATTERNS = [
  /gm\.disposable/i,
  /gmpr41/i,
  /@web-library\.net$/i,
  /^gm[a-z0-9]+@web-library\.net$/i
];

async function main(): Promise<void> {
  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      projectId: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "goldmeta-web"
    });
  }
  const owner = loadOwnerAuthConfig();
  const auth = getAuth();
  const listed = await auth.listUsers(1000);
  const hits = listed.users.filter((u) => {
    const email = u.email ?? "";
    if (owner.pinnedOwnerUid && u.uid === owner.pinnedOwnerUid) return false;
    if (owner.ownerEmail && email.toLowerCase() === owner.ownerEmail) return false;
    if (u.emailVerified) return false;
    return DISPOSABLE_PATTERNS.some((re) => re.test(email));
  });

  console.log("DISPOSABLE_CANDIDATES", hits.length);
  for (const u of hits) {
    const domain = (u.email ?? "").split("@")[1] ?? "unknown";
    console.log(
      JSON.stringify({
        uidMasked: maskUid(u.uid),
        emailDomain: domain,
        emailVerified: u.emailVerified,
        createdAt: u.metadata.creationTime
      })
    );
  }
  console.log(
    "NOTE=Deletion requires a separate short-lived cleanup identity or Console. Never delete OWNER."
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
