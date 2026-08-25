import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import strongBuyFixture from "../fixtures/strongBuy.json";
import { createTestWebhookConnection, freshPayload } from "../helpers";
import { createApp } from "../../src";
import { AiExplainer } from "../../src/services/ai/explainer";
import { InMemoryStore } from "../../src/services/storage/inMemoryStore";
import { resetRateLimits } from "../../src/middleware/rateLimit";
import { isMalformedCloudFunctionsWebhookUrl } from "../../src/services/webhook/publicWebhookUrl";

describe("TradingView webhook URL generation + route", () => {
  let store: InMemoryStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    resetRateLimits();
    store = new InMemoryStore();
    await createTestWebhookConnection(store, "url-user", "existing-active-webhook-id");
    app = createApp({
      store,
      aiExplainer: new AiExplainer()
    });
  });

  it("returns corrected URLs for existing active connections without rotation", async () => {
    const listed = await request(app)
      .get("/v1/tradingview/connections")
      .set("x-test-user-id", "url-user")
      .expect(200);

    expect(listed.body.connections).toHaveLength(1);
    const conn = listed.body.connections[0];
    expect(conn.id).toBe("existing-active-webhook-id");
    expect(conn.webhookUrl).toContain("/webhooks/tradingview/existing-active-webhook-id");
    expect(conn.webhookURL).toContain("/webhooks/tradingview/existing-active-webhook-id");
    expect(isMalformedCloudFunctionsWebhookUrl(conn.webhookUrl)).toBe(false);
    expect(conn.webhookUrl).not.toMatch(/cloudfunctions\.net\/webhooks\/tradingview\//);
    expect(conn).not.toHaveProperty("secret");
    expect(JSON.stringify(listed.body)).not.toMatch(/payloadSecret":"[^"]{8,}/);
  });

  it("accepts POST on the Express webhook route and dedupes", async () => {
    const payload = freshPayload(strongBuyFixture);

    const first = await request(app)
      .post("/webhooks/tradingview/existing-active-webhook-id")
      .send(payload)
      .expect(202);
    expect(first.body.accepted).toBe(true);
    expect(first.body.duplicate).toBe(false);

    const dup = await request(app)
      .post("/webhooks/tradingview/existing-active-webhook-id")
      .send(payload)
      .expect(202);
    expect(dup.body.duplicate).toBe(true);

    const latest = await request(app)
      .get("/v1/decisions/latest")
      .set("x-test-user-id", "url-user")
      .expect(200);
    expect(latest.body.decision.userId).toBe("url-user");
  });

  it("rejects unknown webhook IDs safely without leaking secrets", async () => {
    const response = await request(app)
      .post("/webhooks/tradingview/unknown-webhook-id-zzzz")
      .send(freshPayload(strongBuyFixture))
      .expect((res) => {
        expect([401, 403, 404]).toContain(res.status);
      });

    const body = JSON.stringify(response.body);
    expect(body.toLowerCase()).not.toContain("secret");
    expect(body).not.toMatch(/webhookSecret/i);
  });
});
