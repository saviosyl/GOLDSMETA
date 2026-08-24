import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src";
import { AiExplainer } from "../../src/services/ai/explainer";
import { InMemoryStore } from "../../src/services/storage/inMemoryStore";

describe("CORS for browser clients", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp({
      store: new InMemoryStore(),
      aiExplainer: new AiExplainer()
    });
  });

  it("answers OPTIONS preflight for TradingView connection create with allow headers", async () => {
    const response = await request(app)
      .options("/v1/tradingview/connections")
      .set("Origin", "https://goldmeta.metamechsolutions.com")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "authorization,content-type")
      .expect(204);

    expect(response.headers["access-control-allow-origin"]).toBe(
      "https://goldmeta.metamechsolutions.com"
    );
    expect(String(response.headers["access-control-allow-methods"] ?? "")).toMatch(/POST/i);
    expect(String(response.headers["access-control-allow-headers"] ?? "").toLowerCase()).toContain(
      "authorization"
    );
  });

  it("includes CORS headers on authenticated POST create responses", async () => {
    const response = await request(app)
      .post("/v1/tradingview/connections")
      .set("Origin", "https://goldmeta.metamechsolutions.com")
      .set("x-test-user-id", "cors-user")
      .expect(201);

    expect(response.headers["access-control-allow-origin"]).toBe(
      "https://goldmeta.metamechsolutions.com"
    );
    expect(response.body.connection.webhookURL).toContain("/webhooks/tradingview/");
    expect(response.body.secret).toEqual(expect.any(String));
  });

  it("does not reflect disallowed origins", async () => {
    const response = await request(app)
      .options("/v1/tradingview/connections")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "POST");

    expect([200, 204]).toContain(response.status);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
