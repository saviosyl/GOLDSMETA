import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src";
import { AiExplainer } from "../../src/services/ai/explainer";
import { InMemoryStore } from "../../src/services/storage/inMemoryStore";
import { resetRateLimits } from "../../src/middleware/rateLimit";

const userAuth = { "x-test-user-id": "v4-user" };
const adminAuth = { "x-test-user-id": "v4-admin", "x-test-admin": "true" };

describe("V4 research routes", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetRateLimits();
    app = createApp({ store: new InMemoryStore(), aiExplainer: new AiExplainer() });
  });

  it("exposes non-actionable V4 status", async () => {
    const res = await request(app).get("/v1/v4/status").set(userAuth).expect(200);
    expect(res.body.v4.strategyVersion).toBe("4");
    expect(res.body.v4.actionableLiveEnabled).toBe(false);
    expect(res.body.v4.brokerExecution).toBe("DISABLED");
  });

  it("restricts smoke backtest to admin", async () => {
    await request(app).post("/v1/v4/research/smoke-backtest").set(userAuth).expect(403);
    const ok = await request(app).post("/v1/v4/research/smoke-backtest").set(adminAuth).expect(200);
    expect(ok.body.actionable).toBe(false);
    expect(ok.body.report.strategyVersion).toBe("4");
    expect(ok.body.report.planMutationCount).toBe(0);
  });
});
