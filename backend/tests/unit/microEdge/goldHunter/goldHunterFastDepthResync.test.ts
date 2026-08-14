/**
 * Depth book crossed / resync / warm-up integrity tests.
 * Operational market-data health only — does NOT retune strategy thresholds.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  InMemoryDepthBook,
  depthUnavailableReason,
  GoldHunterFastEngine,
  GoldHunterFastLiveBridge,
  ShadowExecutionAdapter,
  getFrozenGhFastIdentity,
  resetFrozenGhFastIdentityForTests,
  hashGhFastConfig,
  frozenGhFastSoakConfig,
  verifyReplayParityFromEvents,
  defaultGhFastConfig,
  GH_FAST_BROKER_EXECUTION_ENABLED,
  GH_FAST_MUTATION_SURFACE
} from "../../../../src/services/microEdge/goldHunter/fast";
import type { GhFastDepthEvent, GhFastSpotEvent } from "../../../../src/services/microEdge/goldHunter/fast/types";
import {
  updateOpenTrade,
  evaluateOpenExit,
  openTrade
} from "../../../../src/services/microEdge/goldHunter/fast/exits";
import type { GhFastFeatureSnapshot } from "../../../../src/services/microEdge/goldHunter/fast/features";

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

function spotEv(
  seq: number,
  t: number,
  bid: number,
  ask: number
): GhFastSpotEvent {
  return {
    kind: "SPOT",
    receiveSeq: seq,
    eventId: `SPOT:${seq}`,
    receivedAtMs: t,
    brokerTimestampMs: null,
    bid,
    ask
  };
}

describe("depth book crossed diagnostics", () => {
  it("valid depth → crossed book detected; available=false", () => {
    const book = new InMemoryDepthBook();
    book.applyDepthEvent(
      depthEv(1, 1000, [
        { id: "b1", type: "BID", price: 100, size: 1 },
        { id: "a1", type: "ASK", price: 100.1, size: 1 }
      ])
    );
    let s = book.stats();
    expect(s.available).toBe(true);
    expect(s.crossed).toBe(false);
    expect(depthUnavailableReason({
      stats: s,
      depthAgeMs: 100,
      depthFreshnessMs: 2000,
      warmingUp: false
    })).toBeNull();

    // Orphan bid prints above stuck ask without deleting ask id.
    book.applyDepthEvent(
      depthEv(2, 1100, [{ id: "b2", type: "BID", price: 100.2, size: 1 }], [])
    );
    s = book.stats();
    expect(s.crossed).toBe(true);
    expect(s.available).toBe(false);
    expect(s.bestBid).toBe(100.2);
    expect(s.bestAsk).toBe(100.1);
    expect(s.consecutiveInvalidSnapshots).toBeGreaterThanOrEqual(1);
    expect(
      depthUnavailableReason({
        stats: s,
        depthAgeMs: 50,
        depthFreshnessMs: 2000,
        warmingUp: false
      })
    ).toBe("CROSSED_BOOK");
  });

  it("one transient crossed update does not alone imply reconnect storm", () => {
    const book = new InMemoryDepthBook();
    book.applyDepthEvent(
      depthEv(1, 1000, [
        { id: "b1", type: "BID", price: 100, size: 1 },
        { id: "a1", type: "ASK", price: 100.1, size: 1 }
      ])
    );
    book.applyDepthEvent(
      depthEv(2, 1100, [{ id: "b2", type: "BID", price: 100.25, size: 1 }])
    );
    expect(book.stats().consecutiveInvalidSnapshots).toBe(1);
    // Heal: delete stuck ask + add sane ask.
    book.applyDepthEvent(
      depthEv(
        3,
        1200,
        [{ id: "a2", type: "ASK", price: 100.3, size: 1 }],
        ["a1"]
      )
    );
    const s = book.stats();
    expect(s.crossed).toBe(false);
    expect(s.available).toBe(true);
    expect(s.consecutiveInvalidSnapshots).toBe(0);
  });

  it("fresh events + sustained crossed book accumulate invalid streak (watchdog input)", () => {
    const book = new InMemoryDepthBook();
    book.applyDepthEvent(
      depthEv(1, 1000, [
        { id: "b1", type: "BID", price: 100, size: 1 },
        { id: "a1", type: "ASK", price: 100.1, size: 1 }
      ])
    );
    for (let i = 0; i < 5; i++) {
      book.applyDepthEvent(
        depthEv(2 + i, 1100 + i * 50, [
          { id: `b${i + 2}`, type: "BID", price: 100.2 + i * 0.01, size: 1 }
        ])
      );
    }
    const s = book.stats();
    expect(s.crossed).toBe(true);
    expect(s.consecutiveInvalidSnapshots).toBeGreaterThanOrEqual(5);
    expect(s.available).toBe(false);
  });
});

describe("reconnect market-data reset", () => {
  beforeEach(() => {
    resetFrozenGhFastIdentityForTests();
  });

  it("reconnect clears old bid/ask quote IDs; stale quote cannot survive new generation", async () => {
    const eng = new GoldHunterFastEngine({
      adapter: new ShadowExecutionAdapter(),
      useFrozenSoakConfig: true
    });
    eng.depth.applyDepthEvent(
      depthEv(1, 1000, [
        { id: "orphan-ask", type: "ASK", price: 99.5, size: 2 },
        { id: "b1", type: "BID", price: 100.2, size: 1 }
      ])
    );
    expect(eng.depth.hasQuoteId("orphan-ask")).toBe(true);
    expect(eng.depth.stats().crossed).toBe(true);
    const gen0 = eng.depth.generation();
    const closedBefore = eng.closed.length;

    await eng.resetMarketDataForResync({ nowMs: 2000, reason: "test" });
    expect(eng.depth.hasQuoteId("orphan-ask")).toBe(false);
    expect(eng.depth.generation()).toBe(gen0 + 1);
    expect(eng.depth.resyncs()).toBe(1);
    expect(eng.isWarmingUp()).toBe(true);
    expect(eng.status().state).toBe("BOOK_REBUILDING");
    expect(eng.closed.length).toBe(closedBefore);

    // New book generation becomes valid.
    eng.depth.applyDepthEvent(
      depthEv(10, 2100, [
        { id: "nb1", type: "BID", price: 200, size: 1 },
        { id: "na1", type: "ASK", price: 200.1, size: 1 }
      ])
    );
    expect(eng.depth.hasQuoteId("orphan-ask")).toBe(false);
    expect(eng.depth.stats().available).toBe(true);
    expect(eng.depth.stats().crossed).toBe(false);
  });

  it("preserves closed trade history + config SHA; no entries during warm-up", async () => {
    const adapter = new ShadowExecutionAdapter();
    const eng = new GoldHunterFastEngine({
      adapter,
      useFrozenSoakConfig: true
    });
    const shaBefore = getFrozenGhFastIdentity().configSha256;
    // Seed a synthetic closed trade.
    (eng.closed as Array<{ sampleTag?: string }>).push({
      tradeId: "seed",
      side: "BUY",
      setup: "A_MOMENTUM_IGNITION",
      entryTs: 1,
      entryBid: 1,
      entryAsk: 1.1,
      entryPrice: 1.1,
      bestExit: 1.1,
      mfe: 0,
      mae: 0,
      profitLockActive: false,
      lockFloor: null,
      trailDistance: 0.12,
      harvestRunner: false,
      exitTs: 2,
      exitBid: 1,
      exitAsk: 1.1,
      exitPrice: 1,
      grossMove: -0.1,
      additionalFriction: 0.06,
      netMove: -0.16,
      durationMs: 1,
      exitReason: "DATA_STALE",
      result: "LOSS",
      sampleTag: "PRE_FIX_DIAGNOSTIC"
    } as never);
    expect(eng.closed.length).toBe(1);

    await eng.resetMarketDataForResync({ nowMs: 5000 });
    expect(eng.closed.length).toBe(1);
    expect(eng.closed[0]!.tradeId).toBe("seed");
    expect(hashGhFastConfig(eng.getConfig())).toBe(shaBefore);
    expect(hashGhFastConfig(frozenGhFastSoakConfig())).toBe(shaBefore);
    expect(eng.getConfig().profitLockActivateMfe).toBe(0.18);
    expect(eng.getConfig().trailDistance).toBe(0.12);

    // During warm-up, even with valid book, no entry until feature history warms.
    let seq = 1;
    const t0 = 6000;
    eng.depth.applyDepthEvent(
      depthEv(seq++, t0, [
        { id: "b", type: "BID", price: 4330, size: 5 },
        { id: "a", type: "ASK", price: 4330.1, size: 5 }
      ])
    );
    const d1 = await eng.onMarketEvent(spotEv(seq++, t0 + 10, 4330, 4330.1));
    expect(["BOOK_REBUILDING", "DATA_STALE"]).toContain(d1.state);
    expect(d1.action).toBe("WAIT");
    expect(adapter.orders.filter((o) => o.kind === "ENTER").length).toBe(0);
    expect(adapter.brokerRequests ?? 0).toBe(0);
  });

  it("bridge attach does not duplicate listeners; reset clears book generation", async () => {
    const bridge = new GoldHunterFastLiveBridge({
      enabled: true,
      enableCollector: false,
      useFrozenSoakConfig: true
    });
    const fakeSession = {
      onSpotForFast: (cb: (p: Record<string, unknown>) => void) => {
        void cb;
        return () => undefined;
      },
      onDepthForFast: (cb: (p: Record<string, unknown>) => void) => {
        void cb;
        return () => undefined;
      },
      getState: async () => ({
        spotSubscribed: true,
        depthSubscribed: true,
        liveConnected: true
      })
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bridge.attach(fakeSession as any);
    expect(bridge.listenerCountForTests()).toBe(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bridge.attach(fakeSession as any);
    expect(bridge.listenerCountForTests()).toBe(2);

    bridge.engine.depth.applyDepthEvent(
      depthEv(1, 1, [
        { id: "x", type: "BID", price: 10, size: 1 },
        { id: "y", type: "ASK", price: 9, size: 1 }
      ])
    );
    expect(bridge.engine.depth.stats().crossed).toBe(true);
    await bridge.resetMarketDataForResync("test");
    expect(bridge.engine.depth.stats().bidLevels).toBe(0);
    expect(bridge.engine.isWarmingUp()).toBe(true);
    const h = bridge.health();
    expect(h.depthBookAvailable).toBe(false);
    expect(h.warmingUp).toBe(true);
    expect(h.depthUnavailableReason).toBe("WARMING_UP");
    expect(h.brokerOrders).toBe(0);
    expect(h.brokerRequests).toBe(0);
    expect(h.mutationSurface).toBe(GH_FAST_MUTATION_SURFACE);
    expect(GH_FAST_BROKER_EXECUTION_ENABLED).toBe(false);
  });
});

describe("qualification sample integrity", () => {
  beforeEach(() => resetFrozenGhFastIdentityForTests());

  it("tags prior trades PRE_FIX_DIAGNOSTIC and starts formal sample", () => {
    const eng = new GoldHunterFastEngine({
      adapter: new ShadowExecutionAdapter(),
      useFrozenSoakConfig: true
    });
    eng.closed.push({
      tradeId: "t1",
      side: "BUY",
      setup: "A_MOMENTUM_IGNITION",
      entryTs: 1,
      entryBid: 1,
      entryAsk: 1,
      entryPrice: 1,
      bestExit: 1,
      mfe: 0,
      mae: 0,
      profitLockActive: false,
      lockFloor: null,
      trailDistance: 0.12,
      harvestRunner: false,
      exitTs: 2,
      exitBid: 1,
      exitAsk: 1,
      exitPrice: 1,
      grossMove: 0,
      additionalFriction: 0.06,
      netMove: -0.06,
      durationMs: 1,
      exitReason: "DATA_STALE",
      result: "LOSS"
    });
    eng.beginQualificationSample({ receiveSeq: 9000, atMs: 123456 });
    expect(eng.closed[0]!.sampleTag).toBe("PRE_FIX_DIAGNOSTIC");
    expect(eng.preFixDiagnosticTrades().length).toBe(1);
    expect(eng.formalQualificationTrades().length).toBe(0);
    expect(eng.qualificationMarker().startSequence).toBe(9000);
  });
});

describe("TRAIL_HIT diagnostic (no param change)", () => {
  it("reports MFE/MAE/lockFloor path for observed BUY TRAIL_HIT", () => {
    const cfg = defaultGhFastConfig({});
    expect(cfg.profitLockActivateMfe).toBe(0.18);
    expect(cfg.profitLockFraction).toBe(0.45);
    expect(cfg.trailDistance).toBe(0.12);
    expect(cfg.friction).toBe(0.06);

    const trade = openTrade({
      tradeId: "diag",
      side: "BUY",
      setup: "A_MOMENTUM_IGNITION",
      entryTs: 1,
      bid: 4334.99,
      ask: 4335.08,
      trailDistance: cfg.trailDistance
    });
    expect(trade.entryPrice).toBe(4335.08);

    // Path mirrors live soak seq 161→192 (spot bids).
    const path = [
      [4335.13, 4335.22],
      [4335.17, 4335.26],
      [4334.95, 4335.04],
      [4334.91, 4335.0],
      [4334.98, 4335.07],
      [4335.05, 4335.14],
      [4335.07, 4335.16],
      [4335.0, 4335.09],
      [4334.99, 4335.08],
      [4335.08, 4335.16],
      [4335.14, 4335.22],
      [4335.35, 4335.43] // MFE peak
    ] as const;
    for (const [bid, ask] of path) {
      updateOpenTrade(trade, bid, ask, cfg);
    }
    expect(trade.mfe).toBeCloseTo(4335.35 - 4335.08, 6); // 0.27
    expect(trade.profitLockActive).toBe(true);
    const lockAfterActivate = 4335.08 + trade.mfe * cfg.profitLockFraction;
    // Trail floor from bestExit dominates.
    const trailFloor = trade.bestExit - cfg.trailDistance;
    expect(trade.lockFloor).toBeCloseTo(Math.max(lockAfterActivate, trailFloor), 6);

    const lastAbove = 4335.35;
    const firstBelow = 4334.98;
    expect(lastAbove).toBeGreaterThan(trade.lockFloor!);
    expect(firstBelow).toBeLessThanOrEqual(trade.lockFloor!);

    const feat = {
      bid: firstBelow,
      ask: 4335.06,
      mid: (firstBelow + 4335.06) / 2,
      spread: 4335.06 - firstBelow,
      bidVel250: 0,
      bidVel500: 0,
      bidVel1s: 0,
      bidVel2s: 0,
      bidVel3s: 0,
      askVel1s: 0,
      midVel250: 0,
      midVel500: 0,
      midVel1s: 0,
      midVel2s: 0,
      midVel3s: 0,
      acceleration: 0,
      updateRate1s: 4,
      signedImbalance1s: 0,
      efficiency1s: 0,
      efficiency3s: 0,
      high1s: 4335.4,
      low1s: 4334.9,
      high2s: 4335.4,
      low2s: 4334.9,
      high5s: 4335.4,
      low5s: 4334.9,
      high10s: 4335.4,
      low10s: 4334.9,
      high15s: 4335.4,
      low15s: 4334.9,
      high30s: 4335.4,
      low30s: 4334.9,
      distHigh1s: 0,
      distLow1s: 0,
      distHigh5s: 0,
      distLow5s: 0,
      upTouches5s: 0,
      downTouches5s: 0,
      depth: {
        available: true,
        topBidDepth: 1,
        topAskDepth: 1,
        bidDepthN: 1,
        askDepthN: 1,
        bidLevels: 1,
        askLevels: 1,
        depthRatio: 1,
        depthImbalance: 0,
        weightedImbalance: 0,
        liquidityAddedBid: 0,
        liquidityAddedAsk: 0,
        liquidityRemovedBid: 0,
        liquidityRemovedAsk: 0,
        addRateBid: 0,
        addRateAsk: 0,
        removeRateBid: 0,
        removeRateAsk: 0,
        bestBid: firstBelow,
        bestAsk: 4335.06,
        spread: 4335.06 - firstBelow,
        crossed: false,
        lastUpdateMs: 1,
        lastValidBookMs: 1,
        consecutiveInvalidSnapshots: 0,
        bookGeneration: 0,
        resyncCount: 0,
        deleteHits: 0,
        deleteMisses: 0,
        deleteHitRate: 0
      }
    } as GhFastFeatureSnapshot;

    updateOpenTrade(trade, firstBelow, 4335.06, cfg);
    const reason = evaluateOpenExit({
      trade,
      f: feat,
      cfg,
      dataOk: true
    });
    expect(reason).toBe("TRAIL_HIT");
    const gross = firstBelow - trade.entryPrice; // -0.10
    const net = gross - cfg.friction; // -0.16
    expect(gross).toBeCloseTo(-0.1, 6);
    expect(net).toBeCloseTo(-0.16, 6);
    // Jump 4335.35 → 4334.98 is a legitimate executable gap through the trail floor.
    expect(lastAbove - firstBelow).toBeCloseTo(0.37, 6);
  });
});

describe("frozen identity unchanged by depth resync work", () => {
  beforeEach(() => resetFrozenGhFastIdentityForTests());

  it("config SHA matches known soak identity", () => {
    const id = getFrozenGhFastIdentity();
    expect(id.configSha256).toBe(
      "f47c7886f2b0dadddda779e993ba076b27de8b098bd4921d9c8278ee9efeceb4"
    );
    expect(id.engineVersion).toBe("GH_FAST_EVENT_V1");
    expect(id.tuningAllowed).toBe(false);
  });

  it("replay remains deterministic on a short event set", async () => {
    const events = [
      spotEv(1, 1000, 4330, 4330.1),
      depthEv(2, 1001, [
        { id: "b", type: "BID", price: 4330, size: 2 },
        { id: "a", type: "ASK", price: 4330.1, size: 2 }
      ]),
      spotEv(3, 1500, 4330.02, 4330.12),
      spotEv(4, 2000, 4330.05, 4330.15),
      spotEv(5, 2500, 4330.01, 4330.11),
      spotEv(6, 3000, 4330.0, 4330.1),
      spotEv(7, 3500, 4330.03, 4330.13)
    ];
    const a = await verifyReplayParityFromEvents(events);
    const b = await verifyReplayParityFromEvents(events);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.comparedEvents).toBe(b.comparedEvents);
  });
});
