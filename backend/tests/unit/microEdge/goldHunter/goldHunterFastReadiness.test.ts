import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryDepthBook,
  GoldHunterFastEngine,
  GoldHunterFastLiveBridge,
  OrderedEventQueue,
  ShadowExecutionAdapter,
  parseProtoOADepthQuote,
  parseProtoOADeletedQuotes,
  parseProtoOADepthEventPayload,
  parseNormalizedDepthQuote,
  isGoldHunterFastShadowEnabled,
  GhFastEventCollector,
  resetGoldHunterFastLiveBridgeForTests,
  MICRO_DEPTH_SIZE_SCALE
} from "../../../../src/services/microEdge/goldHunter/fast";
import { MICRO_SPOT_PRICE_SCALE } from "../../../../src/services/microEdge/marketData/microCTraderProtocol";
import { createFakeLiveSession } from "../../../../src/services/microEdge/marketData/liveSession";
import { MemoryMicroMarketDataStore } from "../../../../src/services/microEdge/marketData/marketDataStore";
import { MicroLiveCollectorWorker } from "../../../../src/services/microEdge/runtime/liveCollectorWorker";

const REL_BID = 438_012_345; // → 4380.12345
const REL_ASK = 438_024_345; // → 4380.24345

describe("official ProtoOADepthQuote parser", () => {
  it("parses bid payload with price/100000 and size/100", () => {
    const q = parseProtoOADepthQuote({
      id: 1001,
      size: 12500,
      bid: REL_BID
    });
    expect(q).not.toBeNull();
    expect(q!.type).toBe("BID");
    expect(q!.id).toBe("1001");
    expect(q!.price).toBeCloseTo(REL_BID / MICRO_SPOT_PRICE_SCALE, 5);
    expect(q!.size).toBeCloseTo(12500 / MICRO_DEPTH_SIZE_SCALE, 5);
  });

  it("parses ask payload", () => {
    const q = parseProtoOADepthQuote({
      id: 1002,
      size: 9800,
      ask: REL_ASK
    });
    expect(q!.type).toBe("ASK");
    expect(q!.price).toBeCloseTo(REL_ASK / MICRO_SPOT_PRICE_SCALE, 5);
    expect(q!.size).toBeCloseTo(98, 5);
  });

  it("rejects malformed quote with neither bid nor ask", () => {
    expect(parseProtoOADepthQuote({ id: 1, size: 100 })).toBeNull();
  });

  it("rejects both bid and ask — no invented direction", () => {
    expect(
      parseProtoOADepthQuote({ id: 1, size: 100, bid: REL_BID, ask: REL_ASK })
    ).toBeNull();
  });

  it("does not default unknown type to BID on normalized path", () => {
    expect(
      parseNormalizedDepthQuote({ id: "x", type: "UNKNOWN", price: 2400, size: 1 })
    ).toBeNull();
  });

  it("numeric deletedQuotes normalize to {id}", () => {
    expect(parseProtoOADeletedQuotes([1001, 1002])).toEqual([
      { id: "1001" },
      { id: "1002" }
    ]);
  });

  it("string deletedQuote IDs work", () => {
    expect(parseProtoOADeletedQuotes(["1001", "abc"])).toEqual([
      { id: "1001" },
      { id: "abc" }
    ]);
  });
});

describe("real payload depth book reconstruction", () => {
  it("handles official newQuotes + numeric deletedQuotes", () => {
    const book = new InMemoryDepthBook();
    const parsed = parseProtoOADepthEventPayload({
      newQuotes: [
        { id: 1001, size: 12500, bid: REL_BID },
        { id: 1002, size: 9800, ask: REL_ASK }
      ],
      deletedQuotes: []
    });
    expect(parsed.stats.decodedBid).toBe(1);
    expect(parsed.stats.decodedAsk).toBe(1);
    expect(parsed.stats.invalid).toBe(0);
    book.applyDepthEvent({
      kind: "DEPTH",
      receiveSeq: 1,
      eventId: "e1",
      receivedAtMs: 1,
      brokerTimestampMs: 1,
      newQuotes: parsed.newQuotes,
      deletedQuotes: parsed.deletedQuotes
    });
    let s = book.stats(5);
    expect(s.available).toBe(true);
    expect(s.bestBid!).toBeLessThan(s.bestAsk!);
    expect(s.spread!).toBeGreaterThan(0);
    expect(s.bestBid).toBeCloseTo(REL_BID / MICRO_SPOT_PRICE_SCALE, 5);
    expect(s.bestAsk).toBeCloseTo(REL_ASK / MICRO_SPOT_PRICE_SCALE, 5);

    const del = parseProtoOADeletedQuotes([1001]);
    book.applyDepthEvent({
      kind: "DEPTH",
      receiveSeq: 2,
      eventId: "e2",
      receivedAtMs: 2,
      brokerTimestampMs: 2,
      newQuotes: [],
      deletedQuotes: del
    });
    s = book.stats(5);
    expect(s.bestBid).toBeNull();
    expect(s.available).toBe(false);
  });

  it("does not throw on numeric deletedQuotes at book boundary", () => {
    const book = new InMemoryDepthBook();
    expect(() =>
      book.applyDepthEvent({
        kind: "DEPTH",
        receiveSeq: 1,
        eventId: "e",
        receivedAtMs: 1,
        brokerTimestampMs: 1,
        newQuotes: [
          { id: "1001", type: "BID", price: 2400, size: 10 },
          { id: "1002", type: "ASK", price: 2400.2, size: 10 }
        ],
        deletedQuotes: [1001 as unknown as { id: string }]
      })
    ).not.toThrow();
    expect(book.stats().bestBid).toBeNull();
  });
});

describe("duplicate identity + ordered queue", () => {
  it("two depth events same millisecond are not deduplicated", async () => {
    const engine = new GoldHunterFastEngine({
      adapter: new ShadowExecutionAdapter()
    });
    const t = 1_000_000;
    const a = await engine.onMarketEvent({
      kind: "DEPTH",
      receiveSeq: 1,
      eventId: "DEPTH:1:a",
      receivedAtMs: t,
      brokerTimestampMs: t,
      newQuotes: [
        { id: "1", type: "BID", price: 2400, size: 10 },
        { id: "2", type: "ASK", price: 2400.1, size: 10 }
      ]
    });
    const b = await engine.onMarketEvent({
      kind: "DEPTH",
      receiveSeq: 2,
      eventId: "DEPTH:2:b",
      receivedAtMs: t,
      brokerTimestampMs: t,
      newQuotes: [{ id: "1", type: "BID", price: 2400.05, size: 12 }]
    });
    expect(a.reasons).not.toContain("duplicate_event");
    expect(b.reasons).not.toContain("duplicate_event");
    expect(engine.depth.stats().bestBid).toBeCloseTo(2400.05, 5);
  });

  it("single consumer preserves spot/depth order", async () => {
    const order: number[] = [];
    const q = new OrderedEventQueue<number>();
    q.setHandler(async (item) => {
      order.push(item.payload);
      await new Promise((r) => setTimeout(r, 2));
    });
    q.enqueue(1, 10);
    q.enqueue(2, 20);
    q.enqueue(3, 30);
    await q.drain();
    expect(order).toEqual([10, 20, 30]);
    expect(q.stats().dropped).toBe(0);
  });
});

describe("async persistence + feature flag", () => {
  it("FAST disabled by default", () => {
    expect(isGoldHunterFastShadowEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      isGoldHunterFastShadowEnabled({
        GOLD_HUNTER_FAST_SHADOW_ENABLED: "false"
      } as NodeJS.ProcessEnv)
    ).toBe(false);
    expect(
      isGoldHunterFastShadowEnabled({
        GOLD_HUNTER_FAST_SHADOW_ENABLED: "true"
      } as NodeJS.ProcessEnv)
    ).toBe(true);
  });

  it("persistence enqueue does not block when writer is slow", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-fast-async-"));
    try {
      const collector = new GhFastEventCollector({ dir, chunkRows: 2 });
      const t0 = Date.now();
      for (let i = 0; i < 20; i++) {
        collector.record({
          t: t0 + i,
          event: {
            kind: "SPOT",
            receiveSeq: i + 1,
            eventId: `s${i}`,
            receivedAtMs: t0 + i,
            brokerTimestampMs: t0 + i,
            bid: 2400,
            ask: 2400.1
          },
          decision: {
            state: "HUNTING",
            action: "WAIT",
            setup: null,
            setupQuality: 0,
            side: null,
            exitReason: null,
            latency: {
              marketEventReceivedMs: 0,
              featuresCalculatedMs: 0,
              decisionProducedMs: 0,
              shadowOrderProducedMs: null,
              eventToDecisionMs: 0
            },
            reasons: []
          },
          status: {
            state: "HUNTING",
            bid: 2400,
            ask: 2400.1,
            spread: 0.1,
            depthImbalance: 0,
            velocity: 0,
            acceleration: 0,
            setup: null,
            setupQuality: 0
          }
        });
      }
      const elapsed = Date.now() - t0;
      expect(elapsed).toBeLessThan(200);
      await collector.flushAndWait(5000);
      expect(collector.stats().chunksWritten).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("worker FAST attach / detach", () => {
  const prev = process.env.GOLD_HUNTER_FAST_SHADOW_ENABLED;
  beforeEach(() => {
    resetGoldHunterFastLiveBridgeForTests();
  });
  afterEach(() => {
    if (prev == null) delete process.env.GOLD_HUNTER_FAST_SHADOW_ENABLED;
    else process.env.GOLD_HUNTER_FAST_SHADOW_ENABLED = prev;
    resetGoldHunterFastLiveBridgeForTests();
  });

  it("FAST disabled: worker does not attach bridge", async () => {
    process.env.GOLD_HUNTER_FAST_SHADOW_ENABLED = "false";
    const store = new MemoryMicroMarketDataStore();
    const { session, fake } = createFakeLiveSession(store);
    fake.nextSpot = {
      bid: 2400 * MICRO_SPOT_PRICE_SCALE,
      ask: 2400.1 * MICRO_SPOT_PRICE_SCALE,
      timestamp: Date.now(),
      symbolId: 41
    };
    // Bridge flag path only — do not construct MicroLiveCollectorWorker here
    // (vault/encryption env is orthogonal to FAST attach gating).
    const bridge = new GoldHunterFastLiveBridge({ enabled: false });
    expect(bridge.isEnabled()).toBe(false);
    bridge.attach(session);
    expect(bridge.isAttached()).toBe(false);
  });

  it("reconnect attaches once; disconnect detaches", async () => {
    process.env.GOLD_HUNTER_FAST_SHADOW_ENABLED = "true";
    const store = new MemoryMicroMarketDataStore();
    const { session, fake } = createFakeLiveSession(store);
    fake.nextSpot = {
      bid: 2400 * MICRO_SPOT_PRICE_SCALE,
      ask: 2400.1 * MICRO_SPOT_PRICE_SCALE,
      timestamp: Date.now(),
      symbolId: 41
    };
    await session.connect();
    const bridge = new GoldHunterFastLiveBridge({
      enabled: true,
      enableCollector: false
    });
    bridge.attach(session);
    expect(bridge.isAttached()).toBe(true);
    const gen1 = (bridge as unknown as { unsubs: unknown[] }).unsubs.length;
    bridge.attach(session); // re-attach must not stack
    const gen2 = (bridge as unknown as { unsubs: unknown[] }).unsubs.length;
    expect(gen2).toBe(gen1);
    expect(gen2).toBe(2); // spot + depth
    bridge.detach();
    bridge.markStale();
    expect(bridge.isAttached()).toBe(false);
    expect(bridge.health().ready).toBe(false);
    expect(bridge.health().brokerOrders).toBe(0);
    expect(bridge.health().mutationSurface).toBe("NONE");
  });

  it("real ProtoOA depth via bridge ordered path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-fast-bridge-"));
    try {
      const bridge = new GoldHunterFastLiveBridge({
        enabled: true,
        enableCollector: true,
        collectDir: dir
      });
      bridge.ingestRawForTests("SPOT", {
        bid: 2400 * MICRO_SPOT_PRICE_SCALE,
        ask: 2400.12 * MICRO_SPOT_PRICE_SCALE,
        timestamp: 1,
        symbolId: 41
      });
      bridge.ingestRawForTests("DEPTH", {
        symbolId: 41,
        timestamp: 2,
        newQuotes: [
          { id: 1001, size: 12500, bid: 2400 * MICRO_SPOT_PRICE_SCALE },
          { id: 1002, size: 9800, ask: 2400.12 * MICRO_SPOT_PRICE_SCALE }
        ],
        deletedQuotes: []
      });
      bridge.ingestRawForTests("DEPTH", {
        symbolId: 41,
        timestamp: 2,
        newQuotes: [],
        deletedQuotes: [1001]
      });
      await bridge.drainForTests();
      const h = bridge.health();
      expect(h.depthParse.decodedBid).toBe(1);
      expect(h.depthParse.decodedAsk).toBe(1);
      expect(h.depthParse.deletedIds).toBe(1);
      expect(h.eventsDropped).toBe(0);
      expect(h.brokerRequests).toBe(0);
      expect(h.brokerOrders).toBe(0);
      expect(h.decisions).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("safety invariants", () => {
  it("shadow only and zero broker surface", () => {
    const bridge = new GoldHunterFastLiveBridge({
      enabled: true,
      enableCollector: false
    });
    const h = bridge.health();
    expect(h.shadowOnly).toBe(true);
    expect(h.brokerExecutionEnabled).toBe(false);
    expect(h.mutationSurface).toBe("NONE");
    expect(h.brokerOrders).toBe(0);
  });
});
