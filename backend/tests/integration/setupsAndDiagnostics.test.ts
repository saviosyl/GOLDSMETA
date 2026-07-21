import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src";
import { AiExplainer } from "../../src/services/ai/explainer";
import { InMemoryStore } from "../../src/services/storage/inMemoryStore";
import { resetRateLimits } from "../../src/middleware/rateLimit";
import type { SetupRecord } from "../../src/models/setup";

const userAuth = { "x-test-user-id": "setups-user" };
const otherAuth = { "x-test-user-id": "other-user" };
const adminAuth = { "x-test-user-id": "admin-user", "x-test-admin": "true" };

const baseSetup = (overrides: Partial<SetupRecord>): SetupRecord =>
  ({
    schemaVersion: "1.0",
    setupId: overrides.setupId ?? "setup-1",
    decisionId: overrides.decisionId ?? "dec-1",
    userId: overrides.userId ?? "setups-user",
    symbol: "XAUUSD",
    timeframe: "15",
    direction: "BUY",
    environment: "TEST",
    isTestSetup: true,
    status: "CLOSED",
    resolution: "WIN_TP3",
    createdAt: overrides.createdAt ?? "2026-07-21T12:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-21T12:00:00.000Z",
    barTime: "2026-07-21T12:00:00.000Z",
    levels: {
      entryPrice: 2645,
      entryType: "MARKET",
      stopLoss: 2640,
      tp1: 2652,
      tp2: 2658,
      tp3: 2665
    },
    expectedRR: { tp1: 1.4, tp2: 2.6, tp3: 4 },
    initialRisk: 5,
    confidence: 80,
    session: "LONDON",
    trend: "BULLISH",
    confirmationType: "BREAKOUT",
    vah: 2650,
    val: 2635,
    poc: 2645,
    statusHistory: [],
    entryTriggeredAt: null,
    resolvedAt: "2026-07-21T12:30:00.000Z",
    excursion: { mfe: 1, mae: 0.1, highestPriceSeen: 2650, lowestPriceSeen: 2644 },
    appliedBarEventIds: [],
    outcome: {
      rawResolution: "WIN_TP3",
      modelledResolution: "WIN_TP3",
      rawRealisedR: 4,
      modelledRealisedR: 2.7,
      managementNotes: []
    },
    ruleConfigVersion: "setup-rules-1.0.0",
    backendVersion: "1.2.0-phase3",
    pineScriptVersion: "2.0.4",
    barsOpen: 4,
    barsToEntry: 1,
    barsToResolution: 4,
    ...overrides
  }) as SetupRecord;

describe("setups environment filter + admin diagnostics", () => {
  let store: InMemoryStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetRateLimits();
    store = new InMemoryStore();
    store.saveSetup(
      baseSetup({
        setupId: "test-a",
        decisionId: "dec-test-a",
        environment: "TEST",
        isTestSetup: true,
        createdAt: "2026-07-21T12:02:00.000Z"
      })
    );
    store.saveSetup(
      baseSetup({
        setupId: "live-a",
        decisionId: "dec-live-a",
        environment: "LIVE",
        isTestSetup: false,
        createdAt: "2026-07-21T12:01:00.000Z"
      })
    );
    store.saveSetup(
      baseSetup({
        setupId: "test-b",
        decisionId: "dec-test-b",
        environment: "TEST",
        isTestSetup: true,
        createdAt: "2026-07-21T12:00:00.000Z"
      })
    );
    store.saveSetup(
      baseSetup({
        setupId: "other-test",
        decisionId: "dec-other",
        userId: "other-user",
        environment: "TEST",
        isTestSetup: true
      })
    );
    app = createApp({ store, aiExplainer: new AiExplainer() });
  });

  it("returns all setups for the user when environment is omitted", async () => {
    const response = await request(app).get("/v1/setups").set(userAuth).expect(200);
    const ids = response.body.setups.map((s: SetupRecord) => s.setupId);
    expect(ids).toEqual(["test-a", "live-a", "test-b"]);
  });

  it("filters TEST setups server-side", async () => {
    const response = await request(app).get("/v1/setups?environment=TEST").set(userAuth).expect(200);
    expect(response.body.setups).toHaveLength(2);
    expect(response.body.setups.every((s: SetupRecord) => s.environment === "TEST")).toBe(true);
  });

  it("filters LIVE setups server-side", async () => {
    const response = await request(app).get("/v1/setups?environment=LIVE").set(userAuth).expect(200);
    expect(response.body.setups).toHaveLength(1);
    expect(response.body.setups[0].setupId).toBe("live-a");
    expect(response.body.setups[0].environment).toBe("LIVE");
  });

  it("rejects invalid environment with 400", async () => {
    const response = await request(app).get("/v1/setups?environment=DEMO").set(userAuth).expect(400);
    expect(response.body.error.code).toBe("INVALID_ENVIRONMENT");
  });

  it("preserves limit pagination with environment filter", async () => {
    const response = await request(app)
      .get("/v1/setups?environment=TEST&limit=1")
      .set(userAuth)
      .expect(200);
    expect(response.body.setups).toHaveLength(1);
    expect(response.body.setups[0].setupId).toBe("test-a");
  });

  it("does not leak another user's setups", async () => {
    const response = await request(app).get("/v1/setups?environment=TEST").set(otherAuth).expect(200);
    expect(response.body.setups).toHaveLength(1);
    expect(response.body.setups[0].setupId).toBe("other-test");
  });

  it("rejects unauthenticated diagnostics with 401", async () => {
    const response = await request(app).get("/v1/admin/diagnostics").expect(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects authenticated non-admin diagnostics with 403", async () => {
    const response = await request(app).get("/v1/admin/diagnostics").set(userAuth).expect(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("allows authenticated admin diagnostics without secrets", async () => {
    const response = await request(app).get("/v1/admin/diagnostics").set(adminAuth).expect(200);
    expect(response.body.diagnostics.backendVersion).toBe("1.3.1-v4-stage-b");
    expect(response.body.diagnostics.flags.setupTrackingEnvironments).toEqual(
      expect.arrayContaining(["TEST", "LIVE"])
    );
    expect(response.body.diagnostics.flags.brokerMode).toBe("DISABLED");
    expect(response.body.diagnostics.flags.brokerLiveExecutionEnabled).toBe(false);
    expect(response.body.diagnostics.flags.aiEnabled).toBe(false);
    expect(JSON.stringify(response.body)).not.toMatch(/whsec_|apiKey|private_key|webhookSecret":\s*"/i);
  });
});
