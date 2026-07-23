import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import strongBuyFixture from "../fixtures/strongBuy.json";
import staleFixture from "../fixtures/stale.json";
import { createTestWebhookConnection, freshPayload, stalePayload } from "../helpers";
import { createApp } from "../../src";
import { AiExplainer } from "../../src/services/ai/explainer";
import { InMemoryStore } from "../../src/services/storage/inMemoryStore";
import { resetRateLimits } from "../../src/middleware/rateLimit";
import { validateWebhookPayload, WebhookValidationError } from "../../src/services/webhook/validatePayload";
import { env } from "../../src/config/env";
import { buildTradingViewWebhookUrlFromConfig } from "../../src/services/webhook/publicWebhookUrl";

describe("sentAt skew vs barTime semantics", () => {
  let store: InMemoryStore;

  beforeEach(async () => {
    resetRateLimits();
    store = new InMemoryStore();
    await createTestWebhookConnection(store, "skew-user", "skew-webhook-id");
  });

  it("accepts a fresh alert", async () => {
    const payload = freshPayload(strongBuyFixture);
    const validated = await validateWebhookPayload(store, "skew-webhook-id", payload);
    expect(validated.userId).toBe("skew-user");
  });

  it("accepts when barTime is older than five minutes but sentAt is fresh", async () => {
    const now = Date.now();
    const payload = freshPayload(strongBuyFixture, {
      barTime: new Date(now - 20 * 60 * 1000).toISOString(),
      sentAt: new Date(now - 30 * 1000).toISOString()
    });
    await expect(validateWebhookPayload(store, "skew-webhook-id", payload, now)).resolves.toBeTruthy();
  });

  it("accepts delayed TradingView delivery within past skew window", async () => {
    const now = Date.now();
    // ~20 minutes delayed — within 30m default, outside old 5m window
    const payload = freshPayload(strongBuyFixture, {
      barTime: new Date(now - 20 * 60 * 1000).toISOString(),
      sentAt: new Date(now - 20 * 60 * 1000).toISOString()
    });
    await expect(validateWebhookPayload(store, "skew-webhook-id", payload, now)).resolves.toBeTruthy();
  });

  it("rejects genuinely stale sentAt", async () => {
    const payload = stalePayload(staleFixture);
    await expect(validateWebhookPayload(store, "skew-webhook-id", payload)).rejects.toMatchObject({
      code: "STALE_TIMESTAMP"
    } satisfies Partial<WebhookValidationError>);
  });

  it("rejects future sentAt outside future tolerance", async () => {
    const now = Date.now();
    const payload = freshPayload(strongBuyFixture, {
      sentAt: new Date(now + 10 * 60 * 1000).toISOString()
    });
    await expect(validateWebhookPayload(store, "skew-webhook-id", payload, now)).rejects.toMatchObject({
      code: "STALE_TIMESTAMP"
    });
  });

  it("dedupes retry delivery without creating duplicate decisions", async () => {
    const app = createApp({ store, aiExplainer: new AiExplainer() });
    const payload = freshPayload(strongBuyFixture);

    const first = await request(app)
      .post("/webhooks/tradingview/skew-webhook-id")
      .send(payload)
      .expect(202);
    expect(first.body.duplicate).toBe(false);

    const retry = await request(app)
      .post("/webhooks/tradingview/skew-webhook-id")
      .send(payload)
      .expect(202);
    expect(retry.body.duplicate).toBe(true);

    const decisions = await store.listDecisions("skew-user");
    expect(decisions).toHaveLength(1);
  });

  it("keeps production webhook URL under /api", () => {
    const url = buildTradingViewWebhookUrlFromConfig("skew-webhook-id", {
      appEnv: "production",
      firebaseProjectId: "goldmeta-web",
      firebaseRegion: "us-central1",
      webhookPublicBaseUrl: "https://us-central1-goldmeta-web.cloudfunctions.net"
    });
    expect(url).toContain("/api/webhooks/tradingview/");
    expect(url).not.toMatch(/cloudfunctions\.net\/webhooks\/tradingview\//);
  });

  it("documents increased past skew default", () => {
    expect(env.WEBHOOK_MAX_SKEW_MS).toBeGreaterThanOrEqual(30 * 60 * 1000);
    expect(env.WEBHOOK_MAX_FUTURE_SKEW_MS).toBeLessThanOrEqual(5 * 60 * 1000);
  });
});
