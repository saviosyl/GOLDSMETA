/**
 * Phase 0A/0B integrity: DATA_STALE EXIT persistence, resync markers, specialist telemetry.
 * Research-only — does not retune strategy thresholds or enable broker orders.
 */
import { describe, expect, it, beforeEach } from "vitest";
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
  evaluateSetupsDetailed,
  defaultGhFastConfig
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
  // Bypass setups: inject an open position via private field is not available.
  // Use a minimal path: push via (eng as any).open after creating structure.
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
    expect(t.grossMove).toBeDefined();
    expect(t.netMove).toBeDefined();
    expect(t.mfe).toBeDefined();
    expect(t.mae).toBeDefined();
    expect(t.durationMs).toBeGreaterThan(0);
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
    expect(eng.isWarmingUp()).toBe(true);
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

  it("bridge collector persists EXIT + RESYNC; closed count == persisted EXIT", async () => {
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
    // Ensure something was written under collect dir
    expect(readdirSync(dir).length).toBeGreaterThan(0);
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
    expect(live.closed.some((t) => t.exitReason === "DATA_STALE")).toBe(true);
    expect(live.closed.filter((t) => t.exitReason === "DATA_STALE")).toHaveLength(
      1
    );
    expect(live.isWarmingUp()).toBe(true);
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
    expect(result.specialists.map((s) => s.setup)).toEqual([
      "A_MOMENTUM_IGNITION",
      "B_FAST_BREAKOUT",
      "C_PULLBACK_REACCEL"
    ]);
    expect(result.selected).toBeNull();
    for (const sp of result.specialists) {
      expect(sp.eligible).toBe(false);
      expect(sp.failedConditions.length).toBeGreaterThan(0);
    }
    // C must expose specific failure taxonomy (not just "selected=0").
    const c = result.specialists.find((s) => s.setup === "C_PULLBACK_REACCEL")!;
    expect(
      c.failedConditions.some(
        (x) =>
          x.includes("impulse") ||
          x.includes("efficiency") ||
          x.includes("pullback") ||
          x.includes("no_pullback")
      )
    ).toBe(true);
  });
});
