import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/index";
import { AiExplainer } from "../../src/services/ai/explainer";
import { createStore } from "../../src/services/storage/createStore";

describe("cTrader HTTP routes — mutation safety", () => {
  const app = createApp({
    store: createStore(),
    aiExplainer: new AiExplainer()
  });

  it("serves broker control centre with AutoTrade OFF", async () => {
    const res = await request(app)
      .get("/v1/brokers/control-centre")
      .set("x-test-user-id", "ctrader-route-user");
    expect(res.status).toBe(200);
    expect(res.body.autoTrade).toBe("OFF");
    expect(res.body.orderSubmissionEnabled).toBe(false);
    expect(res.body.brokers.some((b: { id: string }) => b.id === "pepperstone_ctrader")).toBe(
      true
    );
  });

  it("serves readiness without claiming connection", async () => {
    const res = await request(app)
      .get("/v1/ctrader/status")
      .set("x-test-user-id", "ctrader-route-user");
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(false);
    expect(res.body.orderSubmissionEnabled).toBe(false);
    expect(res.body.autoTrade).toBe("OFF");
  });

  it("denies close/cancel mutation routes; market denied when Demo submission off", async () => {
    for (const path of [
      "/v1/ctrader/orders/close",
      "/v1/ctrader/orders/cancel",
      "/v1/ctrader/positions/close"
    ]) {
      const res = await request(app)
        .post(path)
        .set("x-test-user-id", "ctrader-route-user")
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.submitted).toBe(false);
      expect(String(res.body.error ?? res.body?.error?.code ?? "")).toMatch(
        /MUTATION_DISABLED|CTRADER/
      );
    }
    const prevDemo = process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
    delete process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
    const market = await request(app)
      .post("/v1/ctrader/orders/market")
      .set("x-test-user-id", "ctrader-route-user")
      .send({ side: "BUY", lots: 0.01 });
    expect([403, 400]).toContain(market.status);
    if (prevDemo === undefined) delete process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
    else process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = prevDemo;
  });

  it("locks DEMO_AUTO when Demo submission env is off", async () => {
    const prevDemo = process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
    delete process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
    const res = await request(app)
      .post("/v1/ctrader/automation/mode")
      .set("x-test-user-id", "ctrader-route-user")
      .send({ mode: "DEMO_AUTO" });
    expect(res.status).toBe(403);
    expect(res.body.active ?? "OFF").toBe("OFF");
    if (prevDemo === undefined) delete process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
    else process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = prevDemo;
  });

  it("keeps LIVE_LOCKED mode blocked", async () => {
    const res = await request(app)
      .post("/v1/ctrader/automation/mode")
      .set("x-test-user-id", "ctrader-route-user")
      .send({ mode: "LIVE_LOCKED" });
    expect(res.status).toBe(403);
  });

  it("demonstration fixture is clearly labelled", async () => {
    const res = await request(app)
      .get("/v1/ctrader/demonstration")
      .set("x-test-user-id", "ctrader-route-user");
    expect(res.status).toBe(200);
    expect(String(res.body.banner || res.body.notice)).toContain("DEMONSTRATION DATA");
    expect(res.body.orderSubmissionEnabled).toBe(false);
  });

  it("preview approve rebuilds server-side and never submits", async () => {
    const previewRes = await request(app)
      .post("/v1/ctrader/preview")
      .set("x-test-user-id", "ctrader-route-user")
      .send({ useDemonstrationFixture: true, decision: "BUY" });
    expect(previewRes.status).toBe(200);
    expect(previewRes.body.orderSubmissionEnabled).toBe(false);

    const rejectClient = await request(app)
      .post("/v1/ctrader/preview/approve")
      .set("x-test-user-id", "ctrader-route-user")
      .send({ preview: previewRes.body.preview });
    expect(rejectClient.status).toBe(400);
    expect(rejectClient.body.error).toBe("SERVER_PREVIEW_REQUIRED");

    const approve = await request(app)
      .post("/v1/ctrader/preview/approve")
      .set("x-test-user-id", "ctrader-route-user")
      .send({ useDemonstrationFixture: true, decision: "BUY" });
    expect(approve.status).toBe(200);
    expect(approve.body.submitted).toBe(false);
    expect(approve.body.submitting).toBe(false);
    expect(approve.body.preview.state).toBe("PREVIEW_APPROVED");
    expect(approve.body.orderSubmissionEnabled).toBe(false);
  });
});
