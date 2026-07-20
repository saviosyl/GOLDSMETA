import { describe, expect, it } from "vitest";
import { DedupeStore } from "../../src/services/webhook/dedupe";

describe("dedupe store", () => {
  it("accepts a new event once and rejects replay until ttl expires", () => {
    const dedupe = new DedupeStore(1000);
    expect(dedupe.checkAndStore("event-1", 1000)).toBe(true);
    expect(dedupe.checkAndStore("event-1", 1200)).toBe(false);
    expect(dedupe.checkAndStore("event-1", 2101)).toBe(true);
  });
});
