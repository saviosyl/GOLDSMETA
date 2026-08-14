import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  FAST_AUTOTRADE_V1_DEMO_ONLY,
  FastAutoTradeLiveBlockedError,
  assertFastAutoTradeDemoOnly,
  evaluateFastAutoTradeDemoLock
} from "../../../../../src/services/broker/ctrader/fastAutoTrade";

describe("FAST_AUTOTRADE_V1 demo lock", () => {
  it("blocks Live automated FAST orders", () => {
    expect(
      evaluateFastAutoTradeDemoLock({
        strategyId: "FAST_AUTOTRADE_V1",
        accountIsLive: true,
        environment: "LIVE"
      })
    ).toEqual({ ok: false, reason: FAST_AUTOTRADE_V1_DEMO_ONLY });
    expect(() =>
      assertFastAutoTradeDemoOnly({
        strategyId: "FAST_AUTOTRADE_V1",
        accountIsLive: true,
        environment: "LIVE"
      })
    ).toThrow(FastAutoTradeLiveBlockedError);
  });

  it("allows Demo FAST orders", () => {
    expect(
      evaluateFastAutoTradeDemoLock({
        strategyId: "FAST_AUTOTRADE_V1",
        accountIsLive: false,
        environment: "DEMO"
      }).ok
    ).toBe(true);
  });

  it("does not apply to non-FAST strategies (manual / other AutoTrade)", () => {
    expect(
      evaluateFastAutoTradeDemoLock({
        strategyId: "LEGACY_V1",
        accountIsLive: true,
        environment: "LIVE"
      }).ok
    ).toBe(true);
  });
});

describe("submitDemoMarketOrder FAST live block", () => {
  const prev = process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
  const prevClientId = process.env.CTRADER_CLIENT_ID;
  const prevClientSecret = process.env.CTRADER_CLIENT_SECRET;

  beforeEach(() => {
    process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = "true";
    process.env.CTRADER_CLIENT_ID = "cid";
    process.env.CTRADER_CLIENT_SECRET = "csecret";
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
    else process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = prev;
    if (prevClientId === undefined) delete process.env.CTRADER_CLIENT_ID;
    else process.env.CTRADER_CLIENT_ID = prevClientId;
    if (prevClientSecret === undefined) delete process.env.CTRADER_CLIENT_SECRET;
    else process.env.CTRADER_CLIENT_SECRET = prevClientSecret;
    vi.resetModules();
    vi.doUnmock("../../../../../src/services/broker/ctrader/connectionStore");
  });

  it("throws FAST_AUTOTRADE_V1_DEMO_ONLY on live account", async () => {
    vi.resetModules();
    vi.doMock("../../../../../src/services/broker/ctrader/connectionStore", () => ({
      getConnection: vi.fn(async () => ({
        selectedAccountId: "999",
        selectedAccountIsLive: true,
        environment: "LIVE",
        oauthScope: "trading",
        brokerConfirmedPepperstone: true,
        symbolId: "41",
        tokens: {
          ciphertext: "v1:old",
          accessExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          refreshedAt: null,
          tokenVersion: 1
        }
      })),
      loadTokenEncryptionSecret: vi.fn(() => "test-encryption-secret-key"),
      persistRotatedTokensAtomic: vi.fn()
    }));
    vi.doMock("../../../../../src/services/broker/ctrader/oauth", () => ({
      refreshAccessToken: vi.fn()
    }));
    vi.doMock("../../../../../src/services/broker/ctrader/tokenCrypto", () => ({
      decryptTokenPayload: vi.fn(() =>
        JSON.stringify({ accessToken: "access", refreshToken: "refresh" })
      ),
      encryptTokenPayload: vi.fn(() => "v1:enc")
    }));
    vi.doMock("../../../../../src/services/broker/ctrader/config", () => ({
      loadCTraderConfig: vi.fn(() => ({
        configured: true,
        clientId: "cid",
        clientSecret: "csecret",
        environment: "DEMO"
      }))
    }));
    const { submitDemoMarketOrder } = await import(
      "../../../../../src/services/broker/ctrader/demoOrderExecution"
    );
    await expect(
      submitDemoMarketOrder({
        ownerUid: "u1",
        side: "BUY",
        lots: 0.01,
        strategyId: "FAST_AUTOTRADE_V1"
      })
    ).rejects.toThrow(/FAST_AUTOTRADE_V1_DEMO_ONLY/);
  });
});
