import { describe, expect, it, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/index";
import { AiExplainer } from "../../src/services/ai/explainer";
import { createStore } from "../../src/services/storage/createStore";
import { AutoTradeService } from "../../src/services/autoTrade/autoTradeService";
import { InMemoryAutoTradeStore } from "../../src/services/autoTrade/inMemoryAutoTradeStore";
import { FakeIgBrokerAdapter } from "../../src/services/autoTrade/fakeIgBrokerAdapter";

describe("autotrade HTTP routes", () => {
  beforeEach(() => {
    AutoTradeService.resetRestartGateForTests();
  });

  const store = createStore();
  const autoTradeService = new AutoTradeService(
    new InMemoryAutoTradeStore(),
    (environment) => new FakeIgBrokerAdapter({ environment }),
    { ownerId: "route-tests" }
  );
  const app = createApp({
    store,
    aiExplainer: new AiExplainer(),
    autoTradeService
  });

  it("returns default OFF status", async () => {
    const res = await request(app)
      .get("/v1/autotrade/status")
      .set("x-test-user-id", "route-user");
    expect(res.status).toBe(200);
    expect(res.body.status.mode).toBe("OFF");
    expect(res.body.status.liveExecutionFeatureEnabled).toBe(false);
  });

  it("emergency stop via HTTP", async () => {
    await request(app)
      .post("/v1/autotrade/mode")
      .set("x-test-user-id", "route-user-2")
      .send({ mode: "SHADOW" });
    const res = await request(app)
      .post("/v1/autotrade/emergency-stop")
      .set("x-test-user-id", "route-user-2");
    expect(res.status).toBe(200);
    expect(res.body.status.locked).toBe(true);
    expect(res.body.status.mode).toBe("OFF");
  });

  it("blocks LIVE mode while feature flag off", async () => {
    const res = await request(app)
      .post("/v1/autotrade/mode")
      .set("x-test-user-id", "route-user-3")
      .send({
        mode: "IG_LIVE_AUTO",
        liveConfirmationPhrase: "ENABLE LIVE AUTOTRADE",
        riskAcknowledged: true,
        accountVerified: true
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("LIVE_FEATURE_DISABLED");
  });

  it("removes public evaluate execution endpoint", async () => {
    const res = await request(app)
      .post("/v1/autotrade/evaluate")
      .set("x-test-user-id", "route-user-4")
      .send({
        decisionId: "dec-x",
        decision: "BUY",
        score: 90,
        entry: 1,
        stop: 0.5,
        takeProfit: 2,
        riskReward: 2,
        decisionAgeMs: 1,
        session: "LONDON"
      });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe("EVALUATE_REMOVED");
  });

  it("blocks non-admin internal evaluate", async () => {
    const res = await request(app)
      .post("/v1/autotrade/internal/evaluate-decision")
      .set("x-test-user-id", "route-user-5")
      .send({ decisionId: "dec-x" });
    expect(res.status).toBe(403);
  });
});
