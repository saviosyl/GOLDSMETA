import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src";
import { AiExplainer } from "../../src/services/ai/explainer";
import { InMemoryStore } from "../../src/services/storage/inMemoryStore";
import { resetRateLimits } from "../../src/middleware/rateLimit";
import type { V4ShadowAnalysisRecord } from "../../src/services/v4/shadowTypes";

const userA = { "x-test-user-id": "user-a" };
const userB = { "x-test-user-id": "user-b" };

const shadowAnalysis = (
  overrides: Partial<V4ShadowAnalysisRecord> = {}
): V4ShadowAnalysisRecord => ({
  analysisId: "a1",
  strategyVersion: "4",
  mode: "SHADOW",
  environment: "LIVE",
  eventId: "e1",
  parentDecisionId: "d1",
  barTime: "2026-07-21T10:00:00.000Z",
  timeframe: "15",
  ohlc: { open: 2650, high: 2652, low: 2648, close: 2651 },
  session: "LONDON",
  regime: "UPTREND",
  bias: "BUY_BIAS",
  atr: 10,
  atrPercentile: 0.5,
  xauPoc: 2650,
  vah: 2658,
  val: 2642,
  profileSource: "XAUUSD_TV",
  profileAsOf: "2026-07-21T10:00:00.000Z",
  gcConfirmation: "UNAVAILABLE",
  htfContext: "UPTREND",
  gateFailures: [],
  rejectionReasons: ["B_ONLY_REASON"],
  configVersion: "v4",
  profileVersion: "p4",
  engineVersion: "e4",
  generatedAt: "2026-07-21T10:00:00.000Z",
  actionable: false,
  ...overrides
});

describe("V5 object-level authorisation", () => {
  let app: ReturnType<typeof createApp>;
  let store: InMemoryStore;

  beforeEach(() => {
    resetRateLimits();
    store = new InMemoryStore();
    app = createApp({ store, aiExplainer: new AiExplainer() });
  });

  it("requires auth on all /v1/v5/* endpoints", async () => {
    const paths = [
      "/v1/v5/status",
      "/v1/v5/glossary",
      "/v1/v5/briefing",
      "/v1/v5/score",
      "/v1/v5/learning",
      "/v1/v5/analytics/premium",
      "/v1/v5/personal",
      "/v1/v5/coach/weekly",
      "/v1/v5/replay"
    ];
    for (const path of paths) {
      const res = await request(app).get(path);
      expect(res.status).toBeGreaterThanOrEqual(401);
    }
    const ask = await request(app).post("/v1/v5/intelligence/ask").send({ question: "Why wait?" });
    expect(ask.status).toBeGreaterThanOrEqual(401);
    const shot = await request(app)
      .post("/v1/v5/screenshot/analyse")
      .send({ observations: { trend: "up" } });
    expect(shot.status).toBeGreaterThanOrEqual(401);
  });

  it("User A cannot read User B personal / intelligence data", async () => {
    store.createJournalEntry("user-b", {
      direction: "BUY",
      outcome: "WIN",
      notes: "secret-b-notes",
      tags: ["ignored"]
    });
    // Tag alone does not map to ignoredWait; personal stats remain user-scoped via journal length
    // Seed a setup for B so personal stats diverge.
    store.saveV4ShadowAnalysis("user-b", shadowAnalysis({ analysisId: "b-only" }));

    const personalA = await request(app).get("/v1/v5/personal").set(userA).expect(200);
    const personalB = await request(app).get("/v1/v5/personal").set(userB).expect(200);
    // A has empty journal/setups → insufficient; B has journal → not the same payload
    expect(personalA.body.stats).not.toEqual(personalB.body.stats);

    const journalA = await request(app).get("/v1/journal").set(userA).expect(200);
    const journalB = await request(app).get("/v1/journal").set(userB).expect(200);
    expect(JSON.stringify(journalA.body)).not.toContain("secret-b-notes");
    expect(JSON.stringify(journalB.body)).toContain("secret-b-notes");

    const askA = await request(app)
      .post("/v1/v5/intelligence/ask")
      .set(userA)
      .send({ question: "Why was this rejected?", environment: "LIVE" })
      .expect(200);
    expect(JSON.stringify(askA.body)).not.toContain("B_ONLY_REASON");

    const askB = await request(app)
      .post("/v1/v5/intelligence/ask")
      .set(userB)
      .send({ question: "Why was this rejected?", environment: "LIVE" })
      .expect(200);
    expect(JSON.stringify(askB.body)).toContain("B_ONLY_REASON");

    const replayA = await request(app).get("/v1/v5/replay").set(userA).expect(200);
    expect(JSON.stringify(replayA.body)).not.toContain("B_ONLY_REASON");
  });

  it("normal users cannot access admin diagnostics", async () => {
    const res = await request(app).get("/v1/admin/diagnostics").set(userA);
    expect(res.status).toBe(403);
  });

  it("TEST and LIVE remain separated in V5 analytics", async () => {
    store.saveV4ShadowAnalysis("user-a", shadowAnalysis({ analysisId: "live-1", environment: "LIVE" }));
    store.saveV4ShadowAnalysis(
      "user-a",
      shadowAnalysis({ analysisId: "test-1", environment: "TEST", rejectionReasons: ["TEST_ONLY"] })
    );
    const live = await request(app)
      .get("/v1/v5/analytics/premium?environment=LIVE")
      .set(userA)
      .expect(200);
    const test = await request(app)
      .get("/v1/v5/analytics/premium?environment=TEST")
      .set(userA)
      .expect(200);
    expect(live.body.analytics.filters.environment).toBe("LIVE");
    expect(test.body.analytics.filters.environment).toBe("TEST");
    expect(JSON.stringify(live.body)).not.toContain("TEST_ONLY");
  });

  it("status declares deterministic intelligence and broker disabled", async () => {
    const res = await request(app).get("/v1/v5/status").set(userA).expect(200);
    expect(res.body.v5.intelligenceImplementation).toBe("deterministic_rules_templated");
    expect(res.body.v5.aiEnabled).toBe(false);
    expect(res.body.v5.brokerExecution).toBe("DISABLED");
    expect(res.body.v5.overridesV4).toBe(false);
  });

  it("V5 never mutates V4 plans", async () => {
    const beforeMutations = store.listV4PlanMutations("user-a", 10).length;
    await request(app)
      .post("/v1/v5/intelligence/ask")
      .set(userA)
      .send({ question: "Why are we waiting?", environment: "LIVE" })
      .expect(200);
    await request(app).get("/v1/v5/score").set(userA).expect(200);
    await request(app)
      .post("/v1/v5/screenshot/analyse")
      .set(userA)
      .send({ observations: { trend: "up" }, environment: "LIVE" })
      .expect(200);
    expect(store.listV4PlanMutations("user-a", 10)).toHaveLength(beforeMutations);
  });
});
