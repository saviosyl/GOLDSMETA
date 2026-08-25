/**
 * Authoritative Demo margin snapshot + expected-margin gate.
 * Covers the 12 Aug MARGIN_UNAVAILABLE production blocker and fail-closed cases.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeAuthoritativeMarginSnapshot,
  evaluateMarginSafetyGate,
  moneyFromDigits,
  parseExpectedMarginEntries,
  selectSideExpectedMargin,
  MARGIN_SNAPSHOT_MAX_AGE_MS
} from "../../../../src/services/broker/ctrader/authoritativeMargin";
import { lotsToOrderVolumeUnits } from "../../../../src/services/broker/ctrader/volumeUnits";
import { isBrokerExecutionEnabled, isCTraderLiveEnabled } from "../../../../src/services/broker/ctrader/flags";

const NOW = Date.parse("2026-08-12T09:15:18.657Z");

describe("authoritative Demo margin", () => {
  beforeEach(() => {
    process.env.CTRADER_LIVE_ENABLED = "false";
    delete process.env.BROKER_EXECUTION_ENABLED;
  });

  it("H: moneyDigits conversion exact", () => {
    // moneyDigits=2 → 5000000 / 100 = 50000
    expect(moneyFromDigits(5_000_000, 2)).toBe(50_000);
    // moneyDigits=8 → 10053099944 / 1e8
    expect(moneyFromDigits(10_053_099_944, 8)).toBeCloseTo(100.53099944, 8);
    expect(moneyFromDigits(null, 2)).toBeNull();
  });

  it("A: broker flat + valid balance → freeMargin = balance", () => {
    const r = computeAuthoritativeMarginSnapshot({
      balance: 50_000,
      moneyDigits: 2,
      leverage: 30,
      openPositionCount: 0,
      reconcileOk: true,
      positionsUsedMargin: [],
      unrealisedRows: null,
      capturedAt: new Date(NOW).toISOString()
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.source).toBe("BROKER_FLAT");
    expect(r.snapshot.usedMargin).toBe(0);
    expect(r.snapshot.unrealisedNetPnl).toBe(0);
    expect(r.snapshot.equity).toBe(50_000);
    expect(r.snapshot.freeMargin).toBe(50_000);
  });

  it("B: open position + usedMargin + unrealised loss → reduced freeMargin", () => {
    const r = computeAuthoritativeMarginSnapshot({
      balance: 50_000,
      moneyDigits: 2,
      leverage: 30,
      openPositionCount: 1,
      reconcileOk: true,
      positionsUsedMargin: [{ positionId: "p1", usedMargin: 2_000 }],
      unrealisedRows: [{ positionId: "p1", netUnrealisedPnl: -150.5 }],
      capturedAt: new Date(NOW).toISOString()
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.equity).toBeCloseTo(49_849.5, 5);
    expect(r.snapshot.usedMargin).toBe(2_000);
    expect(r.snapshot.freeMargin).toBeCloseTo(47_849.5, 5);
    expect(r.snapshot.source).toBe("BROKER_POSITIONS");
  });

  it("C: open position + unrealised profit → equity/freeMargin rise", () => {
    const r = computeAuthoritativeMarginSnapshot({
      balance: 50_000,
      moneyDigits: 2,
      leverage: 30,
      openPositionCount: 1,
      reconcileOk: true,
      positionsUsedMargin: [{ positionId: "p1", usedMargin: 1_500 }],
      unrealisedRows: [{ positionId: "p1", netUnrealisedPnl: 320 }],
      capturedAt: new Date(NOW).toISOString()
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.equity).toBe(50_320);
    expect(r.snapshot.freeMargin).toBe(48_820);
  });

  it("D: missing unrealised P/L when positions open → MARGIN_UNAVAILABLE", () => {
    const r = computeAuthoritativeMarginSnapshot({
      balance: 50_000,
      moneyDigits: 2,
      leverage: 30,
      openPositionCount: 1,
      reconcileOk: true,
      positionsUsedMargin: [{ positionId: "p1", usedMargin: 1_000 }],
      unrealisedRows: null
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("MARGIN_UNAVAILABLE");
  });

  it("E: missing usedMargin when positions open → MARGIN_UNAVAILABLE", () => {
    const r = computeAuthoritativeMarginSnapshot({
      balance: 50_000,
      moneyDigits: 2,
      leverage: 30,
      openPositionCount: 1,
      reconcileOk: true,
      positionsUsedMargin: [{ positionId: "p1", usedMargin: null }],
      unrealisedRows: [{ positionId: "p1", netUnrealisedPnl: 10 }]
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("MARGIN_UNAVAILABLE");
  });

  it("does NOT invent freeMargin=balance when reconcile unknown", () => {
    const r = computeAuthoritativeMarginSnapshot({
      balance: 50_000,
      moneyDigits: 2,
      leverage: 30,
      openPositionCount: 0,
      reconcileOk: false,
      positionsUsedMargin: [],
      unrealisedRows: null
    });
    expect(r.ok).toBe(false);
  });

  it("I: BUY selects buyMargin", () => {
    const quotes = parseExpectedMarginEntries({
      moneyDigits: 2,
      margins: [{ volume: 1700, buyMargin: 250_000, sellMargin: 260_000 }]
    });
    expect(quotes[0]!.buyMargin).toBe(2_500);
    expect(selectSideExpectedMargin({
      side: "BUY",
      protocolVolume: 1700,
      quotes
    })).toBe(2_500);
  });

  it("J: SELL selects sellMargin", () => {
    const quotes = parseExpectedMarginEntries({
      moneyDigits: 2,
      margins: [{ volume: 1700, buyMargin: 250_000, sellMargin: 260_000 }]
    });
    expect(selectSideExpectedMargin({
      side: "SELL",
      protocolVolume: 1700,
      quotes
    })).toBe(2_600);
  });

  it("F: expected-margin missing → EXPECTED_MARGIN_UNAVAILABLE", () => {
    const snap = computeAuthoritativeMarginSnapshot({
      balance: 50_000,
      moneyDigits: 2,
      leverage: 30,
      openPositionCount: 0,
      reconcileOk: true,
      positionsUsedMargin: [],
      unrealisedRows: null,
      capturedAt: new Date(NOW).toISOString()
    });
    expect(snap.ok).toBe(true);
    if (!snap.ok) return;
    const gate = evaluateMarginSafetyGate({
      snapshot: snap.snapshot,
      expectedMargin: null,
      expectedMarginOk: false,
      nowMs: NOW + 100
    });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.reason).toBe("EXPECTED_MARGIN_UNAVAILABLE");
  });

  it("G: expected margin > freeMargin → RISK_SIZE_EXCEEDS_MARGIN", () => {
    const snap = computeAuthoritativeMarginSnapshot({
      balance: 1_000,
      moneyDigits: 2,
      leverage: 30,
      openPositionCount: 0,
      reconcileOk: true,
      positionsUsedMargin: [],
      unrealisedRows: null,
      capturedAt: new Date(NOW).toISOString()
    });
    expect(snap.ok).toBe(true);
    if (!snap.ok) return;
    const gate = evaluateMarginSafetyGate({
      snapshot: snap.snapshot,
      expectedMargin: 2_500,
      expectedMarginOk: true,
      nowMs: NOW + 100
    });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.reason).toBe("RISK_SIZE_EXCEEDS_MARGIN");
  });

  it("K: stale margin snapshot → ZERO submit reason", () => {
    const snap = computeAuthoritativeMarginSnapshot({
      balance: 50_000,
      moneyDigits: 2,
      leverage: 30,
      openPositionCount: 0,
      reconcileOk: true,
      positionsUsedMargin: [],
      unrealisedRows: null,
      capturedAt: new Date(NOW).toISOString()
    });
    expect(snap.ok).toBe(true);
    if (!snap.ok) return;
    const gate = evaluateMarginSafetyGate({
      snapshot: snap.snapshot,
      expectedMargin: 100,
      expectedMarginOk: true,
      nowMs: NOW + MARGIN_SNAPSHOT_MAX_AGE_MS + 1
    });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.reason).toBe("MARGIN_SNAPSHOT_STALE");
  });

  it("L: Live account → LIVE_ACCOUNT_FORBIDDEN", () => {
    const snap = computeAuthoritativeMarginSnapshot({
      balance: 50_000,
      moneyDigits: 2,
      leverage: 30,
      openPositionCount: 0,
      reconcileOk: true,
      positionsUsedMargin: [],
      unrealisedRows: null,
      capturedAt: new Date(NOW).toISOString()
    });
    expect(snap.ok).toBe(true);
    if (!snap.ok) return;
    const gate = evaluateMarginSafetyGate({
      snapshot: snap.snapshot,
      expectedMargin: 100,
      expectedMarginOk: true,
      nowMs: NOW + 10,
      selectedAccountIsLive: true
    });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.reason).toBe("LIVE_ACCOUNT_FORBIDDEN");
  });

  it("Live hard-lock flags remain false", () => {
    expect(isCTraderLiveEnabled()).toBe(false);
    expect(isBrokerExecutionEnabled()).toBe(false);
  });

  /**
   * Regression: 12 Aug blocker ev_mspvivi9_72b2dc
   * ProtoOATrader had balance but no freeMargin field.
   * Broker flat + expected margin OK → gate passes (MARGIN_UNAVAILABLE must NOT fire).
   */
  it("12 Aug regression: missing ProtoOATrader.freeMargin must NOT block flat account", () => {
    // Diagnostics-style account: balance present, freeMargin null (schema gap).
    const diagnosticsFreeMargin: number | null = null;
    expect(diagnosticsFreeMargin).toBeNull();

    expect(lotsToOrderVolumeUnits(17)).toBe(1700);

    // Authoritative flat snapshot + expected margin below free → pass.
    const snap = computeAuthoritativeMarginSnapshot({
      balance: 50_000,
      moneyDigits: 2,
      leverage: 30,
      openPositionCount: 0,
      reconcileOk: true,
      positionsUsedMargin: [],
      unrealisedRows: null,
      capturedAt: new Date(NOW).toISOString()
    });
    expect(snap.ok).toBe(true);
    if (!snap.ok) return;

    // Expected margin for 17 lots XAU at 30:1 — well under €50k (mock authoritative).
    const expectedFor17 = 2_500;
    const gate = evaluateMarginSafetyGate({
      snapshot: snap.snapshot,
      expectedMargin: expectedFor17,
      expectedMarginOk: true,
      nowMs: NOW + 50
    });
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    expect(gate.freeMargin).toBe(50_000);
    expect(gate.expectedMargin).toBe(2_500);
    expect(gate.marginSource).toBe("BROKER_FLAT");
  });

  it("fresh flat + valid expected → gate ok (submit path prerequisite)", () => {
    const snap = computeAuthoritativeMarginSnapshot({
      balance: moneyFromDigits(5_000_000, 2),
      moneyDigits: 2,
      leverage: 30,
      openPositionCount: 0,
      reconcileOk: true,
      positionsUsedMargin: [],
      unrealisedRows: null,
      capturedAt: new Date(NOW).toISOString()
    });
    expect(snap.ok).toBe(true);
    if (!snap.ok) return;
    const gate = evaluateMarginSafetyGate({
      snapshot: snap.snapshot,
      expectedMargin: 100,
      expectedMarginOk: true,
      nowMs: NOW + 20
    });
    expect(gate.ok).toBe(true);
  });
});

describe("mock Open API margin methods", () => {
  it("BUY/SELL expected margin selection via mock client", async () => {
    const { createMockOpenApiClient } = await import(
      "../../../../src/services/broker/ctrader/openApiClient"
    );
    const api = createMockOpenApiClient({
      snapshot: {
        balance: 50_000,
        equity: 50_000,
        freeMargin: 50_000,
        usedMargin: 0,
        currency: "EUR",
        leverage: 30
      },
      expectedBuyMargin: 2_500,
      expectedSellMargin: 2_600
    });
    const snap = await api.fetchAuthoritativeDemoMarginSnapshot!({
      accessToken: "t",
      clientId: "c",
      clientSecret: "s",
      ctidTraderAccountId: "48014710"
    });
    expect(snap.ok).toBe(true);
    const buy = await api.fetchDemoExpectedMargin!({
      accessToken: "t",
      clientId: "c",
      clientSecret: "s",
      ctidTraderAccountId: "48014710",
      symbolId: "41",
      volume: 1700,
      side: "BUY"
    });
    expect(buy.ok).toBe(true);
    if (!buy.ok) return;
    expect(buy.expectedMargin).toBe(2_500);
    const sell = await api.fetchDemoExpectedMargin!({
      accessToken: "t",
      clientId: "c",
      clientSecret: "s",
      ctidTraderAccountId: "48014710",
      symbolId: "41",
      volume: 1700,
      side: "SELL"
    });
    expect(sell.ok).toBe(true);
    if (!sell.ok) return;
    expect(sell.expectedMargin).toBe(2_600);
  });
});
