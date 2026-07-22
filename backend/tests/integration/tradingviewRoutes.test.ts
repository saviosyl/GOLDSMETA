import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src";
import { resetRateLimits } from "../../src/middleware/rateLimit";
import { AiExplainer } from "../../src/services/ai/explainer";
import { InMemoryStore } from "../../src/services/storage/inMemoryStore";

describe("TradingView routes", () => {
  let store: InMemoryStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetRateLimits();
    store = new InMemoryStore();
    app = createApp({
      store,
      aiExplainer: new AiExplainer()
    });
  });

  it("rejects authenticated routes without a token or test auth header", async () => {
    await request(app).get("/v1/settings").expect(401);
  });

  it("creates, lists, rotates, and revokes TradingView connections without exposing stored secrets", async () => {
    const created = await request(app)
      .post("/v1/tradingview/connections")
      .set("x-test-user-id", "api-user")
      .expect(201);

    expect(created.body.connection.webhookId).toEqual(expect.any(String));
    expect(created.body.connection).not.toHaveProperty("secret");
    expect(created.body.connection.hasSecret).toBe(true);
    expect(created.body.connection.payloadSecret).toEqual(expect.any(String));
    expect(created.body.connection.webhookURL).toContain(created.body.connection.webhookId);

    const listed = await request(app)
      .get("/v1/tradingview/connections")
      .set("x-test-user-id", "api-user")
      .expect(200);
    expect(listed.body.connections).toHaveLength(1);
    expect(listed.body.connections[0]).not.toHaveProperty("secret");
    expect(listed.body.connections[0]).not.toHaveProperty("payloadSecret");

    const rotated = await request(app)
      .post(`/v1/tradingview/connections/${created.body.connection.webhookId}/rotate`)
      .set("x-test-user-id", "api-user")
      .expect(200);
    expect(rotated.body.connection.payloadSecret).toEqual(expect.any(String));
    expect(rotated.body.connection.payloadSecret).not.toBe(created.body.connection.payloadSecret);
    expect(rotated.body.connection).not.toHaveProperty("secret");

    const revoked = await request(app)
      .delete(`/v1/tradingview/connections/${created.body.connection.webhookId}`)
      .set("x-test-user-id", "api-user")
      .expect(200);
    expect(revoked.body.connection.status).toBe("REVOKED");
    expect(revoked.body.connection).not.toHaveProperty("secret");
  });

  it("queues and processes an authenticated test alert as a TEST decision", async () => {
    const response = await request(app)
      .post("/v1/tradingview/test")
      .set("x-test-user-id", "api-user")
      .expect(202);

    expect(response.body).toMatchObject({
      accepted: true,
      duplicate: false,
      status: "QUEUED"
    });
    expect(response.body.jobId).toEqual(expect.any(String));

    const decision = await store.latestDecision("api-user");
    expect(decision).toBeDefined();
    expect(decision?.environment).toBe("TEST");
    expect(decision?.isTestDecision).toBe(true);
    expect(decision?.dataSourceLabel).toBe("TEST");
  });
});
