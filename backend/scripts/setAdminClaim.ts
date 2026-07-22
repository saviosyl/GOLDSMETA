#!/usr/bin/env npx tsx
/**
 * One-time secure script: grant Firebase custom claim admin=true.
 *
 * Prerequisites:
 *   - GOOGLE_APPLICATION_CREDENTIALS pointing at a service account with
 *     Firebase Auth Admin privileges (or Application Default Credentials
 *     that can call identitytoolkit + IAM).
 *   - FIREBASE_PROJECT_ID / GOLDMETA_PROJECT_ID = goldmeta-web
 *
 * Usage (do not commit tokens or passwords):
 *   cd backend
 *   export GOLDMETA_PROJECT_ID=goldmeta-web
 *   npx tsx scripts/setAdminClaim.ts --uid iuayfBpUkZYEAlYlsTFxulSC4Ye2
 *
 *   # or by email:
 *   npx tsx scripts/setAdminClaim.ts --email saviosyl@gmail.com
 *
 * After running, the user must refresh their ID token (sign out/in or
 * getIdToken(true)) before /v1/admin/diagnostics succeeds.
 */
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
};

const uidArg = getArg("--uid");
const emailArg = getArg("--email");
const revoke = args.includes("--revoke");

async function main(): Promise<void> {
  if (!uidArg && !emailArg) {
    console.error("Provide --uid <firebaseUid> or --email <email>");
    process.exit(1);
  }

  const projectId =
    process.env.GOLDMETA_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    "goldmeta-web";

  if (!getApps().length) {
    initializeApp({ credential: applicationDefault(), projectId });
  }
  const auth = getAuth();
  const user = uidArg ? await auth.getUser(uidArg) : await auth.getUserByEmail(emailArg!);
  const nextClaims = { ...(user.customClaims ?? {}) };
  if (revoke) {
    delete nextClaims.admin;
  } else {
    nextClaims.admin = true;
  }
  await auth.setCustomUserClaims(user.uid, nextClaims);
  console.log(
    JSON.stringify(
      {
        uid: user.uid,
        email: user.email ?? null,
        admin: revoke ? false : true,
        note: "User must refresh ID token before claim is visible."
      },
      null,
      2
    )
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
