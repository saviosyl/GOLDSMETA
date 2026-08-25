/**
 * Fail-closed exclusions for disposable / test Auth cleanup.
 * Never deletes or mutates the pinned production owner.
 */

import {
  assertPinnedOwnerMutationAllowed,
  isPinnedOwnerEmail,
  isPinnedOwnerUid
} from "./pinnedOwnerMutationGuard";
import { loadOwnerAuthConfig, normalizeEmail } from "./ownerAuthConfig";

export type CleanupCandidate = {
  uid?: string | null;
  email?: string | null;
  role?: string | null;
  ownerClaim?: boolean | null;
};

export type CleanupExclusionReason =
  | "PINNED_OWNER_UID"
  | "OWNER_EMAIL"
  | "OWNER_ROLE"
  | "OWNER_CLAIM";

/**
 * Returns why a candidate must be excluded from cleanup, or null if cleanup
 * of that subject is not blocked by owner identity rules alone.
 */
export function getOwnerCleanupExclusion(
  candidate: CleanupCandidate,
  source: NodeJS.ProcessEnv = process.env
): CleanupExclusionReason | null {
  if (isPinnedOwnerUid(candidate.uid, source)) return "PINNED_OWNER_UID";
  if (isPinnedOwnerEmail(candidate.email, source)) return "OWNER_EMAIL";
  if ((candidate.role ?? "").toUpperCase() === "OWNER") return "OWNER_ROLE";
  if (candidate.ownerClaim === true) return "OWNER_CLAIM";
  return null;
}

export function assertCleanupCandidateAllowed(
  candidate: CleanupCandidate,
  source: NodeJS.ProcessEnv = process.env
): void {
  const reason = getOwnerCleanupExclusion(candidate, source);
  if (reason) {
    assertPinnedOwnerMutationAllowed({
      mutation: "BULK_CLEANUP",
      targetUid: candidate.uid,
      targetEmail: candidate.email,
      source
    });
  }
}

/** Filter helpers for scripts — never returns owner subjects. */
export function filterDisposableCleanupCandidates<T extends CleanupCandidate>(
  candidates: T[],
  source: NodeJS.ProcessEnv = process.env
): T[] {
  const owner = loadOwnerAuthConfig(source);
  return candidates.filter((c) => {
    if (getOwnerCleanupExclusion(c, source)) return false;
    const email = normalizeEmail(c.email);
    if (email && owner.ownerEmail && email === owner.ownerEmail) return false;
    return true;
  });
}

/**
 * Deploy / CI must never invoke break-glass restore.
 * Static check used by unit tests and optional CI scripts.
 */
export function isOwnerRestoreScriptPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  return normalized.endsWith("restorepinnedownerauth.ts");
}
