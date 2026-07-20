import { beforeEach, describe, expect, it } from "vitest";
import strongBuyFixture from "../fixtures/strongBuy.json";
import { createTestWebhookConnection, freshPayload } from "../helpers";
import { validateWebhookPayload, WebhookValidationError } from "../../src/services/webhook/validatePayload";
import { InMemoryStore } from "../../src/services/storage/inMemoryStore";

describe("webhook authentication", () => {
  let store: InMemoryStore;

  beforeEach(async () => {
    store = new InMemoryStore();
    await createTestWebhookConnection(store);
  });

  it("rejects an unknown path webhook id", async () => {
    const payload = freshPayload(strongBuyFixture);
    await expect(validateWebhookPayload(store, "wrong-webhook", payload)).rejects.toThrow(
      WebhookValidationError
    );
  });

  it("accepts a stored webhook connection", async () => {
    const payload = freshPayload(strongBuyFixture);
    const validated = await validateWebhookPayload(store, "test-webhook-id", payload);
    expect(validated.stableEventId).toHaveLength(64);
    expect(validated.userId).toBe("default-user");
  });

  it("requires the connection secret when configured", async () => {
    await createTestWebhookConnection(store, "default-user", "secret-webhook-id", "expected-secret");
    const payload = freshPayload(strongBuyFixture, { webhookSecret: "wrong-secret" });

    await expect(validateWebhookPayload(store, "secret-webhook-id", payload)).rejects.toThrow(
      WebhookValidationError
    );
  });
});
