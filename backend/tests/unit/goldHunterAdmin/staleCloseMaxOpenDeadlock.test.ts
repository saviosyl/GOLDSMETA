/**
 * Stale CLOSE_REQUESTED / max-open deadlock recovery.
 *
 * CLOSE_REQUESTED occupies maxOpen; position manager skips it; early local-only
 * max-open can prevent reaching reconcile. Recovery must be driven by
 * authoritative broker open-position state — never fabricate P/L.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  applyBrokerSettledClose,
  isGoldHunterCloseAcceptedPendingSettlement,
  setGoldHunterCloseSettlementHooksForTests,
  resetGoldHunterCloseSettlementHooksForTests
} from "../../../src/services/goldHunterAdmin/closeSettlement";
import {
  reconcileGoldHunterCloseRequested,
  reconcileGoldHunterCloseSettlements,
  runGoldHunterReconcilePass,
  resetGoldHunterReconcileRuntimeForTests,
  setGoldHunterReconcileHooksForTests,
  maybeEnqueueStaleCloseRequestedWatchdog,
  GH_CLOSE_REQUESTED_STALE_MS,
  drainGoldHunterReconcileForTests
} from "../../../src/services/goldHunterAdmin/reconciliationRuntime";
import {
  countsTowardGoldHunterMaxOpen,
  resetGoldHunterTradeMemory,
  upsertGoldHunterDemoTrade,
  listGoldHunterDemoTrades,
  computeDemoPerformance,
  todayNetPnlEur
} from "../../../src/services/goldHunterAdmin/tradeStore";
import { evaluateGoldHunterOrderGates } from "../../../src/services/goldHunterAdmin/orderGates";
import {
  GH_ADMIN_DEFAULT_CONFIG,
  GH_ADMIN_STRATEGY_ID,
  type GoldHunterDemoTrade
} from "../../../src/services/goldHunterAdmin/types";
import { resetOwnerQueuesForTests } from "../../../src/services/goldHunterAdmin/boundedQueue";

const OWNER = "gh-stale-close-owner";

function gateInput(openTradeCount: number) {
  return {
    config: {
      ...GH_ADMIN_DEFAULT_CONFIG,
      maxOpenTrades: 1,
      demoAutoTradeEnabled: true
    },
    brokerEnvironment: "DEMO",
    brokerConnected: true,
    accountSnapshotValid: true,
    marketOpen: true,
    feedFresh: true,
    depthValid: true,
    spreadOk: true,
    capitalOk: true,
    dailyLossOk: true,
    openTradeCount,
    signalPresent: true,
    signalConsumed: false,
    isAdmin: true
  };
}

function closeRequestedTrade(
  over: Partial<GoldHunterDemoTrade> = {}
): GoldHunterDemoTrade {
  const closeRequestTs = new Date(Date.now() - 120_000).toISOString();
  return {
    goldHunterTradeId: "GH-D-5194a263",
    strategy: GH_ADMIN_STRATEGY_ID,
    environment: "DEMO",
    setup: "B",
    side: "BUY",
    signalTs: closeRequestTs,
    orderTs: closeRequestTs,
    fillTs: closeRequestTs,
    closeTs: null,
    entry: 4415.27,
    exit: null,
    stop: 4415.93,
    entrySpread: 0.12,
    durationMs: null,
    mfe: 0.4,
    mae: -0.1,
    grossPnlEur: null,
    netPnlEur: null,
    result: null,
    exitReason: "TRAIL_HIT",
    brokerOrderId: "70307396",
    brokerPositionId: "54363795",
    status: "CLOSE_REQUESTED",
    signalId: "GH-OPP-stale1",
    clientOrderId: "gh_stale1",
    filledVolumeLots: 0.25,
    closeRequestTs,
    errorCode: "CTRADER_ORDER_TIMEOUT",
    ...over
  };
}

function dealFor(positionId: string, netPnl: number) {
  return {
    dealId: "deal-54363795",
    orderId: "o-close",
    positionId,
    closePrice: 4416.1,
    closedAt: new Date().toISOString(),
    grossPnl: netPnl + 0.5,
    commission: -0.3,
    swap: -0.2,
    netPnl,
    closedVolumeLots: 0.25
  };
}

beforeEach(() => {
  resetGoldHunterTradeMemory();
  resetGoldHunterReconcileRuntimeForTests();
  resetGoldHunterCloseSettlementHooksForTests();
  resetOwnerQueuesForTests();
});

describe("Stale CLOSE_REQUESTED / max-open deadlock", () => {
  it("TEST 1 — process interruption after CLOSE_REQUESTED: broker absent → settle → CLOSED → slot released", async () => {
    await upsertGoldHunterDemoTrade(OWNER, closeRequestedTrade());
    expect(countsTowardGoldHunterMaxOpen(closeRequestedTrade())).toBe(true);

    setGoldHunterReconcileHooksForTests({
      listPositions: async () => [],
      settleClose: async ({ trade }) => {
        const settled = applyBrokerSettledClose({
          trade,
          deal: dealFor("54363795", 12.4)
        });
        await upsertGoldHunterDemoTrade(OWNER, settled);
        return { settled: true, trade: settled };
      }
    });

    const pass = await runGoldHunterReconcilePass({
      ownerUid: OWNER,
      force: true
    });
    expect(pass.positionsReadOk).toBe(true);
    expect(pass.closeRequestedSettled).toBe(1);

    const rows = await listGoldHunterDemoTrades(OWNER, { limit: 10 });
    const t = rows.find((r) => r.goldHunterTradeId === "GH-D-5194a263")!;
    expect(t.status).toBe("CLOSED");
    expect(t.netPnlEur).toBe(12.4);
    expect(t.exit).toBe(4416.1);
    expect(t.result).toBe("WIN");
    expect(countsTowardGoldHunterMaxOpen(t)).toBe(false);

    const open = await listGoldHunterDemoTrades(OWNER, {
      limit: 10,
      openOnly: true
    });
    expect(open).toHaveLength(0);

    const gates = evaluateGoldHunterOrderGates(gateInput(open.length));
    expect(gates.blockers).not.toContain("WAIT — MAX OPEN TRADES");
  });

  it("TEST 2 — broker position still open: keep occupancy, no fabricated close", async () => {
    await upsertGoldHunterDemoTrade(OWNER, closeRequestedTrade());

    let settleCalls = 0;
    setGoldHunterReconcileHooksForTests({
      listPositions: async () => [
        {
          positionId: "54363795",
          side: "BUY",
          volumeLots: 0.25,
          entryPrice: 4415.27,
          stopLoss: 4415.93,
          label: "GH-D-5194a263",
          comment: "GOLD_HUNTER"
        }
      ],
      settleClose: async ({ trade }) => {
        settleCalls += 1;
        return { settled: false, trade };
      }
    });

    const r = await reconcileGoldHunterCloseRequested({
      ownerUid: OWNER,
      brokerPositions: [
        {
          positionId: "54363795",
          side: "BUY",
          volumeLots: 0.25,
          entryPrice: 4415.27,
          stopLoss: 4415.93,
          label: "GH-D-5194a263",
          comment: "GOLD_HUNTER"
        }
      ],
      positionsReadOk: true
    });
    expect(r.stillOpen).toBe(1);
    expect(r.settled).toBe(0);
    expect(settleCalls).toBe(0);

    const t = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0];
    expect(t.status).toBe("CLOSE_REQUESTED");
    expect(t.netPnlEur).toBeNull();
    expect(countsTowardGoldHunterMaxOpen(t)).toBe(true);

    const gates = evaluateGoldHunterOrderGates(gateInput(1));
    expect(gates.blockers).toContain("WAIT — MAX OPEN TRADES");
  });

  it("TEST 3 — broker read failure: fail closed, keep occupancy, no second trade", async () => {
    await upsertGoldHunterDemoTrade(OWNER, closeRequestedTrade());
    setGoldHunterReconcileHooksForTests({
      listPositions: async () => {
        throw new Error("BROKER_DOWN");
      }
    });

    const pass = await runGoldHunterReconcilePass({
      ownerUid: OWNER,
      force: true
    });
    expect(pass.positionsReadOk).toBe(false);
    expect(pass.closeRequestedSettled).toBe(0);

    const t = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0];
    expect(t.status).toBe("CLOSE_REQUESTED");
    expect(countsTowardGoldHunterMaxOpen(t)).toBe(true);
  });

  it("TEST 4 — broker closed but deal not yet available: settlement pending, no fabricated P/L, not actively managed", async () => {
    await upsertGoldHunterDemoTrade(OWNER, closeRequestedTrade());
    setGoldHunterReconcileHooksForTests({
      listPositions: async () => [],
      settleClose: async ({ trade }) => {
        const pending = {
          ...trade,
          status: "CLOSE_ACCEPTED_PENDING_SETTLEMENT" as const,
          result: null,
          netPnlEur: null,
          grossPnlEur: null,
          errorCode: "CLOSE_SETTLEMENT_PENDING"
        };
        await upsertGoldHunterDemoTrade(OWNER, pending);
        return { settled: false, trade: pending };
      }
    });

    const pass = await runGoldHunterReconcilePass({
      ownerUid: OWNER,
      force: true
    });
    expect(pass.closeRequestedSettlementPending).toBe(1);

    const t = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0];
    expect(t.status).toBe("CLOSE_ACCEPTED_PENDING_SETTLEMENT");
    expect(isGoldHunterCloseAcceptedPendingSettlement(t.status)).toBe(true);
    expect(t.netPnlEur).toBeNull();
    expect(t.exit).toBeNull();
    expect(countsTowardGoldHunterMaxOpen(t)).toBe(false);

    const open = await listGoldHunterDemoTrades(OWNER, {
      limit: 10,
      openOnly: true
    });
    expect(open).toHaveLength(0);
  });

  it("TEST 5 — deal arrives: CLOSED with broker P/L; demo performance updated", async () => {
    const pending = closeRequestedTrade({
      status: "CLOSE_ACCEPTED_PENDING_SETTLEMENT",
      errorCode: "BROKER_POSITION_ABSENT_SETTLEMENT_PENDING"
    });
    await upsertGoldHunterDemoTrade(OWNER, pending);

    setGoldHunterCloseSettlementHooksForTests({
      fetchClose: async () => dealFor("54363795", -8.75)
    });
    setGoldHunterReconcileHooksForTests({
      listPositions: async () => []
    });

    const closes = await reconcileGoldHunterCloseSettlements({ ownerUid: OWNER });
    expect(closes.settled).toBe(1);

    const t = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0];
    expect(t.status).toBe("CLOSED");
    expect(t.netPnlEur).toBe(-8.75);
    expect(t.exit).toBe(4416.1);
    expect(t.result).toBe("LOSS");
    expect(t.brokerDealId).toBe("deal-54363795");

    const perf = computeDemoPerformance([t]);
    expect(perf.trades).toBe(1);
    expect(perf.netPnl).toBe(-8.75);
    expect(todayNetPnlEur([t])).toBe(-8.75);
  });

  it("TEST 6 — regression: genuine open broker position still blocks maxOpen=1", async () => {
    await upsertGoldHunterDemoTrade(
      OWNER,
      closeRequestedTrade({
        goldHunterTradeId: "GH-D-open-live",
        status: "FILLED",
        result: "OPEN",
        exitReason: null,
        errorCode: null,
        closeRequestTs: null
      })
    );

    setGoldHunterReconcileHooksForTests({
      listPositions: async () => [
        {
          positionId: "54363795",
          side: "BUY",
          volumeLots: 0.25,
          entryPrice: 4415.27,
          stopLoss: 4415.93,
          label: "GH-D-open-live",
          comment: "GOLD_HUNTER"
        }
      ]
    });

    const pass = await runGoldHunterReconcilePass({
      ownerUid: OWNER,
      force: true
    });
    expect(pass.positionsReadOk).toBe(true);

    const open = await listGoldHunterDemoTrades(OWNER, {
      limit: 10,
      openOnly: true
    });
    expect(open).toHaveLength(1);
    expect(countsTowardGoldHunterMaxOpen(open[0])).toBe(true);

    const gates = evaluateGoldHunterOrderGates(gateInput(open.length));
    expect(gates.blockers).toContain("WAIT — MAX OPEN TRADES");
  });

  it("CLOSE_REQUESTED settlement retries must not run without absence proof", async () => {
    await upsertGoldHunterDemoTrade(OWNER, closeRequestedTrade());
    let settleCalls = 0;
    setGoldHunterCloseSettlementHooksForTests({
      fetchClose: async () => {
        settleCalls += 1;
        return null;
      }
    });

    const closes = await reconcileGoldHunterCloseSettlements({ ownerUid: OWNER });
    expect(closes.settled).toBe(0);
    expect(closes.stillPending).toBe(0);
    expect(settleCalls).toBe(0);

    const t = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0];
    expect(t.status).toBe("CLOSE_REQUESTED");
  });

  it("stale CLOSE_REQUESTED watchdog enqueues forced reconcile", async () => {
    await upsertGoldHunterDemoTrade(
      OWNER,
      closeRequestedTrade({
        closeRequestTs: new Date(
          Date.now() - GH_CLOSE_REQUESTED_STALE_MS - 1_000
        ).toISOString()
      })
    );

    setGoldHunterReconcileHooksForTests({
      listPositions: async () => [],
      settleClose: async ({ trade }) => {
        const settled = applyBrokerSettledClose({
          trade,
          deal: dealFor("54363795", 1.5)
        });
        await upsertGoldHunterDemoTrade(OWNER, settled);
        return { settled: true, trade: settled };
      }
    });

    const w = await maybeEnqueueStaleCloseRequestedWatchdog(OWNER);
    expect(w.staleCount).toBe(1);
    expect(w.enqueued).toBe(true);

    await drainGoldHunterReconcileForTests(OWNER);
    const t = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0];
    expect(t.status).toBe("CLOSED");
  });

  it("execution path reconcile clears stale CLOSE_REQUESTED occupancy before max-open", async () => {
    await upsertGoldHunterDemoTrade(OWNER, closeRequestedTrade());

    setGoldHunterReconcileHooksForTests({
      listPositions: async () => [],
      settleClose: async ({ trade }) => {
        const settled = applyBrokerSettledClose({
          trade,
          deal: dealFor("54363795", 3.2)
        });
        await upsertGoldHunterDemoTrade(OWNER, settled);
        return { settled: true, trade: settled };
      }
    });

    const pass = await runGoldHunterReconcilePass({
      ownerUid: OWNER,
      force: true
    });
    expect(pass.closeRequestedSettled).toBe(1);
    const open = await listGoldHunterDemoTrades(OWNER, {
      limit: 10,
      openOnly: true
    });
    expect(open).toHaveLength(0);
    expect(
      evaluateGoldHunterOrderGates(gateInput(open.length)).blockers
    ).not.toContain("WAIT — MAX OPEN TRADES");
  });

  it("PENDING_RECONCILIATION ENTRY_INVALID with broker position absent settles via disappeared path", async () => {
    await upsertGoldHunterDemoTrade(
      OWNER,
      closeRequestedTrade({
        goldHunterTradeId: "GH-D-entry-invalid",
        status: "PENDING_RECONCILIATION",
        result: null,
        entry: null,
        exitReason: null,
        errorCode: "ENTRY_PRICE_INVALID",
        dataQuality: "ENTRY_INVALID",
        closeRequestTs: null,
        brokerPositionId: "54373411"
      })
    );

    setGoldHunterReconcileHooksForTests({
      listPositions: async () => [],
      settleClose: async ({ trade }) => {
        const settled = applyBrokerSettledClose({
          trade,
          deal: dealFor("54373411", -5.5)
        });
        await upsertGoldHunterDemoTrade(OWNER, settled);
        return { settled: true, trade: settled };
      }
    });

    const pass = await runGoldHunterReconcilePass({
      ownerUid: OWNER,
      force: true
    });
    expect(pass.disappearedSettled).toBe(1);
    const t = (await listGoldHunterDemoTrades(OWNER, { limit: 5 })).find(
      (r) => r.goldHunterTradeId === "GH-D-entry-invalid"
    )!;
    expect(t.status).toBe("CLOSED");
    expect(t.netPnlEur).toBe(-5.5);
    expect(countsTowardGoldHunterMaxOpen(t)).toBe(false);
  });
});
