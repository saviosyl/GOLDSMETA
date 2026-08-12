/**
 * Atomic Demo qualification ownership claims.
 * Path: autotradeQualificationOwners/{accountKeyHash}
 *
 * One Pepperstone Demo account may be claimed by at most one GoldMeta UID.
 * Never exposes another user's UID/email to API clients.
 */

import { createHash } from "crypto";
import { getFirestore } from "firebase-admin/firestore";
import { normalizeAccountId } from "./qualificationStore";

export type QualificationOwnershipClaim = {
  ownerUid: string;
  normalizedAccountId: string;
  accountMasked: string | null;
  claimedAt: string;
  updatedAt: string;
  source: "CLAIM" | "BACKFILL";
};

export type OwnershipClaimResult =
  | { ok: true; claimed: boolean; ownerUid: string }
  | {
      ok: false;
      code: "QUALIFICATION_ACCOUNT_MISMATCH" | "QUALIFICATION_OWNERSHIP_CHECK_UNAVAILABLE";
      message: string;
    };

/** Deterministic non-sensitive doc id for a Demo account ownership claim. */
export function qualificationOwnerDocId(
  accountId: string | number | null | undefined
): string | null {
  const normalized = normalizeAccountId(accountId);
  if (!normalized) return null;
  return createHash("sha256")
    .update(`autotrade-qual-owner|${normalized}`)
    .digest("hex")
    .slice(0, 40);
}

function ownershipRef(accountKey: string) {
  return getFirestore().doc(`autotradeQualificationOwners/${accountKey}`);
}

export async function getQualificationOwnershipClaim(
  accountId: string | number | null | undefined
): Promise<QualificationOwnershipClaim | null> {
  const key = qualificationOwnerDocId(accountId);
  if (!key) return null;
  const snap = await ownershipRef(key).get();
  if (!snap.exists) return null;
  const data = snap.data() as Partial<QualificationOwnershipClaim>;
  if (!data.ownerUid || !data.normalizedAccountId) return null;
  return {
    ownerUid: String(data.ownerUid),
    normalizedAccountId: String(data.normalizedAccountId),
    accountMasked: typeof data.accountMasked === "string" ? data.accountMasked : null,
    claimedAt: typeof data.claimedAt === "string" ? data.claimedAt : "",
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
    source: data.source === "BACKFILL" ? "BACKFILL" : "CLAIM"
  };
}

/**
 * Transactionally claim Demo qualification ownership for startQualification.
 * - empty claim → claim for current UID
 * - same UID → idempotent continue
 * - different UID → QUALIFICATION_ACCOUNT_MISMATCH (never overwrite)
 */
export async function claimDemoQualificationOwnership(args: {
  uid: string;
  accountId: string | number;
  accountMasked: string | null;
}): Promise<OwnershipClaimResult> {
  const normalized = normalizeAccountId(args.accountId);
  const key = qualificationOwnerDocId(normalized);
  if (!normalized || !key) {
    return {
      ok: false,
      code: "QUALIFICATION_OWNERSHIP_CHECK_UNAVAILABLE",
      message: "Demo account ownership key unavailable"
    };
  }

  try {
    return await getFirestore().runTransaction(async (tx) => {
      const ref = ownershipRef(key);
      const snap = await tx.get(ref);
      const now = new Date().toISOString();

      if (snap.exists) {
        const existing = (snap.data() ?? {}) as Partial<QualificationOwnershipClaim>;
        const existingUid = String(existing.ownerUid ?? "").trim();
        if (!existingUid) {
          // Corrupt/empty owner — fail closed rather than steal.
          return {
            ok: false as const,
            code: "QUALIFICATION_OWNERSHIP_CHECK_UNAVAILABLE" as const,
            message: "Qualification ownership record is incomplete"
          };
        }
        if (existingUid === args.uid) {
          const existingMasked =
            typeof existing.accountMasked === "string" ? existing.accountMasked : null;
          tx.set(
            ref,
            {
              updatedAt: now,
              accountMasked: args.accountMasked ?? existingMasked
            },
            { merge: true }
          );
          return { ok: true as const, claimed: false, ownerUid: existingUid };
        }
        return {
          ok: false as const,
          code: "QUALIFICATION_ACCOUNT_MISMATCH" as const,
          message:
            "This Pepperstone Demo account already has qualification under another GoldMeta login"
        };
      }

      const claim: QualificationOwnershipClaim = {
        ownerUid: args.uid,
        normalizedAccountId: normalized,
        accountMasked: args.accountMasked,
        claimedAt: now,
        updatedAt: now,
        source: "CLAIM"
      };
      tx.set(ref, claim);
      return { ok: true as const, claimed: true, ownerUid: args.uid };
    });
  } catch (err) {
    return {
      ok: false,
      code: "QUALIFICATION_OWNERSHIP_CHECK_UNAVAILABLE",
      message:
        err instanceof Error
          ? err.message
          : "Qualification ownership claim failed"
    };
  }
}

/**
 * Backfill ownership from a proven started qualification (never fabricates history).
 * Does not overwrite a different owner's existing claim.
 */
export async function backfillOwnershipFromStartedQualification(args: {
  ownerUid: string;
  accountId: string | number;
  accountMasked: string | null;
}): Promise<OwnershipClaimResult> {
  const normalized = normalizeAccountId(args.accountId);
  const key = qualificationOwnerDocId(normalized);
  if (!normalized || !key) {
    return {
      ok: false,
      code: "QUALIFICATION_OWNERSHIP_CHECK_UNAVAILABLE",
      message: "Demo account ownership key unavailable"
    };
  }

  try {
    return await getFirestore().runTransaction(async (tx) => {
      const ref = ownershipRef(key);
      const snap = await tx.get(ref);
      const now = new Date().toISOString();
      if (snap.exists) {
        const existingUid = String(snap.data()?.ownerUid ?? "").trim();
        if (existingUid && existingUid !== args.ownerUid) {
          return {
            ok: false as const,
            code: "QUALIFICATION_ACCOUNT_MISMATCH" as const,
            message:
              "This Pepperstone Demo account already has qualification under another GoldMeta login"
          };
        }
        if (existingUid === args.ownerUid) {
          return { ok: true as const, claimed: false, ownerUid: existingUid };
        }
      }
      tx.set(
        ref,
        {
          ownerUid: args.ownerUid,
          normalizedAccountId: normalized,
          accountMasked: args.accountMasked,
          claimedAt: now,
          updatedAt: now,
          source: "BACKFILL"
        } satisfies QualificationOwnershipClaim,
        { merge: true }
      );
      return { ok: true as const, claimed: true, ownerUid: args.ownerUid };
    });
  } catch (err) {
    return {
      ok: false,
      code: "QUALIFICATION_OWNERSHIP_CHECK_UNAVAILABLE",
      message:
        err instanceof Error
          ? err.message
          : "Qualification ownership backfill failed"
    };
  }
}
