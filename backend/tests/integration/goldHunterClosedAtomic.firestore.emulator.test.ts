/**
 * Firestore emulator — CLOSED is terminal under concurrent writers.
 * Requires FIRESTORE_EMULATOR_HOST. Never contacts a broker.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initializeApp, deleteApp, getApps, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { applyBrokerSettledClose } from "../../src/services/goldHunterAdmin/closeSettlement";
import {
  getGoldHunterDemoTrade,
  resetGoldHunterTradeMemory,
  setGoldHunterTradeStoreDbForTests,
  upsertGoldHunterDemoTrade
} from "../../src/services/goldHunterAdmin/tradeStore";
import type { GoldHunterDemoTrade } from "../../src/services/goldHunterAdmin/types";

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8081";
const PROJECT = "goldmeta-gh-closed-atomic-test";
const OWNER = "emu-gh-closed-owner";

async function emulatorReachable(): Promise<boolean> {
  try {
    const [host, port] = EMULATOR.split(":");
    const net = await import("net");
    return await new Promise((resolve) => {
      const socket = net.connect({ host, port: Number(port) }, () => {
        socket.end();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
      socket.setTimeout(1000, () => {
        socket.destroy();
        resolve(false);
      });
    });
  } catch {
    return false;
  }
}

function closedTrade(): GoldHunterDemoTrade {
  return applyBrokerSettledClose({
    trade: {
      goldHunterTradeId: "GH-D-emu-closed",
      strategy: "GOLD_HUNTER",
      environment: "DEMO",
      setup: "A",
      side: "BUY",
      signalTs: "2026-08-20T11:42:39.000Z",
      orderTs: "2026-08-20T11:42:39.000Z",
      fillTs: "2026-08-20T11:42:40.000Z",
      closeTs: null,
      entry: 4477.65,
      exit: null,
      stop: 4477.1,
      entrySpread: null,
      durationMs: null,
      mfe: 0.84,
      mae: -0.3,
      grossPnlEur: null,
      netPnlEur: null,
      result: "OPEN",
      exitReason: "TRAIL_HIT",
      brokerOrderId: "70609700",
      brokerPositionId: "54726731",
      status: "FILLED",
      initialRiskPrice: 0.55,
      filledVolumeLots: 9
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
    }
  });
}

describe("GH CLOSED atomic persist (emulator)", () => {
  let app: App | null = null;
  const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

  beforeAll(async () => {
    if (!enabled) return;
    const up = await emulatorReachable();
    if (!up) throw new Error(`Firestore emulator not reachable at ${EMULATOR}`);
    process.env.FIRESTORE_EMULATOR_HOST = EMULATOR;
    app =
      getApps().find((a) => a.name === "gh-closed-atomic") ??
      initializeApp({ projectId: PROJECT }, "gh-closed-atomic");
    setGoldHunterTradeStoreDbForTests(getFirestore(app));
  });

  afterAll(async () => {
    setGoldHunterTradeStoreDbForTests(null);
    if (app) await deleteApp(app);
  });

  beforeEach(async () => {
    resetGoldHunterTradeMemory();
    if (!enabled || !app) return;
    const db = getFirestore(app);
    const col = db
      .collection("users")
      .doc(OWNER)
      .collection("goldHunterDemoTrades");
    const snap = await col.get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  });

  it("concurrent CLOSE_REQUESTED writer cannot regress CLOSED settlement", async () => {
    if (!enabled) return;
    const closed = closedTrade();
    await upsertGoldHunterDemoTrade(OWNER, closed);

    const stale: GoldHunterDemoTrade = {
      ...closed,
      status: "CLOSE_REQUESTED",
      result: null,
      exit: null,
      closeTs: null,
      netPnlEur: null,
      errorCode: "CTRADER_ORDER_TIMEOUT"
    };

    const [a, b] = await Promise.all([
      upsertGoldHunterDemoTrade(OWNER, stale),
      upsertGoldHunterDemoTrade(OWNER, {
        ...stale,
        status: "CLOSE_ACCEPTED_PENDING_SETTLEMENT",
        errorCode: "BROKER_POSITION_ABSENT_SETTLEMENT_PENDING"
      })
    ]);
    expect(a.rejectedRegression).toBe(true);
    expect(b.rejectedRegression).toBe(true);

    const final = await getGoldHunterDemoTrade(OWNER, closed.goldHunterTradeId);
    expect(final?.status).toBe("CLOSED");
    expect(final?.result).toBe("WIN");
    expect(final?.netPnlEur).toBe(0.77);
    expect(final?.exit).toBe(4477.82);
    expect(final?.closeTs).toBe("2026-08-20T11:42:58.176Z");
    expect(final?.brokerDealId).toBe("61009964");
    expect(final?.brokerSettlementTs).toBe("2026-08-20T11:42:58.176Z");
    expect(final?.entry).toBe(4477.65);
  });

  it("stale non-CLOSED write cannot mutate CLOSED lifecycle/PM fields", async () => {
    if (!enabled) return;
    const closed = {
      ...closedTrade(),
      smartPmState: "PROTECTED",
      highestProtectionStage: "PROTECTED",
      closeRequestTs: "2026-08-20T11:42:50.000Z",
      exitReason: "TRAIL_HIT",
      errorCode: null
    };
    await upsertGoldHunterDemoTrade(OWNER, closed);
    const before = await getGoldHunterDemoTrade(OWNER, closed.goldHunterTradeId);

    const [a, b] = await Promise.all([
      upsertGoldHunterDemoTrade(OWNER, {
        ...closed,
        status: "CLOSE_REQUESTED",
        result: null,
        closeRequestTs: "2026-08-20T12:06:15.594Z",
        exitSignalTs: "2026-08-20T12:06:15.594Z",
        errorCode: "CTRADER_ORDER_TIMEOUT",
        smartPmState: "UNPROTECTED",
        highestProtectionStage: "UNPROTECTED",
        exitReason: "HARD_PROTECTION",
        netPnlEur: null,
        exit: null
      }),
      upsertGoldHunterDemoTrade(OWNER, {
        ...closed,
        status: "FILLED",
        result: "OPEN",
        errorCode: "STALE_MFE",
        smartPmState: "UNPROTECTED",
        closeRequestTs: "2026-08-20T12:07:00.000Z"
      })
    ]);
    expect(a.rejectedRegression).toBe(true);
    expect(b.rejectedRegression).toBe(true);

    const final = await getGoldHunterDemoTrade(OWNER, closed.goldHunterTradeId);
    expect(final?.status).toBe("CLOSED");
    expect(final?.result).toBe(before?.result);
    expect(final?.entry).toBe(before?.entry);
    expect(final?.exit).toBe(before?.exit);
    expect(final?.closeTs).toBe(before?.closeTs);
    expect(final?.netPnlEur).toBe(before?.netPnlEur);
    expect(final?.brokerDealId).toBe(before?.brokerDealId);
    expect(final?.brokerSettlementTs).toBe(before?.brokerSettlementTs);
    expect(final?.closeRequestTs).toBe(before?.closeRequestTs);
    expect(final?.exitReason).toBe(before?.exitReason);
    expect(final?.smartPmState).toBe(before?.smartPmState);
    expect(final?.errorCode ?? null).toBe(before?.errorCode ?? null);
  });
});
