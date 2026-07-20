import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import strongBuyFixture from "../fixtures/strongBuy.json";
import { createTestWebhookConnection, freshPayload } from "../helpers";
import { createApp } from "../../src";
import { AiExplainer } from "../../src/services/ai/explainer";
import { InMemoryStore } from "../../src/services/storage/inMemoryStore";
import { resetRateLimits } from "../../src/middleware/rateLimit";

describe("webhook flow", () => {
  let store: InMemoryStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    resetRateLimits();
    store = new InMemoryStore();
    await createTestWebhookConnection(store);
    app = createApp({
      store,
      aiExplainer: new AiExplainer()
    });
  });

  it("queues, processes inline in tests, stores a BUY decision, and dedupes replay", async () => {
    const payload = freshPayload(strongBuyFixture);

    const first = await request(app)
      .post("/webhooks/tradingview/test-webhook-id")
      .send(payload)
      .expect(202);
    expect(first.body).toMatchObject({
      accepted: true,
      duplicate: false,
      status: "QUEUED"
    });
    expect(first.body.jobId).toEqual(expect.any(String));
    expect(first.body.decision).toBeUndefined();

    const processed = await store.latestDecision("default-user");
    expect(processed).toBeDefined();
    expect(processed.decision).toBe("BUY");
    expect(processed.userId).toBe("default-user");
    expect(processed.environment).toBe("LIVE");
    expect(processed.isTestDecision).toBe(false);

    const duplicate = await request(app)
      .post("/webhooks/tradingview/test-webhook-id")
      .send(payload)
      .expect(202);
    expect(duplicate.body).toMatchObject({
      accepted: true,
      duplicate: true,
      status: "QUEUED",
      jobId: null
    });

    const latest = await request(app)
      .get("/v1/decisions/latest")
      .set("x-test-user-id", "default-user")
      .expect(200);
    expect(latest.body.decision.decision).toBe("BUY");
    expect(await store.listDecisions("default-user")).toHaveLength(1);
  });

  it("uses the webhook connection owner instead of metadata.userId", async () => {
    await createTestWebhookConnection(store, "second-user", "second-webhook-id");
    const payload = freshPayload(strongBuyFixture, {
      metadata: {
        userId: "spoofed-user"
      }
    });

    await request(app)
      .post("/webhooks/tradingview/second-webhook-id")
      .send(payload)
      .expect(202);

    expect(await store.latestDecision("second-user")).toBeDefined();
    expect(await store.latestDecision("spoofed-user")).toBeUndefined();
  });
});
