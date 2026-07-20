import { describe, expect, it } from "vitest";
import strongBuyFixture from "../fixtures/strongBuy.json";
import { freshPayload } from "../helpers";
import { validateWebhookPayload, WebhookValidationError } from "../../src/services/webhook/validatePayload";

describe("webhook authentication", () => {
  it("rejects an unknown path webhook id", () => {
    const payload = freshPayload(strongBuyFixture);
    expect(() => validateWebhookPayload("wrong-webhook", payload)).toThrow(WebhookValidationError);
  });

  it("accepts the configured test webhook id", () => {
    const payload = freshPayload(strongBuyFixture);
    const validated = validateWebhookPayload("test-webhook-id", payload);
    expect(validated.stableEventId).toHaveLength(64);
  });
});
