/**
 * ENTRY PENDING_RECONCILIATION watchdog — T1–T12 + P1–P3 + E1–E4.
 *
 * Uncertain NewOrder transmission must be resolved from authoritative
 * cTrader open + exhaustive ProtoOAOrderList + ProtoOADealList evidence.
 * Never resubmits NewOrder. Never fabricates P/L.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  resetDemoBrokerHistoryHooksForTests,
  setDemoBrokerHistoryHooksForTests
} from "../../../src/services/broker/ctrader/demoBrokerHistory";
import {
  findHistoricalOrderByClientOrderId,
  parseBrokerHistoricalOrders,
  type BrokerDealEvidence,
  type BrokerHistoricalOrder,
  type BrokerHistoryPage
} from "../../../src/services/broker/ctrader/openApiClient";
import { submitFastMarketOrder } from "../../../src/services/broker/ctrader/fastAutoTrade/orderTransport";
import {
  reconcileGoldHunterEntryPendingWatchdog,
  isGoldHunterEntryTransmissionUncertainty,
  canTerminalNeverFound,
  GH_ENTRY_NOT_FOUND_MIN_EMPTY_PROOF_CYCLES,
  GH_ENTRY_NOT_FOUND_MIN_SPAN_MS
} from "../../../src/services/goldHunterAdmin/entryPendingReconciliation";
import {
  reconcileGoldHunterCloseRequested,
  runGoldHunterReconcilePass,
  resetGoldHunterReconcileRuntimeForTests,
  setGoldHunterReconcileHooksForTests
} from "../../../src/services/goldHunterAdmin/reconciliationRuntime";
import {
  setGoldHunterCloseSettlementHooksForTests,
  resetGoldHunterCloseSettlementHooksForTests
} from "../../../src/services/goldHunterAdmin/closeSettlement";
import {
  countsTowardGoldHunterMaxOpen,
  resetGoldHunterTradeMemory,
  upsertGoldHunterDemoTrade,
  listGoldHunterDemoTrades
} from "../../../src/services/goldHunterAdmin/tradeStore";
import {
  resetGoldHunterSignalClaimsForTests,
  updateGoldHunterSignalClaim,
  getGoldHunterSignalClaim,
  acquireGoldHunterSignalClaim
} from "../../../src/services/goldHunterAdmin/signalClaimStore";
import {
  GH_ADMIN_DEFAULT_CONFIG,
  GH_ADMIN_STRATEGY_ID,
  GH_ADMIN_EXECUTION_MODE,
  type GoldHunterDemoTrade
} from "../../../src/services/goldHunterAdmin/types";
import { evaluateGoldHunterOrderGates } from "../../../src/services/goldHunterAdmin/orderGates";
import { resetOwnerQueuesForTests } from "../../../src/services/goldHunterAdmin/boundedQueue";

const OWNER = "gh-entry-pending-owner";
const CLIENT = "gh_GHOPPASe25768f31f40f4a65be";
const SIGNAL = "GH-OPP-AS-e25-768f31f40f4a65be";
const TRADE_ID = "GH-D-ac23097e";

function pendingEntryTrade(
  over: Partial<GoldHunterDemoTrade> = {}
): GoldHunterDemoTrade {
  const orderTs = new Date(Date.now() - 120_000).toISOString();
  return {
    goldHunterTradeId: TRADE_ID,
    strategy: GH_ADMIN_STRATEGY_ID,
    environment: "DEMO",
    setup: "A",
    side: "SELL",
    signalTs: orderTs,
    orderTs,
    fillTs: null,
    closeTs: null,
    entry: null,
    exit: null,
    stop: null,
    entrySpread: null,
    durationMs: null,
    mfe: null,
    mae: null,
    grossPnlEur: null,
    netPnlEur: null,
    result: null,
    exitReason: null,
    brokerOrderId: null,
    brokerPositionId: null,
    status: "PENDING_RECONCILIATION",
    signalId: SIGNAL,
    clientOrderId: CLIENT,
    errorCode: "NEWORDER_SEND_TIMEOUT",
    filledVolumeLots: null,
    ...over
  };
}

function histOrder(
  over: Partial<BrokerHistoricalOrder> = {}
): BrokerHistoricalOrder {
  return {
    orderId: "ord-1",
    positionId: "pos-1",
    clientOrderId: CLIENT,
    orderStatus: "ORDER_STATUS_FILLED",
    orderStatusCode: 2,
    tradeSide: "SELL",
    symbolId: "41",
    label: TRADE_ID,
    comment: GH_ADMIN_STRATEGY_ID,
    executionPrice: 4410.5,
    executedVolumeLots: 0.25,
    createdAt: new Date(Date.now() - 100_000).toISOString(),
    updatedAt: new Date(Date.now() - 90_000).toISOString(),
    closingOrder: false,
    ...over
  };
}

function pageOrders(
  items: BrokerHistoricalOrder[],
  hasMore = false,
  from = 0,
  to = Date.now()
): BrokerHistoryPage<BrokerHistoricalOrder> {
  return {
    items,
    hasMore,
    fromTimestampMs: from,
    toTimestampMs: to
  };
}

function pageDeals(
  items: BrokerDealEvidence[],
  hasMore = false,
  from = 0,
  to = Date.now()
): BrokerHistoryPage<BrokerDealEvidence> {
  return {
    items,
    hasMore,
    fromTimestampMs: from,
    toTimestampMs: to
  };
}

function hooksCompleteEmpty(opts?: {
  orders?: BrokerHistoricalOrder[];
  deals?: BrokerDealEvidence[];
}) {
  setDemoBrokerHistoryHooksForTests({
    fetchOrderListPage: async () => ({
      ok: true,
      value: pageOrders(opts?.orders ?? [])
    }),
    fetchDealEvidencePage: async () => ({
      ok: true,
      value: pageDeals(opts?.deals ?? [])
    })
  });
}

async function seedClaim(): Promise<void> {
  await acquireGoldHunterSignalClaim({
    ownerUid: OWNER,
    signalId: SIGNAL,
    goldHunterTradeId: TRADE_ID,
    clientOrderId: CLIENT,
    setup: "A",
    side: "SELL"
  });
  await updateGoldHunterSignalClaim(OWNER, SIGNAL, {
    state: "PENDING_RECONCILIATION",
    errorCode: "NEWORDER_SEND_TIMEOUT"
  });
}

beforeEach(() => {
  resetGoldHunterTradeMemory();
  resetGoldHunterSignalClaimsForTests();
  resetGoldHunterReconcileRuntimeForTests();
  resetGoldHunterCloseSettlementHooksForTests();
  resetDemoBrokerHistoryHooksForTests();
  resetOwnerQueuesForTests();
  setGoldHunterReconcileHooksForTests({
    listPositions: async () => []
  });
});

describe("historical order parse / clientOrderId correlation", () => {
  it("parses ProtoOAOrderList and matches exact clientOrderId only", () => {
    const orders = parseBrokerHistoricalOrders([
      {
        orderId: 1,
        orderStatus: 2,
        clientOrderId: "other",
        positionId: 9,
        tradeData: { tradeSide: 2, label: "x", volume: 100 }
      },
      {
        orderId: 2,
        orderStatus: 3,
        clientOrderId: CLIENT,
        positionId: 10,
        executionPrice: 4400,
        tradeData: { tradeSide: 2, label: TRADE_ID, volume: 25 }
      }
    ]);
    expect(orders).toHaveLength(2);
    const match = findHistoricalOrderByClientOrderId(orders, CLIENT);
    expect(match?.orderId).toBe("2");
    expect(match?.orderStatusCode).toBe(3);
    expect(findHistoricalOrderByClientOrderId(orders, "nope")).toBeNull();
  });
});

describe("ENTRY PENDING_RECONCILIATION watchdog T1–T12", () => {
  it("T1/T3: NEWORDER_SEND_TIMEOUT → exact position later → FILLED/OPEN, no NewOrder", async () => {
    await upsertGoldHunterDemoTrade(OWNER, pendingEntryTrade());
    await seedClaim();
    expect(countsTowardGoldHunterMaxOpen(pendingEntryTrade())).toBe(true);

    hooksCompleteEmpty({ orders: [histOrder()] });

    const r = await reconcileGoldHunterEntryPendingWatchdog({
      ownerUid: OWNER,
      brokerPositions: [
        {
          positionId: "pos-1",
          side: "SELL",
          volumeLots: 0.25,
          entryPrice: 4410.5,
          stopLoss: 4412,
          label: TRADE_ID,
          comment: GH_ADMIN_STRATEGY_ID
        }
      ],
      positionsReadOk: true,
      graceMs: 0
    });
    expect(r.recoveredOpen).toBe(1);

    const trades = await listGoldHunterDemoTrades(OWNER, { limit: 10 });
    expect(trades[0]?.status).toBe("FILLED");
    expect(trades[0]?.result).toBe("OPEN");
    expect(trades[0]?.brokerPositionId).toBe("pos-1");
    expect(countsTowardGoldHunterMaxOpen(trades[0]!)).toBe(true);

    const claim = await getGoldHunterSignalClaim(OWNER, SIGNAL);
    expect(claim?.state).toBe("OPEN");
  });

  it("T2: historical ORDER_STATUS_REJECTED → BROKER_REJECTED, max-open released", async () => {
    await upsertGoldHunterDemoTrade(OWNER, pendingEntryTrade());
    await seedClaim();
    hooksCompleteEmpty({
      orders: [
        histOrder({
          orderStatus: "ORDER_STATUS_REJECTED",
          orderStatusCode: 3,
          positionId: null,
          executionPrice: null
        })
      ]
    });

    const r = await reconcileGoldHunterEntryPendingWatchdog({
      ownerUid: OWNER,
      brokerPositions: [],
      positionsReadOk: true,
      graceMs: 0
    });
    expect(r.rejected).toBe(1);
    const trade = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(trade.status).toBe("BROKER_REJECTED");
    expect(countsTowardGoldHunterMaxOpen(trade)).toBe(false);
    const claim = await getGoldHunterSignalClaim(OWNER, SIGNAL);
    expect(claim?.state).toBe("BROKER_REJECTED");
  });

  it("T4: filled then closed before watchdog → CLOSED with broker P/L", async () => {
    await upsertGoldHunterDemoTrade(OWNER, pendingEntryTrade());
    await seedClaim();
    const closing: BrokerDealEvidence = {
      dealId: "d-close",
      orderId: "ord-close",
      positionId: "pos-closed",
      executionPrice: 4408.2,
      executedAt: new Date().toISOString(),
      filledVolumeLots: 0.25,
      tradeSide: "BUY",
      isClosing: true,
      close: {
        dealId: "d-close",
        orderId: "ord-close",
        positionId: "pos-closed",
        closePrice: 4408.2,
        closedAt: new Date().toISOString(),
        grossPnl: 1.1,
        commission: 0.1,
        swap: 0,
        netPnl: 1.0,
        closedVolumeLots: 0.25,
        entryPrice: 4410.5
      }
    };
    setDemoBrokerHistoryHooksForTests({
      fetchOrderListPage: async () => ({
        ok: true,
        value: pageOrders([histOrder({ positionId: "pos-closed" })])
      }),
      fetchDealEvidencePage: async () => ({
        ok: true,
        value: pageDeals([closing])
      }),
      fetchClosingDealsForPosition: async () => ({
        ok: true,
        value: closing.close
      })
    });

    const r = await reconcileGoldHunterEntryPendingWatchdog({
      ownerUid: OWNER,
      brokerPositions: [],
      positionsReadOk: true,
      graceMs: 0
    });
    expect(r.recoveredClosed).toBe(1);
    const trade = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(trade.status).toBe("CLOSED");
    expect(trade.netPnlEur).toBe(1.0);
    expect(trade.entry).toBe(4410.5);
    expect(trade.exit).toBe(4408.2);
    expect(countsTowardGoldHunterMaxOpen(trade)).toBe(false);
    const claim = await getGoldHunterSignalClaim(OWNER, SIGNAL);
    expect(claim?.state).toBe("CLOSED");
  });

  it("T5: broker APIs unavailable → remain PENDING, max-open blocked", async () => {
    await upsertGoldHunterDemoTrade(OWNER, pendingEntryTrade());
    setDemoBrokerHistoryHooksForTests({
      fetchOrderListPage: async () => ({ ok: false, errorCode: "TIMEOUT" }),
      fetchDealEvidencePage: async () => ({ ok: false, errorCode: "TIMEOUT" })
    });
    const r = await reconcileGoldHunterEntryPendingWatchdog({
      ownerUid: OWNER,
      brokerPositions: [],
      positionsReadOk: false,
      graceMs: 0
    });
    expect(r.brokerUnavailable).toBe(1);
    const trade = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(trade.status).toBe("PENDING_RECONCILIATION");
    expect(countsTowardGoldHunterMaxOpen(trade)).toBe(true);
    expect(trade.entryReconcileEvidence?.successfulEmptyProofCycles ?? 0).toBe(0);
  });

  it("T6: current reconcile empty but historical order exists → NOT never-sent", async () => {
    await upsertGoldHunterDemoTrade(OWNER, pendingEntryTrade());
    hooksCompleteEmpty({
      orders: [
        histOrder({
          orderStatus: "ORDER_STATUS_ACCEPTED",
          orderStatusCode: 1,
          positionId: null
        })
      ]
    });
    const r = await reconcileGoldHunterEntryPendingWatchdog({
      ownerUid: OWNER,
      brokerPositions: [],
      positionsReadOk: true,
      graceMs: 0
    });
    expect(r.terminalNotFound).toBe(0);
    expect(r.stillPending).toBe(1);
    const trade = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(trade.status).toBe("PENDING_RECONCILIATION");
    expect(trade.errorCode).not.toBe("NEWORDER_RECONCILED_NOT_FOUND");
  });

  it("T7/E4: three COMPLETE empty cycles spanning >=90s → NOT_FOUND", async () => {
    const first = new Date(
      Date.now() - GH_ENTRY_NOT_FOUND_MIN_SPAN_MS - 1_000
    ).toISOString();
    await upsertGoldHunterDemoTrade(
      OWNER,
      pendingEntryTrade({
        entryReconcileEvidence: {
          reconciliationAttempts: 2,
          lastReconcileAt: first,
          lastBrokerReadOk: true,
          successfulEmptyProofCycles:
            GH_ENTRY_NOT_FOUND_MIN_EMPTY_PROOF_CYCLES - 1,
          firstSuccessfulEmptyProofAt: first,
          lastSuccessfulEmptyProofAt: first,
          lastHistoryComplete: true
        }
      })
    );
    await seedClaim();
    hooksCompleteEmpty();
    const r = await reconcileGoldHunterEntryPendingWatchdog({
      ownerUid: OWNER,
      brokerPositions: [],
      positionsReadOk: true,
      graceMs: 0
    });
    expect(r.terminalNotFound).toBe(1);
    const trade = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(trade.status).toBe("BROKER_SUBMIT_ERROR");
    expect(trade.errorCode).toBe("NEWORDER_RECONCILED_NOT_FOUND");
    expect(countsTowardGoldHunterMaxOpen(trade)).toBe(false);
    const claim = await getGoldHunterSignalClaim(OWNER, SIGNAL);
    expect(claim?.state).toBe("BROKER_SUBMIT_ERROR");
  });

  it("T8: same clientOrderId produces exactly one ProtoOANewOrderReq total", async () => {
    let newOrderReqCount = 0;
    const transport = {
      sendNewOrder: async () => {
        newOrderReqCount += 1;
        await new Promise(() => undefined);
        return { confirmedSent: true, response: {} };
      },
      onEvent: () => () => undefined
    };
    const result = await submitFastMarketOrder({
      request: {
        ctidTraderAccountId: "1",
        symbolId: "41",
        side: "SELL",
        volume: 25,
        clientOrderId: CLIENT
      },
      transport,
      sendTimeoutMs: 30,
      sendUncertaintyMs: 40,
      eventWaitMs: 10
    });
    expect(result.errorCode).toBe("NEWORDER_SEND_TIMEOUT");
    expect(result.newOrderReqCount).toBe(0);
    expect(newOrderReqCount).toBe(1);

    await upsertGoldHunterDemoTrade(
      OWNER,
      pendingEntryTrade({ clientOrderId: CLIENT })
    );
    hooksCompleteEmpty();
    await reconcileGoldHunterEntryPendingWatchdog({
      ownerUid: OWNER,
      brokerPositions: [],
      positionsReadOk: true,
      graceMs: 0
    });
    expect(newOrderReqCount).toBe(1);
  });

  it("T9: watchdog runs with no new Gold Hunter signal", async () => {
    await upsertGoldHunterDemoTrade(OWNER, pendingEntryTrade());
    hooksCompleteEmpty();
    setGoldHunterReconcileHooksForTests({
      listPositions: async () => []
    });
    const pass = await runGoldHunterReconcilePass({
      ownerUid: OWNER,
      force: true
    });
    expect(pass.skipped).toBe(false);
    expect(pass.entryWatchdog?.inspected).toBe(1);
  });

  it("T10: genuine open position still blocks maxOpen=1", async () => {
    await upsertGoldHunterDemoTrade(
      OWNER,
      pendingEntryTrade({
        status: "FILLED",
        result: "OPEN",
        brokerPositionId: "live-1",
        entry: 4400,
        errorCode: null
      })
    );
    const open = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(countsTowardGoldHunterMaxOpen(open)).toBe(true);
    const gates = evaluateGoldHunterOrderGates({
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
      openTradeCount: 1,
      signalPresent: true,
      signalConsumed: false,
      isAdmin: true
    });
    expect(gates.ok).toBe(false);
    expect(gates.blockers).toContain("WAIT — MAX OPEN TRADES");
    expect(gates.executionMode).toBe(GH_ADMIN_EXECUTION_MODE);
    expect(gates.liveExecutionEnabled).toBe(false);
  });

  it("T11: ENTRY watchdog does not interfere with CLOSE_REQUESTED settlement", async () => {
    const closeTs = new Date(Date.now() - 120_000).toISOString();
    await upsertGoldHunterDemoTrade(OWNER, {
      goldHunterTradeId: "GH-D-close-keep",
      strategy: GH_ADMIN_STRATEGY_ID,
      environment: "DEMO",
      setup: "B",
      side: "BUY",
      signalTs: closeTs,
      orderTs: closeTs,
      fillTs: closeTs,
      closeTs: null,
      entry: 4415,
      exit: null,
      stop: 4416,
      entrySpread: 0.1,
      durationMs: null,
      mfe: 0.2,
      mae: -0.1,
      grossPnlEur: null,
      netPnlEur: null,
      result: null,
      exitReason: "TRAIL_HIT",
      brokerOrderId: "o-close",
      brokerPositionId: "p-close",
      status: "CLOSE_REQUESTED",
      signalId: "sig-close",
      clientOrderId: "gh_close",
      closeRequestTs: closeTs,
      filledVolumeLots: 0.25,
      errorCode: "CTRADER_ORDER_TIMEOUT"
    });
    setGoldHunterCloseSettlementHooksForTests({
      fetchClose: async () => ({
        dealId: "deal-c",
        orderId: "o-c",
        positionId: "p-close",
        closePrice: 4415.5,
        closedAt: new Date().toISOString(),
        grossPnl: 0.5,
        commission: 0.05,
        swap: 0,
        netPnl: 0.45,
        closedVolumeLots: 0.25
      })
    });
    setDemoBrokerHistoryHooksForTests({
      fetchOrderListPage: async () => {
        throw new Error("entry watchdog must not be required for close path");
      }
    });

    const closeR = await reconcileGoldHunterCloseRequested({
      ownerUid: OWNER,
      brokerPositions: [],
      positionsReadOk: true
    });
    expect(closeR.settled + closeR.settlementPending).toBeGreaterThan(0);
    const trade = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(trade.status).not.toBe("PENDING_RECONCILIATION");
    expect(isGoldHunterEntryTransmissionUncertainty(trade)).toBe(false);
  });

  it("T12: Live account / Live execution remains impossible", () => {
    expect(GH_ADMIN_EXECUTION_MODE).toBe("DEMO_ONLY");
    expect(GH_ADMIN_DEFAULT_CONFIG.maxOpenTrades).toBe(1);
    const gates = evaluateGoldHunterOrderGates({
      config: { ...GH_ADMIN_DEFAULT_CONFIG, demoAutoTradeEnabled: true },
      brokerEnvironment: "LIVE",
      brokerConnected: true,
      accountSnapshotValid: true,
      marketOpen: true,
      feedFresh: true,
      depthValid: true,
      spreadOk: true,
      capitalOk: true,
      dailyLossOk: true,
      openTradeCount: 0,
      signalPresent: true,
      signalConsumed: false,
      isAdmin: true
    });
    expect(gates.liveExecutionEnabled).toBe(false);
    expect(gates.ok).toBe(false);
  });

  it("classifier excludes exit-side PENDING_RECONCILIATION", () => {
    expect(
      isGoldHunterEntryTransmissionUncertainty(
        pendingEntryTrade({ exitReason: "TRAIL_HIT" })
      )
    ).toBe(false);
    expect(
      isGoldHunterEntryTransmissionUncertainty(pendingEntryTrade())
    ).toBe(true);
  });

  it("transport send-timeout + later reconcile fill → requestSent=true, one NewOrder", async () => {
    let sends = 0;
    const result = await submitFastMarketOrder({
      request: {
        ctidTraderAccountId: "1",
        symbolId: "41",
        side: "SELL",
        volume: 25,
        clientOrderId: CLIENT
      },
      transport: {
        sendNewOrder: async () => {
          sends += 1;
          await new Promise(() => undefined);
          return { confirmedSent: true, response: {} };
        },
        onEvent: () => () => undefined
      },
      reconcile: {
        async reconcile() {
          return {
            orders: [
              {
                orderId: "o-late",
                positionId: "p-late",
                clientOrderId: CLIENT
              }
            ],
            positions: [
              {
                positionId: "p-late",
                clientOrderId: CLIENT,
                orderId: "o-late"
              }
            ]
          };
        }
      },
      sendTimeoutMs: 30,
      sendUncertaintyMs: 40,
      reconcileAttempts: 1
    });
    expect(sends).toBe(1);
    expect(result.outcome).toBe("BROKER_TIMEOUT_RECONCILED_FILLED");
    expect(result.positionId).toBe("p-late");
    expect(result.requestSent).toBe(true);
    expect(result.newOrderReqCount).toBe(1);
  });
});

describe("pagination / hasMore exhaustiveness P1–P3", () => {
  it("P1: OrderList hasMore=true then later page finds clientOrderId", async () => {
    await upsertGoldHunterDemoTrade(OWNER, pendingEntryTrade());
    await seedClaim();
    let calls = 0;
    setDemoBrokerHistoryHooksForTests({
      fetchOrderListPage: async (args) => {
        calls += 1;
        const span = args.toTimestampMs - args.fromTimestampMs;
        // First wide window: truncated, no match.
        if (span > 60_000) {
          return {
            ok: true,
            value: pageOrders(
              [histOrder({ clientOrderId: "other", orderId: "noise" })],
              true,
              args.fromTimestampMs,
              args.toTimestampMs
            )
          };
        }
        // Narrower bisect pages: return target once.
        return {
          ok: true,
          value: pageOrders(
            [histOrder()],
            false,
            args.fromTimestampMs,
            args.toTimestampMs
          )
        };
      },
      fetchDealEvidencePage: async () => ({
        ok: true,
        value: pageDeals([])
      })
    });

    const r = await reconcileGoldHunterEntryPendingWatchdog({
      ownerUid: OWNER,
      brokerPositions: [
        {
          positionId: "pos-1",
          side: "SELL",
          volumeLots: 0.25,
          entryPrice: 4410.5,
          stopLoss: 4412,
          label: TRADE_ID,
          comment: GH_ADMIN_STRATEGY_ID
        }
      ],
      positionsReadOk: true,
      graceMs: 0
    });
    expect(calls).toBeGreaterThan(1);
    expect(r.recoveredOpen).toBe(1);
    expect(r.terminalNotFound).toBe(0);
    const trade = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(trade.status).toBe("FILLED");
  });

  it("P2: DealList hasMore then later page recovers CLOSED with P/L", async () => {
    await upsertGoldHunterDemoTrade(OWNER, pendingEntryTrade());
    await seedClaim();
    const closing: BrokerDealEvidence = {
      dealId: "d-later",
      orderId: "ord-1",
      positionId: "pos-1",
      executionPrice: 4409,
      executedAt: new Date().toISOString(),
      filledVolumeLots: 0.25,
      tradeSide: "BUY",
      isClosing: true,
      close: {
        dealId: "d-later",
        orderId: "ord-1",
        positionId: "pos-1",
        closePrice: 4409,
        closedAt: new Date().toISOString(),
        grossPnl: 2,
        commission: 0.2,
        swap: 0,
        netPnl: 1.8,
        closedVolumeLots: 0.25,
        entryPrice: 4410.5
      }
    };
    setDemoBrokerHistoryHooksForTests({
      fetchOrderListPage: async () => ({
        ok: true,
        value: pageOrders([histOrder({ positionId: "pos-1" })])
      }),
      fetchDealEvidencePage: async (args) => {
        const span = args.toTimestampMs - args.fromTimestampMs;
        if (span > 60_000) {
          return {
            ok: true,
            value: pageDeals([], true, args.fromTimestampMs, args.toTimestampMs)
          };
        }
        return {
          ok: true,
          value: pageDeals(
            [closing],
            false,
            args.fromTimestampMs,
            args.toTimestampMs
          )
        };
      },
      fetchClosingDealsForPosition: async () => ({
        ok: true,
        value: closing.close
      })
    });

    const r = await reconcileGoldHunterEntryPendingWatchdog({
      ownerUid: OWNER,
      brokerPositions: [],
      positionsReadOk: true,
      graceMs: 0
    });
    expect(r.recoveredClosed).toBe(1);
    const trade = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(trade.status).toBe("CLOSED");
    expect(trade.netPnlEur).toBe(1.8);
  });

  it("P3: hasMore=true but next page fails → PENDING, no empty-proof increment", async () => {
    await upsertGoldHunterDemoTrade(OWNER, pendingEntryTrade());
    setDemoBrokerHistoryHooksForTests({
      fetchOrderListPage: async (args) => {
        const span = args.toTimestampMs - args.fromTimestampMs;
        if (span > 60_000) {
          return {
            ok: true,
            value: pageOrders([], true, args.fromTimestampMs, args.toTimestampMs)
          };
        }
        return { ok: false, errorCode: "PAGE_TIMEOUT" };
      },
      fetchDealEvidencePage: async () => ({
        ok: true,
        value: pageDeals([])
      })
    });

    const r = await reconcileGoldHunterEntryPendingWatchdog({
      ownerUid: OWNER,
      brokerPositions: [],
      positionsReadOk: true,
      graceMs: 0
    });
    expect(r.terminalNotFound).toBe(0);
    expect(r.stillPending).toBe(1);
    const trade = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(trade.status).toBe("PENDING_RECONCILIATION");
    expect(trade.entryReconcileEvidence?.successfulEmptyProofCycles ?? 0).toBe(
      0
    );
  });
});

describe("complete empty-proof cycles E1–E4", () => {
  it("E1: order fails repeatedly then succeeds → partials do not count", async () => {
    await upsertGoldHunterDemoTrade(OWNER, pendingEntryTrade());
    setDemoBrokerHistoryHooksForTests({
      fetchOrderListPage: async () => ({ ok: false, errorCode: "FAIL" }),
      fetchDealEvidencePage: async () => ({
        ok: true,
        value: pageDeals([])
      })
    });
    await reconcileGoldHunterEntryPendingWatchdog({
      ownerUid: OWNER,
      brokerPositions: [],
      positionsReadOk: true,
      graceMs: 0
    });
    let trade = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(trade.entryReconcileEvidence?.successfulEmptyProofCycles ?? 0).toBe(
      0
    );

    hooksCompleteEmpty();
    await reconcileGoldHunterEntryPendingWatchdog({
      ownerUid: OWNER,
      brokerPositions: [],
      positionsReadOk: true,
      graceMs: 0
    });
    trade = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(trade.entryReconcileEvidence?.successfulEmptyProofCycles).toBe(1);
    expect(trade.status).toBe("PENDING_RECONCILIATION");
  });

  it("E2: order+deal ok but open-position read fails → no complete cycle", async () => {
    await upsertGoldHunterDemoTrade(OWNER, pendingEntryTrade());
    hooksCompleteEmpty();
    await reconcileGoldHunterEntryPendingWatchdog({
      ownerUid: OWNER,
      brokerPositions: [],
      positionsReadOk: false,
      graceMs: 0
    });
    const trade = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(trade.entryReconcileEvidence?.successfulEmptyProofCycles ?? 0).toBe(
      0
    );
    expect(trade.status).toBe("PENDING_RECONCILIATION");
  });

  it("E3: two complete empty cycles + one partial → remain PENDING", async () => {
    const first = new Date(Date.now() - 30_000).toISOString();
    await upsertGoldHunterDemoTrade(
      OWNER,
      pendingEntryTrade({
        entryReconcileEvidence: {
          reconciliationAttempts: 2,
          lastReconcileAt: first,
          lastBrokerReadOk: true,
          successfulEmptyProofCycles: 2,
          firstSuccessfulEmptyProofAt: first,
          lastSuccessfulEmptyProofAt: first,
          lastHistoryComplete: true
        }
      })
    );
    // Partial: order history incomplete (hasMore + page fail).
    setDemoBrokerHistoryHooksForTests({
      fetchOrderListPage: async (args) => {
        const span = args.toTimestampMs - args.fromTimestampMs;
        if (span > 60_000) {
          return {
            ok: true,
            value: pageOrders([], true, args.fromTimestampMs, args.toTimestampMs)
          };
        }
        return { ok: false, errorCode: "FAIL" };
      },
      fetchDealEvidencePage: async () => ({
        ok: true,
        value: pageDeals([])
      })
    });
    const r = await reconcileGoldHunterEntryPendingWatchdog({
      ownerUid: OWNER,
      brokerPositions: [],
      positionsReadOk: true,
      graceMs: 0
    });
    expect(r.terminalNotFound).toBe(0);
    const trade = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(trade.status).toBe("PENDING_RECONCILIATION");
    expect(trade.entryReconcileEvidence?.successfulEmptyProofCycles).toBe(2);
  });

  it("canTerminalNeverFound requires span across successful proofs only", () => {
    expect(
      canTerminalNeverFound({
        reconciliationAttempts: 10,
        lastReconcileAt: new Date().toISOString(),
        lastBrokerReadOk: true,
        successfulEmptyProofCycles: 3,
        firstSuccessfulEmptyProofAt: new Date(
          Date.now() - GH_ENTRY_NOT_FOUND_MIN_SPAN_MS - 1
        ).toISOString(),
        lastSuccessfulEmptyProofAt: new Date().toISOString()
      })
    ).toBe(true);
    expect(
      canTerminalNeverFound({
        reconciliationAttempts: 10,
        lastReconcileAt: new Date().toISOString(),
        lastBrokerReadOk: true,
        successfulEmptyProofCycles: 2,
        firstSuccessfulEmptyProofAt: new Date(
          Date.now() - GH_ENTRY_NOT_FOUND_MIN_SPAN_MS - 1
        ).toISOString(),
        lastSuccessfulEmptyProofAt: new Date().toISOString()
      })
    ).toBe(false);
  });
});

describe("null order.positionId recovery via opening deal", () => {
  it("FILLED order with null positionId → opening deal → CLOSED with P/L", async () => {
    await upsertGoldHunterDemoTrade(OWNER, pendingEntryTrade());
    await seedClaim();
    const opening: BrokerDealEvidence = {
      dealId: "d-open",
      orderId: "ord-1",
      positionId: "P123",
      executionPrice: 4410.5,
      executedAt: new Date(Date.now() - 80_000).toISOString(),
      filledVolumeLots: 0.25,
      tradeSide: "SELL",
      isClosing: false,
      close: null
    };
    const closing: BrokerDealEvidence = {
      dealId: "d-close",
      orderId: "ord-close",
      positionId: "P123",
      executionPrice: 4408,
      executedAt: new Date().toISOString(),
      filledVolumeLots: 0.25,
      tradeSide: "BUY",
      isClosing: true,
      close: {
        dealId: "d-close",
        orderId: "ord-close",
        positionId: "P123",
        closePrice: 4408,
        closedAt: new Date().toISOString(),
        grossPnl: 3,
        commission: 0.25,
        swap: 0,
        netPnl: 2.75,
        closedVolumeLots: 0.25,
        entryPrice: 4410.5
      }
    };
    setDemoBrokerHistoryHooksForTests({
      fetchOrderListPage: async () => ({
        ok: true,
        value: pageOrders([
          histOrder({
            orderId: "ord-1",
            positionId: null,
            orderStatus: "ORDER_STATUS_FILLED",
            orderStatusCode: 2
          })
        ])
      }),
      fetchDealEvidencePage: async () => ({
        ok: true,
        value: pageDeals([opening, closing])
      }),
      fetchClosingDealsForPosition: async () => ({
        ok: true,
        value: closing.close
      })
    });

    const r = await reconcileGoldHunterEntryPendingWatchdog({
      ownerUid: OWNER,
      brokerPositions: [],
      positionsReadOk: true,
      graceMs: 0
    });
    expect(r.recoveredClosed).toBe(1);
    const trade = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(trade.status).toBe("CLOSED");
    expect(trade.brokerOrderId).toBe("ord-1");
    expect(trade.brokerPositionId).toBe("P123");
    expect(trade.entry).toBe(4410.5);
    expect(trade.exit).toBe(4408);
    expect(trade.netPnlEur).toBe(2.75);
    expect(countsTowardGoldHunterMaxOpen(trade)).toBe(false);
  });
});
