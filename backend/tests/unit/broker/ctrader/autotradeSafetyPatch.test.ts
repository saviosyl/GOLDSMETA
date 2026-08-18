import { describe, expect, it } from "vitest";
import {
  strategyProvidedTakeProfits,
  appendLifecycleEvent,
  emptyProfitLockState,
  emptyTpStatuses,
  type DemoPositionLifecycle
} from "../../../../src/services/broker/ctrader/positionLifecycleTypes";
import {
  parseBrokerClosedDeals,
  aggregateClosingDeals
} from "../../../../src/services/broker/ctrader/openApiClient";
import { lotsToValidatedBrokerVolume } from "../../../../src/services/broker/ctrader/volumeUnits";
import { newsProtectionBlocksLiveActivation } from "../../../../src/services/broker/ctrader/liveNewsGate";
import {
  evaluateNewsGuard,
  loadNewsProviderKind
} from "../../../../src/services/broker/ctrader/newsGuard";
import { isCTraderLiveEnabled } from "../../../../src/services/broker/ctrader/flags";

/** Pepperstone Demo XAUUSD lot-denominated metadata (min 0.01, step 0.01). */
const PEPPERSTONE_DEMO_XAUUSD_LOTS = {
  minLots: 0.01,
  maxLots: 100,
  stepLots: 0.01
} as const;

function baseLifecycle(
  overrides: Partial<DemoPositionLifecycle> = {}
): DemoPositionLifecycle {
  return {
    id: "c1",
    uid: "u1",
    environment: "DEMO",
    correlationId: "c1",
    brokerOrderId: "o1",
    brokerPositionId: "p1",
    accountId: "4810",
    accountMasked: "48…10",
    symbol: "XAUUSD",
    side: "BUY",
    entry: 2350,
    currentPrice: 2355,
    lots: 0.02,
    remainingLots: 0.02,
    initialSl: 2340,
    currentSl: 2340,
    tp1: 2360,
    tp2: null,
    tp3: null,
    ...emptyTpStatuses(),
    openedAt: new Date().toISOString(),
    closedAt: null,
    realisedPnl: null,
    unrealisedPnl: 5,
    brokerPnlConfirmed: false,
    closePrice: null,
    grossPnl: null,
    commission: null,
    swap: null,
    netPnl: null,
    brokerDealId: null,
    initialRisk: 10,
    currentRisk: 10,
    qualificationStage: "CONTROLLED_DEMO_QUALIFICATION",
    decisionId: "d1",
    setupRef: "d1",
    source: "qualification_controlled",
    managementState: "SL_PROTECTED",
    lastRecommendation: null,
    protectionVerified: true,
    protectionFailure: false,
    events: [],
    appliedDedupeKeys: [],
    updatedAt: new Date().toISOString(),
    status: "OPEN",
    ...emptyProfitLockState(),
    ...overrides
  };
}

describe("autotrade safety patch — TP levels", () => {
  it("missing TP2/TP3 remain null — no fallback TP invention", () => {
    const onlyTp1 = strategyProvidedTakeProfits([{ label: "TP1", price: 4350 }]);
    expect(onlyTp1).toEqual({ tp1: 4350, tp2: null, tp3: null });

    const none = strategyProvidedTakeProfits([]);
    expect(none).toEqual({ tp1: null, tp2: null, tp3: null });

    const unlabeledFirst = strategyProvidedTakeProfits([{ price: 4300 }]);
    expect(unlabeledFirst.tp1).toBe(4300);
    expect(unlabeledFirst.tp2).toBeNull();
    expect(unlabeledFirst.tp3).toBeNull();
  });

  it("does not invent 1R / 1.5R / 2R ladders from risk distance", () => {
    // Position-management layer must not design targets from entry/SL.
    const entry = 2350;
    const sl = 2340;
    const r = Math.abs(entry - sl);
    const invented = {
      tp1: entry + 1 * r,
      tp2: entry + 1.5 * r,
      tp3: entry + 2 * r
    };
    const actual = strategyProvidedTakeProfits([{ label: "TP1", price: 2360 }]);
    expect(actual.tp2).not.toBe(invented.tp2);
    expect(actual.tp3).not.toBe(invented.tp3);
    expect(actual.tp2).toBeNull();
    expect(actual.tp3).toBeNull();
  });
});

describe("autotrade safety patch — broker close P/L", () => {
  it("uses actual broker closing deal P/L when deal is found", () => {
    const deals = parseBrokerClosedDeals([
      {
        dealId: "9001",
        orderId: "8001",
        positionId: "p1",
        executionPrice: 2365.5,
        executionTimestamp: Date.parse("2026-08-08T15:00:00.000Z"),
        moneyDigits: 2,
        closePositionDetail: {
          grossProfit: 1250, // 12.50
          commission: -20, // -0.20
          swap: -5, // -0.05
          moneyDigits: 2,
          closedVolume: 1
        }
      }
    ]);
    expect(deals).toHaveLength(1);
    const agg = aggregateClosingDeals(deals);
    expect(agg).not.toBeNull();
    expect(agg!.grossPnl).toBe(12.5);
    expect(agg!.commission).toBe(-0.2);
    expect(agg!.swap).toBe(-0.05);
    expect(agg!.netPnl).toBeCloseTo(12.5 + -0.05 - 0.2, 5);
    expect(agg!.closePrice).toBe(2365.5);
    expect(agg!.dealId).toBe("9001");
  });

  it("pending close reconciliation does not fabricate P/L = 0", () => {
    const doc = baseLifecycle();
    const pending = appendLifecycleEvent(doc, {
      at: new Date().toISOString(),
      kind: "CLOSE_PENDING",
      reason:
        "CLOSE RECONCILIATION PENDING — broker close deal not yet available; P/L not fabricated",
      brokerAck: false,
      dedupeKey: `close_pending:${doc.correlationId}`
    });
    const next: DemoPositionLifecycle = {
      ...pending.doc,
      status: "CLOSE_RECONCILIATION_PENDING",
      managementState: "CLOSE_RECONCILIATION_PENDING",
      brokerPnlConfirmed: false,
      realisedPnl: null,
      lastRecommendation: "CLOSE RECONCILIATION PENDING"
    };
    expect(next.status).toBe("CLOSE_RECONCILIATION_PENDING");
    expect(next.brokerPnlConfirmed).toBe(false);
    expect(next.realisedPnl).toBeNull();
    expect(next.realisedPnl).not.toBe(0);
    expect(aggregateClosingDeals([])).toBeNull();
  });

  it("aggregates closing deals idempotently by deal ids", () => {
    const deals = parseBrokerClosedDeals([
      {
        dealId: "1",
        positionId: "p1",
        executionPrice: 2360,
        executionTimestamp: 1,
        closePositionDetail: {
          grossProfit: 100,
          commission: 0,
          swap: 0,
          moneyDigits: 2,
          closedVolume: 1
        }
      },
      {
        dealId: "2",
        positionId: "p1",
        executionPrice: 2370,
        executionTimestamp: 2,
        closePositionDetail: {
          grossProfit: 200,
          commission: -10,
          swap: 0,
          moneyDigits: 2,
          closedVolume: 1
        }
      }
    ]);
    const a = aggregateClosingDeals(deals);
    const b = aggregateClosingDeals(deals);
    expect(a!.dealId).toBe("1,2");
    expect(a!.netPnl).toBe(b!.netPnl);
    expect(a!.netPnl).toBeCloseTo(2.9, 5); // 1+2 - 0.10
    expect(a!.closedVolumeLots).toBeCloseTo(0.02, 8);
    expect(a!.closePrice).toBeCloseTo(2365, 5); // VWAP of 2360 & 2370
  });

  it("M1-style: multi-deal close sums net P/L and closed volume", () => {
    const deals = parseBrokerClosedDeals([
      {
        dealId: "d1",
        positionId: "P123",
        executionPrice: 4400,
        executionTimestamp: 1,
        closePositionDetail: {
          grossProfit: 100,
          commission: 0,
          swap: 0,
          moneyDigits: 2,
          closedVolume: 10
        }
      },
      {
        dealId: "d2",
        positionId: "P123",
        executionPrice: 4402,
        executionTimestamp: 2,
        closePositionDetail: {
          grossProfit: 200,
          commission: 0,
          swap: 0,
          moneyDigits: 2,
          closedVolume: 15
        }
      }
    ]);
    const agg = aggregateClosingDeals(deals);
    expect(agg).not.toBeNull();
    expect(agg!.netPnl).toBeCloseTo(3.0, 5);
    expect(agg!.closedVolumeLots).toBeCloseTo(0.25, 8);
    expect(agg!.dealId).toBe("d1,d2");
    expect(agg!.closePrice).toBeCloseTo(
      (4400 * 0.1 + 4402 * 0.15) / 0.25,
      5
    );
  });

  it("incomplete multi-deal price → preserve P/L, aggregate closePrice null", () => {
    const d1 = {
      dealId: "d1",
      orderId: "o1",
      positionId: "P123",
      closePrice: 4408,
      closedAt: "2026-08-18T10:00:00.000Z",
      grossPnl: 1,
      commission: 0,
      swap: 0,
      netPnl: 1,
      closedVolumeLots: 0.1
    };
    const d2 = {
      dealId: "d2",
      orderId: "o2",
      positionId: "P123",
      closePrice: null,
      closedAt: "2026-08-18T10:00:01.000Z",
      grossPnl: 2,
      commission: 0,
      swap: 0,
      netPnl: 2,
      closedVolumeLots: 0.15
    };
    const agg = aggregateClosingDeals([d1, d2]);
    expect(agg).not.toBeNull();
    expect(agg!.netPnl).toBe(3);
    expect(agg!.closedVolumeLots).toBeCloseTo(0.25, 8);
    expect(agg!.dealId).toBe("d1,d2");
    // Subset VWAP must not be presented as the full exit price.
    expect(agg!.closePrice).toBeNull();
  });

  it("multi-deal with any null netPnl → aggregate null (no partial CLOSED P/L)", () => {
    const agg = aggregateClosingDeals([
      {
        dealId: "d1",
        orderId: "o1",
        positionId: "P1",
        closePrice: 4400,
        closedAt: "2026-08-18T10:00:00.000Z",
        grossPnl: -20,
        commission: 0,
        swap: 0,
        netPnl: -20,
        closedVolumeLots: 0.1
      },
      {
        dealId: "d2",
        orderId: "o2",
        positionId: "P1",
        closePrice: 4401,
        closedAt: "2026-08-18T10:00:01.000Z",
        grossPnl: null,
        commission: null,
        swap: null,
        netPnl: null,
        closedVolumeLots: 0.1
      }
    ]);
    expect(agg).toBeNull();
  });

  it("multi-deal complete netPnl -20 and +5 → aggregate -15", () => {
    const agg = aggregateClosingDeals([
      {
        dealId: "d1",
        orderId: "o1",
        positionId: "P1",
        closePrice: 4400,
        closedAt: "2026-08-18T10:00:00.000Z",
        grossPnl: -20,
        commission: 0,
        swap: 0,
        netPnl: -20,
        closedVolumeLots: 0.1
      },
      {
        dealId: "d2",
        orderId: "o2",
        positionId: "P1",
        closePrice: 4401,
        closedAt: "2026-08-18T10:00:01.000Z",
        grossPnl: 5,
        commission: 0,
        swap: 0,
        netPnl: 5,
        closedVolumeLots: 0.1
      }
    ]);
    expect(agg).not.toBeNull();
    expect(agg!.netPnl).toBe(-15);
  });
});

describe("autotrade safety patch — volume metadata", () => {
  it("partial-close conversion uses symbol metadata (no hard-coded ×100 assumption)", () => {
    const ok = lotsToValidatedBrokerVolume({
      lots: 0.02,
      ...PEPPERSTONE_DEMO_XAUUSD_LOTS
    });
    expect(ok.ok).toBe(true);
    expect(ok.roundedLots).toBe(0.02);
    // Pepperstone Demo XAUUSD: 0.02 lots → 2 volume units via metadata-validated helper
    expect(ok.orderVolumeUnits).toBe(2);
    // Different step proves we are not blindly submitting lots×100 without rounding rules:
    const coarseStep = lotsToValidatedBrokerVolume({
      lots: 0.03,
      minLots: 0.01,
      maxLots: 100,
      stepLots: 0.02
    });
    expect(coarseStep.ok).toBe(true);
    expect(coarseStep.roundedLots).toBe(0.02);
    expect(coarseStep.orderVolumeUnits).toBe(2);
    // Ad-hoc lots×100 without step would have submitted 3 units for 0.03 lots.
    expect(coarseStep.orderVolumeUnits).not.toBe(3);
  });

  it("enforces volume minimum", () => {
    const below = lotsToValidatedBrokerVolume({
      lots: 0.005,
      ...PEPPERSTONE_DEMO_XAUUSD_LOTS
    });
    expect(below.ok).toBe(false);
    expect(below.orderVolumeUnits).toBeNull();
    expect(below.rejectionReason).toMatch(/MINIMUM/);
  });

  it("enforces volume step", () => {
    const odd = lotsToValidatedBrokerVolume({
      lots: 0.019,
      minLots: 0.01,
      maxLots: 100,
      stepLots: 0.01
    });
    expect(odd.ok).toBe(true);
    expect(odd.roundedLots).toBe(0.01);
    expect(odd.orderVolumeUnits).toBe(1);
  });

  it("rejects invalid metadata instead of falling back to ×100", () => {
    const bad = lotsToValidatedBrokerVolume({
      lots: 0.01,
      minLots: 0,
      maxLots: 100,
      stepLots: 0.01
    });
    expect(bad.ok).toBe(false);
    expect(bad.rejectionReason).toBe("VOLUME_METADATA_INVALID");
  });
});

describe("autotrade safety patch — news / Live activation", () => {
  it("reports economic calendar provider NONE clearly", () => {
    expect(loadNewsProviderKind({})).toBe("NONE");
    const status = evaluateNewsGuard(
      { mode: "HIGH", minutesBefore: 15, minutesAfter: 15 },
      new Date("2026-08-08T12:00:00.000Z"),
      {}
    );
    expect(status.configured).toBe(false);
    expect(status.provider).toBe("NONE");
    expect(status.providerLabel).toBe("Not configured");
    expect(status.active).toBe(false);
  });

  it("Demo qualification news policy: not configured does not fabricate active block", () => {
    const status = evaluateNewsGuard(
      { mode: "HIGH", minutesBefore: 30, minutesAfter: 30 },
      new Date("2026-08-08T12:00:00.000Z"),
      { CTRADER_NEWS_PROVIDER: "none" }
    );
    expect(status.configured).toBe(false);
    expect(status.active).toBe(false);
  });

  it("Live activation blocked when news filter on and provider unavailable", () => {
    const gate = newsProtectionBlocksLiveActivation(
      { newsFilterEnabled: true, newsImpactMode: "HIGH" },
      {}
    );
    expect(gate.blocked).toBe(true);
    expect(gate.reason).toMatch(/Economic calendar protection must be configured/i);
  });

  it("Live activation not blocked by this gate when news filter off", () => {
    const gate = newsProtectionBlocksLiveActivation(
      { newsFilterEnabled: false, newsImpactMode: "HIGH" },
      {}
    );
    expect(gate.blocked).toBe(false);
  });

  it("Live execution remains hard locked", () => {
    expect(isCTraderLiveEnabled()).toBe(false);
  });
});
