/**
 * GH OPEN fill monotonicity — GH-D-6789089c regression.
 * A valid broker fill must not be cleared by a stale OPEN/reconciliation writer.
 * Does not retune A/B/C, PM, Loss, risk, or sizing.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  applyBrokerSettledClose,
  resetGoldHunterCloseSettlementHooksForTests
} from "../../../src/services/goldHunterAdmin/closeSettlement";
import {
  getGoldHunterOpenPositionDiagnostics,
  registerGoldHunterOpenPositionForOwner,
  resetGoldHunterPositionManagerForTests
} from "../../../src/services/goldHunterAdmin/demoPositionManager";
import { recoverGoldHunterOpenEntryImmediate } from "../../../src/services/goldHunterAdmin/immediateOpenEntryRecovery";
import { reconcileGoldHunterPendingEntries } from "../../../src/services/goldHunterAdmin/reconciliationRuntime";
import {
  countsTowardGoldHunterMaxOpen,
  getGoldHunterDemoTrade,
  hasAuthoritativeGoldHunterOpenFill,
  listGoldHunterDemoTrades,
  mergeClosedGoldHunterTrade,
  mergeOpenGoldHunterAuthoritativeFill,
  resetGoldHunterTradeMemory,
  upsertGoldHunterDemoTrade
} from "../../../src/services/goldHunterAdmin/tradeStore";
import {
  GOLD_HUNTER_BRAIN_VERSION,
  GOLD_HUNTER_FAST_STRATEGY_VERSION,
  GOLD_HUNTER_SOFTWARE_REVISION,
  GOLD_HUNTER_SOFTWARE_REVISION_AT,
  getFrozenGhFastIdentity,
  hashGhFastConfig,
  frozenGhFastSoakConfig
} from "../../../src/services/goldHunterAdmin/abc";
import {
  GH_ADMIN_DEFAULT_CONFIG,
  GH_ADMIN_EXECUTION_MODE,
  type GoldHunterDemoTrade
} from "../../../src/services/goldHunterAdmin/types";
import { goldHunterFrozenInitialRiskPrice } from "../../../src/services/goldHunterAdmin/entryRepair";

const OWNER = "owner-open-fill-monotonic";
const HARD = goldHunterFrozenInitialRiskPrice();
const TRADE_ID = "GH-D-6789089c";
const POSITION_ID = "54814722";
const AUTHORITATIVE_ENTRY = 4522.2;
const AUTHORITATIVE_FILL_TS = "2026-08-20T20:16:06.966Z";
const SETTLEMENT_TS = "2026-08-20T20:16:57.853Z";

function pendingStale(
  over: Partial<GoldHunterDemoTrade> = {}
): GoldHunterDemoTrade {
  return {
    goldHunterTradeId: TRADE_ID,
    strategy: "GOLD_HUNTER",
    environment: "DEMO",
    setup: "A",
    side: "BUY",
    signalTs: "2026-08-20T20:16:05.000Z",
    orderTs: "2026-08-20T20:16:05.000Z",
    fillTs: null,
    closeTs: null,
    entry: null,
    exit: null,
    stop: AUTHORITATIVE_ENTRY - HARD,
    entrySpread: null,
    durationMs: null,
    mfe: null,
    mae: null,
    grossPnlEur: null,
    netPnlEur: null,
    result: null,
    exitReason: null,
    brokerOrderId: "70612001",
    brokerPositionId: POSITION_ID,
    status: "PENDING_RECONCILIATION",
    signalId: "GH-OPP-6789089c",
    clientOrderId: "gh_client_6789089c",
    dataQuality: "ENTRY_INVALID",
    errorCode: "ENTRY_PRICE_INVALID",
    entryRecoverySource: null,
    initialRiskPrice: HARD,
    filledVolumeLots: 9,
    ...over
  };
}

function filledAuthoritative(
  over: Partial<GoldHunterDemoTrade> = {}
): GoldHunterDemoTrade {
  return {
    ...pendingStale(),
    status: "FILLED",
    result: "OPEN",
    entry: AUTHORITATIVE_ENTRY,
    fillTs: AUTHORITATIVE_FILL_TS,
    dataQuality: null,
    errorCode: null,
    entryRecoverySource: "BROKER_POSITION_RECONCILIATION",
    ...over
  };
}

async function persistFilled(): Promise<GoldHunterDemoTrade> {
  const filled = filledAuthoritative();
  await upsertGoldHunterDemoTrade(OWNER, filled);
  registerGoldHunterOpenPositionForOwner({
    ownerUid: OWNER,
    trade: filled,
    bid: AUTHORITATIVE_ENTRY,
    ask: AUTHORITATIVE_ENTRY + 0.05
  });
  return filled;
}

describe("GH OPEN fill monotonicity (GH-D-6789089c)", () => {
  beforeEach(() => {
    resetGoldHunterTradeMemory();
    resetGoldHunterPositionManagerForTests();
    resetGoldHunterCloseSettlementHooksForTests();
  });

  it("A–F. stale reconciliation payload cannot clear a proven OPEN fill", async () => {
    const original = await persistFilled();
    expect(hasAuthoritativeGoldHunterOpenFill(original)).toBe(true);

    const stale = pendingStale({
      openEntryRecoveryLastReason: "TIMEOUT",
      openEntryRecoveryLastAt: "2026-08-20T20:16:16.164Z",
      openEntryRecoveryAttempts: 4,
      entry: null,
      fillTs: null
    });
    const persisted = await upsertGoldHunterDemoTrade(OWNER, stale);
    const row = await getGoldHunterDemoTrade(OWNER, TRADE_ID);

    expect(persisted.trade.entry).toBe(AUTHORITATIVE_ENTRY);
    expect(persisted.trade.fillTs).toBe(AUTHORITATIVE_FILL_TS);
    expect(persisted.trade.initialRiskPrice).toBe(HARD);
    expect(persisted.trade.brokerPositionId).toBe(POSITION_ID);
    expect(persisted.trade.status).toBe("FILLED");
    expect(persisted.trade.result).toBe("OPEN");
    expect(persisted.trade.dataQuality ?? null).toBeNull();
    expect(persisted.trade.errorCode ?? null).toBeNull();
    expect(row?.entry).toBe(AUTHORITATIVE_ENTRY);
    expect(row?.fillTs).toBe(AUTHORITATIVE_FILL_TS);
    expect(row?.initialRiskPrice).toBe(HARD);
    expect(row?.status).toBe("FILLED");
    expect(row?.entryRecoverySource).toBe("BROKER_POSITION_RECONCILIATION");
  });

  it("duplicate/stale OPEN writer cannot erase entry or fillTs", async () => {
    await persistFilled();
    const staleOpen: GoldHunterDemoTrade = {
      ...filledAuthoritative(),
      entry: 0,
      fillTs: null,
      initialRiskPrice: null,
      dataQuality: "ENTRY_INVALID",
      errorCode: "ENTRY_PRICE_INVALID",
      entryRecoverySource: null
    };
    const persisted = await upsertGoldHunterDemoTrade(OWNER, staleOpen);
    expect(persisted.trade.entry).toBe(AUTHORITATIVE_ENTRY);
    expect(persisted.trade.fillTs).toBe(AUTHORITATIVE_FILL_TS);
    expect(persisted.trade.initialRiskPrice).toBe(HARD);
    expect(persisted.trade.status).toBe("FILLED");
    expect(persisted.trade.dataQuality ?? null).toBeNull();
  });

  it("supervisor-style TIMEOUT persist of in-memory PENDING cannot wipe FILLED", async () => {
    await persistFilled();
    const supervisorHeldPending = pendingStale({
      openEntryRecoveryStartedAt: "2026-08-20T20:16:06.162Z",
      openEntryRecoveryLastReason: "TIMEOUT",
      openEntryRecoveryLastAt: "2026-08-20T20:16:16.164Z",
      openEntryRecoveryAttempts: 5
    });
    await upsertGoldHunterDemoTrade(OWNER, supervisorHeldPending);
    const row = await getGoldHunterDemoTrade(OWNER, TRADE_ID);
    expect(row?.status).toBe("FILLED");
    expect(row?.entry).toBe(AUTHORITATIVE_ENTRY);
    expect(row?.fillTs).toBe(AUTHORITATIVE_FILL_TS);
    expect(row?.openEntryRecoveryLastReason).toBe("TIMEOUT");
    expect(row?.openEntryRecoveryAttempts).toBe(5);
  });

  it("reconcile invalid-entry payload cannot wipe an already-valid fill", async () => {
    await persistFilled();
    await upsertGoldHunterDemoTrade(
      OWNER,
      pendingStale({
        status: "PENDING_RECONCILIATION",
        dataQuality: "ENTRY_INVALID",
        errorCode: "ENTRY_PRICE_INVALID",
        entry: null,
        mfe: null,
        mae: null
      })
    );
    const row = await getGoldHunterDemoTrade(OWNER, TRADE_ID);
    expect(row?.entry).toBe(AUTHORITATIVE_ENTRY);
    expect(row?.fillTs).toBe(AUTHORITATIVE_FILL_TS);
    expect(row?.status).toBe("FILLED");
    expect(row?.result).toBe("OPEN");
  });

  it("settlement preserves authoritative entry/fillTs/initialRiskPrice", async () => {
    await persistFilled();
    const settled = applyBrokerSettledClose({
      trade: filledAuthoritative(),
      deal: {
        dealId: "61012099",
        orderId: "70612001",
        positionId: POSITION_ID,
        closePrice: 4521.9,
        closedAt: SETTLEMENT_TS,
        grossPnl: -2.7,
        commission: -0.54,
        swap: 0,
        netPnl: -3.24,
        closedVolumeLots: 9,
        entryPrice: AUTHORITATIVE_ENTRY
      },
      exitReason: "SAFETY_STOP"
    });
    expect(settled.entry).toBe(AUTHORITATIVE_ENTRY);
    expect(settled.fillTs).toBe(AUTHORITATIVE_FILL_TS);
    expect(settled.initialRiskPrice).toBe(HARD);
    expect(settled.status).toBe("CLOSED");

    const staleSettlement: GoldHunterDemoTrade = {
      ...settled,
      fillTs: SETTLEMENT_TS,
      entry: null,
      initialRiskPrice: null
    };
    const persisted = await upsertGoldHunterDemoTrade(OWNER, staleSettlement);
    expect(persisted.trade.entry).toBe(AUTHORITATIVE_ENTRY);
    expect(persisted.trade.fillTs).toBe(AUTHORITATIVE_FILL_TS);
    expect(persisted.trade.initialRiskPrice).toBe(HARD);
    expect(persisted.trade.status).toBe("CLOSED");
    expect(persisted.trade.exit).toBe(4521.9);
    expect(persisted.trade.netPnlEur).toBe(-3.24);
  });

  it("CLOSED monotonicity still rejects non-CLOSED regression", async () => {
    const closed = applyBrokerSettledClose({
      trade: filledAuthoritative(),
      deal: {
        dealId: "61012099",
        orderId: "70612001",
        positionId: POSITION_ID,
        closePrice: 4521.9,
        closedAt: SETTLEMENT_TS,
        grossPnl: -2.7,
        commission: -0.54,
        swap: 0,
        netPnl: -3.24,
        closedVolumeLots: 9,
        entryPrice: AUTHORITATIVE_ENTRY
      }
    });
    await upsertGoldHunterDemoTrade(OWNER, closed);
    const regress = await upsertGoldHunterDemoTrade(
      OWNER,
      filledAuthoritative({ status: "FILLED", result: "OPEN", exit: null })
    );
    expect(regress.rejectedRegression).toBe(true);
    expect(regress.trade.status).toBe("CLOSED");
    expect(regress.trade.entry).toBe(AUTHORITATIVE_ENTRY);
    expect(regress.trade.fillTs).toBe(AUTHORITATIVE_FILL_TS);
    const merged = mergeClosedGoldHunterTrade(closed, pendingStale());
    expect(merged.status).toBe("CLOSED");
    expect(merged.entry).toBe(AUTHORITATIVE_ENTRY);
    expect(merged.fillTs).toBe(AUTHORITATIVE_FILL_TS);
  });

  it("entry recovery still works when entry was genuinely never known", async () => {
    const neverKnown = pendingStale({
      goldHunterTradeId: "GH-D-never-known"
    });
    await upsertGoldHunterDemoTrade(OWNER, neverKnown);
    const recovered = await recoverGoldHunterOpenEntryImmediate({
      ownerUid: OWNER,
      trade: neverKnown,
      timeoutMs: 80,
      pollMs: 20,
      listPositions: async () => [
        {
          positionId: POSITION_ID,
          side: "BUY",
          entryPrice: AUTHORITATIVE_ENTRY,
          volumeLots: 9,
          comment: "GOLD_HUNTER",
          label: "GH-D-never-known"
        } as never
      ]
    });
    expect(recovered.recovered).toBe(true);
    expect(recovered.trade.entry).toBe(AUTHORITATIVE_ENTRY);
    expect(recovered.trade.status).toBe("FILLED");
    expect(recovered.trade.fillTs).toBeTruthy();
    expect(recovered.trade.initialRiskPrice).toBe(HARD);
  });

  it("does not invent an entry when none was ever known", async () => {
    const neverKnown = pendingStale({
      goldHunterTradeId: "GH-D-still-unknown",
      brokerPositionId: POSITION_ID
    });
    await upsertGoldHunterDemoTrade(OWNER, neverKnown);
    await upsertGoldHunterDemoTrade(
      OWNER,
      pendingStale({
        goldHunterTradeId: "GH-D-still-unknown",
        entry: null,
        fillTs: null,
        openEntryRecoveryLastReason: "TIMEOUT"
      })
    );
    const row = await getGoldHunterDemoTrade(OWNER, "GH-D-still-unknown");
    expect(row?.entry).toBeNull();
    expect(row?.fillTs).toBeNull();
    expect(row?.status).toBe("PENDING_RECONCILIATION");
    expect(hasAuthoritativeGoldHunterOpenFill(row)).toBe(false);

    const merge = mergeOpenGoldHunterAuthoritativeFill(
      filledAuthoritative(),
      pendingStale({ entry: 0, fillTs: null })
    );
    expect(merge.entry).toBe(AUTHORITATIVE_ENTRY);
    expect(merge.fillTs).toBe(AUTHORITATIVE_FILL_TS);
  });

  it("pending reconcile can still recover a never-known entry from broker", async () => {
    await upsertGoldHunterDemoTrade(
      OWNER,
      pendingStale({ goldHunterTradeId: "GH-D-recon-recover" })
    );
    const r = await reconcileGoldHunterPendingEntries({
      ownerUid: OWNER,
      positionsReadOk: true,
      brokerPositions: [
        {
          positionId: POSITION_ID,
          side: "BUY",
          entryPrice: AUTHORITATIVE_ENTRY,
          volumeLots: 9,
          comment: "GOLD_HUNTER",
          label: "GH-D-recon-recover"
        }
      ]
    });
    expect(r.recoveredOpen).toBe(1);
    const row = await getGoldHunterDemoTrade(OWNER, "GH-D-recon-recover");
    expect(row?.entry).toBe(AUTHORITATIVE_ENTRY);
    expect(row?.status).toBe("FILLED");
    expect(row?.fillTs).toBeTruthy();
  });

  it("max one position unchanged after stale persist", async () => {
    await persistFilled();
    await upsertGoldHunterDemoTrade(OWNER, pendingStale());
    const open = await listGoldHunterDemoTrades(OWNER, { openOnly: true });
    expect(open).toHaveLength(1);
    expect(countsTowardGoldHunterMaxOpen(open[0]!)).toBe(true);
    expect(GH_ADMIN_DEFAULT_CONFIG.maxOpenTrades).toBe(1);
    expect(
      getGoldHunterOpenPositionDiagnostics(OWNER).filter(
        (p) => p.tradeId === TRADE_ID
      )
    ).toHaveLength(1);
  });

  it("Brain V6 and safety defaults are unchanged; software revision is recorded", () => {
    expect(GOLD_HUNTER_BRAIN_VERSION).toBe("GOLD_HUNTER_BRAIN_V6");
    expect(GOLD_HUNTER_FAST_STRATEGY_VERSION).toBe("GOLD_HUNTER_BRAIN_V6");
    expect(GOLD_HUNTER_SOFTWARE_REVISION).toBe(
      "GH_BRAIN_V6_PULSE_GUARD_CONTINUATION_2026.08.21-02"
    );
    expect(GOLD_HUNTER_SOFTWARE_REVISION_AT).toBe("2026-08-21T16:20:00Z");
    const id = getFrozenGhFastIdentity();
    expect(id.strategyVersion).toBe("GOLD_HUNTER_BRAIN_V6");
    expect(id.maxOpenPositions).toBe(1);
    expect(id.tuningAllowed).toBe(false);
    expect(id.configSha256).toBe(hashGhFastConfig(frozenGhFastSoakConfig()));
    expect(GH_ADMIN_DEFAULT_CONFIG.demoAutoTradeEnabled).toBe(false);
    expect(GH_ADMIN_DEFAULT_CONFIG.mode).toBe("RESEARCH");
    expect(GH_ADMIN_DEFAULT_CONFIG.maxOpenTrades).toBe(1);
    expect(GH_ADMIN_EXECUTION_MODE).toBe("DEMO_ONLY");
    expect(HARD).toBe(frozenGhFastSoakConfig().hardStop);
  });
});
