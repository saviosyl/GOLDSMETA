/**
 * Bounded journal of UNPERSISTED / UNACKNOWLEDGED events only.
 * After persistence ACK, events are removed — lifetime event count does not overflow.
 */
import type { GhShadowCapturedEvent } from "./types";

export const GH_SHADOW_JOURNAL_DEFAULT_CAPACITY = 5_000;

export type GhShadowJournalStats = {
  journalPending: number;
  capacity: number;
  journalHighWaterMark: number;
  overflowCount: number;
  droppedOnOverflow: number;
  persistAcknowledgedEvents: number;
};

export class GhShadowEventJournal {
  private readonly pending: GhShadowCapturedEvent[] = [];
  private readonly capacity: number;
  private overflowCount = 0;
  private droppedOnOverflow = 0;
  private highWaterMark = 0;
  private persistAcknowledgedEvents = 0;

  constructor(capacity = GH_SHADOW_JOURNAL_DEFAULT_CAPACITY) {
    this.capacity = Math.max(1, capacity);
  }

  tryAppend(event: GhShadowCapturedEvent): boolean {
    if (this.pending.length >= this.capacity) {
      this.overflowCount += 1;
      this.droppedOnOverflow += 1;
      return false;
    }
    this.pending.push(event);
    this.highWaterMark = Math.max(this.highWaterMark, this.pending.length);
    return true;
  }

  peekPending(): readonly GhShadowCapturedEvent[] {
    return this.pending;
  }

  /** Snapshot pending events for a persist attempt (does not remove). */
  snapshotPending(): GhShadowCapturedEvent[] {
    return this.pending.map((e) => ({ ...e }));
  }

  /**
   * ACK successful persistence — remove acknowledged eventIds from pending.
   */
  acknowledge(eventIds: string[]): number {
    if (!eventIds.length) return 0;
    const set = new Set(eventIds);
    let removed = 0;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (set.has(this.pending[i]!.eventId)) {
        this.pending.splice(i, 1);
        removed += 1;
      }
    }
    this.persistAcknowledgedEvents += removed;
    return removed;
  }

  list(): readonly GhShadowCapturedEvent[] {
    return this.pending;
  }

  stats(): GhShadowJournalStats {
    return {
      journalPending: this.pending.length,
      capacity: this.capacity,
      journalHighWaterMark: this.highWaterMark,
      overflowCount: this.overflowCount,
      droppedOnOverflow: this.droppedOnOverflow,
      persistAcknowledgedEvents: this.persistAcknowledgedEvents
    };
  }

  clear(): void {
    this.pending.length = 0;
    this.overflowCount = 0;
    this.droppedOnOverflow = 0;
    this.highWaterMark = 0;
    // keep persistAcknowledgedEvents cumulative for epoch diagnostics
  }

  resetAllForTests(): void {
    this.clear();
    this.persistAcknowledgedEvents = 0;
  }
}
