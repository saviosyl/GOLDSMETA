/**
 * Bounded serialized async queue — isolates slow I/O from quote hot path.
 *
 * pending decrements only in `finally` after `await task()`. A hung task
 * therefore occupies the serial slot forever unless the task itself fails
 * boundedly (preclaim timeouts). Do NOT raise maxPending to hide hangs.
 */

export type BoundedQueueStats = {
  pending: number;
  dropped: number;
  completed: number;
  maxPendingSeen: number;
  activeOpportunityId: string | null;
  activeStartedAt: string | null;
  oldestPendingAgeMs: number | null;
  queueStuck: boolean;
};

/** Active task older than this → queueStuck diagnostic (does not discard work). */
export const GH_QUEUE_STUCK_AGE_MS = 15_000;

export type BoundedQueueTaskMeta = {
  opportunityId?: string | null;
};

export class BoundedSerializedQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private dropped = 0;
  private completed = 0;
  private maxPendingSeen = 0;
  private readonly maxPending: number;
  private readonly name: string;
  private activeOpportunityId: string | null = null;
  private activeStartedAtMs: number | null = null;
  private stuckAgeMs: number;

  constructor(
    name: string,
    maxPending = 4,
    stuckAgeMs: number = GH_QUEUE_STUCK_AGE_MS
  ) {
    this.name = name;
    this.maxPending = Math.max(1, maxPending);
    this.stuckAgeMs =
      Number.isFinite(stuckAgeMs) && stuckAgeMs > 0
        ? stuckAgeMs
        : GH_QUEUE_STUCK_AGE_MS;
  }

  /**
   * Enqueue work. If at capacity, drop newest (backpressure) — never unbounded.
   * Returns false when dropped.
   */
  enqueue(
    task: () => Promise<void>,
    meta?: BoundedQueueTaskMeta
  ): boolean {
    if (this.pending >= this.maxPending) {
      this.dropped += 1;
      return false;
    }
    this.pending += 1;
    this.maxPendingSeen = Math.max(this.maxPendingSeen, this.pending);
    const opportunityId = meta?.opportunityId ?? null;
    this.tail = this.tail
      .then(async () => {
        this.activeOpportunityId = opportunityId;
        this.activeStartedAtMs = Date.now();
        try {
          await task();
        } catch {
          /* isolated — never reject the chain */
        } finally {
          this.activeOpportunityId = null;
          this.activeStartedAtMs = null;
          this.pending -= 1;
          this.completed += 1;
        }
      })
      .catch(() => undefined);
    return true;
  }

  stats(nowMs: number = Date.now()): BoundedQueueStats {
    const age =
      this.activeStartedAtMs != null
        ? Math.max(0, nowMs - this.activeStartedAtMs)
        : null;
    return {
      pending: this.pending,
      dropped: this.dropped,
      completed: this.completed,
      maxPendingSeen: this.maxPendingSeen,
      activeOpportunityId: this.activeOpportunityId,
      activeStartedAt:
        this.activeStartedAtMs != null
          ? new Date(this.activeStartedAtMs).toISOString()
          : null,
      oldestPendingAgeMs: age,
      queueStuck: age != null && age >= this.stuckAgeMs
    };
  }

  async drainForTests(): Promise<void> {
    await this.tail;
  }

  resetStatsForTests(): void {
    this.dropped = 0;
    this.completed = 0;
    this.maxPendingSeen = this.pending;
  }
}

const queues = new Map<string, BoundedSerializedQueue>();

export function getOwnerQueue(
  kind: string,
  ownerUid: string,
  maxPending = 4
): BoundedSerializedQueue {
  const key = `${kind}:${ownerUid}`;
  let q = queues.get(key);
  if (!q) {
    q = new BoundedSerializedQueue(`${kind}:${ownerUid}`, maxPending);
    queues.set(key, q);
  }
  return q;
}

export function resetOwnerQueuesForTests(): void {
  queues.clear();
}
