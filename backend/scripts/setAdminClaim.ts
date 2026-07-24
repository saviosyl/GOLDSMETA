#!/usr/bin/env npx tsx
/**
 * One-time secure script: grant Firebase custom claim admin=true.
 *
 * Never prints full UIDs. Never deletes/disables/renames Auth users.
 * Owner email/UID claim changes that are not admin-flag toggles still require
 * break-glass only when combined with dangerous mutations (see mutation guard).
 *
 * Usage:
 *   npx tsx scripts/setAdminClaim.ts --email saviosyl@gmail.com
 *   npx tsx scripts/setAdminClaim.ts --uid <uid>
 */
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { maskUid } from "../src/services/auth/ownerAuthConfig";
import {
  assertPinnedOwnerMutationAllowed,
  isPinnedOwnerEmail,
  isPinnedOwnerUid
} from "../src/services/auth/pinnedOwnerMutationGuard";

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

  // Refuse dangerous flags if someone extends this script later.
  if (args.includes("--delete") || args.includes("--disable") || args.includes("--anonymise")) {
    assertPinnedOwnerMutationAllowed({
      mutation: args.includes("--delete")
        ? "DELETE"
        : args.includes("--disable")
          ? "DISABLE"
          : "ANONYMISE",
      targetUid: uidArg,
      targetEmail: emailArg
    });
    console.error("Dangerous Auth mutation flags are not supported by this script.");
    process.exit(2);
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

  if (isPinnedOwnerUid(user.uid) || isPinnedOwnerEmail(user.email)) {
    // Admin claim toggle on owner is allowed; never rotate password / delete here.
    console.log("TARGET=pinned-owner (admin claim toggle only; no delete/disable/password)");
  }

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
        uidMasked: maskUid(user.uid),
        emailPresent: Boolean(user.email),
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
