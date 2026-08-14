import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GOLD_HUNTER_FAST_ENGINE_VERSION,
  GH_FAST_BROKER_EXECUTION_ENABLED,
  GH_FAST_LATENCY_P50_TARGET_MS,
  GH_FAST_LATENCY_P95_TARGET_MS,
  GH_FAST_MAX_OPEN_POSITIONS,
  GH_FAST_MUTATION_SURFACE,
  GH_FAST_SHADOW_ONLY,
  GoldHunterFastEngine,
  InMemoryDepthBook,
  ShadowExecutionAdapter,
  ForbiddenLiveExecutionAdapter,
  evaluateOpenExit,
  openTrade,
  updateOpenTrade,
  scoreMomentumIgnition,
  scoreFastBreakout,
  scorePullbackReaccel,
  FastFeatureEngine,
  replayGhFastEvents,
  assertReplayDeterministic,
  GhFastEventCollector,
  defaultGhFastConfig
} from "../../../../src/services/microEdge/goldHunter/fast";
import type {
  GhFastFeatureSnapshot
} from "../../../../src/services/microEdge/goldHunter/fast/features";
import type { GhFastMarketEvent } from "../../../../src/services/microEdge/goldHunter/fast/types";
import {
  FakeMicroCTraderTransport
} from "../../../../src/services/microEdge/marketData/microCTraderTransport";
import {
  assertReadOnlyCommand,
  MICRO_ALLOWED_READ_COMMANDS
} from "../../../../src/services/microEdge/marketData/microCTraderProtocol";

const BASE = 2400;
let seq = 1;

function depthSeed(t: number, bid = BASE, ask = BASE + 0.12): GhFastMarketEvent {
  const receiveSeq = seq++;
  return {
    kind: "DEPTH",
    receiveSeq,
    eventId: `DEPTH:test:${receiveSeq}`,
    receivedAtMs: t,
    brokerTimestampMs: t,
    newQuotes: [
      { id: "b1", type: "BID", price: bid, size: 120 },
      { id: "b2", type: "BID", price: bid - 0.05, size: 80 },
      { id: "a1", type: "ASK", price: ask, size: 100 },
      { id: "a2", type: "ASK", price: ask + 0.05, size: 90 }
    ]
  };
}

function spot(t: number, mid: number, spread = 0.12): GhFastMarketEvent {
  const bid = mid - spread / 2;
  const ask = mid + spread / 2;
  const receiveSeq = seq++;
  return {
    kind: "SPOT",
    receiveSeq,
    eventId: `SPOT:test:${receiveSeq}`,
    receivedAtMs: t,
    brokerTimestampMs: t,
    bid,
    ask
  };
}

function emptyDepthStats() {
  return {
    available: true,
    topBidDepth: 100,
    topAskDepth: 80,
    bidDepthN: 200,
    askDepthN: 160,
    depthRatio: 1.25,
    depthImbalance: 0.1,
    weightedImbalance: 0.05,
    liquidityAddedBid: 10,
    liquidityAddedAsk: 5,
    liquidityRemovedBid: 2,
    liquidityRemovedAsk: 20,
    addRateBid: 10,
    addRateAsk: 5,
    removeRateBid: 2,
    removeRateAsk: 20,
    bestBid: BASE,
    bestAsk: BASE + 0.12,
    spread: 0.12,
    lastUpdateMs: 1
  };
}

function feat(partial: Partial<GhFastFeatureSnapshot>): GhFastFeatureSnapshot {
  const mid = partial.mid ?? BASE;
  const spread = partial.spread ?? 0.12;
  return {
    bid: mid - spread / 2,
    ask: mid + spread / 2,
    mid,
    spread,
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
    updateRate1s: 8,
    signedImbalance1s: 0,
    efficiency1s: 0.5,
    efficiency3s: 0.5,
    high1s: mid,
    low1s: mid,
    high2s: mid,
    low2s: mid,
    high5s: mid,
    low5s: mid,
    high10s: mid,
    low10s: mid,
    high15s: mid,
    low15s: mid,
    high30s: mid,
    low30s: mid,
    distHigh1s: 0,
    distLow1s: 0,
    distHigh5s: 0,
    distLow5s: 0,
    upTouches5s: 0,
    downTouches5s: 0,
    depth: emptyDepthStats(),
    ...partial
  };
}

const easyCfg = defaultGhFastConfig({
  minSetupQuality: 0.35,
  momentumVelMin: 0.00005,
  friction: 0.01,
  safetyBuffer: 0.01,
  hardStop: 0.8,
  profitLockActivateMfe: 0.15,
  profitLockFraction: 0.4,
  trailDistance: 0.1,
  rearmFloorMs: 250,
  maxSpread: 0.5
});

async function feedRisingMomentum(engine: GoldHunterFastEngine, t0: number): Promise<void> {
  await engine.onMarketEvent(depthSeed(t0));
  for (let i = 0; i < 40; i++) {
    const t = t0 + i * 50;
    const mid = BASE + i * 0.04;
    await engine.onMarketEvent(spot(t, mid));
    if (i % 5 === 0) {
      const dseq = seq++;
      await engine.onMarketEvent({
        kind: "DEPTH",
        receiveSeq: dseq,
        eventId: `DEPTH:feed:${dseq}`,
        receivedAtMs: t + 1,
        brokerTimestampMs: t + 1,
        newQuotes: [
          { id: "b1", type: "BID", price: mid - 0.06, size: 140 + i },
          { id: "a1", type: "ASK", price: mid + 0.06, size: Math.max(10, 90 - i * 2) }
        ],
        deletedQuotes: i > 10 ? [{ id: "a2" }] : []
      });
    }
  }
}

describe("GOLD_HUNTER FAST safety", () => {
  it("is shadow-only with mutation NONE and one position max", () => {
    expect(GH_FAST_SHADOW_ONLY).toBe(true);
    expect(GH_FAST_BROKER_EXECUTION_ENABLED).toBe(false);
    expect(GH_FAST_MUTATION_SURFACE).toBe("NONE");
    expect(GH_FAST_MAX_OPEN_POSITIONS).toBe(1);
    expect(GOLD_HUNTER_FAST_ENGINE_VERSION).toMatch(/GH_FAST/);
  });

  it("refuses ForbiddenLiveExecutionAdapter construction", () => {
    expect(() => new ForbiddenLiveExecutionAdapter()).toThrow(/REFUSING/);
  });
});

describe("depth reconstruction", () => {
  it("applies newQuotes/deletedQuotes and never treats delete as fill", () => {
    const book = new InMemoryDepthBook();
    book.applyDepthEvent({
      kind: "DEPTH",
      receiveSeq: 1,
      eventId: "d1",
      receivedAtMs: 1000,
      brokerTimestampMs: 1000,
      newQuotes: [
        { id: "1", type: "BID", price: 2400, size: 50 },
        { id: "2", type: "ASK", price: 2400.2, size: 40 }
      ]
    });
    let s = book.stats(5);
    expect(s.available).toBe(true);
    expect(s.topBidDepth).toBe(50);
    expect(s.topAskDepth).toBe(40);
    book.applyDepthEvent({
      kind: "DEPTH",
      receiveSeq: 2,
      eventId: "d2",
      receivedAtMs: 1100,
      brokerTimestampMs: 1100,
      deletedQuotes: [{ id: "2" }],
      newQuotes: [{ id: "3", type: "ASK", price: 2400.25, size: 30 }]
    });
    s = book.stats(5);
    expect(s.liquidityRemovedAsk).toBeGreaterThan(0);
    expect(s.bestAsk).toBe(2400.25);
    // Deleted quote is liquidity disappearance, not an assumed trade fill.
    expect(s.liquidityRemovedAsk).toBe(40);
  });

  it("computes imbalance and top-N depth", () => {
    const book = new InMemoryDepthBook();
    book.applyDepthEvent({
      kind: "DEPTH",
      receiveSeq: 1,
      eventId: "d3",
      receivedAtMs: 1,
      brokerTimestampMs: 1,
      newQuotes: [
        { id: "b1", type: 1, price: 10, size: 100 },
        { id: "b2", type: 1, price: 9.9, size: 50 },
        { id: "a1", type: 2, price: 10.1, size: 20 },
        { id: "a2", type: 2, price: 10.2, size: 20 }
      ]
    });
    const s = book.stats(2);
    expect(s.bidDepthN).toBe(150);
    expect(s.askDepthN).toBe(40);
    expect(s.depthImbalance).toBeGreaterThan(0);
  });
});

describe("setup A/B/C scorers", () => {
  it("setup A fires momentum ignition BUY", () => {
    const hit = scoreMomentumIgnition(
      feat({
        midVel250: 0.0002,
        midVel500: 0.00025,
        midVel1s: 0.0003,
        acceleration: 0.0002,
        signedImbalance1s: 0.4,
        depth: { ...emptyDepthStats(), removeRateAsk: 30, removeRateBid: 5, depthImbalance: 0.2 }
      }),
      easyCfg
    );
    expect(hit?.setup).toBe("A_MOMENTUM_IGNITION");
    expect(hit?.side).toBe("BUY");
  });

  it("setup B fires fast breakout BUY", () => {
    const mid = BASE + 1;
    const hit = scoreFastBreakout(
      feat({
        mid,
        high5s: mid,
        distHigh5s: 0,
        midVel250: 0.0001,
        upTouches5s: 3,
        updateRate1s: 8,
        depth: { ...emptyDepthStats(), depthImbalance: 0.15 }
      }),
      easyCfg
    );
    expect(hit?.setup).toBe("B_FAST_BREAKOUT");
    expect(hit?.side).toBe("BUY");
  });

  it("setup C fires pullback re-acceleration BUY", () => {
    const mid = BASE + 0.6;
    const hit = scorePullbackReaccel(
      feat({
        mid,
        high5s: BASE + 0.8,
        low5s: BASE,
        midVel3s: 0.0002,
        midVel250: 0.0001,
        acceleration: 0.00015,
        efficiency3s: 0.6,
        signedImbalance1s: 0.3,
        depth: { ...emptyDepthStats(), depthImbalance: 0.05 }
      }),
      easyCfg
    );
    expect(hit?.setup).toBe("C_PULLBACK_REACCEL");
    expect(hit?.side).toBe("BUY");
  });
});

describe("exits: abort / lock / runner / trail", () => {
  it("rapid-abort when thesis collapses with mfe<=0", () => {
    const trade = openTrade({
      tradeId: "t1",
      side: "BUY",
      setup: "A_MOMENTUM_IGNITION",
      entryTs: 1,
      bid: BASE,
      ask: BASE + 0.12,
      trailDistance: 0.1
    });
    const reason = evaluateOpenExit({
      trade,
      f: feat({
        mid: BASE - 0.2,
        midVel250: -0.0002,
        acceleration: -0.0002,
        signedImbalance1s: -0.4,
        depth: { ...emptyDepthStats(), depthImbalance: -0.4 }
      }),
      cfg: easyCfg,
      dataOk: true
    });
    expect(reason).toBe("RAPID_ABORT");
  });

  it("profit-lock activates and trail never loosens", () => {
    const trade = openTrade({
      tradeId: "t2",
      side: "BUY",
      setup: "A_MOMENTUM_IGNITION",
      entryTs: 1,
      bid: BASE,
      ask: BASE + 0.1,
      trailDistance: 0.12
    });
    updateOpenTrade(trade, BASE + 0.4, BASE + 0.5, easyCfg);
    expect(trade.profitLockActive).toBe(true);
    expect(trade.harvestRunner).toBe(true);
    expect(trade.lockFloor).not.toBeNull();
    const floor1 = trade.lockFloor!;
    updateOpenTrade(trade, BASE + 0.55, BASE + 0.65, easyCfg);
    const floor2 = trade.lockFloor!;
    expect(floor2).toBeGreaterThanOrEqual(floor1);
    // Adverse tick must not loosen lock floor
    updateOpenTrade(trade, BASE + 0.35, BASE + 0.45, easyCfg);
    expect(trade.lockFloor!).toBeGreaterThanOrEqual(floor2);
  });

  it("runner stays open while pressure favorable", () => {
    const trade = openTrade({
      tradeId: "t3",
      side: "BUY",
      setup: "B_FAST_BREAKOUT",
      entryTs: 1,
      bid: BASE,
      ask: BASE + 0.1,
      trailDistance: 0.12
    });
    updateOpenTrade(trade, BASE + 0.4, BASE + 0.5, easyCfg);
    const reason = evaluateOpenExit({
      trade,
      f: feat({
        mid: BASE + 0.45,
        midVel250: 0.0001,
        acceleration: 0.00005,
        signedImbalance1s: 0.2,
        depth: { ...emptyDepthStats(), depthImbalance: 0.1 }
      }),
      cfg: easyCfg,
      dataOk: true
    });
    expect(reason).toBeNull();
    expect(trade.harvestRunner).toBe(true);
  });

  it("hard protection never averages down", () => {
    const trade = openTrade({
      tradeId: "t4",
      side: "BUY",
      setup: "A_MOMENTUM_IGNITION",
      entryTs: 1,
      bid: BASE,
      ask: BASE + 0.1,
      trailDistance: 0.12
    });
    const reason = evaluateOpenExit({
      trade,
      f: feat({ mid: BASE - 1.0, spread: 0.12 }),
      cfg: { ...easyCfg, hardStop: 0.5 },
      dataOk: true
    });
    expect(reason).toBe("HARD_PROTECTION");
  });
});

describe("event-driven engine + latency", () => {
  it("reacts to spot/depth events without 1s timer primary", async () => {
    const adapter = new ShadowExecutionAdapter();
    const engine = new GoldHunterFastEngine({ config: easyCfg, adapter });
    const t0 = 2_000_000;
    await feedRisingMomentum(engine, t0);
    const st = engine.status();
    expect(st.brokerRequests).toBe(0);
    expect(st.brokerOrders).toBe(0);
    expect(st.mutationSurface).toBe("NONE");
    expect(st.shadowOnly).toBe(true);
    expect(engine.decisions.length).toBeGreaterThan(10);
    // Latency samples are measured, not fabricated
    const lat = st.latency;
    expect(lat.count).toBeGreaterThan(0);
    expect(lat.p50).not.toBeNull();
    expect(lat.p95).not.toBeNull();
    expect(lat.p99).not.toBeNull();
    expect(lat.max).not.toBeNull();
    expect(lat.p50!).toBeLessThan(GH_FAST_LATENCY_P50_TARGET_MS * 20); // generous CI bound
    expect(lat.p95!).toBeLessThan(GH_FAST_LATENCY_P95_TARGET_MS * 20);
  });

  it("can enter on setup A path and exit with shadow orders only", async () => {
    const adapter = new ShadowExecutionAdapter();
    const engine = new GoldHunterFastEngine({
      config: {
        ...easyCfg,
        minSetupQuality: 0.2,
        momentumVelMin: 0.00002,
        friction: 0.001,
        safetyBuffer: 0.001
      },
      adapter
    });
    const t0 = 3_000_000;
    await feedRisingMomentum(engine, t0);
    // Force continuation that should enter if not already
    for (let i = 40; i < 70; i++) {
      const t = t0 + i * 40;
      const mid = BASE + i * 0.05;
      await engine.onMarketEvent(spot(t, mid, 0.1));
      const dseq = seq++;
      await engine.onMarketEvent({
        kind: "DEPTH",
        receiveSeq: dseq,
        eventId: `DEPTH:enter:${dseq}`,
        receivedAtMs: t + 1,
        brokerTimestampMs: t + 1,
        newQuotes: [
          { id: "b1", type: "BID", price: mid - 0.05, size: 200 },
          { id: "a1", type: "ASK", price: mid + 0.05, size: 20 }
        ],
        deletedQuotes: [{ id: "a2" }]
      });
    }
    const entered = adapter.orders.some((o) => o.kind === "ENTER");
    expect(entered || engine.status().openTrade != null || engine.closed.length > 0).toBe(true);
    expect(adapter.orders.every((o) => o.shadowOnly && o.mutationSurface === "NONE")).toBe(true);
    expect(engine.status().brokerOrders).toBe(0);
  });

  it("re-arms within 250-500ms floor only", async () => {
    const adapter = new ShadowExecutionAdapter();
    const engine = new GoldHunterFastEngine({
      config: { ...easyCfg, rearmFloorMs: 300 },
      adapter
    });
    expect(engine.getConfig().rearmFloorMs).toBe(300);
    expect(engine.getConfig().rearmFloorMs).toBeGreaterThanOrEqual(250);
    expect(engine.getConfig().rearmFloorMs).toBeLessThanOrEqual(500);
  });
});

describe("replay equivalence", () => {
  it("live engine and replay share decisions", async () => {
    const events: GhFastMarketEvent[] = [];
    const t0 = 4_000_000;
    events.push(depthSeed(t0));
    for (let i = 0; i < 50; i++) {
      events.push(spot(t0 + i * 60, BASE + Math.sin(i / 5) * 0.2 + i * 0.01));
      if (i % 3 === 0) events.push(depthSeed(t0 + i * 60 + 1, BASE + i * 0.01, BASE + i * 0.01 + 0.12));
    }
    expect(await assertReplayDeterministic(events, easyCfg)).toBe(true);
    const { result } = await replayGhFastEvents({ events, config: easyCfg });
    expect(result.brokerRequests).toBe(0);
    expect(result.brokerOrders).toBe(0);
  });
});

describe("collector + features", () => {
  it("persists compact chunks off hot path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-fast-"));
    try {
      const collector = new GhFastEventCollector({ dir, chunkRows: 5 });
      const engine = new GoldHunterFastEngine({ config: easyCfg });
      const t0 = 5_000_000;
      await engine.onMarketEvent(depthSeed(t0));
      for (let i = 0; i < 8; i++) {
        const dec = await engine.onMarketEvent(spot(t0 + i * 100, BASE + i * 0.01));
        collector.record({
          t: t0 + i * 100,
          event: spot(t0 + i * 100, BASE + i * 0.01),
          decision: dec,
          status: {
            state: engine.status().state,
            bid: engine.status().bid,
            ask: engine.status().ask,
            spread: engine.status().spread,
            depthImbalance: engine.status().depthImbalance,
            velocity: engine.status().velocity,
            acceleration: engine.status().acceleration,
            setup: engine.status().setup,
            setupQuality: engine.status().setupQuality
          },
          depthTop: engine.depth.snapshot(5)
        });
      }
      await collector.flushAndWait(5000);
      expect(collector.hasData()).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("feature engine builds rolling velocities from past-only samples", () => {
    const fe = new FastFeatureEngine();
    const t0 = 6_000_000;
    for (let i = 0; i < 30; i++) {
      fe.onSpot(t0 + i * 100, BASE + i * 0.02 - 0.05, BASE + i * 0.02 + 0.05);
    }
    const snap = fe.snapshot(t0 + 2900, emptyDepthStats());
    expect(snap).not.toBeNull();
    expect(snap!.midVel1s).toBeGreaterThan(0);
    expect(snap!.high5s).toBeGreaterThanOrEqual(snap!.low5s);
  });
});

describe("transport spot + depth subscriptions", () => {
  it("allows depth subscribe VIEW commands and counts them", async () => {
    expect(MICRO_ALLOWED_READ_COMMANDS.has("ProtoOASubscribeDepthQuotesReq")).toBe(true);
    expect(() => assertReadOnlyCommand("ProtoOASubscribeDepthQuotesReq")).not.toThrow();
    const fake = new FakeMicroCTraderTransport();
    await fake.connect();
    expect(fake.getSubscribeSpotsCallCount()).toBe(0);
    expect(fake.getSubscribeDepthCallCount()).toBe(0);
    await fake.subscribeSpots("41");
    await fake.subscribeDepthQuotes("41");
    expect(fake.getSubscribeSpotsCallCount()).toBe(1);
    expect(fake.getSubscribeDepthCallCount()).toBe(1);
    let depthSeen = 0;
    fake.on("ProtoOADepthEvent", () => {
      depthSeen += 1;
    });
    fake.emitDepth({ symbolId: 41, newQuotes: [] });
    expect(depthSeen).toBe(1);
    expect(fake.mutationSurface).toBe("NONE");
  });
});
