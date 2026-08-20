/**
 * GH OPEN entry continuity + terminal CLOSED integrity.
 * Does not retune A/B/C, PM, Loss, risk, or sizing.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { openTrade } from "../../../src/services/goldHunterAdmin/abc/exits";
import { frozenGhFastSoakConfig } from "../../../src/services/goldHunterAdmin/abc";
import {
  applyBrokerSettledClose,
  resetGoldHunterCloseSettlementHooksForTests
} from "../../../src/services/goldHunterAdmin/closeSettlement";
import {
  closeGoldHunterDemoPosition,
  getGoldHunterOpenPositionDiagnostics,
  registerGoldHunterOpenPositionForOwner,
  resetGoldHunterPositionManagerForTests,
  setGoldHunterPositionManagerHooksForTests,
  unregisterGoldHunterManagedPosition
} from "../../../src/services/goldHunterAdmin/demoPositionManager";
import {
  isProvenBrokerOpenEntryIntegrityDefect,
  syncGoldHunterOpenEntryIntegrityHealth
} from "../../../src/services/goldHunterAdmin/entryIntegrity";
import { recoverGoldHunterOpenEntryImmediate } from "../../../src/services/goldHunterAdmin/immediateOpenEntryRecovery";
import {
  ensureGoldHunterKnownPositionEntrySupervisor,
  getGoldHunterSupervisorNewOrderCallCount,
  resetKnownPositionEntrySupervisorForTests,
  setKnownPositionEntrySupervisorHooksForTests
} from "../../../src/services/goldHunterAdmin/knownBrokerPositionEntrySupervisor";
import {
  evaluateGoldHunterFinalLossSafetyGate
} from "../../../src/services/goldHunterAdmin/lossSafetyGate";
import {
  getGoldHunterStrategySelector,
  resetGoldHunterStrategySelectorsForTests
} from "../../../src/services/goldHunterAdmin/strategySelector";
import {
  getGoldHunterDemoTrade,
  listGoldHunterDemoTrades,
  resetGoldHunterTradeMemory,
  setGoldHunterTradeStoreHooksForTests,
  upsertGoldHunterDemoTrade
} from "../../../src/services/goldHunterAdmin/tradeStore";
import {
  GH_ADMIN_DEFAULT_CONFIG,
  GH_ADMIN_EXECUTION_MODE,
  type GoldHunterDemoTrade
} from "../../../src/services/goldHunterAdmin/types";
import { goldHunterFrozenInitialRiskPrice } from "../../../src/services/goldHunterAdmin/entryRepair";

const OWNER = "owner-open-entry-continuity";
const HARD = goldHunterFrozenInitialRiskPrice();

function pendingTrade(
  over: Partial<GoldHunterDemoTrade> = {}
): GoldHunterDemoTrade {
  return {
    goldHunterTradeId: "GH-D-pending-sup-1",
    strategy: "GOLD_HUNTER",
    environment: "DEMO",
    setup: "A",
    side: "BUY",
    signalTs: "2026-08-20T11:41:30.000Z",
    orderTs: "2026-08-20T11:41:30.000Z",
    fillTs: null,
    closeTs: null,
    entry: null,
    exit: null,
    stop: 2600 - HARD,
    entrySpread: null,
    durationMs: null,
    mfe: null,
    mae: null,
    grossPnlEur: null,
    netPnlEur: null,
    result: null,
    exitReason: null,
    brokerOrderId: "70609421",
    brokerPositionId: "54726281",
    status: "PENDING_RECONCILIATION",
    signalId: "GH-OPP-sup-1",
    clientOrderId: "gh_client_sup_1",
    dataQuality: "ENTRY_INVALID",
    errorCode: "ENTRY_PRICE_INVALID",
    initialRiskPrice: HARD,
    filledVolumeLots: 9,
    ...over
  };
}

function filledOpen(over: Partial<GoldHunterDemoTrade> = {}): GoldHunterDemoTrade {
  return {
    ...pendingTrade(),
    goldHunterTradeId: "GH-D-open-1",
    status: "FILLED",
    result: "OPEN",
    entry: 2600.1,
    fillTs: "2026-08-20T11:42:40.000Z",
    dataQuality: null,
    errorCode: null,
    brokerPositionId: "54726731",
    ...over
  };
}

describe("GH OPEN entry continuity + CLOSED integrity", () => {
  beforeEach(() => {
    resetGoldHunterTradeMemory();
    resetGoldHunterPositionManagerForTests();
    setGoldHunterPositionManagerHooksForTests({});
    resetGoldHunterCloseSettlementHooksForTests();
    resetGoldHunterStrategySelectorsForTests();
    resetKnownPositionEntrySupervisorForTests();
  });

  it("1. immediate 2500ms fail → supervisor continues → FILLED OPEN + PM", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-sup-later" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    const immediate = await recoverGoldHunterOpenEntryImmediate({
      ownerUid: OWNER,
      trade,
      timeoutMs: 80,
      pollMs: 20,
      listPositions: async () => [
        {
          positionId: "54726281",
          side: "BUY",
          entryPrice: 0,
          volumeLots: 9,
          comment: "GOLD_HUNTER",
          label: "GH-D-sup-later"
        } as never
      ]
    });
    expect(immediate.recovered).toBe(false);
    expect(immediate.reason).toBe("ENTRY_INVALID_WITHIN_WINDOW");

    let n = 0;
    const r = await ensureGoldHunterKnownPositionEntrySupervisor({
      ownerUid: OWNER,
      trade: immediate.trade,
      timeoutMs: 400,
      pollMs: 20,
      listPositions: async () => {
        n += 1;
        return [
          {
            positionId: "54726281",
            side: "BUY",
            entryPrice: n >= 3 ? 4478.35 : 0,
            volumeLots: 9,
            comment: "GOLD_HUNTER",
            label: "GH-D-sup-later"
          } as never
        ];
      }
    });
    expect(r.recovered).toBe(true);
    expect(r.reason).toBe("RECOVERED_OPEN");
    expect(r.trade.status).toBe("FILLED");
    expect(r.trade.result).toBe("OPEN");
    expect(r.trade.entry).toBe(4478.35);
    expect(r.trade.fillTs).toBeTruthy();
    expect(r.trade.initialRiskPrice).toBe(HARD);
    expect(r.trade.entryRecoverySource).toBe("BROKER_POSITION_RECONCILIATION");
    expect(r.pmRegistered).toBe(true);
    expect(r.trade.openEntryPmRegisteredAt).toBeTruthy();
    expect(r.trade.openEntryRecoveryLastReason).toBe("RECOVERED_OPEN");
    expect(
      getGoldHunterOpenPositionDiagnostics(OWNER).some(
        (p) => p.tradeId === "GH-D-sup-later"
      )
    ).toBe(true);
  });

  it("2. invalid open-position entry + historical opening execution → OPEN + PM", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-sup-order" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    setKnownPositionEntrySupervisorHooksForTests({
      findHistoricalOrder: async () => ({
        orderId: "70609421",
        positionId: "54726281",
        clientOrderId: "gh_client_sup_1",
        orderStatus: "ORDER_FILLED",
        orderStatusCode: 2,
        tradeSide: "BUY",
        symbolId: "41",
        label: "GH-D-sup-order",
        comment: "GOLD_HUNTER",
        executionPrice: 4478.35,
        executedVolumeLots: 9,
        createdAt: "2026-08-20T11:41:30.900Z",
        updatedAt: "2026-08-20T11:41:30.960Z",
        closingOrder: false
      }),
      findOpeningDeal: async () => null,
      findClosingDeal: async () => null
    });
    const r = await ensureGoldHunterKnownPositionEntrySupervisor({
      ownerUid: OWNER,
      trade,
      timeoutMs: 300,
      pollMs: 20,
      listPositions: async () => [
        {
          positionId: "54726281",
          side: "BUY",
          entryPrice: 0,
          volumeLots: 9,
          comment: "GOLD_HUNTER",
          label: "GH-D-sup-order"
        } as never
      ]
    });
    expect(r.recovered).toBe(true);
    expect(r.trade.entry).toBe(4478.35);
    expect(r.trade.status).toBe("FILLED");
    expect(r.trade.entryRecoverySource).toBe(
      "BROKER_ORDER_EXECUTION_RECONCILIATION"
    );
    expect(r.pmRegistered).toBe(true);
  });

  it("3. historical price exists but position gone → do not promote OPEN", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-sup-gone" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    setKnownPositionEntrySupervisorHooksForTests({
      findHistoricalOrder: async () => ({
        orderId: "70609421",
        positionId: "54726281",
        clientOrderId: "gh_client_sup_1",
        orderStatus: "ORDER_FILLED",
        orderStatusCode: 2,
        tradeSide: "BUY",
        symbolId: "41",
        label: "GH-D-sup-gone",
        comment: "GOLD_HUNTER",
        executionPrice: 4478.35,
        executedVolumeLots: 9,
        createdAt: "2026-08-20T11:41:30.900Z",
        updatedAt: "2026-08-20T11:41:30.960Z",
        closingOrder: false
      }),
      findOpeningDeal: async () => ({
        dealId: "61009849",
        orderId: "70609421",
        positionId: "54726281",
        executionPrice: 4478.35,
        executedAt: "2026-08-20T11:41:30.960Z",
        filledVolumeLots: 9,
        tradeSide: "BUY",
        isClosing: false,
        close: null,
        label: "GH-D-sup-gone",
        comment: "GOLD_HUNTER",
        symbolId: "41",
        dealStatus: "FILLED"
      }),
      findClosingDeal: async () => ({ dealId: "61009849" })
    });
    const r = await ensureGoldHunterKnownPositionEntrySupervisor({
      ownerUid: OWNER,
      trade,
      timeoutMs: 250,
      pollMs: 20,
      listPositions: async () => []
    });
    expect(r.recovered).toBe(false);
    expect(r.reason).toBe("POSITION_CLOSED_BEFORE_RECOVERY");
    expect(r.trade.status).toBe("PENDING_RECONCILIATION");
    expect(r.trade.entry).toBeNull();
    expect(r.pmRegistered).toBe(false);
    expect(getGoldHunterOpenPositionDiagnostics(OWNER).length).toBe(0);
  });

  it("4. supervisor expires bounded — no invented entry, zero NewOrder", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-sup-expire" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    const r = await ensureGoldHunterKnownPositionEntrySupervisor({
      ownerUid: OWNER,
      trade,
      timeoutMs: 180,
      pollMs: 30,
      listPositions: async () => [
        {
          positionId: "54726281",
          side: "BUY",
          entryPrice: 0,
          volumeLots: 9,
          comment: "GOLD_HUNTER",
          label: "GH-D-sup-expire"
        } as never
      ]
    });
    expect(r.recovered).toBe(false);
    expect(r.reason).toBe("ENTRY_INVALID_WITHIN_WINDOW");
    expect(r.trade.entry).toBeNull();
    expect(r.newOrderCalls).toBe(0);
    expect(getGoldHunterSupervisorNewOrderCallCount()).toBe(0);
  });

  it("5. AutoTrade OFF during recovery — existing position still recovers", async () => {
    expect(GH_ADMIN_DEFAULT_CONFIG.demoAutoTradeEnabled).toBe(false);
    expect(GH_ADMIN_EXECUTION_MODE).toBe("DEMO_ONLY");
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-sup-off" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    const r = await ensureGoldHunterKnownPositionEntrySupervisor({
      ownerUid: OWNER,
      trade,
      timeoutMs: 200,
      pollMs: 20,
      listPositions: async () => [
        {
          positionId: "54726281",
          side: "BUY",
          entryPrice: 4478.35,
          volumeLots: 9,
          comment: "GOLD_HUNTER",
          label: "GH-D-sup-off"
        } as never
      ]
    });
    expect(r.recovered).toBe(true);
    expect(r.trade.status).toBe("FILLED");
    expect(GH_ADMIN_DEFAULT_CONFIG.demoAutoTradeEnabled).toBe(false);
  });

  it("6. PM close held → settlement CLOSED → stale callback cannot regress", async () => {
    const trade = filledOpen();
    await upsertGoldHunterDemoTrade(OWNER, trade);
    const cfg = frozenGhFastSoakConfig();
    const state = openTrade({
      tradeId: trade.goldHunterTradeId,
      side: "BUY",
      setup: "A_MOMENTUM_IGNITION",
      entryTs: Date.now(),
      bid: 2600.1,
      ask: 2600.15,
      trailDistance: cfg.trailDistance
    });
    registerGoldHunterOpenPositionForOwner({
      ownerUid: OWNER,
      trade,
      bid: 2600.1,
      ask: 2600.15
    });

    let release!: (v: { accepted: boolean; errorCode: string | null }) => void;
    const held = new Promise<{ accepted: boolean; errorCode: string | null }>(
      (res) => {
        release = res;
      }
    );
    setGoldHunterPositionManagerHooksForTests({
      closePosition: async () => held
    });

    const closing = closeGoldHunterDemoPosition({
      ownerUid: OWNER,
      trade,
      exitReason: "HARD_PROTECTION",
      bid: 2600,
      ask: 2600.05,
      state
    });

    for (let i = 0; i < 20; i++) {
      const cur = await getGoldHunterDemoTrade(OWNER, trade.goldHunterTradeId);
      if (cur?.status === "CLOSE_REQUESTED") break;
      await new Promise((r) => setTimeout(r, 10));
    }

    const settled = applyBrokerSettledClose({
      trade: {
        ...(await getGoldHunterDemoTrade(OWNER, trade.goldHunterTradeId))!,
        status: "CLOSE_ACCEPTED_PENDING_SETTLEMENT"
      },
      deal: {
        dealId: "61009964",
        orderId: "70609700",
        positionId: "54726731",
        closePrice: 4477.82,
        closedAt: "2026-08-20T11:42:58.176Z",
        grossPnl: 1.31,
        commission: -0.54,
        swap: 0,
        netPnl: 0.77,
        closedVolumeLots: 9,
        entryPrice: 4477.65
      },
      exitReason: "TRAIL_HIT"
    });
    await upsertGoldHunterDemoTrade(OWNER, settled);

    release({ accepted: false, errorCode: "CTRADER_ORDER_TIMEOUT" });
    const outcome = await closing;
    expect(outcome).toBe("SETTLED");

    const final = await getGoldHunterDemoTrade(OWNER, trade.goldHunterTradeId);
    expect(final?.status).toBe("CLOSED");
    expect(final?.result).toBe("WIN");
    expect(final?.netPnlEur).toBe(0.77);
    expect(final?.exit).toBe(4477.82);
    expect(final?.closeTs).toBe("2026-08-20T11:42:58.176Z");
    expect(final?.brokerDealId).toBe("61009964");
    expect(final?.brokerSettlementTs).toBe("2026-08-20T11:42:58.176Z");
    expect(final?.entry).toBe(2600.1);
  });

  it("7. stale MFE/MAE write after CLOSED stays CLOSED", async () => {
    const closed = applyBrokerSettledClose({
      trade: filledOpen({ goldHunterTradeId: "GH-D-stale-mfe" }),
      deal: {
        dealId: "d-closed",
        orderId: "o1",
        positionId: "54726731",
        closePrice: 2600.4,
        closedAt: "2026-08-20T11:42:58.176Z",
        grossPnl: 1.31,
        commission: -0.54,
        swap: 0,
        netPnl: 0.77,
        closedVolumeLots: 9,
        entryPrice: 2600.1
      }
    });
    await upsertGoldHunterDemoTrade(OWNER, closed);
    const stale = await upsertGoldHunterDemoTrade(OWNER, {
      ...closed,
      status: "FILLED",
      result: "OPEN",
      closeTs: null,
      exit: null,
      netPnlEur: null,
      mfe: 9.99,
      mae: -9.99
    });
    expect(stale.rejectedRegression).toBe(true);
    expect(stale.trade.status).toBe("CLOSED");
    expect(stale.trade.result).toBe("WIN");
    expect(stale.trade.netPnlEur).toBe(0.77);
    expect(stale.trade.exit).toBe(2600.4);
    expect(stale.trade.closeTs).toBe("2026-08-20T11:42:58.176Z");
    expect(stale.trade.brokerDealId).toBe("d-closed");
    expect(stale.trade.brokerSettlementTs).toBe("2026-08-20T11:42:58.176Z");
    expect(stale.trade.mfe).toBe(closed.mfe);
    expect(stale.trade.mae).toBe(closed.mae);
  });

  it("8. unresolved proven-open invalid entry → entryIntegrityHealthy=false", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-unhealthy" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    expect(isProvenBrokerOpenEntryIntegrityDefect(trade)).toBe(true);
    const sel = getGoldHunterStrategySelector(OWNER);
    expect(sel.getLossControllerEntryState().unknownRGuardActive).toBe(false);
    const sync = await syncGoldHunterOpenEntryIntegrityHealth(OWNER);
    expect(sync.healthy).toBe(false);
    expect(sync.defectCount).toBe(1);
    expect(sel.getLossControllerEntryState().entryIntegrityHealthy).toBe(false);
    expect(sel.getLossControllerEntryState().unknownRGuardActive).toBe(false);
    expect(sel.getLossControllerEntryState().unknownRealisedRLossCount).toBe(0);
  });

  it("9. authoritative recovery returns entryIntegrityHealthy=true", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-healthy-again" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    await syncGoldHunterOpenEntryIntegrityHealth(OWNER);
    expect(
      getGoldHunterStrategySelector(OWNER).getLossControllerEntryState()
        .entryIntegrityHealthy
    ).toBe(false);

    const r = await ensureGoldHunterKnownPositionEntrySupervisor({
      ownerUid: OWNER,
      trade,
      timeoutMs: 200,
      pollMs: 20,
      listPositions: async () => [
        {
          positionId: "54726281",
          side: "BUY",
          entryPrice: 4478.35,
          volumeLots: 9,
          comment: "GOLD_HUNTER",
          label: "GH-D-healthy-again"
        } as never
      ]
    });
    expect(r.recovered).toBe(true);
    expect(
      getGoldHunterStrategySelector(OWNER).getLossControllerEntryState()
        .entryIntegrityHealthy
    ).toBe(true);
  });

  it("10. PR #157 third-loss pretransport still blocks", () => {
    const sel = getGoldHunterStrategySelector(OWNER);
    for (let i = 0; i < 3; i++) {
      sel.notifyTradeClosed({
        side: "BUY",
        setup: "A",
        entryPrice: 2600,
        result: "LOSS",
        tradeId: `gh-loss-${i}`,
        realisedR: -0.7,
        closedAtMs: 1_000_000 + i * 1000
      });
    }
    const gate = evaluateGoldHunterFinalLossSafetyGate({
      ownerUid: OWNER,
      side: "BUY",
      atMs: 1_000_000 + 4000,
      mid: 2600,
      signedImbalance1s: 0.2,
      midVel250: 0.001
    });
    expect(gate.ok).toBe(false);
    expect(gate.rejectionReason).toBe("WAIT_LOSS_STREAK_GUARD");
  });

  it("11. hung immediate-read still times out (no invent)", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-hung-keep" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    const timeoutMs = 200;
    const started = Date.now();
    const r = await recoverGoldHunterOpenEntryImmediate({
      ownerUid: OWNER,
      trade,
      timeoutMs,
      pollMs: 50,
      listPositions: () =>
        new Promise(() => {
          /* hung */
        })
    });
    const elapsed = Date.now() - started;
    expect(r.recovered).toBe(false);
    expect(r.reason).toBe("TIMEOUT");
    expect(r.trade.entry).toBeNull();
    expect(elapsed).toBeLessThan(800);
  });

  it("12. position closes DURING historical lookup → no OPEN promotion", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-sup-race-hist" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    let releaseOrder!: (order: {
      orderId: string;
      positionId: string;
      clientOrderId: string;
      orderStatus: string;
      orderStatusCode: number;
      tradeSide: "BUY";
      symbolId: string;
      label: string;
      comment: string;
      executionPrice: number;
      executedVolumeLots: number;
      createdAt: string;
      updatedAt: string;
      closingOrder: boolean;
    }) => void;
    const heldOrder = new Promise<Parameters<typeof releaseOrder>[0]>((res) => {
      releaseOrder = res;
    });
    let lookupStarted = false;
    let listCalls = 0;
    setKnownPositionEntrySupervisorHooksForTests({
      findHistoricalOrder: async () => {
        lookupStarted = true;
        return heldOrder;
      },
      findOpeningDeal: async () => null,
      findClosingDeal: async () => null
    });
    const running = ensureGoldHunterKnownPositionEntrySupervisor({
      ownerUid: OWNER,
      trade,
      timeoutMs: 800,
      pollMs: 20,
      listPositions: async () => {
        listCalls += 1;
        if (listCalls === 1) {
          return [
            {
              positionId: "54726281",
              side: "BUY",
              entryPrice: 0,
              volumeLots: 9,
              comment: "GOLD_HUNTER",
              label: "GH-D-sup-race-hist"
            } as never
          ];
        }
        return [];
      }
    });
    for (let i = 0; i < 40 && !lookupStarted; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(lookupStarted).toBe(true);
    releaseOrder({
      orderId: "70609421",
      positionId: "54726281",
      clientOrderId: "gh_client_sup_1",
      orderStatus: "ORDER_FILLED",
      orderStatusCode: 2,
      tradeSide: "BUY",
      symbolId: "41",
      label: "GH-D-sup-race-hist",
      comment: "GOLD_HUNTER",
      executionPrice: 4478.35,
      executedVolumeLots: 9,
      createdAt: "2026-08-20T11:41:30.900Z",
      updatedAt: "2026-08-20T11:41:30.960Z",
      closingOrder: false
    });
    const r = await running;
    expect(r.recovered).toBe(false);
    expect(r.reason).toBe("POSITION_CLOSED_BEFORE_RECOVERY");
    expect(r.trade.status).toBe("PENDING_RECONCILIATION");
    expect(r.trade.entry).toBeNull();
    expect(r.pmRegistered).toBe(false);
    expect(r.trade.openEntryPmRegisteredAt ?? null).toBeNull();
    expect(getGoldHunterOpenPositionDiagnostics(OWNER).length).toBe(0);
    expect(listCalls).toBeGreaterThanOrEqual(2);
  });

  it("13. hung historical order read → bounded TIMEOUT", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-hung-order" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    setKnownPositionEntrySupervisorHooksForTests({
      findHistoricalOrder: () => new Promise(() => undefined),
      findOpeningDeal: async () => null,
      findClosingDeal: async () => null
    });
    const started = Date.now();
    const r = await ensureGoldHunterKnownPositionEntrySupervisor({
      ownerUid: OWNER,
      trade,
      timeoutMs: 180,
      pollMs: 30,
      listPositions: async () => [
        {
          positionId: "54726281",
          side: "BUY",
          entryPrice: 0,
          volumeLots: 9,
          comment: "GOLD_HUNTER",
          label: "GH-D-hung-order"
        } as never
      ]
    });
    expect(r.recovered).toBe(false);
    expect(r.reason).toBe("TIMEOUT");
    expect(r.trade.entry).toBeNull();
    expect(r.pmRegistered).toBe(false);
    expect(Date.now() - started).toBeLessThan(800);
  });

  it("14. hung opening deal read → bounded TIMEOUT", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-hung-deal" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    setKnownPositionEntrySupervisorHooksForTests({
      findHistoricalOrder: async () => null,
      findOpeningDeal: () => new Promise(() => undefined),
      findClosingDeal: async () => null
    });
    const started = Date.now();
    const r = await ensureGoldHunterKnownPositionEntrySupervisor({
      ownerUid: OWNER,
      trade,
      timeoutMs: 180,
      pollMs: 30,
      listPositions: async () => [
        {
          positionId: "54726281",
          side: "BUY",
          entryPrice: 0,
          volumeLots: 9,
          comment: "GOLD_HUNTER",
          label: "GH-D-hung-deal"
        } as never
      ]
    });
    expect(r.recovered).toBe(false);
    expect(r.reason).toBe("TIMEOUT");
    expect(r.trade.entry).toBeNull();
    expect(Date.now() - started).toBeLessThan(800);
  });

  it("15. hung closing-deal read → bounded TIMEOUT", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-hung-close" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    setKnownPositionEntrySupervisorHooksForTests({
      findHistoricalOrder: async () => null,
      findOpeningDeal: async () => null,
      findClosingDeal: () => new Promise(() => undefined)
    });
    const started = Date.now();
    const r = await ensureGoldHunterKnownPositionEntrySupervisor({
      ownerUid: OWNER,
      trade,
      timeoutMs: 180,
      pollMs: 30,
      listPositions: async () => []
    });
    expect(r.recovered).toBe(false);
    expect(r.reason).toBe("TIMEOUT");
    expect(r.trade.entry).toBeNull();
    expect(Date.now() - started).toBeLessThan(800);
  });

  it("16. rejected/error/missed opening deal cannot supply entry", async () => {
    for (const dealStatus of ["REJECTED", "ERROR", "MISSED", "INTERNALLY_REJECTED"]) {
      resetGoldHunterTradeMemory();
      resetKnownPositionEntrySupervisorForTests();
      const trade = pendingTrade({
        goldHunterTradeId: `GH-D-bad-deal-${dealStatus}`
      });
      await upsertGoldHunterDemoTrade(OWNER, trade);
      setKnownPositionEntrySupervisorHooksForTests({
        findHistoricalOrder: async () => null,
        findOpeningDeal: async () => ({
          dealId: "61009849",
          orderId: "70609421",
          positionId: "54726281",
          executionPrice: 4478.35,
          executedAt: "2026-08-20T11:41:30.960Z",
          filledVolumeLots: 9,
          tradeSide: "BUY",
          isClosing: false,
          close: null,
          label: trade.goldHunterTradeId,
          comment: "GOLD_HUNTER",
          symbolId: "41",
          dealStatus
        }),
        findClosingDeal: async () => null
      });
      const r = await ensureGoldHunterKnownPositionEntrySupervisor({
        ownerUid: OWNER,
        trade,
        timeoutMs: 160,
        pollMs: 30,
        listPositions: async () => [
          {
            positionId: "54726281",
            side: "BUY",
            entryPrice: 0,
            volumeLots: 9,
            comment: "GOLD_HUNTER",
            label: trade.goldHunterTradeId
          } as never
        ]
      });
      expect(r.recovered).toBe(false);
      expect(r.trade.entry).toBeNull();
      expect(r.pmRegistered).toBe(false);
    }
  });

  it("17. successful FILLED opening deal can supply entry", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-good-deal" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    setKnownPositionEntrySupervisorHooksForTests({
      findHistoricalOrder: async () => null,
      findOpeningDeal: async () => ({
        dealId: "61009849",
        orderId: "70609421",
        positionId: "54726281",
        executionPrice: 4478.35,
        executedAt: "2026-08-20T11:41:30.960Z",
        filledVolumeLots: 9,
        tradeSide: "BUY",
        isClosing: false,
        close: null,
        label: "GH-D-good-deal",
        comment: "GOLD_HUNTER",
        symbolId: "41",
        dealStatus: "FILLED"
      }),
      findClosingDeal: async () => null
    });
    const r = await ensureGoldHunterKnownPositionEntrySupervisor({
      ownerUid: OWNER,
      trade,
      timeoutMs: 300,
      pollMs: 20,
      listPositions: async () => [
        {
          positionId: "54726281",
          side: "BUY",
          entryPrice: 0,
          volumeLots: 9,
          comment: "GOLD_HUNTER",
          label: "GH-D-good-deal"
        } as never
      ]
    });
    expect(r.recovered).toBe(true);
    expect(r.trade.entry).toBe(4478.35);
    expect(r.trade.status).toBe("FILLED");
    expect(r.trade.entryRecoverySource).toBe(
      "BROKER_OPENING_DEAL_RECONCILIATION"
    );
    expect(r.pmRegistered).toBe(true);
  });

  it("17b. closing FILLED historical order cannot supply OPEN entry", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-close-order" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    setKnownPositionEntrySupervisorHooksForTests({
      findHistoricalOrder: async () => ({
        orderId: "70609421",
        positionId: "54726281",
        clientOrderId: "gh_client_sup_1",
        orderStatus: "ORDER_FILLED",
        orderStatusCode: 2,
        tradeSide: "BUY",
        symbolId: "41",
        label: "GH-D-close-order",
        comment: "GOLD_HUNTER",
        executionPrice: 4478.35,
        executedVolumeLots: 9,
        createdAt: "2026-08-20T11:41:37.000Z",
        updatedAt: "2026-08-20T11:41:37.000Z",
        closingOrder: true
      }),
      findOpeningDeal: async () => null,
      findClosingDeal: async () => null
    });
    const r = await ensureGoldHunterKnownPositionEntrySupervisor({
      ownerUid: OWNER,
      trade,
      timeoutMs: 160,
      pollMs: 30,
      listPositions: async () => [
        {
          positionId: "54726281",
          side: "BUY",
          entryPrice: 0,
          volumeLots: 9,
          comment: "GOLD_HUNTER",
          label: "GH-D-close-order"
        } as never
      ]
    });
    expect(r.recovered).toBe(false);
    expect(r.trade.entry).toBeNull();
    expect(r.pmRegistered).toBe(false);
  });

  it("18. stale non-CLOSED write cannot alter CLOSED lifecycle/PM fields", async () => {
    const closed = applyBrokerSettledClose({
      trade: filledOpen({
        goldHunterTradeId: "GH-D-stale-lifecycle",
        smartPmState: "PROTECTED",
        highestProtectionStage: "PROTECTED",
        exitReason: "TRAIL_HIT",
        closeRequestTs: "2026-08-20T11:42:50.000Z",
        errorCode: null
      }),
      deal: {
        dealId: "d-life",
        orderId: "o1",
        positionId: "54726731",
        closePrice: 2600.4,
        closedAt: "2026-08-20T11:42:58.176Z",
        grossPnl: 1.31,
        commission: -0.54,
        swap: 0,
        netPnl: 0.77,
        closedVolumeLots: 9,
        entryPrice: 2600.1
      }
    });
    await upsertGoldHunterDemoTrade(OWNER, closed);
    const before = await getGoldHunterDemoTrade(OWNER, closed.goldHunterTradeId);
    const stale = await upsertGoldHunterDemoTrade(OWNER, {
      ...closed,
      status: "CLOSE_REQUESTED",
      result: null,
      closeRequestTs: "2026-08-20T12:06:15.594Z",
      exitSignalTs: "2026-08-20T12:06:15.594Z",
      errorCode: "CTRADER_ORDER_TIMEOUT",
      smartPmState: "UNPROTECTED",
      highestProtectionStage: "UNPROTECTED",
      protectedProfitR: 0,
      protectedStopPrice: 1,
      lastStopAdjustReason: "HARD_PROTECTION",
      exitReason: "HARD_PROTECTION",
      entry: 1,
      exit: null,
      closeTs: null,
      netPnlEur: null,
      brokerDealId: "mutated"
    });
    expect(stale.rejectedRegression).toBe(true);
    const final = stale.trade;
    expect(final.status).toBe("CLOSED");
    expect(final.result).toBe(before?.result);
    expect(final.entry).toBe(before?.entry);
    expect(final.exit).toBe(before?.exit);
    expect(final.closeTs).toBe(before?.closeTs);
    expect(final.netPnlEur).toBe(before?.netPnlEur);
    expect(final.brokerDealId).toBe(before?.brokerDealId);
    expect(final.brokerSettlementTs).toBe(before?.brokerSettlementTs);
    expect(final.closeRequestTs).toBe(before?.closeRequestTs);
    expect(final.exitReason).toBe(before?.exitReason);
    expect(final.smartPmState).toBe(before?.smartPmState);
    expect(final.errorCode ?? null).toBe(before?.errorCode ?? null);
  });

  it("19. immediate recovery vs concurrent CLOSED → no PM registration", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-imm-closed" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    const closed = applyBrokerSettledClose({
      trade: {
        ...trade,
        status: "FILLED",
        result: "OPEN",
        entry: 4478.35,
        fillTs: "2026-08-20T11:41:33.000Z"
      },
      deal: {
        dealId: "61009849",
        orderId: "70609421",
        positionId: "54726281",
        closePrice: 4477.78,
        closedAt: "2026-08-20T11:41:37.986Z",
        grossPnl: -4.39,
        commission: -0.54,
        swap: 0,
        netPnl: -4.93,
        closedVolumeLots: 9,
        entryPrice: 4478.35
      }
    });
    let sawRecoveredCandidate = false;
    setGoldHunterTradeStoreHooksForTests({
      beforeCommit: async (incoming) => {
        if (incoming.status === "FILLED" && incoming.result === "OPEN") {
          expect(incoming.openEntryPmRegisteredAt ?? null).toBeNull();
          sawRecoveredCandidate = true;
          await upsertGoldHunterDemoTrade(OWNER, closed);
        }
      }
    });
    const r = await recoverGoldHunterOpenEntryImmediate({
      ownerUid: OWNER,
      trade,
      timeoutMs: 200,
      pollMs: 20,
      listPositions: async () => [
        {
          positionId: "54726281",
          side: "BUY",
          entryPrice: 4478.35,
          volumeLots: 9,
          comment: "GOLD_HUNTER",
          label: "GH-D-imm-closed"
        } as never
      ]
    });
    expect(sawRecoveredCandidate).toBe(true);
    expect(r.recovered).toBe(false);
    expect(r.reason).toBe("POSITION_CLOSED_BEFORE_RECOVERY");
    expect(r.pmRegistered ?? false).toBe(false);
    expect(r.trade.status).toBe("CLOSED");
    expect(r.trade.result).toBe("LOSS");
    expect(r.trade.netPnlEur).toBe(-4.93);
    expect(r.trade.brokerDealId).toBe("61009849");
    expect(r.trade.openEntryPmRegisteredAt ?? null).toBeNull();
    expect(getGoldHunterOpenPositionDiagnostics(OWNER).length).toBe(0);
    const final = await getGoldHunterDemoTrade(OWNER, trade.goldHunterTradeId);
    expect(final?.status).toBe("CLOSED");
    expect(final?.openEntryPmRegisteredAt ?? null).toBeNull();
  });

  it("20. openEntryPmRegisteredAt only after actual PM registration", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-pm-stamp" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    let sawPromoteWithoutPmStamp = false;
    setGoldHunterTradeStoreHooksForTests({
      beforeCommit: (incoming) => {
        if (
          incoming.status === "FILLED" &&
          incoming.result === "OPEN" &&
          !incoming.openEntryPmRegisteredAt
        ) {
          sawPromoteWithoutPmStamp = true;
        }
      }
    });
    const r = await recoverGoldHunterOpenEntryImmediate({
      ownerUid: OWNER,
      trade,
      timeoutMs: 200,
      pollMs: 20,
      listPositions: async () => [
        {
          positionId: "54726281",
          side: "BUY",
          entryPrice: 4478.35,
          volumeLots: 9,
          comment: "GOLD_HUNTER",
          label: "GH-D-pm-stamp"
        } as never
      ]
    });
    expect(r.recovered).toBe(true);
    expect(sawPromoteWithoutPmStamp).toBe(true);
    expect(r.trade.openEntryPmRegisteredAt).toBeTruthy();
    expect(
      getGoldHunterOpenPositionDiagnostics(OWNER).some(
        (p) => p.tradeId === "GH-D-pm-stamp"
      )
    ).toBe(true);
  });

  it("21. recovery start timestamp is true start and supervisor honours it", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-start-ts" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    let startAtFirstPoll: string | null = null;
    const immediate = await recoverGoldHunterOpenEntryImmediate({
      ownerUid: OWNER,
      trade,
      timeoutMs: 80,
      pollMs: 20,
      listPositions: async () => {
        const cur = await getGoldHunterDemoTrade(OWNER, trade.goldHunterTradeId);
        startAtFirstPoll = cur?.openEntryRecoveryStartedAt ?? null;
        return [
          {
            positionId: "54726281",
            side: "BUY",
            entryPrice: 0,
            volumeLots: 9,
            comment: "GOLD_HUNTER",
            label: "GH-D-start-ts"
          } as never
        ];
      }
    });
    expect(immediate.recovered).toBe(false);
    expect(startAtFirstPoll).toBeTruthy();
    expect(immediate.trade.openEntryRecoveryStartedAt).toBe(startAtFirstPoll);

    const ancient = new Date(Date.now() - 9_700).toISOString();
    const late = pendingTrade({
      goldHunterTradeId: "GH-D-start-horizon",
      openEntryRecoveryStartedAt: ancient
    });
    await upsertGoldHunterDemoTrade(OWNER, late);
    const started = Date.now();
    const r = await ensureGoldHunterKnownPositionEntrySupervisor({
      ownerUid: OWNER,
      trade: late,
      timeoutMs: 10_000,
      pollMs: 30,
      listPositions: () => new Promise(() => undefined)
    });
    expect(r.reason).toBe("TIMEOUT");
    expect(r.recovered).toBe(false);
    expect(r.trade.entry).toBeNull();
    expect(Date.now() - started).toBeLessThan(1500);
    expect(r.trade.openEntryRecoveryStartedAt).toBe(ancient);
  });

  it("safety defaults unchanged", () => {
    expect(GH_ADMIN_DEFAULT_CONFIG.demoAutoTradeEnabled).toBe(false);
    expect(GH_ADMIN_DEFAULT_CONFIG.maxOpenTrades).toBe(1);
    expect(GH_ADMIN_DEFAULT_CONFIG.riskPerTradePct).toBe(1);
    expect(GH_ADMIN_EXECUTION_MODE).toBe("DEMO_ONLY");
    expect(HARD).toBe(frozenGhFastSoakConfig().hardStop);
  });
});

describe("unregister after CLOSED", () => {
  beforeEach(() => {
    resetGoldHunterTradeMemory();
    resetGoldHunterPositionManagerForTests();
    resetGoldHunterStrategySelectorsForTests();
  });

  it("drops managed state when trade is already CLOSED", async () => {
    const trade = filledOpen({ goldHunterTradeId: "GH-D-unreg" });
    registerGoldHunterOpenPositionForOwner({
      ownerUid: OWNER,
      trade,
      bid: 2600,
      ask: 2600.05
    });
    expect(
      getGoldHunterOpenPositionDiagnostics(OWNER).some(
        (p) => p.tradeId === "GH-D-unreg"
      )
    ).toBe(true);
    unregisterGoldHunterManagedPosition(OWNER, "GH-D-unreg");
    expect(
      getGoldHunterOpenPositionDiagnostics(OWNER).some(
        (p) => p.tradeId === "GH-D-unreg"
      )
    ).toBe(false);
    const rows = await listGoldHunterDemoTrades(OWNER);
    expect(rows.length).toBe(0);
  });
});
