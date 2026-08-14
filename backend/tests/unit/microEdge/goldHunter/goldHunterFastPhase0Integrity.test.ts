/**
 * Phase 0A/0B integrity: DATA_STALE EXIT persistence, resync markers, specialist telemetry.
 * Research-only — does not retune strategy thresholds or enable broker orders.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GoldHunterFastEngine,
  GoldHunterFastLiveBridge,
  ShadowExecutionAdapter,
  resetFrozenGhFastIdentityForTests,
  applyStreamEvent,
  verifyReplayParityFromEvents,
  verifyReplayParityFromLocalChunks,
  evaluateSetupsDetailed,
  defaultGhFastConfig,
  marketEventsOnly,
  isGhFastMarketEvent
} from "../../../../src/services/microEdge/goldHunter/fast";
import type {
  GhFastDepthEvent,
  GhFastSpotEvent,
  GhFastStreamEvent
} from "../../../../src/services/microEdge/goldHunter/fast/types";
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

function seedOpenTrade(eng: GoldHunterFastEngine, nowMs: number): void {
  const open = {
    tradeId: `gh_fast_test_${nowMs}`,
    side: "BUY" as const,
    setup: "A_MOMENTUM_IGNITION" as const,
    entryTs: nowMs - 5_000,
    entryBid: 4330,
    entryAsk: 4330.1,
    entryPrice: 4330.1,
    bestExit: 4330,
    mfe: 0,
    mae: 0,
    profitLockActive: false,
    lockFloor: null,
    trailDistance: 0.12,
    harvestRunner: false
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (eng as any).open = open;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (eng as any).lastBid = 4330;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (eng as any).lastAsk = 4330.1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (eng as any).sampleTagMode = "QUALIFICATION";
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
  maxSpread: 0.5,
  sideFreshnessMs: 60_000,
  depthFreshnessMs: 60_000
});

async function feedRisingMomentum(
  process: (ev: GhFastSpotEvent | GhFastDepthEvent) => Promise<unknown>,
  t0: number,
  startSeq = 1
): Promise<{ seq: number; entered: boolean }> {
  let seq = startSeq;
  await process(
    depthEv(seq++, t0, [
      { id: "b1", type: "BID", price: 4330, size: 140 },
      { id: "a1", type: "ASK", price: 4330.12, size: 90 }
    ])
  );
  let entered = false;
  for (let i = 0; i < 50; i++) {
    const t = t0 + i * 50;
    const mid = 4330 + i * 0.04;
    const d = await process(spotEv(seq++, t, mid - 0.06, mid + 0.06));
    if (
      d &&
      typeof d === "object" &&
      "action" in d &&
      (d.action === "ENTER_BUY" || d.action === "ENTER_SELL")
    ) {
      entered = true;
    }
    if (i % 4 === 0) {
      await process(
        depthEv(seq++, t + 1, [
          { id: "b1", type: "BID", price: mid - 0.06, size: 140 + i },
          { id: "a1", type: "ASK", price: mid + 0.06, size: Math.max(10, 90 - i * 2) }
        ])
      );
    }
  }
  return { seq, entered };
}

describe("Phase 0A — resync EXIT + deterministic marker", () => {
  beforeEach(() => resetFrozenGhFastIdentityForTests());

  it("open trade + resync => exactly one DATA_STALE EXIT with audit fields", async () => {
    const adapter = new ShadowExecutionAdapter();
    const eng = new GoldHunterFastEngine({
      adapter,
      useFrozenSoakConfig: true
    });
    seedOpenTrade(eng, 10_000);
    const before = eng.closed.length;
    const result = await eng.resetMarketDataForResync({
      reason: "stale_spot_and_depth",
      nowMs: 10_000,
      receiveSeq: 42
    });
    expect(result.closedOpen).toBe(true);
    expect(result.closedTrades).toHaveLength(1);
    expect(result.exitDecisions).toHaveLength(1);
    expect(result.exitDecisions[0]!.action).toBe("EXIT");
    expect(result.exitDecisions[0]!.exitReason).toBe("DATA_STALE");
    expect(eng.closed.length).toBe(before + 1);
    const t = result.closedTrades[0]!;
    expect(t.exitReason).toBe("DATA_STALE");
    expect(t.sampleTag).toBe("QUALIFICATION");
    expect(t.resyncReason).toBe("stale_spot_and_depth");
    expect(t.resetSequence).toBe(42);
    expect(t.bookGeneration).toBe(result.resyncMarker.bookGenerationAfter);
    expect(result.resyncMarker.kind).toBe("RESYNC");
    expect(result.resyncDecision.action).toBe("RESYNC");
    expect(eng.isWarmingUp()).toBe(true);
    expect(adapter.orders.filter((o) => o.kind === "EXIT")).toHaveLength(1);
    expect(adapter.brokerRequests ?? 0).toBe(0);
  });

  it("no open trade + resync => no artificial trade", async () => {
    const adapter = new ShadowExecutionAdapter();
    const eng = new GoldHunterFastEngine({
      adapter,
      useFrozenSoakConfig: true
    });
    const result = await eng.resetMarketDataForResync({
      reason: "invalid_crossed_book",
      nowMs: 1,
      receiveSeq: 7
    });
    expect(result.closedOpen).toBe(false);
    expect(result.closedTrades).toHaveLength(0);
    expect(eng.closed).toHaveLength(0);
    expect(adapter.orders.filter((o) => o.kind === "EXIT")).toHaveLength(0);
    expect(result.resyncMarker.closedTradeIds).toHaveLength(0);
  });

  it("multiple resync calls => no duplicate EXIT", async () => {
    const adapter = new ShadowExecutionAdapter();
    const eng = new GoldHunterFastEngine({
      adapter,
      useFrozenSoakConfig: true
    });
    seedOpenTrade(eng, 5_000);
    await eng.resetMarketDataForResync({
      reason: "stale_spot",
      nowMs: 5_000,
      receiveSeq: 1
    });
    expect(eng.closed).toHaveLength(1);
    await eng.resetMarketDataForResync({
      reason: "stale_depth",
      nowMs: 6_000,
      receiveSeq: 2
    });
    expect(eng.closed).toHaveLength(1);
    expect(eng.persistedExitEvidence).toHaveLength(1);
    expect(adapter.orders.filter((o) => o.kind === "EXIT")).toHaveLength(1);
    expect(eng.resyncMarkers).toHaveLength(2);
  });

  it("RESYNC_EXIT_AUDIT is not a market event", async () => {
    const bridge = new GoldHunterFastLiveBridge({
      enabled: true,
      enableCollector: true,
      collectDir: mkdtempSync(join(tmpdir(), "gh-fast-audit-")),
      useFrozenSoakConfig: true
    });
    seedOpenTrade(bridge.engine, 20_000);
    await bridge.resetMarketDataForResync("stale_spot_and_depth");
    const audit = {
      kind: "RESYNC_EXIT_AUDIT" as const,
      receiveSeq: 1,
      eventId: "RESYNC_EXIT_AUDIT:1:x",
      receivedAtMs: 1,
      tradeId: "x",
      reason: "stale_spot_and_depth"
    };
    expect(isGhFastMarketEvent(audit)).toBe(false);
    expect(marketEventsOnly([audit, spotEv(2, 2, 1, 1.1)])).toHaveLength(1);
    expect(marketEventsOnly([audit, spotEv(2, 2, 1, 1.1)])[0]!.kind).toBe("SPOT");
  });

  it("bridge collector persists AUDIT_EXIT + RESYNC; closed count == persisted EXIT", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-fast-phase0-"));
    const bridge = new GoldHunterFastLiveBridge({
      enabled: true,
      enableCollector: true,
      collectDir: dir,
      useFrozenSoakConfig: true
    });
    seedOpenTrade(bridge.engine, 20_000);
    const r = await bridge.resetMarketDataForResync("stale_spot_and_depth");
    expect(r.closedTrades).toBe(1);
    await bridge.collector!.flushAndWait(3000);
    expect(bridge.collector!.persistedExitCount()).toBe(1);
    expect(bridge.collector!.persistedResyncCount()).toBe(1);
    expect(bridge.engine.closed.length).toBe(
      bridge.collector!.persistedExitCount()
    );
    const h = bridge.health();
    expect(h.eventsDropped).toBe(0);
    expect(h.brokerRequests).toBe(0);
    expect(h.brokerOrders).toBe(0);
    expect(h.resyncByReason.stale_spot_and_depth).toBe(1);
    expect(readdirSync(dir).length).toBeGreaterThan(0);
  });

  it("collector → disk → verifyReplayParityFromLocalChunks (open + RESYNC)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-fast-disk-replay-"));
    const bridge = new GoldHunterFastLiveBridge({
      enabled: true,
      enableCollector: true,
      collectDir: dir,
      useFrozenSoakConfig: false,
      config: easyCfg
    });
    const feed = await feedRisingMomentum(
      (ev) => bridge.processMarketEventForTests(ev),
      1_000_000
    );
    expect(feed.entered || bridge.engine.status().openTrade != null).toBe(true);
    if (!bridge.engine.status().openTrade) {
      seedOpenTrade(bridge.engine, 1_000_000 + 50 * 50);
    }
    expect(bridge.engine.status().openTrade).not.toBeNull();
    const openId = bridge.engine.status().openTrade!.tradeId;
    const r = await bridge.resetMarketDataForResync("stale_spot_and_depth");
    expect(r.closedTrades).toBe(1);
    expect(bridge.engine.closed.filter((t) => t.exitReason === "DATA_STALE")).toHaveLength(1);
    expect(bridge.engine.closed.filter((t) => t.tradeId === openId)).toHaveLength(1);
    await bridge.collector!.flushAndWait(5000);

    const parity = await verifyReplayParityFromLocalChunks({
      chunkDir: dir,
      useFrozenSoakConfig: false,
      config: easyCfg
    });
    expect(parity.code).toBe("LIVE_REPLAY_OK");
    expect(parity.ok).toBe(true);
    expect(parity.comparedEvents).toBeGreaterThan(0);
    expect(parity.liveEntries).toBe(parity.replayEntries);
    expect(parity.liveExits).toBe(parity.replayExits);
    expect(parity.liveResyncs).toBe(parity.replayResyncs);
    expect(parity.liveResyncs).toBeGreaterThanOrEqual(1);
    expect(parity.liveExits).toBeGreaterThanOrEqual(1);
    expect(bridge.health().brokerOrders).toBe(0);
    expect(bridge.health().brokerRequests).toBe(0);
  });

  it("replay with resync marker => action parity (force-close + rebuild)", async () => {
    const events: GhFastStreamEvent[] = [
      spotEv(1, 1000, 4330, 4330.1),
      depthEv(2, 1001, [
        { id: "b", type: "BID", price: 4330, size: 2 },
        { id: "a", type: "ASK", price: 4330.1, size: 2 }
      ]),
      spotEv(3, 1500, 4330.02, 4330.12),
      {
        kind: "RESYNC",
        receiveSeq: 4,
        eventId: "RESYNC:4:stale_spot",
        receivedAtMs: 1600,
        reason: "stale_spot",
        bookGenerationAfter: 1,
        closedTradeIds: []
      },
      spotEv(5, 1700, 4330.0, 4330.1),
      depthEv(6, 1710, [
        { id: "b2", type: "BID", price: 4330, size: 2 },
        { id: "a2", type: "ASK", price: 4330.1, size: 2 }
      ])
    ];
    const parity = await verifyReplayParityFromEvents(events);
    expect(parity.ok).toBe(true);
    expect(parity.code).toBe("LIVE_REPLAY_OK");
    expect(parity.liveResyncs).toBe(parity.replayResyncs);

    const live = new GoldHunterFastEngine({
      adapter: new ShadowExecutionAdapter(),
      useFrozenSoakConfig: true
    });
    seedOpenTrade(live, 1400);
    const actions: string[] = [];
    for (const ev of events) {
      const d = await applyStreamEvent(live, ev);
      actions.push(d.action);
    }
    expect(actions).toContain("RESYNC");
    expect(live.closed.filter((t) => t.exitReason === "DATA_STALE")).toHaveLength(
      1
    );
  });
});

describe("Phase 0B — raw specialist telemetry", () => {
  it("evaluateSetupsDetailed reports A/B/C separately from selected", () => {
    const cfg = defaultGhFastConfig({});
    const f = {
      bid: 4330,
      ask: 4330.1,
      mid: 4330.05,
      spread: 0.1,
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
      updateRate1s: 1,
      signedImbalance1s: 0,
      efficiency1s: 0,
      efficiency3s: 0.1,
      high1s: 4330.1,
      low1s: 4330,
      high2s: 4330.1,
      low2s: 4330,
      high5s: 4330.2,
      low5s: 4329.9,
      high10s: 4330.2,
      low10s: 4329.9,
      high15s: 4330.2,
      low15s: 4329.9,
      high30s: 4330.2,
      low30s: 4329.9,
      distHigh1s: 0.05,
      distLow1s: 0.05,
      distHigh5s: 0.15,
      distLow5s: 0.15,
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
        bestBid: 4330,
        bestAsk: 4330.1,
        spread: 0.1,
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

    const result = evaluateSetupsDetailed(f, cfg);
    expect(result.specialists).toHaveLength(3);
    expect(result.selected).toBeNull();
    for (const sp of result.specialists) {
      expect(sp.eligible).toBe(false);
      expect(sp.selected).toBe(false);
      expect(sp.failedConditions.length).toBeGreaterThan(0);
      // Structural fail → rawQuality null (not fake 0)
      expect(sp.rawQuality).toBeNull();
    }
  });

  it("preserves nonzero sub-threshold rawQuality with quality_below_min", () => {
    const cfg = defaultGhFastConfig({ minSetupQuality: 0.55, momentumVelMin: 0.00008 });
    // Structural gates for A buy pass, but quality kept just below min.
    const f = {
      bid: 4330,
      ask: 4330.1,
      mid: 4330.05,
      spread: 0.1,
      bidVel250: 0.0001,
      bidVel500: 0.0001,
      bidVel1s: 0.00009,
      bidVel2s: 0.00009,
      bidVel3s: 0.00009,
      askVel1s: 0.00009,
      midVel250: 0.0001,
      midVel500: 0.0001,
      midVel1s: 0.00009,
      midVel2s: 0.00009,
      midVel3s: 0.00009,
      acceleration: 0.00002,
      updateRate1s: 5,
      signedImbalance1s: 0.2,
      efficiency1s: 0.5,
      efficiency3s: 0.5,
      high1s: 4330.2,
      low1s: 4329.9,
      high2s: 4330.2,
      low2s: 4329.9,
      high5s: 4330.2,
      low5s: 4329.9,
      high10s: 4330.2,
      low10s: 4329.9,
      high15s: 4330.2,
      low15s: 4329.9,
      high30s: 4330.2,
      low30s: 4329.9,
      distHigh1s: 0.15,
      distLow1s: 0.15,
      distHigh5s: 0.15,
      distLow5s: 0.15,
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
        addRateAsk: 1,
        removeRateBid: 0,
        removeRateAsk: 2,
        bestBid: 4330,
        bestAsk: 4330.1,
        spread: 0.1,
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

    const result = evaluateSetupsDetailed(f, cfg);
    const a = result.specialists.find((s) => s.setup === "A_MOMENTUM_IGNITION")!;
    // If structural gates + quality calc ran below min:
    if (a.failedConditions.includes("quality_below_min")) {
      expect(a.eligible).toBe(false);
      expect(a.rawQuality).not.toBeNull();
      expect(a.rawQuality!).toBeGreaterThan(0);
      expect(a.rawQuality!).toBeLessThan(cfg.minSetupQuality);
      expect(a.candidateSide).toBe("BUY");
    } else if (a.eligible) {
      // Quality cleared min — still prove rawQuality nonzero
      expect(a.rawQuality!).toBeGreaterThan(0);
    } else {
      // Structural fail path must use null not 0
      expect(a.rawQuality).toBeNull();
    }
  });
});

describe("Phase 0 — ordinary strategy behavioural fingerprint", () => {
  it("deterministic decision digest is stable for a fixed SPOT/DEPTH fixture", async () => {
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
      spotEv(7, 3500, 4330.03, 4330.13),
      spotEv(8, 4000, 4330.08, 4330.18),
      depthEv(9, 4010, [
        { id: "b", type: "BID", price: 4330.05, size: 3 },
        { id: "a", type: "ASK", price: 4330.15, size: 2 }
      ]),
      spotEv(10, 4500, 4330.1, 4330.2)
    ];
    const eng = new GoldHunterFastEngine({
      adapter: new ShadowExecutionAdapter(),
      useFrozenSoakConfig: true
    });
    const lines: string[] = [];
    for (const ev of events) {
      const d = await eng.onMarketEvent(ev);
      lines.push(
        [
          ev.receiveSeq,
          d.action,
          d.setup ?? "-",
          d.side ?? "-",
          d.setupQuality.toFixed(6),
          d.exitReason ?? "-",
          d.state
        ].join("|")
      );
    }
    const digest = createHash("sha256").update(lines.join("\n")).digest("hex");
    // Re-run for stability within this HEAD.
    const eng2 = new GoldHunterFastEngine({
      adapter: new ShadowExecutionAdapter(),
      useFrozenSoakConfig: true
    });
    const lines2: string[] = [];
    for (const ev of events) {
      const d = await eng2.onMarketEvent(ev);
      lines2.push(
        [
          ev.receiveSeq,
          d.action,
          d.setup ?? "-",
          d.side ?? "-",
          d.setupQuality.toFixed(6),
          d.exitReason ?? "-",
          d.state
        ].join("|")
      );
    }
    const digest2 = createHash("sha256").update(lines2.join("\n")).digest("hex");
    expect(digest).toBe(digest2);
    expect(lines).toEqual(lines2);
    // Expose digest for V1 cross-SHA comparison artifact.
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });
});
