/**
 * Gold Hunter Demo lifecycle — execution trigger, opportunity dedupe,
 * position manager, persistence bounds, soak.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("../../../src/services/broker/ctrader/connectionStore", () => ({
  getConnection: vi.fn(async () => ({
    selectedAccountId: "123",
    selectedAccountIsLive: false,
    environment: "DEMO",
    oauthScope: "trading",
    brokerConfirmedPepperstone: true,
    symbolId: "42",
    symbolName: "XAUUSD",
    symbolDigits: 2
  }))
}));

vi.mock("../../../src/services/broker/ctrader/flags", () => ({
  isCTraderLiveEnabled: () => false,
  isCTraderDemoOrderSubmissionEnabled: () => true
}));

vi.mock("../../../src/services/marketFeed/sharedMarketData", () => ({
  getSharedXauusdQuote: vi.fn(async () => ({
    marketStatus: "OPEN",
    updatedAt: new Date().toISOString(),
    bid: 2600,
    ask: 2600.12
  }))
}));

import {
  buildGoldHunterOpportunityId,
  getGoldHunterStrategySelector,
  resetGoldHunterStrategySelectorsForTests,
  type GoldHunterSelectedCandidate
} from "../../../src/services/goldHunterAdmin/strategySelector";
import {
  enqueueGoldHunterDemoAutoExecution,
  drainGoldHunterDemoAutoExecutionForTests,
  resetGoldHunterDemoAutoExecutionForTests,
  runGoldHunterDemoAutoExecution,
  setGoldHunterDemoAutoExecutionHooksForTests,
  goldHunterDemoExecQueueStats
} from "../../../src/services/goldHunterAdmin/demoAutoExecutionRuntime";
import {
  resetGoldHunterMarketFeedForTests,
  getGoldHunterRuntimePersistWriteCount,
  GH_SELECTOR_RUNTIME_PERSIST_MIN_MS,
  onGoldHunterDepthEvent,
  markGoldHunterSpotAttached,
  markGoldHunterDepthAttached
} from "../../../src/services/goldHunterAdmin/marketFeedHook";
import {
  tickGoldHunterPositionManager,
  resetGoldHunterPositionManagerForTests,
  setGoldHunterPositionManagerHooksForTests,
  registerGoldHunterOpenPositionForOwner,
  nextTightenedStop,
  reconcileAndRestoreGoldHunterPositions,
  restoreGoldHunterPositionManager
} from "../../../src/services/goldHunterAdmin/demoPositionManager";
import {
  resetGoldHunterSignalClaimsForTests,
  acquireGoldHunterSignalClaim
} from "../../../src/services/goldHunterAdmin/signalClaimStore";
import {
  resetGoldHunterTradeMemory,
  upsertGoldHunterDemoTrade,
  listGoldHunterDemoTrades
} from "../../../src/services/goldHunterAdmin/tradeStore";
import { saveGoldHunterConfig } from "../../../src/services/goldHunterAdmin/configStore";
import { resetOwnerQueuesForTests, BoundedSerializedQueue } from "../../../src/services/goldHunterAdmin/boundedQueue";
import { assertGoldHunterCandidateFresh } from "../../../src/services/goldHunterAdmin/candidateFreshness";
import { frozenGhFastSoakConfig } from "../../../src/services/goldHunterAdmin/abc";
import {
  updateOpenTrade,
  evaluateOpenExit,
  openTrade
} from "../../../src/services/goldHunterAdmin/abc/exits";
import { GH_ADMIN_DEFAULT_CONFIG, GH_ADMIN_STRATEGY_ID } from "../../../src/services/goldHunterAdmin/types";
import { GH_FAST_MARKET_DATA_NORMALIZATION_VERSION } from "../../../src/services/goldHunterAdmin/abc";
import type { BrokerSymbol } from "../../../src/services/broker/domain";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const OWNER = "gh-lifecycle-owner";

function symbolMeta(): BrokerSymbol {
  return {
    brokerId: "pepperstone_ctrader",
    environment: "DEMO",
    symbolId: "42",
    symbolName: "XAUUSD",
    displayName: "XAUUSD",
    baseAsset: "XAU",
    quoteAsset: "USD",
    digits: 2,
    pipPosition: 1,
    tickSize: 0.01,
    minVolume: 0.01,
    volumeStep: 0.01,
    maxVolume: 50,
    lotSize: 1,
    commissionType: null,
    commissionAmount: null,
    minCommission: null,
    swapLong: null,
    swapShort: null,
    minStopDistance: null,
    rawSlDistance: null,
    distanceSetIn: null,
    rawTpDistance: null,
    normalizedMinStopPriceDistance: 0.1,
    guaranteedStopAvailable: null,
    tradingScheduleId: null,
    metadataComplete: true
  };
}

async function seedConfig(enabled: boolean) {
  await saveGoldHunterConfig(OWNER, {
    ...GH_ADMIN_DEFAULT_CONFIG,
    demoAutoTradeEnabled: enabled,
    mode: enabled ? "DEMO_AUTO" : "RESEARCH",
    updatedAt: new Date().toISOString(),
    updatedBy: OWNER
  });
}

const hitA = {
  setup: "A_MOMENTUM_IGNITION",
  side: "BUY" as const,
  quality: 0.8
};

beforeEach(async () => {
  resetGoldHunterStrategySelectorsForTests();
  resetGoldHunterSignalClaimsForTests();
  resetGoldHunterTradeMemory();
  resetGoldHunterMarketFeedForTests();
  resetGoldHunterDemoAutoExecutionForTests();
  resetGoldHunterPositionManagerForTests();
  resetOwnerQueuesForTests();
  await seedConfig(false);
});

describe("Opportunity lifecycle vs display candidate", () => {
  it("continuous selected setup across 100 Depth events → one opportunity", () => {
    const sel = getGoldHunterStrategySelector(OWNER);
    const ids = new Set<string>();
    let newOppCount = 0;
    for (let i = 0; i < 100; i++) {
      const tick = sel.processInjectedSelectionForTests({
        selected: hitA,
        receivedAtMs: 10_000 + i,
        receiveSeq: i + 1
      });
      if (tick.newOpportunity) newOppCount += 1;
      if (tick.opportunity) ids.add(tick.opportunity.opportunityId);
      expect(tick.selectedNow).toBe(true);
      expect(tick.candidate?.opportunityId).toBeTruthy();
    }
    expect(newOppCount).toBe(1);
    expect(ids.size).toBe(1);
  });

  it("receiveSeq changes alone → not 100 separate opportunity ids", () => {
    const sel = getGoldHunterStrategySelector(OWNER);
    const first = sel.processInjectedSelectionForTests({
      selected: hitA,
      receivedAtMs: 1_000,
      receiveSeq: 1
    });
    expect(first.newOpportunity).toBe(true);
    const id = first.opportunity!.opportunityId;
    for (let i = 2; i <= 100; i++) {
      const tick = sel.processInjectedSelectionForTests({
        selected: hitA,
        receivedAtMs: 1_000 + i,
        receiveSeq: i
      });
      expect(tick.newOpportunity).toBe(false);
      expect(tick.candidate?.opportunityId).toBe(id);
      expect(tick.candidate?.latestReceiveSeq).toBe(i);
    }
  });

  it("setup ends then valid rearm then new setup → new opportunity", () => {
    const sel = getGoldHunterStrategySelector(OWNER);
    const cfg = frozenGhFastSoakConfig();
    const t0 = 50_000;
    const a = sel.processInjectedSelectionForTests({
      selected: hitA,
      receivedAtMs: t0
    });
    expect(a.newOpportunity).toBe(true);
    const id1 = a.opportunity!.opportunityId;

    // End selection
    sel.processInjectedSelectionForTests({
      selected: null,
      receivedAtMs: t0 + 10
    });

    // Too soon — rearm floor
    const early = sel.processInjectedSelectionForTests({
      selected: hitA,
      receivedAtMs: t0 + 10 + Math.floor(cfg.rearmFloorMs / 2)
    });
    expect(early.newOpportunity).toBe(false);

    // After rearm
    const again = sel.processInjectedSelectionForTests({
      selected: hitA,
      receivedAtMs: t0 + 10 + cfg.rearmFloorMs + 1
    });
    expect(again.newOpportunity).toBe(true);
    expect(again.opportunity!.opportunityId).not.toBe(id1);
  });

  it("sticky display candidate after setup disappears → no newOpportunity", () => {
    const sel = getGoldHunterStrategySelector(OWNER);
    const a = sel.processInjectedSelectionForTests({
      selected: hitA,
      receivedAtMs: 1_000
    });
    expect(a.newOpportunity).toBe(true);
    const sticky = sel.processInjectedSelectionForTests({
      selected: null,
      receivedAtMs: 1_100
    });
    expect(sticky.selectedNow).toBe(false);
    expect(sticky.newOpportunity).toBe(false);
    expect(sticky.opportunity).toBeNull();
    expect(sticky.candidate?.opportunityId).toBe(a.opportunity!.opportunityId);
  });

  it("opportunity id ignores receiveSeq / mid jitter", () => {
    const a = buildGoldHunterOpportunityId({
      setup: "A",
      side: "BUY",
      resyncGeneration: 0,
      opportunityEpoch: 1
    });
    const b = buildGoldHunterOpportunityId({
      setup: "A",
      side: "BUY",
      resyncGeneration: 0,
      opportunityEpoch: 1
    });
    expect(a).toBe(b);
    expect(a.startsWith("GH-OPP-")).toBe(true);
  });
});

describe("Execution trigger (not UI)", () => {
  it("production call site is demoAutoExecutionRuntime → attemptGoldHunterDemoExecution", () => {
    const text = readFileSync(
      resolve(process.cwd(), "src/services/goldHunterAdmin/demoAutoExecutionRuntime.ts"),
      "utf8"
    );
    expect(text).toContain("attemptGoldHunterDemoExecution");
    expect(text).toContain("enqueueGoldHunterDemoAutoExecution");
    expect(text).toContain("demoAutoTradeEnabled");
    const hook = readFileSync(
      resolve(process.cwd(), "src/services/goldHunterAdmin/marketFeedHook.ts"),
      "utf8"
    );
    expect(hook).toContain("enqueueGoldHunterDemoAutoExecution");
    expect(hook).toContain("newOpportunity");
    // Not UI routes
    const route = readFileSync(
      resolve(process.cwd(), "src/routes/goldHunterAdmin.ts"),
      "utf8"
    );
    expect(route).not.toContain("attemptGoldHunterDemoExecution");
    expect(route).not.toContain("enqueueGoldHunterDemoAutoExecution");
  });

  it("selector selected + AutoTrade OFF → zero broker submission", async () => {
    await seedConfig(false);
    let brokerCalls = 0;
    setGoldHunterDemoAutoExecutionHooksForTests({
      attempt: async () => {
        brokerCalls += 1;
        return {
          ok: true,
          submitted: true,
          outcome: "FILLED",
          signalId: "x",
          tradeId: "t"
        };
      },
      loadSymbol: async () => symbolMeta(),
      isAdmin: async () => true
    });
    const sel = getGoldHunterStrategySelector(OWNER);
    const tick = sel.processInjectedSelectionForTests({
      selected: hitA,
      receivedAtMs: Date.now()
    });
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: tick.newOpportunity,
      opportunity: tick.opportunity
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    // Runtime short-circuits on AutoTrade OFF before attempt
    const direct = await runGoldHunterDemoAutoExecution(OWNER, tick.opportunity!);
    expect("skipped" in direct && direct.skipped).toContain("AUTOTRADE OFF");
    expect(brokerCalls).toBe(0);
  });

  it("selector selected + AutoTrade ON + gates path → orchestrator called exactly once", async () => {
    await seedConfig(true);
    let calls = 0;
    setGoldHunterDemoAutoExecutionHooksForTests({
      attempt: async (_uid, cand) => {
        calls += 1;
        return {
          ok: true,
          submitted: true,
          outcome: "FILLED",
          signalId: cand.signalId,
          tradeId: "GH-D-1"
        };
      },
      loadSymbol: async () => symbolMeta(),
      isAdmin: async () => true
    });
    const sel = getGoldHunterStrategySelector(OWNER);
    const tick = sel.processInjectedSelectionForTests({
      selected: hitA,
      receivedAtMs: Date.now()
    });
    expect(tick.newOpportunity).toBe(true);
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity: tick.opportunity
    });
    // Burst of sticky ticks must not enqueue more submissions for same opp via newOpportunity=false
    for (let i = 0; i < 50; i++) {
      const t = sel.processInjectedSelectionForTests({
        selected: hitA,
        receivedAtMs: Date.now() + i
      });
      enqueueGoldHunterDemoAutoExecution({
        ownerUid: OWNER,
        newOpportunity: t.newOpportunity,
        opportunity: t.opportunity
      });
    }
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    expect(calls).toBe(1);
  });

  it("two simultaneous trigger callbacks → one durable broker claim", async () => {
    const id = "GH-OPP-concurrent";
    const a = await acquireGoldHunterSignalClaim({
      ownerUid: OWNER,
      signalId: id,
      goldHunterTradeId: "GH-D-a",
      clientOrderId: "gh_a",
      setup: "A",
      side: "BUY"
    });
    const b = await acquireGoldHunterSignalClaim({
      ownerUid: OWNER,
      signalId: id,
      goldHunterTradeId: "GH-D-b",
      clientOrderId: "gh_b",
      setup: "A",
      side: "BUY"
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
  });
});

describe("Candidate freshness", () => {
  it("stale candidate → WAIT — SIGNAL STALE", () => {
    const sel = getGoldHunterStrategySelector(OWNER);
    const tick = sel.processInjectedSelectionForTests({
      selected: hitA,
      receivedAtMs: Date.now() - 60_000
    });
    // Overwrite ages to stale
    const cand = tick.candidate!;
    // Force stale by not refreshing spot/depth ages relative to now
    const r = assertGoldHunterCandidateFresh({
      ownerUid: OWNER,
      candidate: cand,
      nowMs: Date.now()
    });
    // lastSpotAtMs was set to receivedAtMs (60s ago) → stale vs sideFreshnessMs 1500
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocker).toBe("WAIT — SIGNAL STALE");
  });

  it("candidate from prior resync generation → zero order freshness fail", () => {
    const sel = getGoldHunterStrategySelector(OWNER);
    const tick = sel.processInjectedSelectionForTests({
      selected: hitA,
      receivedAtMs: Date.now()
    });
    sel.clearForResync();
    const r = assertGoldHunterCandidateFresh({
      ownerUid: OWNER,
      candidate: tick.candidate!,
      nowMs: Date.now()
    });
    expect(r.ok).toBe(false);
  });

  it("fresh live candidate passes freshness", () => {
    const sel = getGoldHunterStrategySelector(OWNER);
    const now = Date.now();
    const tick = sel.processInjectedSelectionForTests({
      selected: hitA,
      receivedAtMs: now
    });
    const r = assertGoldHunterCandidateFresh({
      ownerUid: OWNER,
      candidate: tick.candidate!,
      nowMs: now
    });
    expect(r.ok).toBe(true);
  });
});

describe("Frozen exits + position manager", () => {
  it("RAPID_ABORT / TRAIL_HIT / HARVEST_FADE / DATA_STALE paths", () => {
    const cfg = frozenGhFastSoakConfig();
    const trade = openTrade({
      tradeId: "t1",
      side: "BUY",
      setup: "A_MOMENTUM_IGNITION",
      entryTs: Date.now(),
      bid: 2600,
      ask: 2600.1,
      trailDistance: cfg.trailDistance
    });

    const baseFeat = {
      bid: 2599.9,
      ask: 2600.0,
      mid: 2599.95,
      spread: 0.1,
      midVel250: -cfg.momentumVelMin * 2,
      midVel500: 0,
      acceleration: -cfg.momentumVelMin * 2,
      signedImbalance1s: -0.3,
      depth: {
        depthImbalance: -0.3,
        removeRateBid: 1,
        removeRateAsk: 0
      }
    } as Parameters<typeof evaluateOpenExit>[0]["f"];

    expect(
      evaluateOpenExit({ trade, f: baseFeat, cfg, dataOk: false })
    ).toBe("DATA_STALE");

    updateOpenTrade(trade, 2599.9, 2600.0, cfg);
    expect(
      evaluateOpenExit({ trade, f: baseFeat, cfg, dataOk: true })
    ).toBe("RAPID_ABORT");

    // Profit lock trail
    const runner = openTrade({
      tradeId: "t2",
      side: "BUY",
      setup: "A_MOMENTUM_IGNITION",
      entryTs: Date.now(),
      bid: 2600,
      ask: 2600.1,
      trailDistance: cfg.trailDistance
    });
    updateOpenTrade(runner, 2600.4, 2600.5, cfg); // mfe enough for lock
    expect(runner.profitLockActive).toBe(true);
    const trailFeat = {
      ...baseFeat,
      bid: runner.lockFloor! - 0.01,
      ask: runner.lockFloor!,
      midVel250: 0,
      acceleration: 0,
      signedImbalance1s: 0,
      depth: { depthImbalance: 0, removeRateBid: 0, removeRateAsk: 0 }
    } as typeof baseFeat;
    expect(
      evaluateOpenExit({ trade: runner, f: trailFeat, cfg, dataOk: true })
    ).toBe("TRAIL_HIT");

    const harvest = openTrade({
      tradeId: "t3",
      side: "BUY",
      setup: "A_MOMENTUM_IGNITION",
      entryTs: Date.now(),
      bid: 2600,
      ask: 2600.1,
      trailDistance: cfg.trailDistance
    });
    updateOpenTrade(harvest, 2600.4, 2600.5, cfg);
    const fadeFeat = {
      ...baseFeat,
      bid: 2600.35,
      ask: 2600.4,
      midVel250: 0,
      acceleration: -0.001,
      signedImbalance1s: -0.1,
      depth: { depthImbalance: 0, removeRateBid: 0, removeRateAsk: 0 }
    } as typeof baseFeat;
    expect(
      evaluateOpenExit({ trade: harvest, f: fadeFeat, cfg, dataOk: true })
    ).toBe("HARVEST_FADE");
  });

  it("never widen protective stop", () => {
    expect(
      nextTightenedStop({
        side: "BUY",
        currentStop: 2599.5,
        proposedLockFloor: 2599.2,
        hardStop: 0.55,
        entry: 2600
      })
    ).toBeNull();
    expect(
      nextTightenedStop({
        side: "BUY",
        currentStop: 2599.5,
        proposedLockFloor: 2599.7,
        hardStop: 0.55,
        entry: 2600
      })
    ).toBeCloseTo(2599.7, 6);
    expect(
      nextTightenedStop({
        side: "SELL",
        currentStop: 2600.5,
        proposedLockFloor: 2600.8,
        hardStop: 0.55,
        entry: 2600
      })
    ).toBeNull();
  });

  it("open GH position → frozen exit evaluator active; close rejection truthful", async () => {
    const sel = getGoldHunterStrategySelector(OWNER);
    sel.processInjectedSelectionForTests({
      selected: hitA,
      receivedAtMs: Date.now()
    });
    const trade = {
      goldHunterTradeId: "GH-D-pos1",
      strategy: GH_ADMIN_STRATEGY_ID,
      environment: "DEMO" as const,
      setup: "A" as const,
      side: "BUY" as const,
      signalTs: new Date().toISOString(),
      orderTs: new Date().toISOString(),
      fillTs: new Date().toISOString(),
      closeTs: null,
      entry: 2600.1,
      exit: null,
      stop: 2600.1 - 0.55,
      entrySpread: 0.12,
      durationMs: null,
      mfe: null,
      mae: null,
      grossPnlEur: null,
      netPnlEur: null,
      result: "OPEN" as const,
      exitReason: null,
      brokerOrderId: "o1",
      brokerPositionId: "p1",
      status: "FILLED" as const,
      filledVolumeLots: 0.1
    };
    await upsertGoldHunterDemoTrade(OWNER, trade);
    registerGoldHunterOpenPositionForOwner({
      ownerUid: OWNER,
      trade,
      bid: 2600,
      ask: 2600.1
    });

    setGoldHunterPositionManagerHooksForTests({
      closePosition: async () => ({
        accepted: false,
        executionType: null,
        positionId: "p1",
        errorCode: "CLOSE_DENIED"
      }),
      amendStop: async () => ({
        accepted: true,
        executionType: "ORDER_FILLED",
        positionId: "p1",
        errorCode: null
      })
    });

    // Force DATA_STALE exit by clearing features dataOk path — inject stale depth
    sel.processInjectedSelectionForTests({
      selected: hitA,
      receivedAtMs: Date.now(),
      depthValidity: "DEPTH_STALE"
    });
    const r = await tickGoldHunterPositionManager({ ownerUid: OWNER });
    expect(r.evaluated).toBeGreaterThanOrEqual(1);
    expect(r.exitsAttempted).toBeGreaterThanOrEqual(1);
    const updated = (await listGoldHunterDemoTrades(OWNER, { limit: 10 })).find(
      (t) => t.goldHunterTradeId === "GH-D-pos1"
    );
    expect(updated?.status).toBe("PENDING_RECONCILIATION");
    expect(updated?.exitReason).toBe("DATA_STALE");
    expect(updated?.errorCode).toContain("CLOSE");
  });

  it("unmatched / Fast / manual positions untouched", async () => {
    const r = await reconcileAndRestoreGoldHunterPositions({
      ownerUid: OWNER,
      brokerPositions: [
        { positionId: "fast-1", comment: "FAST_AUTOTRADE_V1", label: "FAT-1" },
        { positionId: "manual-1", comment: "manual", label: "manual" }
      ]
    });
    expect(r.unmatched).toBe(2);
    expect(r.restored).toBe(0);
  });

  it("position manager restart restores GH-owned only", async () => {
    await upsertGoldHunterDemoTrade(OWNER, {
      goldHunterTradeId: "GH-D-rest",
      strategy: GH_ADMIN_STRATEGY_ID,
      environment: "DEMO",
      setup: "B",
      side: "SELL",
      signalTs: null,
      orderTs: new Date().toISOString(),
      fillTs: new Date().toISOString(),
      closeTs: null,
      entry: 2601,
      exit: null,
      stop: 2601.55,
      entrySpread: null,
      durationMs: null,
      mfe: null,
      mae: null,
      grossPnlEur: null,
      netPnlEur: null,
      result: "OPEN",
      exitReason: null,
      brokerOrderId: "o",
      brokerPositionId: "pos-gh",
      status: "FILLED",
      filledVolumeLots: 0.05
    });
    const mgr = await restoreGoldHunterPositionManager(OWNER);
    expect(mgr.restored).toBe(1);
  });
});

describe("High-frequency persistence + queues", () => {
  it("monitoring Firestore persistence bounded under high-rate Depth stream", async () => {
    await markGoldHunterSpotAttached(OWNER, true);
    await markGoldHunterDepthAttached(OWNER, true);
    const before = getGoldHunterRuntimePersistWriteCount(OWNER);
    const start = Date.now();
    for (let i = 0; i < 200; i++) {
      await onGoldHunterDepthEvent(
        { ownerUid: OWNER, symbolId: "42", environment: "DEMO" },
        {
          symbolId: 42,
          newQuotes: [
            { id: i, quoteType: 1, price: 260000000 + i, size: 10 },
            { id: i + 10000, quoteType: 2, price: 260012000 + i, size: 10 }
          ]
        }
      );
    }
    const elapsed = Date.now() - start;
    const writes = getGoldHunterRuntimePersistWriteCount(OWNER) - before;
    // Far fewer than 200 — roughly elapsed/cadence + attach transitions
    const maxExpected =
      Math.ceil(elapsed / GH_SELECTOR_RUNTIME_PERSIST_MIN_MS) + 10;
    expect(writes).toBeLessThan(80);
    expect(writes).toBeLessThanOrEqual(maxExpected + 5);
  });

  it("bounded queue drops under backpressure — no unbounded fan-out", async () => {
    const q = new BoundedSerializedQueue("soak", 2);
    let started = 0;
    const slow = () =>
      new Promise<void>((r) => {
        started += 1;
        setTimeout(r, 30);
      });
    expect(q.enqueue(slow)).toBe(true);
    expect(q.enqueue(slow)).toBe(true);
    expect(q.enqueue(slow)).toBe(false); // dropped
    expect(q.enqueue(slow)).toBe(false);
    await q.drainForTests();
    expect(q.stats().dropped).toBeGreaterThanOrEqual(2);
    expect(started).toBeLessThanOrEqual(2);
  });

  it("quote-worker-style path remains responsive during slow broker submission", async () => {
    await seedConfig(true);
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    setGoldHunterDemoAutoExecutionHooksForTests({
      attempt: async () => {
        await gate;
        return {
          ok: true,
          submitted: true,
          outcome: "FILLED",
          signalId: "x",
          tradeId: "t"
        };
      },
      loadSymbol: async () => symbolMeta(),
      isAdmin: async () => true
    });
    const sel = getGoldHunterStrategySelector(OWNER);
    const tick = sel.processInjectedSelectionForTests({
      selected: hitA,
      receivedAtMs: Date.now()
    });
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity: tick.opportunity
    });
    // Hot path continues while broker blocked
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) {
      sel.processInjectedSelectionForTests({
        selected: hitA,
        receivedAtMs: Date.now() + i
      });
    }
    expect(Date.now() - t0).toBeLessThan(200);
    release();
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    expect(goldHunterDemoExecQueueStats(OWNER).completed).toBeGreaterThanOrEqual(1);
  });
});

describe("High-rate soak", () => {
  it("thousands of events: AutoTrade OFF → zero broker; bounded persists; selector alive", async () => {
    await seedConfig(false);
    let broker = 0;
    setGoldHunterDemoAutoExecutionHooksForTests({
      attempt: async () => {
        broker += 1;
        return {
          ok: true,
          submitted: true,
          outcome: "FILLED",
          signalId: "x",
          tradeId: "t"
        };
      },
      loadSymbol: async () => symbolMeta(),
      isAdmin: async () => true
    });
    await markGoldHunterSpotAttached(OWNER, true);
    await markGoldHunterDepthAttached(OWNER, true);
    const sel = getGoldHunterStrategySelector(OWNER);
    let newOpps = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) {
      const tick = sel.processInjectedSelectionForTests({
        selected: i % 500 === 499 ? null : hitA,
        receivedAtMs: 1_000_000 + i,
        receiveSeq: i + 1
      });
      if (tick.newOpportunity) {
        newOpps += 1;
        enqueueGoldHunterDemoAutoExecution({
          ownerUid: OWNER,
          newOpportunity: true,
          opportunity: tick.opportunity
        });
      }
      if (i % 10 === 0) {
        void onGoldHunterDepthEvent(
          { ownerUid: OWNER, symbolId: "42", environment: "DEMO" },
          {
            symbolId: 42,
            newQuotes: [
              { id: i, quoteType: 1, price: 260000000, size: 5 },
              { id: i + 1, quoteType: 2, price: 260012000, size: 5 }
            ]
          }
        );
      }
    }
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    expect(broker).toBe(0);
    expect(newOpps).toBeLessThan(20); // rearm-limited, not per-event
    expect(sel.getReceiveSeq()).toBeGreaterThanOrEqual(N);
    const writes = getGoldHunterRuntimePersistWriteCount(OWNER);
    expect(writes).toBeLessThan(N / 5);
  });
});

describe("Fast AutoTrade runtime isolation (shared surfaces)", () => {
  it("demoOrderExecution still defaults clientOrderId when omitted", () => {
    const text = readFileSync(
      resolve(
        process.cwd(),
        "src/services/broker/ctrader/demoOrderExecution.ts"
      ),
      "utf8"
    );
    expect(text).toMatch(/args\.clientOrderId\?\.trim\(\)\s*\|\|/);
    expect(text).toContain("gm_");
  });

  it("persistentQuoteWorker still forwards spots independently of GH errors", () => {
    const text = readFileSync(
      resolve(
        process.cwd(),
        "src/services/broker/ctrader/persistentQuoteWorker.ts"
      ),
      "utf8"
    );
    expect(text).toContain("void onGoldHunterSpotEvent");
    expect(text).toContain(".catch");
    expect(text).toContain("saveAuthoritativeQuote");
  });
});
