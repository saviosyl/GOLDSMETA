/**
 * Production storage policy for signal-outcome stores.
 * In-memory is allowed only in NODE_ENV=test or explicit local flag.
 * Otherwise fail closed when Firestore is unavailable.
 */

export const SIGNAL_OUTCOME_STORAGE_UNAVAILABLE = "SIGNAL_OUTCOME_STORAGE_UNAVAILABLE" as const;

export class SignalOutcomeStorageUnavailableError extends Error {
  readonly code = SIGNAL_OUTCOME_STORAGE_UNAVAILABLE;
  constructor(message = "Signal outcome storage unavailable") {
    super(message);
    this.name = "SignalOutcomeStorageUnavailableError";
  }
}

/** True when in-memory stores are explicitly permitted. */
export function allowInMemorySignalOutcomeStore(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (env.NODE_ENV === "test") return true;
  if (env.SIGNAL_OUTCOME_ALLOW_MEMORY === "true") return true;
  if (env.APP_ENV === "test" && env.STORAGE_BACKEND === "memory") return true;
  return false;
}

export function assertFirestoreOrAllowMemory(
  db: unknown,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (db != null) return;
  if (allowInMemorySignalOutcomeStore(env)) return;
  throw new SignalOutcomeStorageUnavailableError(
    "Firestore unavailable — refusing in-memory signal outcome store outside test/local"
  );
}
