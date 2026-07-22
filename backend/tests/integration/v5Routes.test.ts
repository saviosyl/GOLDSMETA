import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src";
import { AiExplainer } from "../../src/services/ai/explainer";
import { InMemoryStore } from "../../src/services/storage/inMemoryStore";
import { resetRateLimits } from "../../src/middleware/rateLimit";

const userAuth = { "x-test-user-id": "v5-user" };

describe("V5 intelligence routes", () => {
  let app: ReturnType<typeof createApp>;
  let store: InMemoryStore;

  beforeEach(() => {
    resetRateLimits();
    store = new InMemoryStore();
    app = createApp({ store, aiExplainer: new AiExplainer() });
  });

  it("exposes non-actionable V5 status", async () => {
    const res = await request(app).get("/v1/v5/status").set(userAuth).expect(200);
    expect(res.body.v5.brokerExecution).toBe("DISABLED");
    expect(res.body.v5.overridesV4).toBe(false);
    expect(res.body.v5.intelligenceImplementation).toBe("deterministic_rules_templated");
    expect(res.body.v5.aiEnabled).toBe(false);
  });

  it("serves glossary offline", async () => {
    const res = await request(app).get("/v1/v5/glossary").set(userAuth).expect(200);
    expect(res.body.offline).toBe(true);
    expect(res.body.glossary.length).toBeGreaterThan(5);
  });

  it("answers intelligence without inventing data", async () => {
    const res = await request(app)
      .post("/v1/v5/intelligence/ask")
      .set(userAuth)
      .send({ question: "Why are we waiting?", environment: "LIVE" })
      .expect(200);
    expect(res.body.actionable).toBe(false);
    expect(res.body.answer.insufficientData).toBe(true);
  });

  it("scopes briefing to authenticated user", async () => {
    const res = await request(app).get("/v1/v5/briefing").set(userAuth).expect(200);
    expect(res.body.briefing.actionable).toBe(false);
  });

  it("screenshot analyse never creates a trade", async () => {
    const res = await request(app)
      .post("/v1/v5/screenshot/analyse")
      .set(userAuth)
      .send({ observations: { trend: "up" }, environment: "LIVE" })
      .expect(200);
    expect(res.body.createsTrade).toBe(false);
    expect(res.body.result.createsTrade).toBe(false);
  });
});
