/**
 * Level-II DepthBook invariants + sustained-cross recovery + disconnect ghost fix.
 * Forensic basis: gh_research_mst6992t_ug7ykh stale bid 4387.32 / quote 2361229607.
 */
import { describe, expect, it, vi } from "vitest";
import { InMemoryDepthBook } from "../../../../src/services/microEdge/goldHunter/fast/depthBook";
import {
  decideSustainedCrossRecovery,
  GH_FAST_SUSTAINED_CROSS_RECOVERY_COOLDOWN_MS,
  GH_FAST_SUSTAINED_CROSS_RECOVERY_MS,
  classifyResearchDepthValidity
} from "../../../../src/services/microEdge/goldHunter/fast/depthRecovery";
import { ResearchIngestBridge } from "../../../../src/services/microEdge/goldHunter/fast/research/researchIngestBridge";
import { ResearchFeaturePipeline } from "../../../../src/services/microEdge/goldHunter/fast/research/researchFeaturePipeline";
import type { GhFastDepthEvent } from "../../../../src/services/microEdge/goldHunter/fast/types";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function depthEv(
  seq: number,
  t: number,
  newQuotes: GhFastDepthEvent["newQuotes"],
  deletedQuotes: GhFastDepthEvent["deletedQuotes"] = []
): GhFastDepthEvent {
  return {
    kind: "DEPTH",
    receiveSeq: seq,
    eventId: `DEPTH:${seq}`,
    receivedAtMs: t,
    brokerTimestampMs: null,
    newQuotes,
    deletedQuotes
  };
}

describe("DepthBook invariants (Level-II)", () => {
  it("1. deleted quote ID cannot remain best bid/ask", () => {
    const book = new InMemoryDepthBook();
    book.applyDepthEvent(
      depthEv(1, 1000, [
        { id: "2361229607", type: "BID", price: 4387.32, size: 1 },
        { id: "a1", type: "ASK", price: 4387.43, size: 1 }
      ])
    );
    expect(book.stats().bestBid).toBe(4387.32);
    book.applyDepthEvent(depthEv(2, 1100, [], ["2361229607"]));
    expect(book.hasQuoteId("2361229607")).toBe(false);
    expect(book.stats().bestBid).not.toBe(4387.32);
    expect(book.stats().deleteHits).toBe(1);
  });

  it("2. updated quote ID replaces prior price/size", () => {
    const book = new InMemoryDepthBook();
    book.applyDepthEvent(
      depthEv(1, 1000, [
        { id: "b1", type: "BID", price: 100, size: 2 },
        { id: "a1", type: "ASK", price: 100.2, size: 1 }
      ])
    );
    book.applyDepthEvent(
      depthEv(2, 1100, [{ id: "b1", type: "BID", price: 100.05, size: 5 }])
    );
    expect(book.stats().bestBid).toBe(100.05);
    expect(book.stats().topBidDepth).toBe(5);
  });

  it("3. side migration cannot leave duplicate opposite-side level", () => {
    const book = new InMemoryDepthBook();
    book.applyDepthEvent(
      depthEv(1, 1000, [
        { id: "q1", type: "BID", price: 100, size: 1 },
        { id: "a1", type: "ASK", price: 100.2, size: 1 }
      ])
    );
    book.applyDepthEvent(
      depthEv(2, 1100, [{ id: "q1", type: "ASK", price: 100.15, size: 2 }])
    );
    expect(book.stats().bidLevels).toBe(0);
    expect(book.stats().askLevels).toBe(2);
    expect(book.stats().crossed).toBe(false);
  });

  it("4. zero-size behavior matches proven raw cTrader (retain size>=0; no size=0 observed for stale id)", () => {
    // Proven: raw run never sent size=0 for 2361229607. We do NOT treat size=0
    // as delete without that evidence. Current book accepts size>=0.
    const book = new InMemoryDepthBook();
    book.applyDepthEvent(
      depthEv(1, 1000, [
        { id: "z1", type: "BID", price: 100, size: 0 },
        { id: "a1", type: "ASK", price: 100.1, size: 1 }
      ])
    );
    expect(book.hasQuoteId("z1")).toBe(true);
    expect(book.stats().bestBid).toBe(100);
  });

  it("5. stale level cannot pin bestBid forever across clearForResync", () => {
    const book = new InMemoryDepthBook();
    book.applyDepthEvent(
      depthEv(1, 1000, [
        { id: "2361229607", type: "BID", price: 4387.32, size: 1 },
        { id: "a1", type: "ASK", price: 4387.43, size: 1 }
      ])
    );
    book.applyDepthEvent(
      depthEv(2, 2000, [{ id: "a2", type: "ASK", price: 4383.5, size: 1 }], [])
    );
    expect(book.stats().crossed).toBe(true);
    expect(book.stats().bestBid).toBe(4387.32);
    book.clearForResync();
    expect(book.hasQuoteId("2361229607")).toBe(false);
    expect(book.stats().bestBid).toBeNull();
    book.applyDepthEvent(
      depthEv(3, 3000, [
        { id: "nb", type: "BID", price: 4383.4, size: 1 },
        { id: "na", type: "ASK", price: 4383.5, size: 1 }
      ])
    );
    expect(book.stats().bestBid).toBe(4383.4);
    expect(book.stats().crossed).toBe(false);
    expect(book.stats().resyncCount).toBe(1);
  });
});

describe("sustained-cross recovery gate", () => {
  it("6. sustained crossed state triggers bounded recovery", () => {
    const d = decideSustainedCrossRecovery({
      crossed: true,
      crossedSinceMs: 1000,
      nowMs: 1000 + GH_FAST_SUSTAINED_CROSS_RECOVERY_MS,
      recoveryInFlight: false,
      lastRecoveryAttemptMs: null
    });
    expect(d.action).toBe("TRIGGER_RECOVERY");
  });

  it("9. no repeated resync storm (cooldown)", () => {
    const d = decideSustainedCrossRecovery({
      crossed: true,
      crossedSinceMs: 1000,
      nowMs: 1000 + GH_FAST_SUSTAINED_CROSS_RECOVERY_MS + 1,
      recoveryInFlight: false,
      lastRecoveryAttemptMs: 1000 + GH_FAST_SUSTAINED_CROSS_RECOVERY_MS,
      cooldownMs: GH_FAST_SUSTAINED_CROSS_RECOVERY_COOLDOWN_MS
    });
    expect(d.action).toBe("NONE");
  });

  it("transient crossed below threshold does not recover", () => {
    const d = decideSustainedCrossRecovery({
      crossed: true,
      crossedSinceMs: 1000,
      nowMs: 1000 + 4511, // Day-1 healthy self-heal max
      recoveryInFlight: false,
      lastRecoveryAttemptMs: null
    });
    expect(d.action).toBe("NONE");
  });
});

describe("research disconnect ghost fix + ordered resync", () => {
  it("7+10. noteDisconnect enqueues ordered RESYNC_MARKER and clears old Depth", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-depth-fix-"));
    const bridge = new ResearchIngestBridge({
      localDir: dir,
      gcsBucket: null,
      campaignMode: false
    });
    bridge.setConnectionState("CONNECTED", "test");
    bridge.setSubscriptionFlags(true, true);
    // Seed stale ghost bid (forensic shape).
    bridge.ingestDepth(
      {
        newQuotes: [
          { id: "2361229607", size: "100", bid: "438732000", ask: null },
          { id: "a1", size: "100", bid: null, ask: "438743000" }
        ],
        deletedQuotes: []
      },
      1000
    );
    await bridge.drainForTests();
    expect(bridge.pipelineForTests().depthBook().hasQuoteId("2361229607")).toBe(
      true
    );
    const gen0 = bridge.pipelineForTests().currentDepthStats().bookGeneration;

    bridge.noteDisconnect("session_detached", 2000);
    await bridge.drainForTests();

    expect(bridge.pipelineForTests().depthBook().hasQuoteId("2361229607")).toBe(
      false
    );
    expect(bridge.pipelineForTests().currentDepthStats().bookGeneration).toBe(
      gen0 + 1
    );
    expect(bridge.pipelineForTests().isRecoveryInFlight()).toBe(true);
    const h = bridge.health(2500);
    expect(h.currentDepthState).toBe("RESYNC_RECOVERY");
    expect(h.depthResyncCount).toBeGreaterThanOrEqual(1);
  });

  it("8. paper trading remains blocked until fresh valid Depth returns", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-depth-paper-"));
    const bridge = new ResearchIngestBridge({
      localDir: dir,
      gcsBucket: null,
      campaignMode: false
    });
    bridge.setConnectionState("CONNECTED", "test");
    bridge.setSubscriptionFlags(true, true);
    bridge.ingestSpot(
      { bid: 438732000, ask: 438743000, timestamp: 1000 },
      1000
    );
    bridge.ingestDepth(
      {
        newQuotes: [
          { id: "b1", size: "100", bid: "438732000", ask: null },
          { id: "a1", size: "100", bid: null, ask: "438743000" }
        ],
        deletedQuotes: []
      },
      1100
    );
    await bridge.drainForTests();

    // Force crossed + recovery
    bridge.ingestDepth(
      {
        newQuotes: [{ id: "a2", size: "100", bid: null, ask: "438300000" }],
        deletedQuotes: []
      },
      1200
    );
    await bridge.drainForTests();
    // Manually trigger recovery path via sustained threshold by injecting
    // crossed duration through decide + noteResync
    bridge.noteResync("sustained_crossed_book", 13000);
    await bridge.drainForTests();
    const paperDuring = bridge.referencePaperSummary();
    expect(paperDuring.open).toBe(0);

    // Fresh valid depth restores
    bridge.ingestDepth(
      {
        newQuotes: [
          { id: "nb", size: "100", bid: "438340000", ask: null },
          { id: "na", size: "100", bid: null, ask: "438350000" }
        ],
        deletedQuotes: []
      },
      14000
    );
    bridge.ingestSpot(
      { bid: 438340000, ask: 438350000, timestamp: 14100 },
      14100
    );
    await bridge.drainForTests();
    const h = bridge.health(14100);
    expect(h.currentDepthState).toBe("DEPTH_VALID");
  });

  it("SPOT ticks do not inflate depth crossed event counter", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-depth-count-"));
    const bridge = new ResearchIngestBridge({
      localDir: dir,
      gcsBucket: null,
      campaignMode: false
    });
    bridge.setConnectionState("CONNECTED", "test");
    bridge.setSubscriptionFlags(true, true);
    bridge.ingestDepth(
      {
        newQuotes: [
          { id: "b1", size: "100", bid: "100200000", ask: null },
          { id: "a1", size: "100", bid: null, ask: "100100000" }
        ],
        deletedQuotes: []
      },
      1000
    );
    await bridge.drainForTests();
    const afterDepth = bridge.health(1000);
    expect(afterDepth.depthEventCount).toBe(1);
    expect(afterDepth.depthCrossedEventCount).toBe(1);

    bridge.ingestSpot({ bid: 100000000, ask: 100050000, timestamp: 1100 }, 1100);
    bridge.ingestSpot({ bid: 100000000, ask: 100050000, timestamp: 1200 }, 1200);
    await bridge.drainForTests();
    const afterSpot = bridge.health(1200);
    expect(afterSpot.depthEventCount).toBe(1);
    expect(afterSpot.depthCrossedEventCount).toBe(1);
    expect(afterSpot.bookCrossedCount).toBe(1);
  });

  it("research specialists expose DEPTH_CROSSED contamination flag", () => {
    const pipe = new ResearchFeaturePipeline();
    pipe.onSpot({
      kind: "SPOT",
      receiveSeq: 1,
      eventId: "SPOT:1",
      receivedAtMs: 1000,
      brokerTimestampMs: null,
      bid: 100.2,
      ask: 100.1
    });
    // Warm features with valid then crossed
    for (let i = 0; i < 30; i++) {
      pipe.onSpot({
        kind: "SPOT",
        receiveSeq: 2 + i,
        eventId: `SPOT:${2 + i}`,
        receivedAtMs: 1000 + i * 50,
        brokerTimestampMs: null,
        bid: 100 + i * 0.01,
        ask: 100.05 + i * 0.01
      });
    }
    pipe.onDepth(
      depthEv(100, 3000, [
        { id: "b1", type: "BID", price: 100.2, size: 1 },
        { id: "a1", type: "ASK", price: 100.1, size: 1 }
      ])
    );
    const snap = pipe.onDepth(
      depthEv(101, 3100, [{ id: "b2", type: "BID", price: 100.25, size: 1 }])
    );
    expect(snap.crossed).toBe(true);
    expect(snap.depthValidity).toBe("DEPTH_CROSSED");
    expect(snap.derivedDataContaminated).toBe(true);
    if (snap.specialists) {
      for (const s of snap.specialists) {
        expect(s.depthValidity).toBe("DEPTH_CROSSED");
        expect(s.derivedDataContaminated).toBe(true);
      }
    }
  });

  it("classifyResearchDepthValidity covers all states", () => {
    const base = {
      available: true,
      crossed: false,
      bidLevels: 1,
      askLevels: 1,
      lastUpdateMs: 1000
    };
    expect(
      classifyResearchDepthValidity({
        stats: base,
        recoveryInFlight: true,
        depthAgeMs: 100,
        depthFreshnessMs: 2000
      })
    ).toBe("RESYNC_RECOVERY");
    expect(
      classifyResearchDepthValidity({
        stats: { ...base, crossed: true, available: false },
        recoveryInFlight: false,
        depthAgeMs: 100,
        depthFreshnessMs: 2000
      })
    ).toBe("DEPTH_CROSSED");
    expect(
      classifyResearchDepthValidity({
        stats: { ...base, available: false },
        recoveryInFlight: false,
        depthAgeMs: 100,
        depthFreshnessMs: 2000
      })
    ).toBe("DEPTH_UNAVAILABLE");
    expect(
      classifyResearchDepthValidity({
        stats: base,
        recoveryInFlight: false,
        depthAgeMs: 5000,
        depthFreshnessMs: 2000
      })
    ).toBe("DEPTH_STALE");
    expect(
      classifyResearchDepthValidity({
        stats: base,
        recoveryInFlight: false,
        depthAgeMs: 100,
        depthFreshnessMs: 2000
      })
    ).toBe("DEPTH_VALID");
  });

  it("sustained-cross recovery invokes transport hook once with cooldown", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-depth-hook-"));
    const hook = vi.fn();
    const bridge = new ResearchIngestBridge({
      localDir: dir,
      gcsBucket: null,
      campaignMode: false,
      onDepthRecoveryRequest: hook
    });
    bridge.setConnectionState("CONNECTED", "test");
    bridge.setSubscriptionFlags(true, true);
    const t0 = 1_000_000;
    bridge.ingestDepth(
      {
        newQuotes: [
          { id: "b1", size: "100", bid: "100200000", ask: null },
          { id: "a1", size: "100", bid: null, ask: "100100000" }
        ],
        deletedQuotes: []
      },
      t0
    );
    await bridge.drainForTests();
    // Keep crossed across threshold
    bridge.ingestDepth(
      {
        newQuotes: [{ id: "b2", size: "100", bid: "100250000", ask: null }],
        deletedQuotes: []
      },
      t0 + GH_FAST_SUSTAINED_CROSS_RECOVERY_MS + 50
    );
    await bridge.drainForTests();
    expect(hook).toHaveBeenCalledWith("sustained_crossed_book");
    const calls = hook.mock.calls.length;
    // Another crossed event within cooldown must not storm
    bridge.ingestDepth(
      {
        newQuotes: [{ id: "b3", size: "100", bid: "100260000", ask: null }],
        deletedQuotes: []
      },
      t0 + GH_FAST_SUSTAINED_CROSS_RECOVERY_MS + 1000
    );
    await bridge.drainForTests();
    expect(hook.mock.calls.length).toBe(calls);
  });
});
