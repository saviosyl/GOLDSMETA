import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConnection: vi.fn(),
  loadTokenEncryptionSecret: vi.fn(),
  persistRotatedTokensAtomic: vi.fn(),
  refreshAccessToken: vi.fn(),
  decryptTokenPayload: vi.fn()
}));

vi.mock("../../../src/services/broker/ctrader/config", () => ({
  loadCTraderConfig: () => ({ configured: true })
}));

vi.mock("../../../src/services/broker/ctrader/connectionStore", () => ({
  getConnection: mocks.getConnection,
  loadTokenEncryptionSecret: mocks.loadTokenEncryptionSecret,
  persistRotatedTokensAtomic: mocks.persistRotatedTokensAtomic
}));

vi.mock("../../../src/services/broker/ctrader/oauth", () => ({
  refreshAccessToken: mocks.refreshAccessToken
}));

vi.mock("../../../src/services/broker/ctrader/openApiClient", () => ({
  createOpenApiClient: vi.fn(() => ({}))
}));

vi.mock("../../../src/services/broker/ctrader/tokenCrypto", () => ({
  decryptTokenPayload: mocks.decryptTokenPayload,
  encryptTokenPayload: vi.fn(() => "enc")
}));

vi.mock("../../../src/services/broker/ctrader/flags", () => ({
  isCTraderLiveEnabled: () => false,
  isCTraderDemoOrderSubmissionEnabled: () => true
}));

import {
  fetchGoldHunterAccountSnapshot,
  GH_ACCOUNT_SNAPSHOT_STALE_MS,
  resetGoldHunterAccountSnapshotCache
} from "../../../src/services/goldHunterAdmin/accountSnapshot";

const OWNER = "gh-account-cache-owner";

function authClient(capturedAt: string) {
  return {
    fetchAuthoritativeDemoMarginSnapshot: vi.fn(async () => ({
      ok: true as const,
      snapshot: {
        balance: 10_000,
        equity: 10_010,
        usedMargin: 100,
        freeMargin: 9_900,
        openPositionCount: 0,
        capturedAt
      },
      notes: []
    }))
  };
}

function failedClient(note = "broker_timeout") {
  return {
    fetchAuthoritativeDemoMarginSnapshot: vi.fn(async () => ({
      ok: false as const,
      notes: [note]
    }))
  };
}

beforeEach(() => {
  resetGoldHunterAccountSnapshotCache();
  vi.clearAllMocks();
  process.env.CTRADER_CLIENT_ID = "client";
  process.env.CTRADER_CLIENT_SECRET = "secret";
  mocks.loadTokenEncryptionSecret.mockReturnValue("enc-key");
  mocks.decryptTokenPayload.mockReturnValue(
    JSON.stringify({
      accessToken: "access",
      refreshToken: "refresh"
    })
  );
  mocks.refreshAccessToken.mockResolvedValue({
    accessToken: "new-access",
    refreshToken: "new-refresh",
    expiresIn: 3600
  });
  mocks.persistRotatedTokensAtomic.mockResolvedValue(undefined);
  mocks.getConnection.mockResolvedValue({
    selectedAccountId: "48014710",
    selectedAccountIsLive: false,
    environment: "DEMO",
    selectedAccountMasked: "***",
    brokerName: "Pepperstone",
    currency: "EUR",
    balance: 10_000,
    lastSyncAt: "2026-08-25T08:00:00.000Z",
    tokens: {
      ciphertext: "cipher",
      accessExpiresAt: "2099-01-01T00:00:00.000Z",
      refreshedAt: "2026-08-25T08:00:00.000Z",
      tokenVersion: 1
    }
  } as never);
});

describe("Gold Hunter account snapshot cache freshness", () => {
  it("reuses a valid cached authoritative snapshot just inside 60s and keeps age monotonic", async () => {
    const now0 = Date.parse("2026-08-25T08:00:00.000Z");
    const capturedAt = new Date(now0 - (GH_ACCOUNT_SNAPSHOT_STALE_MS - 100)).toISOString();
    const initialClient = authClient(capturedAt);
    const first = await fetchGoldHunterAccountSnapshot({
      ownerUid: OWNER,
      nowMs: now0,
      allowRiskValidCache: true,
      openApiClient: initialClient as never
    });
    expect(first.validForRisk).toBe(true);

    const secondClient = authClient(new Date(now0).toISOString());
    const second = await fetchGoldHunterAccountSnapshot({
      ownerUid: OWNER,
      nowMs: now0 + 50,
      allowRiskValidCache: true,
      openApiClient: secondClient as never
    });
    expect(second.validForRisk).toBe(true);
    expect(second.authState).toBe("AUTHORISED");
    expect(second.ageMs).toBe(GH_ACCOUNT_SNAPSHOT_STALE_MS - 50);
    const thirdClient = authClient(new Date(now0).toISOString());
    const third = await fetchGoldHunterAccountSnapshot({
      ownerUid: OWNER,
      nowMs: now0 + 80,
      allowRiskValidCache: true,
      openApiClient: thirdClient as never
    });
    expect(third.validForRisk).toBe(true);
    expect(third.ageMs).toBe((second.ageMs ?? 0) + 30);
    expect(initialClient.fetchAuthoritativeDemoMarginSnapshot).toHaveBeenCalledTimes(1);
    expect(secondClient.fetchAuthoritativeDemoMarginSnapshot).toHaveBeenCalledTimes(0);
    expect(thirdClient.fetchAuthoritativeDemoMarginSnapshot).toHaveBeenCalledTimes(0);
  });

  it("rejects cached snapshots older than 60s and fails closed when refresh fails", async () => {
    const now0 = Date.parse("2026-08-25T08:00:00.000Z");
    const capturedAt = new Date(now0 - (GH_ACCOUNT_SNAPSHOT_STALE_MS - 10)).toISOString();
    const initialClient = authClient(capturedAt);
    await fetchGoldHunterAccountSnapshot({
      ownerUid: OWNER,
      nowMs: now0,
      allowRiskValidCache: true,
      openApiClient: initialClient as never
    });

    const refreshClient = failedClient("refresh_failed_after_stale_cache");
    const refreshed = await fetchGoldHunterAccountSnapshot({
      ownerUid: OWNER,
      nowMs: now0 + 20,
      allowRiskValidCache: true,
      openApiClient: refreshClient as never
    });
    expect(refreshed.validForRisk).toBe(false);
    expect(refreshed.authState).not.toBe("AUTHORISED");
    expect(refreshClient.fetchAuthoritativeDemoMarginSnapshot).toHaveBeenCalledTimes(1);
  });

  it("rejects future-dated cached snapshots and fails closed when refresh fails", async () => {
    const now0 = Date.parse("2026-08-25T08:00:00.000Z");
    const futureCapturedAt = new Date(now0 + 5_000).toISOString();
    const initialClient = authClient(futureCapturedAt);
    await fetchGoldHunterAccountSnapshot({
      ownerUid: OWNER,
      nowMs: now0,
      allowRiskValidCache: true,
      openApiClient: initialClient as never
    });

    const refreshClient = failedClient("refresh_failed_after_future_cache");
    const refreshed = await fetchGoldHunterAccountSnapshot({
      ownerUid: OWNER,
      nowMs: now0 + 1_000,
      allowRiskValidCache: true,
      openApiClient: refreshClient as never
    });
    expect(refreshed.validForRisk).toBe(false);
    expect(refreshed.authState).not.toBe("AUTHORISED");
    expect(refreshClient.fetchAuthoritativeDemoMarginSnapshot).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid capturedAt cache and fails closed on refresh failure", async () => {
    const now0 = Date.parse("2026-08-25T08:00:00.000Z");
    const initialClient = authClient("invalid-captured-at");
    await fetchGoldHunterAccountSnapshot({
      ownerUid: OWNER,
      nowMs: now0,
      allowRiskValidCache: true,
      openApiClient: initialClient as never
    });

    const refreshClient = failedClient("refresh_failed_after_invalid_timestamp");
    const refreshed = await fetchGoldHunterAccountSnapshot({
      ownerUid: OWNER,
      nowMs: now0 + 1_000,
      allowRiskValidCache: true,
      openApiClient: refreshClient as never
    });
    expect(refreshed.validForRisk).toBe(false);
    expect(refreshed.authState).not.toBe("AUTHORISED");
    expect(refreshClient.fetchAuthoritativeDemoMarginSnapshot).toHaveBeenCalledTimes(1);
  });
});
