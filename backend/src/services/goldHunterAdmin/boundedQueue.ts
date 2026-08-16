/**
 * Bounded serialized async queue — isolates slow I/O from quote hot path.
 */
export type BoundedQueueStats = {
  pending: number;
  dropped: number;
  completed: number;
  maxPendingSeen: number;
};

export class BoundedSerializedQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private dropped = 0;
  private completed = 0;
  private maxPendingSeen = 0;
  private readonly maxPending: number;
  private readonly name: string;

  constructor(name: string, maxPending = 4) {
    this.name = name;
    this.maxPending = Math.max(1, maxPending);
  }

  /**
   * Enqueue work. If at capacity, drop newest (backpressure) — never unbounded.
   * Returns false when dropped.
   */
  enqueue(task: () => Promise<void>): boolean {
    if (this.pending >= this.maxPending) {
      this.dropped += 1;
      return false;
    }
    this.pending += 1;
    this.maxPendingSeen = Math.max(this.maxPendingSeen, this.pending);
    this.tail = this.tail
      .then(async () => {
        try {
          await task();
        } catch {
          /* isolated — never reject the chain */
        } finally {
          this.pending -= 1;
          this.completed += 1;
        }
      })
      .catch(() => undefined);
    return true;
  }

  stats(): BoundedQueueStats {
    return {
      pending: this.pending,
      dropped: this.dropped,
      completed: this.completed,
      maxPendingSeen: this.maxPendingSeen
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
