#!/usr/bin/env npx tsx
/**
 * BREAK-GLASS — one-time controlled pinned owner Auth restore.
 *
 * REQUIRES explicit approval env:
 *   GOLDMETA_BREAK_GLASS_AUTH_RESTORE=YES_I_APPROVE_PINNED_OWNER_RESTORE
 *
 * Usage (operator workstation / cloud agent with ADC):
 *   GOLDMETA_PINNED_OWNER_UID="$(gcloud secrets versions access latest \
 *     --secret=GOLDMETA_PINNED_OWNER_UID --project=goldmeta-web)" \
 *   GOLDMETA_OWNER_EMAIL=saviosyl@gmail.com \
 *   GOLDMETA_BREAK_GLASS_AUTH_RESTORE=YES_I_APPROVE_PINNED_OWNER_RESTORE \
 *   GOLDMETA_TEMP_PASSWORD_FILE=/path/to/operator-only-file \
 *     npx tsx scripts/restorePinnedOwnerAuth.ts
 *
 * Safety:
 * - Never prints full UID or temporary password
 * - Deletes only the exact replacement UID resolved by owner email
 * - Creates user with explicit uid = pinned UID (never random)
 * - Fail-closed on mismatch; second execution is a no-op when already HEALTHY
 * - Does NOT touch Firestore, webhooks, or Secret Manager
 * - Not for production request paths / Cloud Functions
 */

import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const APPROVAL = "YES_I_APPROVE_PINNED_OWNER_RESTORE";
const OWNER_EMAIL_DEFAULT = "saviosyl@gmail.com";

function redactUid(uid: string | null | undefined): string {
  if (!uid || uid.length < 8) return "null";
  return `${uid.slice(0, 4)}…${uid.slice(-4)}`;
}

function fail(message: string, code = 2): never {
  console.error(`RESTORE_FAIL=${message}`);
  process.exit(code);
}

function generateTempPassword(): string {
  // 32 bytes → ~43 chars base64url; strong temporary credential
  return randomBytes(32).toString("base64url");
}

function writePasswordFile(path: string, password: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${password}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  if (!existsSync(path)) fail("PASSWORD_FILE_WRITE_FAILED");
}

async function main(): Promise<void> {
  if (process.env.GOLDMETA_BREAK_GLASS_AUTH_RESTORE !== APPROVAL) {
    fail(
      "BREAK_GLASS_NOT_APPROVED — set GOLDMETA_BREAK_GLASS_AUTH_RESTORE=" +
        APPROVAL
    );
  }

  const pinned = (process.env.GOLDMETA_PINNED_OWNER_UID ?? "").trim();
  const email = (
    process.env.GOLDMETA_OWNER_EMAIL ?? OWNER_EMAIL_DEFAULT
  )
    .trim()
    .toLowerCase();
  const passwordFile = (
    process.env.GOLDMETA_TEMP_PASSWORD_FILE ??
    ""
  ).trim();

  if (!pinned || pinned.length < 20) fail("PINNED_UID_MISSING_OR_INVALID");
  if (!email.includes("@")) fail("OWNER_EMAIL_INVALID");
  if (!passwordFile) {
    fail("GOLDMETA_TEMP_PASSWORD_FILE required (operator-only path; never commit)");
  }

  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      projectId:
        process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "goldmeta-web"
    });
  }

  const auth = getAuth();

  // --- Precondition scan ---
  let pinnedExisting = false;
  try {
    const u = await auth.getUser(pinned);
    pinnedExisting = true;
    if ((u.email ?? "").toLowerCase() === email && !u.disabled) {
      console.log("RESTORE_RESULT=ALREADY_HEALTHY_NOOP");
      console.log(`PINNED_UID=${redactUid(pinned)}`);
      console.log(`EMAIL_UID=${redactUid(u.uid)}`);
      console.log(`EMAIL_VERIFIED=${u.emailVerified}`);
      console.log(`DISABLED=${u.disabled}`);
      process.exit(0);
    }
    fail(
      `PINNED_UID_EXISTS_WITH_UNEXPECTED_STATE email=${Boolean(u.email)} disabled=${u.disabled}`
    );
  } catch (e) {
    if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
  }

  let replacementUid: string | null = null;
  try {
    const byEmail = await auth.getUserByEmail(email);
    replacementUid = byEmail.uid;
  } catch (e) {
    if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
  }

  // Duplicate email defense via listUsers
  const sameEmailUids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      if ((u.email ?? "").toLowerCase() === email) sameEmailUids.push(u.uid);
    }
    pageToken = page.pageToken;
  } while (pageToken);

  if (sameEmailUids.length > 1) {
    fail(
      `MULTIPLE_OWNER_EMAIL_ACCOUNTS count=${sameEmailUids.length} uids=${sameEmailUids.map(redactUid).join(",")}`
    );
  }

  if (pinnedExisting) fail("PINNED_ALREADY_EXISTS_ABORT");

  if (!replacementUid) {
    // Email free — create pinned only
    console.log("RESTORE_PHASE=CREATE_PINNED_ONLY (no replacement to delete)");
  } else {
    if (replacementUid === pinned) {
      fail("REPLACEMENT_EQUALS_PINNED_UNEXPECTED");
    }
    console.log(`RESTORE_PHASE=DELETE_REPLACEMENT replacement=${redactUid(replacementUid)}`);
  }

  // Generate password BEFORE any mutation
  const tempPassword = generateTempPassword();
  writePasswordFile(passwordFile, tempPassword);
  console.log("TEMP_PASSWORD_FILE=written (contents never logged)");

  // Delete replacement immediately before create
  if (replacementUid) {
    // Re-resolve immediately before delete (TOCTOU)
    const again = await auth.getUserByEmail(email);
    if (again.uid !== replacementUid) {
      fail(
        `REPLACEMENT_UID_CHANGED_BEFORE_DELETE expected=${redactUid(replacementUid)} got=${redactUid(again.uid)}`
      );
    }
    if (again.uid === pinned) fail("REFUSING_TO_DELETE_PINNED");
    await auth.deleteUser(again.uid);
    console.log(`REPLACEMENT_DELETED=${redactUid(again.uid)}`);

    // Confirm gone
    try {
      await auth.getUser(again.uid);
      fail("REPLACEMENT_STILL_EXISTS_AFTER_DELETE");
    } catch (e) {
      if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
    }
  }

  // Create with EXPLICIT pinned UID — never let Firebase assign random UID
  try {
    const created = await auth.createUser({
      uid: pinned,
      email,
      emailVerified: true,
      disabled: false,
      password: tempPassword
    });
    if (created.uid !== pinned) {
      fail(`CREATE_RETURNED_WRONG_UID got=${redactUid(created.uid)}`);
    }
    console.log("PINNED_CREATED=yes");
  } catch (error) {
    const code = (error as { code?: string }).code ?? "unknown";
    const message = error instanceof Error ? error.message : String(error);
    console.error(`CREATE_USER_FAILED code=${code}`);
    console.error(`CREATE_USER_FAILED_REDACTED=${message.replace(pinned, redactUid(pinned))}`);
    console.error(
      "COMPENSATING_ACTION=STOP — retry only exact pinned-UID createUser after diagnosing; do not SignUp"
    );
    process.exit(3);
  }

  // Post-create verification
  const pinnedUser = await auth.getUser(pinned);
  const emailUser = await auth.getUserByEmail(email);
  if (emailUser.uid !== pinned) fail(`EMAIL_MAP_MISMATCH ${redactUid(emailUser.uid)}`);
  if (!pinnedUser.emailVerified) fail("EMAIL_NOT_VERIFIED");
  if (pinnedUser.disabled) fail("USER_DISABLED");

  if (replacementUid) {
    try {
      await auth.getUser(replacementUid);
      fail("REPLACEMENT_STILL_EXISTS");
    } catch (e) {
      if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
    }
  }

  console.log("RESTORE_RESULT=SUCCESS");
  console.log(`PINNED_UID=${redactUid(pinned)}`);
  console.log(`EMAIL_UID=${redactUid(emailUser.uid)}`);
  console.log(`EMAIL_VERIFIED=${pinnedUser.emailVerified}`);
  console.log(`DISABLED=${pinnedUser.disabled}`);
  console.log("REPLACEMENT_ABSENT=yes");
  console.log("FIRESTORE_TOUCHED=no");
  console.log("WEBHOOK_TOUCHED=no");
  console.log("SECRET_ROTATED=no");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("RESTORE_FAIL=UNEXPECTED");
  console.error(`ERROR_REDACTED=${message.slice(0, 240)}`);
  process.exit(1);
});
