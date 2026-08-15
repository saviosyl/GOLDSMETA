import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../../src/services/broker/ctrader/connectionStore", () => ({
  getConnection: vi.fn(),
  loadTokenEncryptionSecret: vi.fn(() => "test-encryption-secret-key"),
  persistRotatedTokensAtomic: vi.fn()
}));

vi.mock("../../../../src/services/broker/ctrader/oauth", () => ({
  refreshAccessToken: vi.fn()
}));

vi.mock("../../../../src/services/broker/ctrader/tokenCrypto", () => ({
  decryptTokenPayload: vi.fn(() =>
    JSON.stringify({ accessToken: "access", refreshToken: "refresh" })
  ),
  encryptTokenPayload: vi.fn(() => "v1:enc")
}));

vi.mock("../../../../src/services/broker/ctrader/config", () => ({
  loadCTraderConfig: vi.fn(() => ({
    configured: true,
    clientId: "cid",
    clientSecret: "csecret",
    environment: "DEMO"
  }))
}));

vi.mock("../../../../src/services/broker/ctrader/openApiClient", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/services/broker/ctrader/openApiClient")
  >("../../../../src/services/broker/ctrader/openApiClient");
  return {
    ...actual,
    createOpenApiClient: () => ({
      placeDemoMarketOrder: vi.fn(async (args: { side: string; volume: number }) => ({
        accepted: true,
        executionType: "ORDER_FILLED",
        orderId: "1",
        positionId: "2",
        errorCode: null,
        clientOrderId: "c1",
        raw: { side: args.side, volume: args.volume }
      }))
    })
  };
});

import { getConnection } from "../../../../src/services/broker/ctrader/connectionStore";
import { submitDemoMarketOrder } from "../../../../src/services/broker/ctrader/demoOrderExecution";
import { CTraderMutationDisabledError } from "../../../../src/services/broker/ctrader/mutationGuard";

describe("submitDemoMarketOrder", () => {
  const prev = process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
  const prevClientId = process.env.CTRADER_CLIENT_ID;
  const prevClientSecret = process.env.CTRADER_CLIENT_SECRET;

  beforeEach(() => {
    process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = "true";
    process.env.CTRADER_CLIENT_ID = "cid";
    process.env.CTRADER_CLIENT_SECRET = "csecret";
    process.env.FAST_AUTOTRADE_V1_ENABLED = "false";
    process.env.DEMO_OPPORTUNITY_MODE = "ACTIVE_DEMO";
    vi.mocked(getConnection).mockResolvedValue({
      selectedAccountId: "123",
      selectedAccountIsLive: false,
      environment: "DEMO",
      oauthScope: "trading",
      brokerConfirmedPepperstone: true,
      symbolId: "41",
      tokens: {
        ciphertext: "v1:old",
        accessExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        refreshedAt: null,
        tokenVersion: 1
      }
    } as never);
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
    else process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = prev;
    if (prevClientId === undefined) delete process.env.CTRADER_CLIENT_ID;
    else process.env.CTRADER_CLIENT_ID = prevClientId;
    if (prevClientSecret === undefined) delete process.env.CTRADER_CLIENT_SECRET;
    else process.env.CTRADER_CLIENT_SECRET = prevClientSecret;
  });

  it("rejects when Demo submission is off", async () => {
    delete process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
    await expect(
      submitDemoMarketOrder({ ownerUid: "u1", side: "BUY", lots: 0.01 })
    ).rejects.toBeInstanceOf(CTraderMutationDisabledError);
  });

  it("rejects Live accounts", async () => {
    vi.mocked(getConnection).mockResolvedValue({
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
    } as never);
    await expect(
      submitDemoMarketOrder({ ownerUid: "u1", side: "BUY", lots: 0.01 })
    ).rejects.toThrow(/LIVE_ACCOUNT_FORBIDDEN/);
  });

  it("places a Demo market order when gated correctly", async () => {
    const result = await submitDemoMarketOrder({
      ownerUid: "u1",
      side: "BUY",
      lots: 0.01,
      stopLoss: 2300,
      takeProfit: 2400,
      entryHint: 2350
    });
    expect(result.accepted).toBe(true);
    expect(result.orderId).toBe("1");
  });
});
