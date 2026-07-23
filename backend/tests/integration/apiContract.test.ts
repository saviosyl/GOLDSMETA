import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import strongBuyFixture from "../fixtures/strongBuy.json";
import iosDecisionFields from "../fixtures/contracts/iosDecisionFields.json";
import responseEnvelopes from "../fixtures/contracts/responseEnvelopes.json";
import { createTestWebhookConnection, freshPayload } from "../helpers";
import { createApp } from "../../src";
import { AiExplainer } from "../../src/services/ai/explainer";
import { InMemoryStore } from "../../src/services/storage/inMemoryStore";
import { resetRateLimits } from "../../src/middleware/rateLimit";

const auth = { "x-test-user-id": "contract-user" };

const assertErrorEnvelope = (body: unknown): void => {
  expect(body).toEqual(
    expect.objectContaining({
      error: expect.objectContaining({
        code: expect.any(String),
        message: expect.any(String)
      })
    })
  );
  const error = (body as { error: Record<string, unknown> }).error;
  for (const field of responseEnvelopes.errorFields) {
    expect(error).toHaveProperty(field);
  }
};

const assertDecisionShape = (decision: Record<string, unknown>): void => {
  for (const field of iosDecisionFields.stringFields) {
    expect(typeof decision[field]).toBe("string");
  }
  for (const field of iosDecisionFields.numberFields) {
    expect(typeof decision[field]).toBe("number");
  }
  for (const field of iosDecisionFields.booleanFields) {
    expect(typeof decision[field]).toBe("boolean");
  }
  for (const field of iosDecisionFields.arrayFields) {
    expect(Array.isArray(decision[field])).toBe(true);
  }
  for (const field of iosDecisionFields.objectFields) {
    expect(decision[field]).toEqual(expect.any(Object));
  }
  for (const field of iosDecisionFields.nullableFields) {
    expect(field in decision).toBe(true);
  }
  expect(["LIVE", "TEST"]).toContain(decision.environment);
  expect(typeof decision.isTestDecision).toBe("boolean");
};

describe("API contract envelopes", () => {
  let store: InMemoryStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    resetRateLimits();
    store = new InMemoryStore();
    await createTestWebhookConnection(store, "contract-user", "test-webhook-id", "contract-secret");
    app = createApp({
      store,
      aiExplainer: new AiExplainer()
    });
  });

  it("rejects unauthenticated protected calls with a consistent error envelope", async () => {
    const response = await request(app).get("/v1/decisions/latest").expect(401);
    assertErrorEnvelope(response.body);
  });

  it("returns health without auth wrapper nesting secrets", async () => {
    const response = await request(app).get("/health").expect(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        ok: true,
        appEnv: expect.any(String),
        storageBackend: expect.any(String),
        backendVersion: expect.any(String)
      })
    );
    expect(JSON.stringify(response.body)).not.toMatch(/secret|api[_-]?key|token/i);
  });

  it(
    "matches decision, device, settings, journal and tradingview envelopes",
    async () => {
    const webhook = await request(app)
      .post("/webhooks/tradingview/test-webhook-id")
      .send(
        freshPayload(strongBuyFixture, {
          webhookSecret: "contract-secret",
          metadata: { source: "contract-test" }
        })
      )
      .expect(202);

    expect(webhook.body).toEqual(
      expect.objectContaining({
        accepted: true,
        duplicate: false,
        eventId: expect.any(String),
        status: "QUEUED",
        jobId: expect.any(String)
      })
    );

    // Wait briefly for inline test-mode processing
    const started = Date.now();
    while (Date.now() - started < 2000) {
      const latest = await store.latestDecision("contract-user");
      if (latest) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const latest = await request(app)
      .get("/v1/decisions/latest")
      .set(auth)
      .expect(200);
    expect(latest.body).toHaveProperty(responseEnvelopes.successWrappers.latestDecision);
    assertDecisionShape(latest.body.decision);

    const history = await request(app).get("/v1/decisions").set(auth).expect(200);
    expect(history.body).toHaveProperty(responseEnvelopes.successWrappers.decisionList);
    expect(Array.isArray(history.body.decisions)).toBe(true);
    expect(history.body.decisions.length).toBeGreaterThan(0);
    assertDecisionShape(history.body.decisions[0]);

    const device = await request(app)
      .post("/v1/devices/register")
      .set(auth)
      .send({
        deviceId: "iphone-contract-1",
        fcmToken: "fcm-token-contract-1234567890",
        platform: "ios",
        appVersion: "1.0.0"
      })
      .expect(201);
    expect(device.body).toHaveProperty(responseEnvelopes.successWrappers.deviceRegistration);
    expect(device.body.device).toEqual(
      expect.objectContaining({
        deviceId: "iphone-contract-1",
        userId: "contract-user",
        platform: "ios"
      })
    );

    const settings = await request(app).get("/v1/settings").set(auth).expect(200);
    expect(settings.body).toHaveProperty(responseEnvelopes.successWrappers.settings);

    const journal = await request(app)
      .post("/v1/journal")
      .set(auth)
      .send({
        decisionId: latest.body.decision.decisionId,
        symbol: "XAUUSD",
        direction: "BUY",
        outcome: "OPEN"
      })
      .expect(201);
    expect(journal.body).toHaveProperty(responseEnvelopes.successWrappers.journalCreate);

    const journalList = await request(app).get("/v1/journal").set(auth).expect(200);
    expect(journalList.body).toHaveProperty(responseEnvelopes.successWrappers.journalList);
    expect(Array.isArray(journalList.body.entries)).toBe(true);

    const stats = await request(app).get("/v1/journal/statistics").set(auth).expect(200);
    expect(stats.body).toHaveProperty(responseEnvelopes.successWrappers.journalStatistics);

    const connection = await request(app)
      .post("/v1/tradingview/connections")
      .set(auth)
      .expect(201);
    expect(connection.body).toHaveProperty(responseEnvelopes.successWrappers.connectionCreate);
    expect(connection.body.connection).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        webhookUrl: expect.stringContaining("/webhooks/tradingview/"),
        webhookURL: expect.stringContaining("/webhooks/tradingview/"),
        payloadSecret: expect.any(String),
        hasSecret: true
      })
    );
    expect(connection.body.connection.webhookUrl).not.toMatch(
      /cloudfunctions\.net\/webhooks\/tradingview\//
    );
    expect(connection.body.webhookUrl).toContain("/webhooks/tradingview/");

    const rotated = await request(app)
      .post(`/v1/tradingview/connections/${connection.body.connection.id}/rotate`)
      .set(auth)
      .expect(200);
    expect(rotated.body).toHaveProperty(responseEnvelopes.successWrappers.connectionRotate);
    expect(rotated.body.secret).toEqual(expect.any(String));
    expect(rotated.body.secret).not.toBe(connection.body.secret);

    const revoked = await request(app)
      .delete(`/v1/tradingview/connections/${connection.body.connection.id}`)
      .set(auth)
      .expect(200);
    expect(revoked.body).toHaveProperty(responseEnvelopes.successWrappers.connectionRevoke);
    expect(revoked.body.connection.status).toBe("REVOKED");

    const testAlert = await request(app).post("/v1/tradingview/test").set(auth).expect(202);
    for (const field of responseEnvelopes.tradingViewTestFields) {
      expect(testAlert.body).toHaveProperty(field);
    }
    expect(testAlert.body.ok).toBe(true);
    expect(testAlert.body.connection).toEqual(expect.any(Object));

    const missing = await request(app)
      .get("/v1/decisions/does-not-exist")
      .set(auth)
      .expect(404);
    assertErrorEnvelope(missing.body);
  },
  15_000
  );

  it("does not trust client-supplied metadata.userId for ownership", async () => {
    await request(app)
      .post("/webhooks/tradingview/test-webhook-id")
      .send(
        freshPayload(strongBuyFixture, {
          webhookSecret: "contract-secret",
          metadata: { userId: "attacker-user" }
        })
      )
      .expect(202);

    const started = Date.now();
    while (Date.now() - started < 2000) {
      if (await store.latestDecision("contract-user")) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const attackerLatest = await request(app)
      .get("/v1/decisions/latest")
      .set({ "x-test-user-id": "attacker-user" })
      .expect(404);
    assertErrorEnvelope(attackerLatest.body);

    const ownerLatest = await request(app)
      .get("/v1/decisions/latest")
      .set(auth)
      .expect(200);
    expect(ownerLatest.body.decision.userId).toBe("contract-user");
  });
});
