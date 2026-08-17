/**
 * Bounded in-memory event journal for shadow qualification.
 * Hot path appends here; async persistence is separate.
 * Overflow while a formal trade is open → caller must invalidate.
 */
import type { GhShadowCapturedEvent } from "./types";

export const GH_SHADOW_JOURNAL_DEFAULT_CAPACITY = 20_000;

export type GhShadowJournalStats = {
  size: number;
  capacity: number;
  overflowCount: number;
  droppedOnOverflow: number;
};

export class GhShadowEventJournal {
  private readonly events: GhShadowCapturedEvent[] = [];
  private readonly capacity: number;
  private overflowCount = 0;
  private droppedOnOverflow = 0;

  constructor(capacity = GH_SHADOW_JOURNAL_DEFAULT_CAPACITY) {
    this.capacity = Math.max(1, capacity);
  }

  /**
   * Append event. Returns false if capacity exceeded (event NOT stored).
   * Does not silently overwrite — caller must invalidate formal sample.
   */
  tryAppend(event: GhShadowCapturedEvent): boolean {
    if (this.events.length >= this.capacity) {
      this.overflowCount += 1;
      this.droppedOnOverflow += 1;
      return false;
    }
    this.events.push(event);
    return true;
  }

  list(): readonly GhShadowCapturedEvent[] {
    return this.events;
  }

  stats(): GhShadowJournalStats {
    return {
      size: this.events.length,
      capacity: this.capacity,
      overflowCount: this.overflowCount,
      droppedOnOverflow: this.droppedOnOverflow
    };
  }

  clear(): void {
    this.events.length = 0;
    this.overflowCount = 0;
    this.droppedOnOverflow = 0;
  }
}
