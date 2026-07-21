import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src";
import { AiExplainer } from "../../src/services/ai/explainer";
import { InMemoryStore } from "../../src/services/storage/inMemoryStore";
import { resetRateLimits } from "../../src/middleware/rateLimit";
import type { SetupRecord } from "../../src/models/setup";

const userAuth = { "x-test-user-id": "stage3-user" };

const liveSetup = (): SetupRecord =>
  ({
    schemaVersion: "1.0",
    setupId: "live-1",
    decisionId: "dec-live-1",
    userId: "stage3-user",
    symbol: "XAUUSD",
    timeframe: "15",
    direction: "BUY",
    environment: "LIVE",
    isTestSetup: false,
    status: "WAITING_FOR_ENTRY",
    resolution: "OPEN",
    createdAt: "2026-07-21T12:00:00.000Z",
    updatedAt: "2026-07-21T12:00:00.000Z",
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
    resolvedAt: null,
    excursion: { mfe: null, mae: null, highestPriceSeen: null, lowestPriceSeen: null },
    appliedBarEventIds: [],
    outcome: {
      rawResolution: "OPEN",
      modelledResolution: "OPEN",
      rawRealisedR: null,
      modelledRealisedR: null,
      managementNotes: []
    },
    ruleConfigVersion: "setup-rules-1.0.0",
    backendVersion: "1.3.0-phase3-stage3",
    pineScriptVersion: "2.0.4",
    barsOpen: 0,
    barsToEntry: null,
    barsToResolution: null
  }) as SetupRecord;

describe("Stage 3 manual execution + settings", () => {
  let store: InMemoryStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetRateLimits();
    store = new InMemoryStore();
    store.saveSetup(liveSetup());
    app = createApp({ store, ai: new AiExplainer() });
  });

  it("requires LIVE ack before ENTERED journal", async () => {
    const denied = await request(app)
      .patch("/v1/setups/live-1/manual-execution")
      .set(userAuth)
      .send({ action: "ENTERED", actualEntryPrice: 2645, cashRiskIntended: 20 })
      .expect(403);
    expect(denied.body.error.code).toBe("LIVE_ACK_REQUIRED");

    await request(app)
      .patch("/v1/settings")
      .set(userAuth)
      .send({ liveForwardAckAt: "2026-07-21T13:00:00.000Z" })
      .expect(200);

    const ok = await request(app)
      .patch("/v1/setups/live-1/manual-execution")
      .set(userAuth)
      .send({
        action: "ENTERED",
        actualEntryPrice: 2645.2,
        positionSize: 1,
        broker: "IG",
        cashRiskIntended: 20,
        tradedAt: "2026-07-21T13:05:00.000Z"
      })
      .expect(200);

    expect(ok.body.setup.manualExecution.action).toBe("ENTERED");
    expect(ok.body.setup.manualExecution.systemOutcomeUntouched).toBe(true);
    expect(ok.body.setup.outcome.rawResolution).toBe("OPEN");
  });

  it("logs manual risk limit changes and keeps safety locks", async () => {
    const response = await request(app)
      .patch("/v1/settings")
      .set(userAuth)
      .send({
        manualRisk: { maxCashRiskPerTrade: 25, maxDailyRealisedLoss: 50 }
      })
      .expect(200);

    expect(response.body.settings.manualRisk.maxCashRiskPerTrade).toBe(25);
    expect(response.body.settings.manualRisk.noAveragingDown).toBe(true);
    expect(response.body.settings.manualRisk.noMartingale).toBe(true);
    expect(response.body.settings.manualRiskLimitChangeLog[0].field).toBe("maxDailyRealisedLoss");
  });

  it("exposes Stage 3 fields on system status with broker disabled", async () => {
    const response = await request(app).get("/v1/system/status").set(userAuth).expect(200);
    expect(response.body.status.backendVersion).toBe("1.3.0-phase3-stage3");
    expect(response.body.status.flags.setupTrackingEnvironments).toEqual(
      expect.arrayContaining(["TEST", "LIVE"])
    );
    expect(response.body.status.brokerLiveExecutionEnabled).toBe(false);
    expect(response.body.status.brokerExecutionEnabled).toBe(false);
    expect(response.body.status.brokerMode).toBe("DISABLED");
    expect(response.body.status.manualRisk.maxCashRiskPerTrade).toBe(20);
  });
});
