/**
 * Safety regression: projected daily-risk, entry=0, maxOpen, volume contract,
 * config invalid, broker/local mismatch, lease crash-recovery.
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
  evaluateGoldHunterLeaseOrphanRelease,
  listGoldHunterMaxOpenLeaseHolders,
  reconcileGoldHunterMaxOpenLeaseOrphans,
  reserveGoldHunterMaxOpenSlot,
  resetGoldHunterMaxOpenLeaseForTests
} from "../../../src/services/goldHunterAdmin/maxOpenLease";
import {
  countsTowardGoldHunterMaxOpen,
  resetGoldHunterTradeMemory,
  upsertGoldHunterDemoTrade
} from "../../../src/services/goldHunterAdmin/tradeStore";
import {
  registerGoldHunterOpenPositionForOwner,
  resetGoldHunterPositionManagerForTests,
  tickGoldHunterPositionManager,
  restoreGoldHunterPositionManager
} from "../../../src/services/goldHunterAdmin/demoPositionManager";
import { assertGoldHunterDemoOnlyEnvironment } from "../../../src/services/goldHunterAdmin/orderGates";
import {
  breakDownCTraderVolumeContract,
  PEPPERSTONE_GH_DEMO_KNOWN_TRADE_RAW,
  PEPPERSTONE_XAUUSD_DEMO_PROTO_SYMBOL
} from "../../../src/services/goldHunterAdmin/volumeContract";
import { validateGoldHunterRiskConfig } from "../../../src/services/goldHunterAdmin/configValidation";
import {
  saveGoldHunterConfig,
  resetGoldHunterAdminMemory
} from "../../../src/services/goldHunterAdmin/configStore";
import {
  GH_ADMIN_DEFAULT_CONFIG,
  GH_ADMIN_STRATEGY_ID,
  type GoldHunterDemoTrade
} from "../../../src/services/goldHunterAdmin/types";
import {
  resetGoldHunterSignalClaimsForTests,
  type GoldHunterSignalClaim
} from "../../../src/services/goldHunterAdmin/signalClaimStore";
import { lotsToOrderVolumeUnits } from "../../../src/services/broker/ctrader/volumeUnits";

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
    // Historical field name — stores trading units / XAU oz under Pepperstone mapping,
    // NOT conventional 100-oz lots. See volume contract tests.
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
  resetGoldHunterAdminMemory();
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
      brokerOpenGoldHunterPositions: [],
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
      brokerOpenGoldHunterPositions: [],
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
      brokerOpenGoldHunterPositions: [],
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
      brokerOpenGoldHunterPositions: [],
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
      brokerOpenGoldHunterPositions: [],
      proposedTradeRiskEur: 10
    });
    expect(snap.allowed).toBe(false);
    expect(snap.blocker).toBe("WAIT — DAILY RISK UNKNOWN");
  });
});

describe("Fail-closed config validation", () => {
  it("dailyLossLimitPct=NaN → BLOCK CONFIG INVALID", () => {
    const snap = buildGoldHunterProjectedDailyRiskSnapshot({
      config: cfg({ dailyLossLimitPct: Number.NaN }),
      trades: [],
      positionsReadOk: true,
      brokerOpenGoldHunterPositions: [],
      proposedTradeRiskEur: 10
    });
    expect(snap.allowed).toBe(false);
    expect(snap.blocker).toBe("WAIT — CONFIG INVALID");
    expect(validateGoldHunterRiskConfig(cfg({ dailyLossLimitPct: Number.NaN })).ok).toBe(
      false
    );
  });

  it("dailyLossLimitPct=Infinity → BLOCK", () => {
    const snap = buildGoldHunterProjectedDailyRiskSnapshot({
      config: cfg({ dailyLossLimitPct: Number.POSITIVE_INFINITY }),
      trades: [],
      positionsReadOk: true,
      brokerOpenGoldHunterPositions: [],
      proposedTradeRiskEur: 10
    });
    expect(snap.allowed).toBe(false);
    expect(snap.blocker).toBe("WAIT — CONFIG INVALID");
  });

  it("riskPerTradePct=NaN → BLOCK", () => {
    expect(
      buildGoldHunterProjectedDailyRiskSnapshot({
        config: cfg({ riskPerTradePct: Number.NaN }),
        trades: [],
        positionsReadOk: true,
        brokerOpenGoldHunterPositions: [],
        proposedTradeRiskEur: 10
      }).blocker
    ).toBe("WAIT — CONFIG INVALID");
  });

  it("allocatedCapitalEur=NaN → BLOCK", () => {
    expect(
      buildGoldHunterProjectedDailyRiskSnapshot({
        config: cfg({ allocatedCapitalEur: Number.NaN }),
        trades: [],
        positionsReadOk: true,
        brokerOpenGoldHunterPositions: [],
        proposedTradeRiskEur: 10
      }).blocker
    ).toBe("WAIT — CONFIG INVALID");
  });

  it("maxOpenTrades=NaN → BLOCK", () => {
    expect(
      buildGoldHunterProjectedDailyRiskSnapshot({
        config: cfg({ maxOpenTrades: Number.NaN }),
        trades: [],
        positionsReadOk: true,
        brokerOpenGoldHunterPositions: [],
        proposedTradeRiskEur: 10
      }).blocker
    ).toBe("WAIT — CONFIG INVALID");
  });

  it("maxOpenTrades=2 → BLOCK and save rejected", async () => {
    const snap = buildGoldHunterProjectedDailyRiskSnapshot({
      config: cfg({ maxOpenTrades: 2 }),
      trades: [],
      positionsReadOk: true,
      brokerOpenGoldHunterPositions: [],
      proposedTradeRiskEur: 10
    });
    expect(snap.allowed).toBe(false);
    expect(snap.blocker).toBe("WAIT — CONFIG INVALID");
    await expect(
      saveGoldHunterConfig(OWNER, { maxOpenTrades: 2 }, OWNER)
    ).rejects.toMatchObject({ code: expect.stringContaining("maxOpenTrades") });
  });
});

describe("Broker / local mismatch", () => {
  it("C: broker open without matched local → WAIT — DAILY RISK UNKNOWN", () => {
    const snap = buildGoldHunterProjectedDailyRiskSnapshot({
      config: cfg(),
      trades: [],
      positionsReadOk: true,
      brokerOpenGoldHunterPositions: [
        {
          positionId: "54326887",
          label: "GH-D-orphan",
          comment: "GOLD_HUNTER",
          entryPrice: 4400
        }
      ],
      proposedTradeRiskEur: 10
    });
    expect(snap.allowed).toBe(false);
    expect(snap.authoritative).toBe(false);
    expect(snap.blocker).toBe("WAIT — DAILY RISK UNKNOWN");
    expect(snap.brokerOpenGoldHunterCount).toBe(1);
    expect(snap.matchedBrokerGoldHunterCount).toBe(0);
    expect(snap.unmatchedBrokerGoldHunterCount).toBe(1);
  });

  it("matched broker open with valid local blocks new entry (maxOpen=1)", () => {
    const open = trade({
      goldHunterTradeId: "GH-D-open1",
      brokerPositionId: "54326887",
      entry: 4401.2,
      status: "FILLED",
      result: "OPEN"
    });
    const snap = buildGoldHunterProjectedDailyRiskSnapshot({
      config: cfg(),
      trades: [open],
      positionsReadOk: true,
      brokerOpenGoldHunterPositions: [
        {
          positionId: "54326887",
          label: "GH-D-open1",
          comment: "GOLD_HUNTER",
          entryPrice: 4401.2
        }
      ],
      proposedTradeRiskEur: 10
    });
    expect(snap.matchedBrokerGoldHunterCount).toBe(1);
    expect(snap.unmatchedBrokerGoldHunterCount).toBe(0);
    expect(snap.allowed).toBe(false);
    expect(snap.blocker).toBe("WAIT — MAX OPEN TRADES");
  });

  it("broker position with unknown entry → unmatched / BLOCK", () => {
    const open = trade({
      goldHunterTradeId: "GH-D-bad",
      brokerPositionId: "99",
      entry: 0,
      status: "FILLED",
      result: "OPEN"
    });
    const snap = buildGoldHunterProjectedDailyRiskSnapshot({
      config: cfg(),
      trades: [open],
      positionsReadOk: true,
      brokerOpenGoldHunterPositions: [
        {
          positionId: "99",
          label: "GH-D-bad",
          comment: "GOLD_HUNTER",
          entryPrice: null
        }
      ],
      proposedTradeRiskEur: 10
    });
    expect(snap.allowed).toBe(false);
    expect(snap.blocker).toBe("WAIT — DAILY RISK UNKNOWN");
    expect(snap.unmatchedBrokerGoldHunterCount).toBe(1);
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

  it("D-concurrency: realized €35 + two €10 opportunities → one max; never €55", async () => {
    const closed = trade({
      goldHunterTradeId: "GH-D-loss35",
      status: "CLOSED",
      result: "LOSS",
      netPnlEur: -35,
      closeTs: "2026-08-17T08:00:00.000Z"
    });
    const snapA = buildGoldHunterProjectedDailyRiskSnapshot({
      config: cfg(),
      trades: [closed],
      positionsReadOk: true,
      brokerOpenGoldHunterPositions: [],
      proposedTradeRiskEur: 10,
      now: new Date("2026-08-17T09:00:00.000Z")
    });
    // Each alone fits (€45 ≤ €50) — concurrency must be gated by maxOpen lease.
    expect(snapA.projectedWorstCaseLossEur).toBe(45);
    expect(snapA.allowed).toBe(true);

    const [a, b] = await Promise.all([
      reserveGoldHunterMaxOpenSlot({
        ownerUid: OWNER,
        maxOpenTrades: 1,
        reservationId: "GH-D-opp1",
        knownOccupancy: 0
      }),
      reserveGoldHunterMaxOpenSlot({
        ownerUid: OWNER,
        maxOpenTrades: 1,
        reservationId: "GH-D-opp2",
        knownOccupancy: 0
      })
    ]);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    // Dual projected €35+10+10 = 55 must never both reserve.
    expect(35 + 10 + 10).toBe(55);
  });
});

describe("Max-open lease crash recovery", () => {
  it("1: crash before claim + broker zero → reconciliation may release", async () => {
    await reserveGoldHunterMaxOpenSlot({
      ownerUid: OWNER,
      maxOpenTrades: 1,
      reservationId: "GH-D-crash1",
      knownOccupancy: 0
    });
    expect(await listGoldHunterMaxOpenLeaseHolders(OWNER)).toEqual([
      "GH-D-crash1"
    ]);
    const result = await reconcileGoldHunterMaxOpenLeaseOrphans({
      ownerUid: OWNER,
      positionsReadOk: true,
      brokerGhPositionIds: [],
      trades: [],
      claims: []
    });
    expect(result.released).toEqual(["GH-D-crash1"]);
    expect(await listGoldHunterMaxOpenLeaseHolders(OWNER)).toEqual([]);
  });

  it("2: broker outcome unknown → lease MUST remain", async () => {
    await reserveGoldHunterMaxOpenSlot({
      ownerUid: OWNER,
      maxOpenTrades: 1,
      reservationId: "GH-D-unk",
      knownOccupancy: 0
    });
    const claim: GoldHunterSignalClaim = {
      signalId: "sig-unk",
      strategy: GH_ADMIN_STRATEGY_ID,
      environment: "DEMO",
      ownerUid: OWNER,
      state: "SUBMITTING",
      goldHunterTradeId: "GH-D-unk",
      clientOrderId: "gh_unk",
      brokerOrderId: null,
      brokerPositionId: null,
      errorCode: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      claimedAt: new Date().toISOString(),
      setup: "A",
      side: "BUY"
    };
    const result = await reconcileGoldHunterMaxOpenLeaseOrphans({
      ownerUid: OWNER,
      positionsReadOk: true,
      brokerGhPositionIds: [],
      trades: [],
      claims: [claim]
    });
    expect(result.released).toEqual([]);
    expect(result.retained[0]?.reason).toContain("claim_uncertain");
    expect(await listGoldHunterMaxOpenLeaseHolders(OWNER)).toEqual(["GH-D-unk"]);
  });

  it("3: broker position exists → lease MUST remain", async () => {
    await reserveGoldHunterMaxOpenSlot({
      ownerUid: OWNER,
      maxOpenTrades: 1,
      reservationId: "GH-D-pos",
      knownOccupancy: 0
    });
    const decision = evaluateGoldHunterLeaseOrphanRelease({
      reservationId: "GH-D-pos",
      positionsReadOk: true,
      brokerGhPositionIds: ["54326887"],
      trades: [],
      claims: []
    });
    expect(decision.mayRelease).toBe(false);
    expect(decision.reason).toBe("broker_gh_position_exists");
  });

  it("4: lease cleanup broker read fails → lease MUST remain", async () => {
    await reserveGoldHunterMaxOpenSlot({
      ownerUid: OWNER,
      maxOpenTrades: 1,
      reservationId: "GH-D-readfail",
      knownOccupancy: 0
    });
    const result = await reconcileGoldHunterMaxOpenLeaseOrphans({
      ownerUid: OWNER,
      positionsReadOk: false,
      brokerGhPositionIds: [],
      trades: [],
      claims: []
    });
    expect(result.released).toEqual([]);
    expect(result.brokerReadOk).toBe(false);
    expect(await listGoldHunterMaxOpenLeaseHolders(OWNER)).toEqual([
      "GH-D-readfail"
    ]);
  });
});

describe("Volume unit-contract (Pepperstone raw — no speculative retune)", () => {
  it("K: official Open API math + Pepperstone GH raw round-trip", () => {
    const sym = PEPPERSTONE_XAUUSD_DEMO_PROTO_SYMBOL;
    const raw = PEPPERSTONE_GH_DEMO_KNOWN_TRADE_RAW;

    expect(sym.lotSize).toBe(10000);
    expect(sym.minVolume).toBe(100);
    expect(sym.stepVolume).toBe(100);
    expect(sym.maxVolume).toBe(500000);
    expect(sym.measurementUnits).toBeNull();

    const open = breakDownCTraderVolumeContract({
      rawProtocolVolume: raw.rawNewOrderVolume,
      rawLotSize: sym.lotSize
    });

    // Official:
    // tradingUnits = rawProtocolVolume / 100
    // tradingUnitsPerConventionalLot = rawLotSize / 100
    // conventionalLots = tradingUnits / tradingUnitsPerConventionalLot
    expect(open.rawProtocolVolume).toBe(18);
    expect(open.tradingUnits).toBe(0.18);
    expect(open.rawLotSize).toBe(10000);
    expect(open.tradingUnitsPerConventionalLot).toBe(100);
    expect(open.conventionalLots).toBeCloseTo(0.0018, 10);
    expect(open.xauOuncesIfOneTradingUnitIsOneOz).toBe(0.18);

    // Intended economic XAU exposure (Pepperstone proven 1 trading unit ≈ 1 oz)
    expect(raw.intendedEconomicXauOz).toBe(0.18);
    expect(raw.rawDealFilledVolume).toBe(18);
    expect(raw.rawPositionTradeDataVolume).toBe(18);
    expect(raw.rawClosingDealClosedVolume).toBe(18);
    expect(raw.rawClosePositionVolume).toBe(raw.rawPositionTradeDataVolume);

    // Production helper used by GH close path: lotsToOrderVolumeUnits on the
    // *trading-unit* quantity (historically named lots) → raw 18.
    expect(lotsToOrderVolumeUnits(open.tradingUnits)).toBe(18);
    expect(lotsToOrderVolumeUnits(open.tradingUnits)).toBe(
      raw.rawClosePositionVolume
    );

    // Naming note: do NOT treat "protocol 18 = 0.18 conventional lots".
    // 0.18 is trading units / XAU oz; conventional lots are 0.0018.
    // Propose later rename: filledVolumeLots → filledTradingUnits (or filledXauOz).
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
      "src/services/goldHunterAdmin/configValidation.ts",
      "src/services/goldHunterAdmin/volumeContract.ts",
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
    const fnStart = text.indexOf(
      "export async function attemptGoldHunterDemoExecution"
    );
    const body = text.slice(fnStart);
    const riskIdx = body.indexOf("evaluateGoldHunterPreClaimProjectedDailyRisk");
    const claimCallIdx = body.indexOf(
      "acquireGoldHunterSignalClaim({\n          ownerUid"
    );
    expect(riskIdx).toBeGreaterThan(0);
    expect(claimCallIdx).toBeGreaterThan(riskIdx);
  });
});
