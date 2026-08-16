import { beforeEach, describe, expect, it } from "vitest";
import {
  evaluateGoldHunterArmingReadiness,
  type GoldHunterAccountSnapshot
} from "../../../src/services/goldHunterAdmin/accountSnapshot";
import {
  assertGoldHunterDemoOnlyEnvironment,
  evaluateGoldHunterOrderGates,
  isGoldHunterSignalConsumed,
  markGoldHunterSignalConsumed,
  resetGoldHunterConsumedSignals
} from "../../../src/services/goldHunterAdmin/orderGates";
import { GH_ADMIN_DEFAULT_CONFIG } from "../../../src/services/goldHunterAdmin/types";

function demoSnap(
  patch: Partial<GoldHunterAccountSnapshot> = {}
): GoldHunterAccountSnapshot {
  return {
    provider: "cTrader",
    environment: "DEMO",
    authState: "AUTHORISED",
    authorised: true,
    accountMasked: "****1234",
    brokerName: "Pepperstone",
    currency: "EUR",
    balance: 50_000,
    equity: 49_985.2,
    marginUsed: 120,
    freeMargin: 49_865.2,
    openPositionCount: 0,
    capturedAt: new Date().toISOString(),
    ageMs: 1000,
    source: "AUTHORITATIVE_DEMO",
    notes: [],
    demoOrderSubmissionEnabled: true,
    validForRisk: true,
    ...patch
  };
}

describe("Gold Hunter account snapshot arming", () => {
  it("arms only when DEMO + valid snapshot + selector connected", () => {
    const ok = evaluateGoldHunterArmingReadiness({
      snapshot: demoSnap(),
      allocatedCapitalEur: 2000,
      riskPerTradePct: 1,
      strategySelectorConnected: true,
      protectionGeometryConnected: true
    });
    expect(ok.ok).toBe(true);

    const noSelector = evaluateGoldHunterArmingReadiness({
      snapshot: demoSnap(),
      allocatedCapitalEur: 2000,
      riskPerTradePct: 1,
      strategySelectorConnected: false,
      protectionGeometryConnected: true
    });
    expect(noSelector.ok).toBe(false);
    expect(noSelector.blockers).toContain("STRATEGY_SELECTOR_NOT_CONNECTED");
  });

  it("refuses Live / unknown / invalid snapshot", () => {
    expect(
      evaluateGoldHunterArmingReadiness({
        snapshot: demoSnap({ environment: "LIVE", authState: "LIVE_REFUSED", validForRisk: false }),
        allocatedCapitalEur: 2000,
        riskPerTradePct: 1,
        strategySelectorConnected: true,
      protectionGeometryConnected: true
      }).blockers
    ).toContain("LIVE_OR_NON_DEMO_ACCOUNT");

    expect(
      evaluateGoldHunterArmingReadiness({
        snapshot: demoSnap({ environment: null, validForRisk: false }),
        allocatedCapitalEur: 2000,
        riskPerTradePct: 1,
        strategySelectorConnected: true,
      protectionGeometryConnected: true
      }).blockers
    ).toContain("ACCOUNT_ENVIRONMENT_UNKNOWN");

    expect(
      evaluateGoldHunterArmingReadiness({
        snapshot: demoSnap({ balance: null, validForRisk: false }),
        allocatedCapitalEur: 2000,
        riskPerTradePct: 1,
        strategySelectorConnected: true,
      protectionGeometryConnected: true
      }).blockers
    ).toContain("ACCOUNT_SNAPSHOT_INVALID");
  });

  it("does not invent equity — missing optional margin stays null-safe", () => {
    const snap = demoSnap({ equity: null, marginUsed: null, freeMargin: null });
    expect(snap.balance).toBe(50_000);
    expect(snap.equity).toBeNull();
    expect(snap.marginUsed).toBeNull();
  });
});

describe("Gold Hunter market reopen + duplicate order gates", () => {
  beforeEach(() => {
    resetGoldHunterConsumedSignals();
  });

  const baseConfig = {
    ...GH_ADMIN_DEFAULT_CONFIG,
    demoAutoTradeEnabled: true,
    mode: "DEMO_AUTO" as const,
    updatedAt: new Date().toISOString(),
    updatedBy: "test"
  };

  it("CLOSED + armed + no setup → zero order (WAIT)", () => {
    const g = evaluateGoldHunterOrderGates({
      config: baseConfig,
      brokerEnvironment: "DEMO",
      brokerConnected: true,
      accountSnapshotValid: true,
      marketOpen: false,
      feedFresh: false,
      depthValid: true,
      spreadOk: true,
      capitalOk: true,
      dailyLossOk: true,
      openTradeCount: 0,
      signalPresent: false,
      signalConsumed: false,
      isAdmin: true
    });
    expect(g.ok).toBe(false);
    expect(g.blockers).toContain("WAIT — MARKET CLOSED");
    expect(g.blockers).toContain("WAIT — NO SETUP SELECTED");
    expect(g.liveExecutionEnabled).toBe(false);
  });

  it("OPEN + fresh + no selected setup → WAIT — NO SETUP SELECTED", () => {
    const g = evaluateGoldHunterOrderGates({
      config: baseConfig,
      brokerEnvironment: "DEMO",
      brokerConnected: true,
      accountSnapshotValid: true,
      marketOpen: true,
      feedFresh: true,
      depthValid: true,
      spreadOk: true,
      capitalOk: true,
      dailyLossOk: true,
      openTradeCount: 0,
      signalPresent: false,
      signalConsumed: false,
      isAdmin: true
    });
    expect(g.ok).toBe(false);
    expect(g.blockers).toEqual(["WAIT — NO SETUP SELECTED"]);
  });

  it("OPEN + selected candidate + all gates → exactly one allow; duplicate blocked", () => {
    const signalId = "GH-SIG-1";
    const first = evaluateGoldHunterOrderGates({
      config: baseConfig,
      brokerEnvironment: "DEMO",
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
      signalConsumed: isGoldHunterSignalConsumed(signalId),
      isAdmin: true
    });
    expect(first.ok).toBe(true);
    markGoldHunterSignalConsumed(signalId);

    const second = evaluateGoldHunterOrderGates({
      config: baseConfig,
      brokerEnvironment: "DEMO",
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
      signalConsumed: isGoldHunterSignalConsumed(signalId),
      isAdmin: true
    });
    expect(second.ok).toBe(false);
    expect(second.blockers).toContain("WAIT — DUPLICATE SIGNAL");
  });

  it("unknown / Live environment refused", () => {
    expect(() => assertGoldHunterDemoOnlyEnvironment(null)).toThrow(
      /ENVIRONMENT_UNKNOWN|GOLD_HUNTER/
    );
    expect(() => assertGoldHunterDemoOnlyEnvironment("LIVE")).toThrow(
      /LIVE_ACCOUNT_REFUSED|GOLD_HUNTER/
    );
    expect(
      evaluateGoldHunterOrderGates({
        config: baseConfig,
        brokerEnvironment: null,
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
      }).blockers
    ).toContain("WAIT — ACCOUNT ENVIRONMENT UNKNOWN");
  });

  it("invalid account snapshot blocks orders", () => {
    expect(
      evaluateGoldHunterOrderGates({
        config: baseConfig,
        brokerEnvironment: "DEMO",
        brokerConnected: true,
        accountSnapshotValid: false,
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
      }).blockers
    ).toContain("WAIT — ACCOUNT SNAPSHOT INVALID");
  });
});
