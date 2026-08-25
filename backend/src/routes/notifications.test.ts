import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../index";
import { InMemoryStore } from "../services/storage/inMemoryStore";
import { resetRateLimits } from "../middleware/rateLimit";
import * as webPush from "../services/notifications/webPush";
import * as firebaseAdmin from "../services/firebaseAdmin";

vi.mock("../services/firebaseAdmin", async () => {
  const actual = await vi.importActual<typeof import("../services/firebaseAdmin")>(
    "../services/firebaseAdmin"
  );
  return {
    ...actual,
    sendFirebaseMessages: vi.fn(async () => 0)
  };
});

type TestPushBody = {
  ok?: boolean;
  webSent?: number;
  fcmSent?: number;
  message?: string;
  error?: { code?: string; message?: string };
};

describe("POST /v1/notifications/test", () => {
  let store: InMemoryStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetRateLimits();
    store = new InMemoryStore();
    app = createApp({ store });
    process.env.VAPID_PUBLIC_KEY = "Btest-public-key-value-for-unit-tests-0123456789";
    process.env.VAPID_PRIVATE_KEY = "test-private-key-value-012345678901234";
    vi.spyOn(webPush, "isWebPushConfigured").mockReturnValue(true);
    vi.spyOn(webPush, "sendWebPushToUser").mockResolvedValue(1);
    vi.mocked(firebaseAdmin.sendFirebaseMessages).mockResolvedValue(0);
  });

  it("sends a real Web Push payload and reports webSent", async () => {
    store.upsertWebPushSubscription({
      userId: "owner-1",
      subscriptionId: "sub-1",
      endpoint: "https://web.push.example/endpoint",
      expirationTime: null,
      keys: { p256dh: "p256dh-key-value", auth: "auth-key-value" },
      registeredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const res = await request(app)
      .post("/v1/notifications/test")
      .set("x-test-user-id", "owner-1")
      .send({});

    const body = res.body as TestPushBody;
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.webSent).toBe(1);
    expect(body.message).toMatch(/GoldMeta Test Alert/i);
    expect(webPush.sendWebPushToUser).toHaveBeenCalledWith(
      store,
      "owner-1",
      expect.objectContaining({
        title: "GoldMeta Test Alert",
        body: "iPhone notifications are working."
      })
    );
  });

  it("rejects when no subscription or FCM device exists", async () => {
    const res = await request(app)
      .post("/v1/notifications/test")
      .set("x-test-user-id", "owner-1")
      .send({});
    const body = res.body as TestPushBody;
    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("NO_PUSH_TARGETS");
  });

  it("rejects when VAPID is missing and no FCM devices exist", async () => {
    vi.spyOn(webPush, "isWebPushConfigured").mockReturnValue(false);
    const res = await request(app)
      .post("/v1/notifications/test")
      .set("x-test-user-id", "owner-1")
      .send({});
    const body = res.body as TestPushBody;
    expect(res.status).toBe(503);
    expect(body.error?.code).toBe("SERVER_CONFIGURATION_MISSING");
  });
});
