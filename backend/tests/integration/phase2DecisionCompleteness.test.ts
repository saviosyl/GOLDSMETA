import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import conflictedFixture from "../fixtures/conflicted.json";
import malformedFixture from "../fixtures/malformed.json";
import neutralFixture from "../fixtures/neutral.json";
import partialFixture from "../fixtures/partial.json";
import staleFixture from "../fixtures/stale.json";
import strongBuyFixture from "../fixtures/strongBuy.json";
import strongSellFixture from "../fixtures/strongSell.json";
import { createTestWebhookConnection, freshPayload, stalePayload } from "../helpers";
import { createApp } from "../../src";
import { AiExplainer } from "../../src/services/ai/explainer";
import { evaluateHardGuards } from "../../src/services/decision/hardGuards";
import { scoreSnapshot, directionFromScore } from "../../src/services/decision/scoringEngine";
import { buildTradePlan } from "../../src/services/decision/tradePlanEngine";
import { evaluateDataQuality } from "../../src/services/snapshot/dataQuality";
import { mergeSnapshot } from "../../src/services/snapshot/mergeSnapshot";
import { InMemoryStore } from "../../src/services/storage/inMemoryStore";
import { resetRateLimits } from "../../src/middleware/rateLimit";
import { processDecisionPipeline } from "../../src/services/decision/decisionPipeline";

describe("phase2 decision completeness and safety", () => {
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

  it("stores timeframe, barTime, OHLCV, VP, trend and confirmation on BUY", async () => {
    const payload = freshPayload(strongBuyFixture);
    const decision = await processDecisionPipeline(
      "default-user",
      payload,
      payload.eventId,
      store,
      new AiExplainer()
    );

    expect(decision.decision).toBe("BUY");
    expect(decision.timeframe).toBe("15");
    expect(decision.barTime).toBe(payload.barTime);
    expect(decision.ohlcv?.close).toBe(payload.ohlcv?.close);
    expect(decision.marketStructure?.poc).toBeTruthy();
    expect(decision.marketStructure?.vah).toBeTruthy();
    expect(decision.marketStructure?.val).toBeTruthy();
    expect(decision.marketStructure?.trend).toBe("BULLISH");
    expect(decision.marketStructure?.trendStrength).toBeGreaterThan(0);
    expect(decision.marketStructure?.confirmationClassification).toBe("BREAKOUT");
    expect(decision.dataQuality).toBe("GOOD");
  });

  it("stores timeframe and produces SELL on fresh complete bearish payload", async () => {
    const payload = freshPayload(strongSellFixture);
    const decision = await processDecisionPipeline(
      "default-user",
      payload,
      payload.eventId,
      store,
      new AiExplainer()
    );
    expect(decision.decision).toBe("SELL");
    expect(decision.timeframe).toBe("15");
    expect(decision.marketStructure?.trend).toBe("BEARISH");
  });

  it("returns WAIT for neutral payload", async () => {
    const payload = freshPayload(neutralFixture);
    const decision = await processDecisionPipeline(
      "default-user",
      payload,
      payload.eventId,
      store,
      new AiExplainer()
    );
    expect(decision.decision).toBe("WAIT");
    expect(decision.timeframe).toBe("15");
    expect(decision.reasonCodes).toEqual(
      expect.arrayContaining(["MISSING_CONFIRMATION"])
    );
  });

  it("forces WAIT with STALE_DATA on stale payload", async () => {
    const payload = stalePayload(staleFixture);
    const decision = await processDecisionPipeline(
      "default-user",
      payload,
      payload.eventId,
      store,
      new AiExplainer()
    );
    expect(decision.decision).toBe("WAIT");
    expect(decision.dataQuality).toBe("STALE");
    expect(decision.reasonCodes).toContain("STALE_DATA");
  });

  it("forces WAIT with MISSING_VOLUME_PROFILE on partial payload", async () => {
    const payload = freshPayload(partialFixture);
    const snapshot = mergeSnapshot(payload);
    const quality = evaluateDataQuality(snapshot);
    expect(quality.quality).toBe("PARTIAL");
    expect(quality.missingInputs).toContain("volumeProfile");

    const decision = await processDecisionPipeline(
      "default-user",
      payload,
      payload.eventId,
      store,
      new AiExplainer()
    );
    expect(decision.decision).toBe("WAIT");
    expect(decision.reasonCodes).toEqual(
      expect.arrayContaining(["MISSING_VOLUME_PROFILE", "INCOMPLETE_DATA"])
    );
  });

  it("rejects malformed payloads at the webhook", async () => {
    await request(app)
      .post("/webhooks/tradingview/test-webhook-id")
      .send(malformedFixture)
      .expect(400);
  });

  it("dedupes duplicate payloads to a single decision", async () => {
    const payload = freshPayload(strongBuyFixture);

    const first = await request(app)
      .post("/webhooks/tradingview/test-webhook-id")
      .send(payload)
      .expect(202);
    expect(first.body.duplicate).toBe(false);

    const second = await request(app)
      .post("/webhooks/tradingview/test-webhook-id")
      .send(payload)
      .expect(202);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.jobId).toBeNull();

    expect(await store.listDecisions("default-user")).toHaveLength(1);
  });

  it("exposes timeframe on the decisions API for History", async () => {
    const payload = freshPayload(strongBuyFixture);
    await request(app)
      .post("/webhooks/tradingview/test-webhook-id")
      .send(payload)
      .expect(202);

    const history = await request(app)
      .get("/v1/decisions")
      .set("x-test-user-id", "default-user")
      .expect(200);

    expect(history.body.decisions[0].timeframe).toBe("15");
    expect(history.body.decisions[0].marketStructure.poc).toEqual(expect.any(Number));
  });

  it("keeps CONFLICTED data from producing BUY/SELL", () => {
    const snapshot = mergeSnapshot(freshPayload(conflictedFixture));
    const quality = evaluateDataQuality(snapshot);
    expect(quality.quality).toBe("CONFLICTED");
    const score = scoreSnapshot(snapshot);
    const direction = directionFromScore(score.score);
    const guards = evaluateHardGuards(
      snapshot,
      direction === "WAIT" ? "BUY" : direction,
      buildTradePlan(snapshot, direction === "WAIT" ? "BUY" : direction),
      quality,
      80
    );
    expect(guards.passed).toBe(false);
    expect(guards.reasonCodes).toContain("CONFLICTED_DATA");
  });
});
