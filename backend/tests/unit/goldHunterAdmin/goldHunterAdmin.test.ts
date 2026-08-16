import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../../src";
import { resetGoldHunterAdminMemory } from "../../../src/services/goldHunterAdmin/configStore";
import { resetGoldHunterTradeMemory } from "../../../src/services/goldHunterAdmin/tradeStore";
import {
  assertGoldHunterDemoOnlyEnvironment,
  evaluateGoldHunterOrderGates
} from "../../../src/services/goldHunterAdmin/orderGates";
import { sizeGoldHunterDemoLots } from "../../../src/services/goldHunterAdmin/riskSizing";
import { GH_ADMIN_DEFAULT_CONFIG } from "../../../src/services/goldHunterAdmin/types";

const app = createApp();

describe("Gold Hunter Admin API", () => {
  beforeEach(() => {
    resetGoldHunterAdminMemory();
    resetGoldHunterTradeMemory();
  });

  it("rejects non-admin status access", async () => {
    const res = await request(app)
      .get("/v1/gold-hunter/status")
      .set({ "x-test-user-id": "user-1", "x-test-role": "USER_APPROVED" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("allows OWNER to read status + default config", async () => {
    const res = await request(app)
      .get("/v1/gold-hunter/status")
      .set({ "x-test-user-id": "owner-1", "x-test-role": "OWNER" });
    expect(res.status).toBe(200);
    expect(res.body.product).toBe("GOLD_HUNTER");
    expect(res.body.executionMode).toBe("DEMO_ONLY");
    expect(res.body.liveExecutionEnabled).toBe(false);
    expect(res.body.config.demoAutoTradeEnabled).toBe(false);
    expect(res.body.config.allocatedCapitalEur).toBe(5000);
  });

  it("persists allocation server-side", async () => {
    const headers = { "x-test-user-id": "owner-alloc", "x-test-role": "OWNER" };
    const put = await request(app)
      .put("/v1/gold-hunter/config")
      .set(headers)
      .send({ allocatedCapitalEur: 2500 });
    expect(put.status).toBe(200);
    expect(put.body.config.allocatedCapitalEur).toBe(2500);

    const get = await request(app).get("/v1/gold-hunter/config").set(headers);
    expect(get.status).toBe(200);
    expect(get.body.config.allocatedCapitalEur).toBe(2500);
  });

  it("rejects invalid allocation", async () => {
    const res = await request(app)
      .put("/v1/gold-hunter/config")
      .set({ "x-test-user-id": "owner-bad", "x-test-role": "OWNER" })
      .send({ allocatedCapitalEur: -10 });
    expect(res.status).toBe(400);
  });

  it("requires confirmation to arm Demo AutoTrade", async () => {
    const res = await request(app)
      .put("/v1/gold-hunter/config")
      .set({ "x-test-user-id": "owner-arm", "x-test-role": "OWNER" })
      .send({ demoAutoTradeEnabled: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CONFIRMATION_REQUIRED");
  });

  it("refuses Live arm endpoint", async () => {
    const res = await request(app)
      .post("/v1/gold-hunter/live/arm")
      .set({ "x-test-user-id": "owner-live", "x-test-role": "OWNER" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("LIVE_EXECUTION_DISABLED");
    expect(res.body.error.liveExecutionEnabled).toBe(false);
  });

  it("refuses Live mode in config body", async () => {
    const res = await request(app)
      .put("/v1/gold-hunter/config")
      .set({ "x-test-user-id": "owner-live2", "x-test-role": "OWNER" })
      .send({ mode: "LIVE", liveExecutionEnabled: true });
    expect(res.status).toBe(403);
  });
});

describe("Gold Hunter order gates", () => {
  const base = {
    config: {
      ...GH_ADMIN_DEFAULT_CONFIG,
      demoAutoTradeEnabled: true,
      mode: "DEMO_AUTO" as const,
      updatedAt: new Date().toISOString(),
      updatedBy: "test"
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
    openTradeCount: 0,
    signalPresent: true,
    signalConsumed: false,
    isAdmin: true
  };

  it("passes when all gates clear", () => {
    const g = evaluateGoldHunterOrderGates(base);
    expect(g.ok).toBe(true);
    expect(g.liveExecutionEnabled).toBe(false);
  });

  it("blocks AutoTrade OFF", () => {
    const g = evaluateGoldHunterOrderGates({
      ...base,
      config: { ...base.config, demoAutoTradeEnabled: false }
    });
    expect(g.ok).toBe(false);
    expect(g.blockers).toContain("WAIT — AUTOTRADE OFF");
  });

  it("blocks Live broker environment", () => {
    const g = evaluateGoldHunterOrderGates({
      ...base,
      brokerEnvironment: "LIVE"
    });
    expect(g.blockers).toContain("WAIT — LIVE ENVIRONMENT REFUSED");
  });

  it("blocks market closed / stale / max open / daily loss", () => {
    expect(
      evaluateGoldHunterOrderGates({ ...base, marketOpen: false }).blockers
    ).toContain("WAIT — MARKET CLOSED");
    expect(
      evaluateGoldHunterOrderGates({ ...base, feedFresh: false }).blockers
    ).toContain("WAIT — FEED STALE");
    expect(
      evaluateGoldHunterOrderGates({ ...base, openTradeCount: 1 }).blockers
    ).toContain("WAIT — MAX OPEN TRADES");
    expect(
      evaluateGoldHunterOrderGates({ ...base, dailyLossOk: false }).blockers
    ).toContain("WAIT — DAILY LOSS LIMIT");
  });

  it("assertGoldHunterDemoOnlyEnvironment throws on LIVE", () => {
    expect(() => assertGoldHunterDemoOnlyEnvironment("LIVE")).toThrow(
      /LIVE_ACCOUNT_REFUSED|GOLD_HUNTER/
    );
  });
});

describe("Gold Hunter risk sizing", () => {
  it("sizes from allocated capital not full broker equity", () => {
    const r = sizeGoldHunterDemoLots({
      config: {
        ...GH_ADMIN_DEFAULT_CONFIG,
        allocatedCapitalEur: 5000,
        riskPerTradePct: 1,
        updatedAt: "",
        updatedBy: "t"
      },
      entry: 2400,
      stop: 2395,
      valuePerPointPerLot: 1,
      minLots: 0.01,
      maxLots: 50,
      lotStep: 0.01
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.riskBudgetEur).toBe(50);
      expect(r.lots).toBe(10);
    }
  });

  it("fail-closed without broker volume metadata", () => {
    const r = sizeGoldHunterDemoLots({
      config: {
        ...GH_ADMIN_DEFAULT_CONFIG,
        updatedAt: "",
        updatedBy: "t"
      },
      entry: 2400,
      stop: 2395,
      valuePerPointPerLot: 1,
      minLots: 0,
      maxLots: 0,
      lotStep: 0
    });
    expect(r.ok).toBe(false);
  });
});
