#!/usr/bin/env npx tsx
/**
 * BREAK-GLASS — controlled pinned owner Auth restore (explicit approval only).
 *
 * Requires:
 *   GOLDMETA_BREAK_GLASS_AUTH_RESTORE=YES_I_APPROVE_PINNED_OWNER_RESTORE
 *   GOLDMETA_PINNED_OWNER_UID (Secret Manager)
 *   GOLDMETA_OWNER_EMAIL=saviosyl@gmail.com
 *   GOLDMETA_TEMP_PASSWORD_FILE=<operator-only path>
 *
 * Never prints full UID or password. Does not touch Firestore/webhooks/secrets.
 * Never call from CI, Cloud Functions, or registration paths.
 */

import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { assertPinnedOwnerMutationAllowed } from "../src/services/auth/pinnedOwnerMutationGuard";

const APPROVAL = "YES_I_APPROVE_PINNED_OWNER_RESTORE";
const OWNER_EMAIL_DEFAULT = "saviosyl@gmail.com";

function redactUid(uid: string | null | undefined): string {
  if (!uid || uid.length < 8) return "null";
  return `${uid.slice(0, 4)}…${uid.slice(-4)}`;
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function fail(message: string, code = 2): never {
  console.error(`RESTORE_FAIL=${message}`);
  process.exit(code);
}

function generateTempPassword(): string {
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
    fail("BREAK_GLASS_NOT_APPROVED — set GOLDMETA_BREAK_GLASS_AUTH_RESTORE=" + APPROVAL);
  }

  const pinned = (process.env.GOLDMETA_PINNED_OWNER_UID ?? "").trim();
  const email = (process.env.GOLDMETA_OWNER_EMAIL ?? OWNER_EMAIL_DEFAULT).trim().toLowerCase();
  const passwordFile = (process.env.GOLDMETA_TEMP_PASSWORD_FILE ?? "").trim();

  if (!pinned || pinned.length < 20) fail("PINNED_UID_MISSING_OR_INVALID");
  if (!email.includes("@")) fail("OWNER_EMAIL_INVALID");
  if (!passwordFile) {
    fail("GOLDMETA_TEMP_PASSWORD_FILE required (operator-only path; never commit)");
  }

  // Deleting the incorrect replacement still requires mutation guard when email matches owner.
  assertPinnedOwnerMutationAllowed({
    mutation: "DELETE",
    targetEmail: email,
    source: {
      ...process.env,
      GOLDMETA_BREAK_GLASS_OWNER_AUTH_MUTATION: "1",
      GOLDMETA_BREAK_GLASS_OWNER_AUTH_CONFIRM: "I_UNDERSTAND_PINNED_OWNER_MUTATION"
    }
  });

  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      projectId: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "goldmeta-web"
    });
  }

  const auth = getAuth();
  const db = getFirestore();

  console.log("RESTORE_SNAPSHOT_BEGIN");
  console.log(`PINNED_HASH=${hashValue(pinned)} PINNED_MASK=${redactUid(pinned)}`);
  console.log(`OWNER_EMAIL_HASH=${hashValue(email)}`);

  let pinnedExisting = false;
  try {
    const u = await auth.getUser(pinned);
    pinnedExisting = true;
    const role = (u.customClaims as { role?: string } | undefined)?.role;
    if ((u.email ?? "").toLowerCase() === email && !u.disabled && u.emailVerified && role === "OWNER") {
      console.log("RESTORE_RESULT=ALREADY_HEALTHY_NOOP");
      console.log(`PINNED_UID=${redactUid(pinned)}`);
      process.exit(0);
    }
    fail(
      `PINNED_UID_EXISTS_WITH_UNEXPECTED_STATE email=${Boolean(u.email)} disabled=${u.disabled} verified=${u.emailVerified}`
    );
  } catch (e) {
    if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
  }

  let replacementUid: string | null = null;
  try {
    const byEmail = await auth.getUserByEmail(email);
    replacementUid = byEmail.uid;
    console.log(`REPLACEMENT_MASK=${redactUid(byEmail.uid)} HASH=${hashValue(byEmail.uid)}`);
    console.log(`REPLACEMENT_CREATED=${byEmail.metadata.creationTime}`);
    console.log(`REPLACEMENT_VERIFIED=${byEmail.emailVerified}`);
    console.log(`REPLACEMENT_CLAIMS=${JSON.stringify(byEmail.customClaims ?? {})}`);
  } catch (e) {
    if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
  }

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
    fail(`MULTIPLE_OWNER_EMAIL_ACCOUNTS count=${sameEmailUids.length}`);
  }
  if (pinnedExisting) fail("PINNED_ALREADY_EXISTS_ABORT");

  if (replacementUid) {
    if (replacementUid === pinned) fail("REPLACEMENT_EQUALS_PINNED_UNEXPECTED");
    const claims = (await auth.getUser(replacementUid)).customClaims ?? {};
    if (claims.role === "OWNER" || claims.owner === true) fail("REPLACEMENT_HAS_OWNER_MARKER_ABORT");
  }

  const hooks = await db.collection("webhookConnections").where("userId", "==", pinned).limit(5).get();
  console.log(
    `WEBHOOK_ON_PINNED_COUNT=${hooks.size} ACTIVE=${hooks.docs.filter((d) => d.data().status === "ACTIVE").length}`
  );
  const decisions = await db.collection("users").doc(pinned).collection("decisions").limit(1).get();
  console.log(`FIRESTORE_DECISIONS_PRESENT=${decisions.size > 0}`);
  console.log("RESTORE_SNAPSHOT_END");

  const tempPassword = generateTempPassword();
  writePasswordFile(passwordFile, tempPassword);
  console.log("TEMP_PASSWORD_FILE=written (contents never logged)");

  if (replacementUid) {
    console.log(`RESTORE_PHASE=DELETE_REPLACEMENT replacement=${redactUid(replacementUid)}`);
    const again = await auth.getUserByEmail(email);
    if (again.uid !== replacementUid) fail("REPLACEMENT_UID_CHANGED_BEFORE_DELETE");
    if (again.uid === pinned) fail("REFUSING_TO_DELETE_PINNED");
    if ((again.email ?? "").toLowerCase() !== email) fail("REFUSING_DELETE_EMAIL_MISMATCH");
    await auth.deleteUser(again.uid);
    console.log(`REPLACEMENT_DELETED=${redactUid(again.uid)}`);
    try {
      await auth.getUser(again.uid);
      fail("REPLACEMENT_STILL_EXISTS_AFTER_DELETE");
    } catch (e) {
      if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
    }
  }

  try {
    const created = await auth.createUser({
      uid: pinned,
      email,
      emailVerified: true,
      disabled: false,
      password: tempPassword,
      displayName: "GoldMeta Owner"
    });
    if (created.uid !== pinned) fail(`CREATE_RETURNED_WRONG_UID got=${redactUid(created.uid)}`);
    console.log("PINNED_CREATED=yes");
  } catch (error) {
    const code = (error as { code?: string }).code ?? "unknown";
    const message = error instanceof Error ? error.message : String(error);
    console.error(`CREATE_USER_FAILED code=${code}`);
    console.error(`CREATE_USER_FAILED_REDACTED=${message.replaceAll(pinned, redactUid(pinned))}`);
    console.error("COMPENSATING_ACTION=STOP — retry only exact pinned-UID createUser; do not SignUp");
    process.exit(3);
  }

  await auth.setCustomUserClaims(pinned, {
    role: "OWNER",
    owner: true,
    approved: true,
    admin: true,
    brokerAccess: true,
    brokerExecution: false,
    autoTrade: false,
    liveTrading: false,
    demoOrderSubmission: false
  });
  await auth.revokeRefreshTokens(pinned);
  console.log("OWNER_CLAIMS_SET=yes REFRESH_TOKENS_REVOKED=yes");

  try {
    await auth.generatePasswordResetLink(email);
    console.log("PASSWORD_RESET_LINK_GENERATED=yes (link not printed)");
  } catch (e) {
    console.log(`PASSWORD_RESET_LINK_SKIPPED code=${(e as { code?: string }).code ?? "unknown"}`);
  }

  const pinnedUser = await auth.getUser(pinned);
  const emailUser = await auth.getUserByEmail(email);
  if (emailUser.uid !== pinned) fail(`EMAIL_MAP_MISMATCH ${redactUid(emailUser.uid)}`);
  if (!pinnedUser.emailVerified) fail("EMAIL_NOT_VERIFIED");
  if (pinnedUser.disabled) fail("USER_DISABLED");
  if ((pinnedUser.customClaims as { role?: string } | undefined)?.role !== "OWNER") {
    fail("OWNER_CLAIM_MISSING");
  }
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
  console.log("ROLE=OWNER");
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
