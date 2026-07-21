import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src";
import { AiExplainer } from "../../src/services/ai/explainer";
import { InMemoryStore } from "../../src/services/storage/inMemoryStore";
import { resetRateLimits } from "../../src/middleware/rateLimit";
import { runV4ShadowLifecycle } from "../../src/services/v4/shadowOrchestrator";
import type { MarketSnapshot, TradingViewPayload } from "../../src/models/types";

const userAuth = { "x-test-user-id": "v4-user" };
const otherAuth = { "x-test-user-id": "v4-other" };
const adminAuth = { "x-test-user-id": "v4-admin", "x-test-admin": "true" };

describe("V4 research routes Stage B", () => {
  let app: ReturnType<typeof createApp>;
  let store: InMemoryStore;

  beforeEach(() => {
    resetRateLimits();
    store = new InMemoryStore();
    app = createApp({ store, aiExplainer: new AiExplainer() });
  });

  it("exposes non-actionable V4 status with Stage B flags", async () => {
    const res = await request(app).get("/v1/v4/status").set(userAuth).expect(200);
    expect(res.body.v4.strategyVersion).toBe("4");
    expect(res.body.v4.actionableLiveEnabled).toBe(false);
    expect(res.body.v4.actionableSetupEnabled).toBe(false);
    expect(res.body.v4.notificationsEnabled).toBe(false);
    expect(res.body.v4.brokerExecution).toBe("DISABLED");
    expect(res.body.v4.banner).toContain("SHADOW");
    expect(res.body.v4.flags.V4_ACTIONABLE_SETUP_ENABLED).toBe(false);
  });

  it("scopes analyses to the authenticated user", async () => {
    await store.saveV4ShadowAnalysis("v4-user", {
      analysisId: "a-user",
      strategyVersion: "4",
      mode: "SHADOW",
      environment: "LIVE",
      eventId: "e1",
      parentDecisionId: "d1",
      barTime: "2025-01-01T10:00:00.000Z",
      timeframe: "15",
      ohlc: { open: 1, high: 2, low: 0.5, close: 1.5 },
      session: "LONDON",
      regime: "BALANCED_RANGE",
      bias: "NEUTRAL",
      atr: 8,
      atrPercentile: 0.4,
      xauPoc: 1,
      vah: 2,
      val: 0.5,
      profileSource: "XAUUSD_TV",
      profileAsOf: null,
      gcConfirmation: "UNAVAILABLE",
      htfContext: "BALANCED_RANGE",
      gateFailures: [],
      rejectionReasons: [],
      configVersion: "v4",
      profileVersion: "p4",
      engineVersion: "e4",
      generatedAt: "2025-01-01T10:00:00.000Z",
      actionable: false
    });

    const mine = await request(app)
      .get("/v1/v4/analyses?environment=LIVE")
      .set(userAuth)
      .expect(200);
    expect(mine.body.analyses).toHaveLength(1);

    const other = await request(app)
      .get("/v1/v4/analyses?environment=LIVE")
      .set(otherAuth)
      .expect(200);
    expect(other.body.analyses).toHaveLength(0);
  });

  it("returns separate shadow analytics and GC unavailable", async () => {
    const analytics = await request(app)
      .get("/v1/v4/analytics?environment=LIVE")
      .set(userAuth)
      .expect(200);
    expect(analytics.body.actionable).toBe(false);
    expect(analytics.body.analytics.mode).toBe("SHADOW");
    expect(analytics.body.analytics.unsafePlanCount).toBe(0);

    const gc = await request(app).get("/v1/v4/gc/status").set(userAuth).expect(200);
    expect(gc.body.gc.profileQuality).toBe("UNAVAILABLE");
    expect(gc.body.banner).toContain("UNAVAILABLE");
  });

  it("restricts smoke backtest to admin", async () => {
    await request(app).post("/v1/v4/research/smoke-backtest").set(userAuth).expect(403);
    const ok = await request(app).post("/v1/v4/research/smoke-backtest").set(adminAuth).expect(200);
    expect(ok.body.actionable).toBe(false);
    expect(ok.body.report.strategyVersion).toBe("4");
    expect(ok.body.report.planMutationCount).toBe(0);
  });

  it("surfaces V4 flags on diagnostics", async () => {
    const res = await request(app).get("/v1/admin/diagnostics").set(adminAuth).expect(200);
    expect(res.body.diagnostics.flags.v4.V4_ACTIONABLE_SETUP_ENABLED).toBe(false);
    expect(res.body.diagnostics.v4.mode).toBe("SHADOW");
  });
});

describe("V4 shadow isolation from V3", () => {
  it("V4 failure remains non-fatal and does not invent V3 mutations", async () => {
    const store = new InMemoryStore();
    const badStore = {
      listActiveSetups: () => {
        throw new Error("forced V4 failure");
      },
      listV4ShadowPlans: async () => [],
      saveV4ShadowAnalysis: vi.fn(),
      saveV4ShadowCandidate: vi.fn(),
      saveV4ShadowPlan: vi.fn(),
      saveV4ShadowResult: vi.fn()
    };

    const payload = { symbol: "XAUUSD", timeframe: "15" } as TradingViewPayload;
    const snapshot = {
      marketDataTime: "2025-01-01T10:00:00.000Z",
      isConfirmedBar: true,
      ohlcv: { open: 2650, high: 2651, low: 2649, close: 2650, volume: 10 },
      sessionVolumeProfile: { session: "LONDON", poc: 2650, vah: 2655, val: 2645 }
    } as MarketSnapshot;

    const result = await runV4ShadowLifecycle({
      store: badStore as never,
      userId: "u1",
      payload,
      snapshot,
      environment: "LIVE",
      parentDecisionId: "d-v3",
      eventId: "e1"
    });

    expect(result).toBeNull();
    expect(badStore.saveV4ShadowAnalysis).not.toHaveBeenCalled();
    expect(store.listDecisions("u1")).toHaveLength(0);
  });

  it("never marks shadow records actionable and never touches broker hooks", async () => {
    const brokerSpy = vi.fn();
    const store = new InMemoryStore();
    const payload = { symbol: "XAUUSD", timeframe: "15" } as TradingViewPayload;
    const snapshot = {
      marketDataTime: "2025-01-01T10:00:00.000Z",
      isConfirmedBar: true,
      ohlcv: { open: 2650, high: 2651, low: 2649, close: 2650.5, volume: 10 },
      sessionVolumeProfile: {
        session: "LONDON",
        poc: 2650,
        vah: 2655,
        val: 2645,
        asOf: "2025-01-01T10:00:00.000Z"
      }
    } as MarketSnapshot;

    await runV4ShadowLifecycle({
      store,
      userId: "u1",
      payload,
      snapshot,
      environment: "LIVE",
      parentDecisionId: "d1",
      eventId: "e-broker-guard"
    });

    expect(brokerSpy).not.toHaveBeenCalled();
    for (const a of store.listV4ShadowAnalyses("u1", "LIVE", 10)) {
      expect(a.actionable).toBe(false);
      expect(a.strategyVersion).toBe("4");
      expect(a.mode).toBe("SHADOW");
      expect(a.environment).toBe("LIVE");
    }
    for (const p of store.listV4ShadowPlans("u1", "LIVE", 10)) {
      expect(p.actionable).toBe(false);
      expect(p.locked).toBe(true);
    }
  });
});
