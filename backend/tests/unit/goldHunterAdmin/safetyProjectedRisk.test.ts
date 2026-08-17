/**
 * Safety regression: projected daily-risk, entry=0, maxOpen, volume contract.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildGoldHunterProjectedDailyRiskSnapshot,
  isGoldHunterUnresolvedDailyRisk,
  resetGoldHunterPreClaimRiskHooksForTests,
  setGoldHunterPreClaimRiskHooksForTests
} from "../../../src/services/goldHunterAdmin/projectedDailyRisk";
import {
  isAuthoritativeGoldHunterFill,
  isValidGoldHunterEntryPrice
} from "../../../src/services/goldHunterAdmin/entryValidity";
import {
  reserveGoldHunterMaxOpenSlot,
  resetGoldHunterMaxOpenLeaseForTests
} from "../../../src/services/goldHunterAdmin/maxOpenLease";
import {
  countsTowardGoldHunterMaxOpen,
  resetGoldHunterTradeMemory,
  upsertGoldHunterDemoTrade,
  listGoldHunterDemoTrades
} from "../../../src/services/goldHunterAdmin/tradeStore";
import {
  registerGoldHunterOpenPositionForOwner,
  resetGoldHunterPositionManagerForTests,
  tickGoldHunterPositionManager,
  restoreGoldHunterPositionManager
} from "../../../src/services/goldHunterAdmin/demoPositionManager";
import { assertGoldHunterDemoOnlyEnvironment } from "../../../src/services/goldHunterAdmin/orderGates";
import {
  centsToLots,
  lotsToOrderVolumeUnits,
  CTRADER_VOLUME_CENTS_PER_LOT
} from "../../../src/services/broker/ctrader/volumeUnits";
import {
  GH_ADMIN_DEFAULT_CONFIG,
  GH_ADMIN_STRATEGY_ID,
  type GoldHunterDemoTrade
} from "../../../src/services/goldHunterAdmin/types";
import { getGoldHunterStrategySelector } from "../../../src/services/goldHunterAdmin/strategySelector";
import { resetGoldHunterSignalClaimsForTests } from "../../../src/services/goldHunterAdmin/signalClaimStore";

const OWNER = "gh-safety-owner";

function cfg(over: Partial<typeof GH_ADMIN_DEFAULT_CONFIG> = {}) {
  return {
    ...GH_ADMIN_DEFAULT_CONFIG,
    allocatedCapitalEur: 1000,
    riskPerTradePct: 1,
    dailyLossLimitPct: 5,
    maxOpenTrades: 1,
    demoAutoTradeEnabled: false,
    pauseNewEntries: true,
    emergencyStopActive: true,
    updatedAt: new Date().toISOString(),
    updatedBy: OWNER,
    ...over
  };
}

function trade(over: Partial<GoldHunterDemoTrade> = {}): GoldHunterDemoTrade {
  return {
    goldHunterTradeId: "GH-D-t1",
    strategy: GH_ADMIN_STRATEGY_ID,
    environment: "DEMO",
    setup: "A",
    side: "BUY",
    signalTs: "2026-08-17T07:00:00.000Z",
    orderTs: "2026-08-17T07:00:00.000Z",
    fillTs: "2026-08-17T07:00:01.000Z",
    closeTs: null,
    entry: 4400,
    exit: null,
    stop: 4399.45,
    entrySpread: 0.1,
    durationMs: null,
    mfe: 0,
    mae: 0,
    grossPnlEur: null,
    netPnlEur: null,
    result: "OPEN",
    exitReason: null,
    brokerOrderId: "o1",
    brokerPositionId: "p1",
    status: "FILLED",
    signalId: "GH-OPP-t1",
    clientOrderId: "gh_t1",
    filledVolumeLots: 0.18,
    ...over
  };
}

beforeEach(() => {
  resetGoldHunterTradeMemory();
  resetGoldHunterPreClaimRiskHooksForTests();
  resetGoldHunterMaxOpenLeaseForTests();
  resetGoldHunterPositionManagerForTests();
  resetGoldHunterSignalClaimsForTests();
});

describe("Projected daily-risk gate", () => {
  it("A: realized €41.70 + proposed €10 > €50 budget → BLOCK before claim", () => {
    const closed = trade({
      goldHunterTradeId: "GH-D-closed",
      status: "CLOSED",
      result: "LOSS",
      netPnlEur: -41.7,
      closeTs: "2026-08-17T08:00:00.000Z",
      brokerPositionId: "px"
    });
    const snap = buildGoldHunterProjectedDailyRiskSnapshot({
      config: cfg(),
      trades: [closed],
      positionsReadOk: true,
      brokerOpenGoldHunterCount: 0,
      proposedTradeRiskEur: 10,
      now: new Date("2026-08-17T09:00:00.000Z")
    });
    expect(snap.dailyLossBudgetEur).toBe(50);
    expect(snap.realizedLossConsumedEur).toBe(41.7);
    expect(snap.proposedTradeRiskEur).toBe(10);
    expect(snap.projectedWorstCaseLossEur).toBe(51.7);
    expect(snap.allowed).toBe(false);
    expect(snap.blocker).toBe("WAIT — PROJECTED DAILY LOSS LIMIT");
    expect(snap.authoritative).toBe(true);
  });

  it("B: realized €30 + proposed €10, no other exposure → eligible", () => {
    const closed = trade({
      goldHunterTradeId: "GH-D-closed2",
      status: "CLOSED",
      result: "LOSS",
      netPnlEur: -30,
      closeTs: "2026-08-17T08:00:00.000Z"
    });
    const snap = buildGoldHunterProjectedDailyRiskSnapshot({
      config: cfg(),
      trades: [closed],
      positionsReadOk: true,
      brokerOpenGoldHunterCount: 0,
      proposedTradeRiskEur: 10,
      now: new Date("2026-08-17T09:00:00.000Z")
    });
    expect(snap.projectedWorstCaseLossEur).toBe(40);
    expect(snap.allowed).toBe(true);
    expect(snap.blocker).toBeNull();
  });

  it("C: pending close unknown P/L → WAIT — DAILY RISK UNKNOWN", () => {
    const pending = trade({
      status: "CLOSE_ACCEPTED_PENDING_SETTLEMENT",
      result: null,
      netPnlEur: null,
      exitReason: "HARVEST_FADE"
    });
    expect(isGoldHunterUnresolvedDailyRisk(pending)).toBe(true);
    expect(countsTowardGoldHunterMaxOpen(pending)).toBe(false);
    const snap = buildGoldHunterProjectedDailyRiskSnapshot({
      config: cfg(),
      trades: [pending],
      positionsReadOk: true,
      brokerOpenGoldHunterCount: 0,
      proposedTradeRiskEur: 10
    });
    expect(snap.allowed).toBe(false);
    expect(snap.blocker).toBe("WAIT — DAILY RISK UNKNOWN");
    expect(snap.unresolvedSettlementCount).toBe(1);
  });

  it("D: broker risk snapshot failure → BLOCK", () => {
    const snap = buildGoldHunterProjectedDailyRiskSnapshot({
      config: cfg(),
      trades: [],
      positionsReadOk: false,
      brokerOpenGoldHunterCount: 0,
      proposedTradeRiskEur: 10
    });
    expect(snap.authoritative).toBe(false);
    expect(snap.allowed).toBe(false);
    expect(snap.blocker).toBe("WAIT — DAILY RISK UNKNOWN");
  });

  it("J: CLOSE_ACCEPTED releases max-open but unknown P/L blocks daily risk", () => {
    const pending = trade({
      status: "CLOSE_ACCEPTED_PENDING_SETTLEMENT",
      result: null,
      netPnlEur: null
    });
    expect(countsTowardGoldHunterMaxOpen(pending)).toBe(false);
    const snap = buildGoldHunterProjectedDailyRiskSnapshot({
      config: cfg(),
      trades: [pending],
      positionsReadOk: true,
      brokerOpenGoldHunterCount: 0,
      proposedTradeRiskEur: 10
    });
    expect(snap.allowed).toBe(false);
    expect(snap.blocker).toBe("WAIT — DAILY RISK UNKNOWN");
  });
});

describe("Entry validity", () => {
  it("E: entry=0 + position → no dynamic harvest/trail registration", async () => {
    expect(isValidGoldHunterEntryPrice(0)).toBe(false);
    expect(
      isAuthoritativeGoldHunterFill({
        fillPrice: 0,
        positionId: "54326887",
        filledVolumeLots: 0.18
      })
    ).toBe(false);

    await upsertGoldHunterDemoTrade(
      OWNER,
      trade({
        entry: 0,
        status: "PENDING_RECONCILIATION",
        result: null,
        errorCode: "ENTRY_PRICE_INVALID",
        dataQuality: "ENTRY_INVALID",
        mfe: 4405.5,
        mae: 0
      })
    );
    registerGoldHunterOpenPositionForOwner({
      ownerUid: OWNER,
      trade: trade({ entry: 0 }),
      bid: 4400,
      ask: 4400.1
    });
    // Must not register invalid entry into manager.
    const restored = await restoreGoldHunterPositionManager(OWNER);
    expect(restored.restored).toBe(0);

    const tick = await tickGoldHunterPositionManager({ ownerUid: OWNER });
    expect(tick.exitsAttempted).toBe(0);
    expect(tick.evaluated).toBe(0);
  });

  it("F: valid broker entry recovered → manager may start", async () => {
    const t = trade({ entry: 4397.45, status: "FILLED", result: "OPEN" });
    await upsertGoldHunterDemoTrade(OWNER, t);
    registerGoldHunterOpenPositionForOwner({
      ownerUid: OWNER,
      trade: t,
      bid: 4397.4,
      ask: 4397.5
    });
    const restored = await restoreGoldHunterPositionManager(OWNER);
    expect(restored.restored).toBe(1);
  });
});

describe("Max-open occupancy + concurrency", () => {
  it("H: ACCEPTED_PENDING_FILL occupies max-open", () => {
    expect(
      countsTowardGoldHunterMaxOpen(
        trade({ status: "ACCEPTED_PENDING_FILL", result: null, entry: null })
      )
    ).toBe(true);
  });

  it("I: PENDING_RECONCILIATION occupies max-open", () => {
    expect(
      countsTowardGoldHunterMaxOpen(
        trade({
          status: "PENDING_RECONCILIATION",
          result: null,
          exitReason: "HARVEST_FADE"
        })
      )
    ).toBe(true);
  });

  it("G: two concurrent reservations maxOpen=1 → exactly one wins", async () => {
    const [a, b] = await Promise.all([
      reserveGoldHunterMaxOpenSlot({
        ownerUid: OWNER,
        maxOpenTrades: 1,
        reservationId: "GH-D-a",
        knownOccupancy: 0
      }),
      reserveGoldHunterMaxOpenSlot({
        ownerUid: OWNER,
        maxOpenTrades: 1,
        reservationId: "GH-D-b",
        knownOccupancy: 0
      })
    ]);
    const wins = [a, b].filter((r) => r.ok);
    const losses = [a, b].filter((r) => !r.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
  });
});

describe("Volume unit-contract (audit — no speculative retune)", () => {
  it("K: economic 0.18 lot → protocol 18 → lots round-trip; close equals remaining", () => {
    // Today's risk budget €10 @ hardStop 0.55 implies ~0.18 lot economic size
    // when valuePerPointPerLot ≈ €100 (Pepperstone XAUUSD EUR).
    const economicLots = 0.18;
    const protocolVolume = lotsToOrderVolumeUnits(economicLots);
    expect(CTRADER_VOLUME_CENTS_PER_LOT).toBe(100);
    expect(protocolVolume).toBe(18);
    expect(centsToLots(protocolVolume)).toBe(0.18);

    // Close full remaining must equal broker remaining protocol volume exactly.
    const remainingProtocol = protocolVolume;
    const closeProtocol = lotsToOrderVolumeUnits(centsToLots(remainingProtocol));
    expect(closeProtocol).toBe(remainingProtocol);

    // Display note: if a deal reports closedVolume=1800 → centsToLots=18 lots,
    // that is NOT the same as protocol 18 (=0.18 lots). Do not silently retune
    // production converters without end-to-end broker proof.
    const ifMisreadAs1800 = centsToLots(1800);
    expect(ifMisreadAs1800).toBe(18);
    expect(ifMisreadAs1800).not.toBe(economicLots);
  });
});

describe("Isolation + Live refuse", () => {
  it("L: Live execution remains impossible", () => {
    expect(() => assertGoldHunterDemoOnlyEnvironment("LIVE")).toThrow();
  });

  it("M: FAST AutoTrade isolation unchanged for new safety modules", () => {
    for (const f of [
      "src/services/goldHunterAdmin/projectedDailyRisk.ts",
      "src/services/goldHunterAdmin/entryValidity.ts",
      "src/services/goldHunterAdmin/maxOpenLease.ts",
      "src/services/goldHunterAdmin/executionOrchestrator.ts",
      "src/services/goldHunterAdmin/demoPositionManager.ts"
    ]) {
      const text = readFileSync(resolve(process.cwd(), f), "utf8");
      expect(text).not.toMatch(/fastAutoTrade\/engine/);
      expect(text).not.toMatch(/createAutoTradeService/);
      expect(text).not.toMatch(/qualificationMachine/);
    }
  });

  it("orchestrator runs projected risk before claim", () => {
    const text = readFileSync(
      resolve(
        process.cwd(),
        "src/services/goldHunterAdmin/executionOrchestrator.ts"
      ),
      "utf8"
    );
    const fnStart = text.indexOf("export async function attemptGoldHunterDemoExecution");
    const body = text.slice(fnStart);
    const riskIdx = body.indexOf("evaluateGoldHunterPreClaimProjectedDailyRisk");
    const claimCallIdx = body.indexOf(
      "acquireGoldHunterSignalClaim({\n          ownerUid"
    );
    expect(riskIdx).toBeGreaterThan(0);
    expect(claimCallIdx).toBeGreaterThan(riskIdx);
  });
});
