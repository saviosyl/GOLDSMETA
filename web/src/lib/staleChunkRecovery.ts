/**
 * One-time recovery when a lazy-route chunk 404s after a Cloudflare deploy.
 * Guards against infinite reload loops via sessionStorage + build identity.
 */

import { GOLD_META_COMMIT_SHA } from "./buildIdentity";

export const STALE_CHUNK_RECOVERY_KEY = "gm-stale-chunk-recovery";

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const message =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "string"
        ? error
        : String(error);
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /ChunkLoadError/i.test(message) ||
    /Loading chunk [\d]+ failed/i.test(message) ||
    /Loading CSS chunk [\d]+ failed/i.test(message)
  );
}

type RecoveryRecord = {
  commit: string;
  at: number;
};

function readRecord(): RecoveryRecord | null {
  try {
    const raw = sessionStorage.getItem(STALE_CHUNK_RECOVERY_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RecoveryRecord;
  } catch {
    return null;
  }
}

/** True when we already attempted recovery for this build in this tab session. */
export function hasAttemptedStaleChunkRecovery(
  commitSha: string = GOLD_META_COMMIT_SHA
): boolean {
  const record = readRecord();
  if (!record) return false;
  return record.commit === commitSha;
}

/**
 * Attempt a one-time hard reload after unregistering controlling SW caches
 * that may still point at removed hashed assets.
 * Returns true when reload was scheduled.
 */
export async function attemptStaleChunkRecovery(args?: {
  commitSha?: string;
  reload?: () => void;
}): Promise<boolean> {
  const commitSha = args?.commitSha ?? GOLD_META_COMMIT_SHA;
  const reload = args?.reload ?? (() => window.location.reload());

  if (hasAttemptedStaleChunkRecovery(commitSha)) {
    return false;
  }

  try {
    sessionStorage.setItem(
      STALE_CHUNK_RECOVERY_KEY,
      JSON.stringify({ commit: commitSha, at: Date.now() } satisfies RecoveryRecord)
    );
  } catch {
    /* private mode — still attempt a single reload */
  }

  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.update().catch(() => undefined)));
    }
  } catch {
    /* ignore SW update failures */
  }

  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => /workbox|goldmeta|precache/i.test(k))
          .map((k) => caches.delete(k))
      );
    }
  } catch {
    /* ignore cache purge failures */
  }

  reload();
  return true;
}

export function clearStaleChunkRecoveryFlag(): void {
  try {
    sessionStorage.removeItem(STALE_CHUNK_RECOVERY_KEY);
  } catch {
    /* ignore */
  }
}
