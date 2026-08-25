import { describe, expect, it } from "vitest";
import plan15Fixture from "../fixtures/pine3Plan15mPayload.json";
import { processDecisionPipeline } from "../../src/services/decision/decisionPipeline";
import { InMemoryStore } from "../../src/services/storage/inMemoryStore";
import { AiExplainer } from "../../src/services/ai/explainer";
import { freshPayload } from "../helpers";

describe("decision pipeline oneHour bias contract", () => {
  it("persists explicit oneHourBiasConfirmed + oneHourBiasSourceTime from payload", async () => {
    const store = new InMemoryStore();
    const payload = freshPayload(plan15Fixture);
    const decision = await processDecisionPipeline(
      "default-user",
      payload,
      "evt-explicit-1h-bias",
      store,
      new AiExplainer()
    );

    expect(decision.higherTimeframeBias).toBe("BULLISH");
    expect(decision.oneHourBiasConfirmed).toBe(true);
    expect(decision.oneHourBiasSourceTime).toBe("2026-07-20T14:00:00Z");
  });

  it("does not infer oneHourBiasConfirmed from confirmed 15m/5m/1m bars when explicit fields are missing", async () => {
    const store = new InMemoryStore();
    const cloned = JSON.parse(JSON.stringify(plan15Fixture)) as Record<string, unknown>;
    const metadata = { ...(cloned.metadata as Record<string, unknown>) };
    const optionalIndicators = { ...(cloned.optionalIndicators as Record<string, unknown>) };
    delete metadata.oneHourBiasConfirmed;
    delete metadata.oneHourBiasSourceTime;
    delete optionalIndicators.oneHourBias;

    const payload = freshPayload(cloned, {
      metadata,
      optionalIndicators,
      isConfirmedBar: true
    });
    const decision = await processDecisionPipeline(
      "default-user",
      payload,
      "evt-missing-explicit-1h-bias",
      store,
      new AiExplainer()
    );

    expect(decision.higherTimeframeBias).toBe("BULLISH");
    expect(decision.oneHourBiasConfirmed).toBeNull();
    expect(decision.oneHourBiasSourceTime).toBeNull();
  });
});
