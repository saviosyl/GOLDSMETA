import { describe, expect, it } from "vitest";
import malformedFixture from "../fixtures/malformed.json";
import staleFixture from "../fixtures/stale.json";
import strongBuyFixture from "../fixtures/strongBuy.json";
import { freshPayload, stalePayload } from "../helpers";
import { tradingViewPayloadSchema } from "../../src/models/types";
import { validateWebhookPayload, WebhookValidationError } from "../../src/services/webhook/validatePayload";

describe("payload validation", () => {
  it("validates a well-formed TradingView payload", () => {
    const payload = freshPayload(strongBuyFixture);
    expect(tradingViewPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("rejects malformed payloads", () => {
    expect(tradingViewPayloadSchema.safeParse(malformedFixture).success).toBe(false);
  });

  it("rejects payloads outside timestamp skew", () => {
    const payload = stalePayload(staleFixture);
    expect(() => validateWebhookPayload("test-webhook-id", payload)).toThrow(WebhookValidationError);
  });
});
