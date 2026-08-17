/**
 * Bound Gold Hunter PRE-CLAIM read-only I/O so one hung Firestore/broker
 * metadata call cannot permanently stall the serialized execution queue.
 *
 * Safety:
 * - Use ONLY before durable claim / broker submit.
 * - On timeout the caller must fail closed (no claim) and return so the
 *   queue `finally` decrements pending. The underlying Promise is not
 *   cancelled — never claim/submit after a timed-out preclaim path.
 */

export class GoldHunterPreclaimTimeoutError extends Error {
  readonly op: string;
  readonly stage: string;
  readonly timeoutMs: number;
  constructor(op: string, stage: string, timeoutMs: number) {
    super(`${op}_TIMEOUT`);
    this.name = "GoldHunterPreclaimTimeoutError";
    this.op = op;
    this.stage = stage;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Observed healthy enqueue→preclaim on goldmeta-quote-worker-00019: 0.8–1.7s
 * (including config load + identity/freshness). Broker symbol load completed
 * within that window on e7. Timeouts are ~2–3× the healthy p90, not fragile.
 */
export const GH_PRECLAIM_FIRESTORE_TIMEOUT_MS = 3_000;
export const GH_PRECLAIM_BROKER_METADATA_TIMEOUT_MS = 5_000;
export const GH_PRECLAIM_ACCOUNT_TIMEOUT_MS = 5_000;

export async function withGoldHunterPreclaimTimeout<T>(
  op: string,
  stage: string,
  timeoutMs: number,
  work: () => Promise<T>
): Promise<T> {
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new GoldHunterPreclaimTimeoutError(op, stage, ms)),
          ms
        );
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function isGoldHunterPreclaimTimeout(
  error: unknown
): error is GoldHunterPreclaimTimeoutError {
  return error instanceof GoldHunterPreclaimTimeoutError;
}
