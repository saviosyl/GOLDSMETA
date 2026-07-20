export class DedupeStore {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs: number) {}

  checkAndStore(eventId: string, now = Date.now()): boolean {
    this.prune(now);
    if (this.seen.has(eventId)) {
      return false;
    }
    this.seen.set(eventId, now + this.ttlMs);
    return true;
  }

  has(eventId: string, now = Date.now()): boolean {
    this.prune(now);
    return this.seen.has(eventId);
  }

  reset(): void {
    this.seen.clear();
  }

  private prune(now: number): void {
    for (const [eventId, expiresAt] of this.seen.entries()) {
      if (expiresAt <= now) {
        this.seen.delete(eventId);
      }
    }
  }
}
