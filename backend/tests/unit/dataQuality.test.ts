import { describe, expect, it } from "vitest";
import conflictedFixture from "../fixtures/conflicted.json";
import partialFixture from "../fixtures/partial.json";
import staleFixture from "../fixtures/stale.json";
import strongBuyFixture from "../fixtures/strongBuy.json";
import { freshPayload, stalePayload } from "../helpers";
import { evaluateDataQuality } from "../../src/services/snapshot/dataQuality";
import { mergeSnapshot } from "../../src/services/snapshot/mergeSnapshot";

describe("data quality", () => {
  it("marks complete fresh payloads as good", () => {
    const snapshot = mergeSnapshot(freshPayload(strongBuyFixture));
    expect(evaluateDataQuality(snapshot).quality).toBe("GOOD");
  });

  it("marks old market data as stale", () => {
    const snapshot = mergeSnapshot(stalePayload(staleFixture));
    expect(evaluateDataQuality(snapshot).quality).toBe("STALE");
  });

  it("marks directional contradictions as conflicted", () => {
    const snapshot = mergeSnapshot(freshPayload(conflictedFixture));
    expect(evaluateDataQuality(snapshot).quality).toBe("CONFLICTED");
  });

  it("marks null volume profile as partial with volumeProfile missing", () => {
    const snapshot = mergeSnapshot(freshPayload(partialFixture));
    const result = evaluateDataQuality(snapshot);
    expect(result.quality).toBe("PARTIAL");
    expect(result.missingInputs).toContain("volumeProfile");
  });
});
