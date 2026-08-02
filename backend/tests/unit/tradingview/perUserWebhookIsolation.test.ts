/**
 * Per-user webhook isolation + hashed secrets + standard defaults.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type DocData = Record<string, unknown>;

const docs = vi.hoisted(() => {
  const map = new Map<string, DocData>();
  return {
    map,
    reset() {
      map.clear();
    }
  };
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    doc(path: string) {
      return {
        path,
        async set(data: DocData, opts?: { merge?: boolean }) {
          const prev = docs.map.get(path) ?? {};
          docs.map.set(path, opts?.merge ? { ...prev, ...data } : { ...data });
        },
        async get() {
          const data = docs.map.get(path);
          return { exists: Boolean(data), data: () => data };
        }
      };
    }
  })
}));

import { InMemoryGoldMetaStore } from "../../../src/services/storage/inMemoryStore";
import { validateWebhookPayload, WebhookValidationError } from "../../../src/services/webhook/validatePayload";
import {
  ensureStandardDefaults,
  generateWebhookSecret,
  getUserTradingViewConnection,
  hashWebhookToken,
  resetTradingViewProfileMemory,
  restoreStandardSetup,
  saveCustomMapping,
  saveUserTradingViewConnection
} from "../../../src/services/tradingview/userTradingViewConnection";
import { STANDARD_TEMPLATE_ID } from "../../../src/services/tradingview/standardTemplate";

const USER_A = "user-aaaa-11111111";
const USER_B = "user-bbbb-22222222";

function validPayload(overrides: Record<string, unknown> = {}) {
  const ts = new Date().toISOString();
  return {
    schemaVersion: "1.0",
    source: "tradingview",
    eventId: `evt-${Math.random().toString(16).slice(2)}`,
    webhookSecret: null,
    symbol: "XAUUSD",
    exchange: "OANDA",
    timeframe: "15",
    eventType: "BAR_CLOSE",
    barTime: ts,
    sentAt: ts,
    isConfirmedBar: true,
    indicatorName: "GoldMetaBridge",
    ohlcv: { open: 2400, high: 2410, low: 2390, close: 2405, volume: 10 },
    levels: { pocAll: 2400, vahAll: 2410, valAll: 2390 },
    sessionVolumeProfile: null,
    marketProfile: null,
    trend: { direction: "BULLISH", strength: 80, components: [] },
    confirmationCandle: {
      confirmed: true,
      direction: "BULLISH",
      classification: "CONTINUATION",
      isClosed: true
    },
    optionalIndicators: null,
    metadata: { templateVersion: "1" },
    ...overrides
  };
}

describe("per-user TradingView webhooks", () => {
  let store: InMemoryGoldMetaStore;

  beforeEach(() => {
    docs.reset();
    resetTradingViewProfileMemory();
    store = new InMemoryGoldMetaStore();
  });

  it("gives each user a unique webhook and stores only hashes", async () => {
    const secretA = generateWebhookSecret();
    const secretB = generateWebhookSecret();
    const connA = await store.createWebhookConnection({
      userId: USER_A,
      webhookId: "wh-user-a-unique",
      secret: null,
      secretHash: hashWebhookToken(secretA)
    });
    const connB = await store.createWebhookConnection({
      userId: USER_B,
      webhookId: "wh-user-b-unique",
      secret: null,
      secretHash: hashWebhookToken(secretB)
    });
    expect(connA.webhookId).not.toBe(connB.webhookId);
    expect(connA.secret).toBeNull();
    expect(connB.secret).toBeNull();
    expect(connA.secretHash).toBeTruthy();
    expect(connA.secretHash).not.toBe(secretA);

    await saveUserTradingViewConnection(USER_A, {
      webhookId: connA.webhookId,
      webhookTokenHash: connA.secretHash
    });
    await saveUserTradingViewConnection(USER_B, {
      webhookId: connB.webhookId,
      webhookTokenHash: connB.secretHash
    });

    const profileA = await getUserTradingViewConnection(USER_A);
    const profileB = await getUserTradingViewConnection(USER_B);
    expect(profileA.webhookId).toBe(connA.webhookId);
    expect(profileB.webhookId).toBe(connB.webhookId);
    expect(profileA.webhookId).not.toBe(profileB.webhookId);
  });

  it("routes a signal only to the owning user decision path identity", async () => {
    await store.createWebhookConnection({
      userId: USER_A,
      webhookId: "wh-a-only",
      secret: null,
      secretHash: hashWebhookToken("sa")
    });
    await store.createWebhookConnection({
      userId: USER_B,
      webhookId: "wh-b-only",
      secret: null,
      secretHash: hashWebhookToken("sb")
    });

    const forA = await validateWebhookPayload(store, "wh-a-only", validPayload());
    expect(forA.userId).toBe(USER_A);
    expect(forA.userId).not.toBe(USER_B);

    const forB = await validateWebhookPayload(store, "wh-b-only", validPayload());
    expect(forB.userId).toBe(USER_B);
  });

  it("rejects one user posting to another webhook id", async () => {
    await store.createWebhookConnection({
      userId: USER_A,
      webhookId: "wh-a-guard",
      secret: null,
      secretHash: hashWebhookToken("tok-a")
    });
    // USER_B cannot invent USER_A's webhook — unknown id fails
    await expect(
      validateWebhookPayload(store, "wh-does-not-exist", validPayload())
    ).rejects.toBeInstanceOf(WebhookValidationError);
  });

  it("accepts standard alert and rejects unsupported symbol / stale", async () => {
    await store.createWebhookConnection({
      userId: USER_A,
      webhookId: "wh-std",
      secret: null,
      secretHash: null
    });
    const ok = await validateWebhookPayload(
      store,
      "wh-std",
      validPayload({ symbol: "OANDA:XAUUSD" })
    );
    expect(ok.payload.symbol).toBe("XAUUSD");

    await expect(
      validateWebhookPayload(store, "wh-std", validPayload({ symbol: "BTCUSD" }))
    ).rejects.toMatchObject({ code: "UNSUPPORTED_SYMBOL" });

    const stale = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    await expect(
      validateWebhookPayload(store, "wh-std", validPayload({ sentAt: stale }))
    ).rejects.toMatchObject({ code: "STALE_TIMESTAMP" });
  });

  it("defaults to standard template and restore does not affect another user", async () => {
    const a = await ensureStandardDefaults(USER_A);
    expect(a.templateId).toBe(STANDARD_TEMPLATE_ID);
    await saveCustomMapping(USER_A, [
      { tradingViewField: "trend_value", goldMetaField: "trendMeter", required: false }
    ], 600);
    await ensureStandardDefaults(USER_B);
    await restoreStandardSetup(USER_A);
    const aAfter = await getUserTradingViewConnection(USER_A);
    const bAfter = await getUserTradingViewConnection(USER_B);
    expect(aAfter.templateMode).toBe("standard");
    expect(bAfter.uid).toBe(USER_B);
    expect(bAfter.templateMode).toBe("standard");
  });
});
