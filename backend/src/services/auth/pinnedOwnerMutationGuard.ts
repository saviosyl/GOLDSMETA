/**
 * Pinned owner Auth mutation guard — server/ops only.
 *
 * Blocks delete / disable / email-rename / anonymise of the pinned production
 * owner unless BOTH break-glass env flags are set. Never logs full UIDs.
 */

import {
  loadOwnerAuthConfig,
  maskUid,
  normalizeEmail,
  DEFAULT_OWNER_EMAIL
} from "./ownerAuthConfig";

export type DangerousAuthMutation =
  | "DELETE"
  | "DISABLE"
  | "EMAIL_RENAME"
  | "ANONYMISE"
  | "BULK_CLEANUP";

export class PinnedOwnerMutationBlockedError extends Error {
  readonly code = "PINNED_OWNER_MUTATION_BLOCKED";
  constructor(
    readonly mutation: DangerousAuthMutation,
    message: string
  ) {
    super(message);
    this.name = "PinnedOwnerMutationBlockedError";
  }
}

export function isBreakGlassOwnerMutationAllowed(
  source: NodeJS.ProcessEnv = process.env
): boolean {
  const flag = (source.GOLDMETA_BREAK_GLASS_OWNER_AUTH_MUTATION ?? "").trim() === "1";
  const confirm =
    (source.GOLDMETA_BREAK_GLASS_OWNER_AUTH_CONFIRM ?? "").trim() ===
    "I_UNDERSTAND_PINNED_OWNER_MUTATION";
  return flag && confirm;
}

export function isPinnedOwnerUid(
  uid: string | null | undefined,
  source: NodeJS.ProcessEnv = process.env
): boolean {
  const pinned = loadOwnerAuthConfig(source).pinnedOwnerUid;
  if (!pinned || !uid) return false;
  return uid.trim() === pinned;
}

export function isPinnedOwnerEmail(
  email: string | null | undefined,
  source: NodeJS.ProcessEnv = process.env
): boolean {
  const owner = loadOwnerAuthConfig(source).ownerEmail || DEFAULT_OWNER_EMAIL;
  const normalized = normalizeEmail(email);
  return Boolean(normalized && normalized === owner);
}

/**
 * Fail closed before any Auth delete/disable/rename/anonymise/bulk cleanup.
 * Call from operational scripts; never expose pinned UID in thrown messages.
 */
export function assertPinnedOwnerMutationAllowed(args: {
  mutation: DangerousAuthMutation;
  targetUid?: string | null;
  targetEmail?: string | null;
  source?: NodeJS.ProcessEnv;
}): void {
  const source = args.source ?? process.env;
  const touchesPinned =
    isPinnedOwnerUid(args.targetUid, source) ||
    isPinnedOwnerEmail(args.targetEmail, source);

  if (!touchesPinned) return;

  if (isBreakGlassOwnerMutationAllowed(source)) {
    // Redacted audit only — never print full UID/email secrets.
    console.warn(
      JSON.stringify({
        event: "PINNED_OWNER_BREAK_GLASS_MUTATION",
        mutation: args.mutation,
        targetUidRedacted: maskUid(args.targetUid),
        targetEmail: normalizeEmail(args.targetEmail) ? "[owner-email]" : null,
        at: new Date().toISOString()
      })
    );
    return;
  }

  throw new PinnedOwnerMutationBlockedError(
    args.mutation,
    `Refusing ${args.mutation} on pinned GoldMeta owner Auth subject. ` +
      "Set GOLDMETA_BREAK_GLASS_OWNER_AUTH_MUTATION=1 and " +
      "GOLDMETA_BREAK_GLASS_OWNER_AUTH_CONFIRM=I_UNDERSTAND_PINNED_OWNER_MUTATION " +
      "only for explicit manual break-glass."
  );
}
