/**
 * GoldMeta owner Auth protection — server-only configuration.
 * Pinned UID must never ship in web/iOS bundles.
 */

export const DEFAULT_OWNER_EMAIL = "saviosyl@gmail.com";

export type OwnerAuthConfig = {
  ownerEmail: string;
  pinnedOwnerUid: string | null;
};

export function loadOwnerAuthConfig(
  source: NodeJS.ProcessEnv = process.env
): OwnerAuthConfig {
  const ownerEmail = (
    source.GOLDMETA_OWNER_EMAIL ??
    source.OWNER_EMAIL ??
    DEFAULT_OWNER_EMAIL
  )
    .trim()
    .toLowerCase();

  const pinnedOwnerUid = (
    source.GOLDMETA_PINNED_OWNER_UID ??
    source.PINNED_OWNER_UID ??
    ""
  ).trim();

  return {
    ownerEmail,
    pinnedOwnerUid: pinnedOwnerUid.length > 0 ? pinnedOwnerUid : null
  };
}

export function maskUid(uid: string | null | undefined): string | null {
  if (!uid) return null;
  if (uid.length <= 8) return `${uid.slice(0, 2)}…${uid.slice(-2)}`;
  return `${uid.slice(0, 4)}…${uid.slice(-4)}`;
}

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}
