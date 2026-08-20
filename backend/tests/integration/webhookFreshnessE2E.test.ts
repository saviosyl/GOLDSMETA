import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import strongBuyFixture from "../fixtures/strongBuy.json";
import { createTestWebhookConnection, freshPayload, stalePayload } from "../helpers";
import staleFixture from "../fixtures/stale.json";
import { createApp } from "../../src";
import { AiExplainer } from "../../src/services/ai/explainer";
import { InMemoryStore } from "../../src/services/storage/inMemoryStore";
import { resetRateLimits } from "../../src/middleware/rateLimit";
import { buildTradingViewWebhookUrlFromConfig } from "../../src/services/webhook/publicWebhookUrl";

/**
 * End-to-end coverage for webhook URL + sentAt skew + decision surfaces.
 * No deployment / no broker calls.
 */
describe("webhook freshness E2E (local)", () => {
  let store: InMemoryStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    resetRateLimits();
    store = new InMemoryStore();
    await createTestWebhookConnection(store, "live-user", "live-webhook-id");
    app = createApp({ store, aiExplainer: new AiExplainer() });
  });

  it("correct URL, fresh LIVE post, latest + history, stale reject, dedupe", async () => {
    const url = buildTradingViewWebhookUrlFromConfig("live-webhook-id", {
      appEnv: "production",
      firebaseProjectId: "goldmeta-web",
      firebaseRegion: "us-central1"
    });
    expect(url).toContain("/api/webhooks/tradingview/live-webhook-id");

    const payload = freshPayload(strongBuyFixture);
    const first = await request(app)
      .post("/webhooks/tradingview/live-webhook-id")
      .send(payload)
      .expect(202);
    expect(first.body.accepted).toBe(true);
    expect(first.body.duplicate).toBe(false);

    const latest = await request(app)
      .get("/v1/decisions/latest")
      .set("x-test-user-id", "live-user")
      .expect(200);
    expect(latest.body.decision.environment).toBe("LIVE");
    expect(latest.body.decision.userId).toBe("live-user");
    expect(latest.body.decision.decision).toBe("BUY");

    const history = await request(app)
      .get("/v1/decisions?limit=10")
      .set("x-test-user-id", "live-user")
      .expect(200);
    expect(history.body.decisions).toHaveLength(1);

    const outcomes = await request(app)
      .get("/v1/signal-outcomes")
      .set("x-test-user-id", "live-user")
      .expect(200);
    expect(outcomes.body).toHaveProperty("items");

    const retired = await request(app)
      .get("/v1/autotrade/status")
      .set("x-test-user-id", "live-user");
    expect(retired.status).toBe(404);
    const ctrader = await request(app)
      .get("/v1/ctrader/status")
      .set("x-test-user-id", "live-user")
      .expect(200);
    expect(ctrader.body.autoTrade).toBe("OFF");
    expect(ctrader.body.liveEnabled).toBe(false);

    // Stale sentAt still fails
    const stale = stalePayload(staleFixture);
    const staleRes = await request(app)
      .post("/webhooks/tradingview/live-webhook-id")
      .send(stale)
      .expect(400);
    expect(staleRes.body.error.code).toBe("STALE_TIMESTAMP");

    // Duplicate delivery
    const dup = await request(app)
      .post("/webhooks/tradingview/live-webhook-id")
      .send(payload)
      .expect(202);
    expect(dup.body.duplicate).toBe(true);
    expect(await store.listDecisions("live-user")).toHaveLength(1);
  });
});
