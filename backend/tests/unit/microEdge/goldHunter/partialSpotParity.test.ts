/**
 * Partial cTrader Spot last-known-side parity:
 * ResearchFeaturePipeline must match GoldHunterFastEngine.
 */
import { describe, expect, it } from "vitest";
import { ResearchFeaturePipeline } from "../../../../src/services/microEdge/goldHunter/fast/research/researchFeaturePipeline";
import { GoldHunterFastEngine } from "../../../../src/services/microEdge/goldHunter/fast/engine";
import { ShadowExecutionAdapter } from "../../../../src/services/microEdge/goldHunter/fast/executionAdapter";
import type { GhFastSpotEvent } from "../../../../src/services/microEdge/goldHunter/fast/types";

function spot(
  seq: number,
  t: number,
  bid: number | null,
  ask: number | null
): GhFastSpotEvent {
  return {
    kind: "SPOT",
    receiveSeq: seq,
    eventId: `SPOT:${seq}`,
    receivedAtMs: t,
    brokerTimestampMs: t,
    bid,
    ask
  };
}

describe("partial Spot last-known-side parity (Research vs Engine)", () => {
  it("builds complete pairs across bid-only / ask-only events", async () => {
    const research = new ResearchFeaturePipeline();
    const engine = new GoldHunterFastEngine({
      adapter: new ShadowExecutionAdapter(),
      useFrozenSoakConfig: true
    });

    const s1 = research.onSpot(spot(1, 1000, 4390.0, null));
    await engine.onMarketEvent(spot(1, 1000, 4390.0, null));
    expect(s1.lastFeatureSpot).toBeNull();
    expect(research.lastCompleteFeatureSpot()).toBeNull();
    expect(engine.status().bid).toBeCloseTo(4390.0, 5);
    expect(engine.status().ask).toBeNull();

    const s2 = research.onSpot(spot(2, 1001, null, 4390.1));
    await engine.onMarketEvent(spot(2, 1001, null, 4390.1));
    expect(s2.lastFeatureSpot).toEqual({ bid: 4390.0, ask: 4390.1 });
    expect(engine.status().bid).toBeCloseTo(4390.0, 5);
    expect(engine.status().ask).toBeCloseTo(4390.1, 5);

    const s3 = research.onSpot(spot(3, 1002, 4390.02, null));
    await engine.onMarketEvent(spot(3, 1002, 4390.02, null));
    expect(s3.lastFeatureSpot).toEqual({ bid: 4390.02, ask: 4390.1 });
    expect(engine.status().bid).toBeCloseTo(4390.02, 5);
    expect(engine.status().ask).toBeCloseTo(4390.1, 5);

    const s4 = research.onSpot(spot(4, 1003, null, 4390.12));
    await engine.onMarketEvent(spot(4, 1003, null, 4390.12));
    expect(s4.lastFeatureSpot).toEqual({ bid: 4390.02, ask: 4390.12 });
    expect(engine.status().bid).toBeCloseTo(4390.02, 5);
    expect(engine.status().ask).toBeCloseTo(4390.12, 5);

    const stats = research.spotPartialStats();
    expect(stats.spotBidOnlyEvents).toBe(2);
    expect(stats.spotAskOnlyEvents).toBe(2);
    expect(stats.spotTwoSidedEvents).toBe(0);
  });

  it("clearForResync drops lastBid/lastAsk — no pre-resync side leak", async () => {
    const research = new ResearchFeaturePipeline();
    const engine = new GoldHunterFastEngine({
      adapter: new ShadowExecutionAdapter(),
      useFrozenSoakConfig: true
    });

    research.onSpot(spot(1, 2000, 4390.0, null));
    research.onSpot(spot(2, 2001, null, 4390.1));
    await engine.onMarketEvent(spot(1, 2000, 4390.0, null));
    await engine.onMarketEvent(spot(2, 2001, null, 4390.1));
    expect(research.lastCompleteFeatureSpot()).toEqual({
      bid: 4390.0,
      ask: 4390.1
    });

    research.clearForResync();
    await engine.resetMarketDataForResync({
      reason: "test_partial_resync",
      nowMs: 2002,
      receiveSeq: 3
    });

    expect(research.lastKnownSpot()).toEqual({ bid: null, ask: null });
    expect(research.lastCompleteFeatureSpot()).toBeNull();
    expect(engine.status().bid).toBeNull();
    expect(engine.status().ask).toBeNull();

    // BID-only after resync must NOT reuse old ASK 4390.10
    const afterBid = research.onSpot(spot(4, 2003, 4391.0, null));
    await engine.onMarketEvent(spot(4, 2003, 4391.0, null));
    expect(afterBid.lastFeatureSpot).toBeNull();
    expect(research.lastKnownSpot()).toEqual({ bid: 4391.0, ask: null });
    expect(engine.status().bid).toBeCloseTo(4391.0, 5);
    expect(engine.status().ask).toBeNull();

    const afterAsk = research.onSpot(spot(5, 2004, null, 4391.12));
    await engine.onMarketEvent(spot(5, 2004, null, 4391.12));
    expect(afterAsk.lastFeatureSpot).toEqual({ bid: 4391.0, ask: 4391.12 });
    expect(engine.status().bid).toBeCloseTo(4391.0, 5);
    expect(engine.status().ask).toBeCloseTo(4391.12, 5);
  });
});
