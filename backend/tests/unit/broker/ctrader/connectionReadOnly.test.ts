/**
 * cTrader Demo read-only connection tests — OAuth, Demo filter, owner isolation,
 * stale quotes, refresh, preview-only, mutations denied.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type DocData = Record<string, unknown>;

const store = vi.hoisted(() => {
  const oauthStates = new Map<string, DocData>();
  const connections = new Map<string, DocData>();
  return {
    oauthStates,
    connections,
    reset() {
      oauthStates.clear();
      connections.clear();
    }
  };
});

vi.mock("firebase-admin/firestore", () => {
  function oauthDoc(id: string) {
    return {
      id,
      async set(data: DocData) {
        store.oauthStates.set(id, { ...data });
      },
      async get() {
        const data = store.oauthStates.get(id);
        return { exists: Boolean(data), data: () => data };
      },
      async update(data: DocData) {
        const prev = store.oauthStates.get(id) ?? {};
        store.oauthStates.set(id, { ...prev, ...data });
      }
    };
  }

  function connectionDoc(path: string) {
    return {
      path,
      async set(data: DocData, opts?: { merge?: boolean }) {
        const prev = store.connections.get(path) ?? {};
        store.connections.set(path, opts?.merge ? { ...prev, ...data } : { ...data });
      },
      async get() {
        const data = store.connections.get(path);
        return { exists: Boolean(data), data: () => data };
      }
    };
  }

  return {
    getFirestore: () => ({
      collection(name: string) {
        if (name !== "ctraderOAuthStates") {
          throw new Error(`unexpected collection ${name}`);
        }
        return {
          doc(id: string) {
            return oauthDoc(id);
          }
        };
      },
      doc(path: string) {
        return connectionDoc(path);
      },
      async runTransaction<T>(
        fn: (tx: {
          get: (ref: ReturnType<typeof oauthDoc>) => Promise<{
            exists: boolean;
            data: () => unknown;
          }>;
          update: (ref: ReturnType<typeof oauthDoc>, data: DocData) => void;
        }) => Promise<T>
      ) {
        return fn({
          get: async (ref) => ref.get(),
          update: (ref, data) => {
            const prev = store.oauthStates.get(ref.id) ?? {};
            store.oauthStates.set(ref.id, { ...prev, ...data });
          }
        });
      }
    })
  };
});

vi.mock("../../../../src/services/auth/ownerAuthConfig", () => ({
  loadOwnerAuthConfig: () => ({
    ownerEmail: "saviosyl@gmail.com",
    pinnedOwnerUid: "owner-uid-pinned-test"
  })
}));

import {
  assertPinnedOwner,
  buildDiagnostics,
  buildLiveDemoPreview,
  completeOAuthCallback,
  disconnectOwner,
  listDemoAccountsForOwner,
  readQuoteForOwner,
  redactForLogs,
  selectDemoAccount,
  startOAuthForOwner
} from "../../../../src/services/broker/ctrader/connectionService";
import {
  createMockOpenApiClient,
  isPepperstoneBrokerName
} from "../../../../src/services/broker/ctrader/openApiClient";
import {
  buildOAuthFrontendRedirect,
  createOAuthState,
  refreshAccessToken
} from "../../../../src/services/broker/ctrader/oauth";
import { resolveXauUsdFromCatalogue } from "../../../../src/services/broker/ctrader/symbolResolver";
import { friendlyCTraderError } from "../../../../src/services/broker/ctrader/friendlyErrors";
import { cTraderOrderApi } from "../../../../src/services/broker/ctrader/cTraderService";
import { snapshotCTraderFlags } from "../../../../src/services/broker/ctrader/flags";
import { maskAccountId } from "../../../../src/services/broker/ctrader/tokenCrypto";

const OWNER = "owner-uid-pinned-test";

function setCredEnv() {
  process.env.CTRADER_CLIENT_ID = "test-client";
  process.env.CTRADER_CLIENT_SECRET = "test-secret";
  process.env.CTRADER_REDIRECT_URI = "https://example.test/v1/ctrader/oauth/callback";
  process.env.CTRADER_ENVIRONMENT = "DEMO";
  process.env.CTRADER_TOKEN_ENCRYPTION_KEY = "unit-test-encryption-key-32b";
  process.env.CTRADER_OPENAPI_TRANSPORT = "mock";
  process.env.GOLDMETA_PINNED_OWNER_UID = OWNER;
}

describe("connection owner gate", () => {
  beforeEach(() => {
    store.reset();
    setCredEnv();
  });

  it("allows pinned owner and rejects others", () => {
    expect(() => assertPinnedOwner(OWNER)).not.toThrow();
    expect(() => assertPinnedOwner("other-user")).toThrow(/CTRADER_OWNER_ONLY/);
  });
});

describe("OAuth start + callback (mocked exchange)", () => {
  beforeEach(() => {
    store.reset();
    setCredEnv();
  });

  it("starts OAuth with state and completes Demo-only discovery", async () => {
    const started = await startOAuthForOwner(OWNER);
    expect(started.authorizationUrl).toContain("client_id=test-client");
    expect(started.authorizationUrl).toContain("code_challenge");
    expect(started.environment).toBe("DEMO");

    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            accessToken: "access-AAA",
            refreshToken: "refresh-BBB",
            expiresIn: 3600
          }),
          { status: 200 }
        )
    );

    const result = await completeOAuthCallback({
      code: "auth-code",
      state: started.state,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    expect(result.ownerUid).toBe(OWNER);
    expect(result.accounts.every((a) => !a.isLive)).toBe(true);

    await expect(
      completeOAuthCallback({
        code: "auth-code",
        state: started.state,
        fetchImpl: fetchImpl as unknown as typeof fetch
      })
    ).rejects.toThrow(/OAUTH_STATE_REPLAY/);
  });

  it("rejects non-owner OAuth start", async () => {
    await expect(startOAuthForOwner("intruder")).rejects.toThrow(/CTRADER_OWNER_ONLY/);
  });
});

describe("Demo account selection + Live rejection", () => {
  beforeEach(() => {
    store.reset();
    setCredEnv();
  });

  it("selects Demo Pepperstone and rejects Live", async () => {
    const started = await startOAuthForOwner(OWNER);
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            accessToken: "access-AAA",
            refreshToken: "refresh-BBB",
            expiresIn: 3600
          }),
          { status: 200 }
        )
    );
    await completeOAuthCallback({
      code: "c",
      state: started.state,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const demoApi = createMockOpenApiClient({
      accounts: [
        {
          ctidTraderAccountId: "222",
          isLive: false,
          brokerNameTitle: "Pepperstone Ltd",
          depositCurrency: "EUR",
          leverage: 50,
          accountIdMasked: maskAccountId("222"),
          accountKeyHash: "h2"
        },
        {
          ctidTraderAccountId: "333",
          isLive: true,
          brokerNameTitle: "Pepperstone",
          depositCurrency: "EUR",
          leverage: 50,
          accountIdMasked: maskAccountId("333"),
          accountKeyHash: "h3"
        }
      ]
    });

    const listed = await listDemoAccountsForOwner(OWNER, demoApi);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.ctidTraderAccountId).toBe("222");

    await expect(
      selectDemoAccount({
        ownerUid: OWNER,
        ctidTraderAccountId: "333",
        api: demoApi
      })
    ).rejects.toThrow(/CTRADER_LIVE_ACCOUNT_REJECTED/);

    const selected = await selectDemoAccount({
      ownerUid: OWNER,
      ctidTraderAccountId: "222",
      api: demoApi
    });
    expect(selected.account.isDemo).toBe(true);
    expect(selected.account.accountIdMasked).toMatch(/…|•/);
    expect(isPepperstoneBrokerName(selected.account.brokerName)).toBe(true);
    expect(selected.symbol?.symbolName).toMatch(/XAU|GOLD/i);
  });
});

describe("stale quote + preview-only", () => {
  beforeEach(() => {
    store.reset();
    setCredEnv();
  });

  it("rejects stale quotes and builds non-dispatchable preview", async () => {
    const started = await startOAuthForOwner(OWNER);
    await completeOAuthCallback({
      code: "c",
      state: started.state,
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            accessToken: "a",
            refreshToken: "r",
            expiresIn: 3600
          }),
          { status: 200 }
        )) as unknown as typeof fetch
    });
    const api = createMockOpenApiClient();
    await selectDemoAccount({
      ownerUid: OWNER,
      ctidTraderAccountId: "123456",
      api
    });

    const staleApi = createMockOpenApiClient({
      quote: {
        symbolId: "41",
        symbolName: "XAUUSD",
        bid: 2350,
        ask: 2350.4,
        spread: 0.4,
        timestamp: new Date(Date.now() - 60_000).toISOString(),
        marketStatus: "OPEN",
        stale: false,
        source: "LIVE"
      }
    });
    await expect(readQuoteForOwner(OWNER, staleApi)).rejects.toThrow(/CTRADER_QUOTE_STALE/);

    const liveApi = createMockOpenApiClient();
    const preview = await buildLiveDemoPreview({
      ownerUid: OWNER,
      decision: "BUY",
      api: liveApi
    });
    expect(preview.label).toMatch(/Preview only/i);
    expect(preview.preview.orderSubmissionEnabled).toBe(false);
  });
});

describe("diagnostics + disconnect + redaction", () => {
  beforeEach(() => {
    store.reset();
    setCredEnv();
  });

  it("builds diagnostics and clears tokens on disconnect", async () => {
    const started = await startOAuthForOwner(OWNER);
    await completeOAuthCallback({
      code: "c",
      state: started.state,
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            accessToken: "access-secret-token",
            refreshToken: "refresh-secret-token",
            expiresIn: 3600
          }),
          { status: 200 }
        )) as unknown as typeof fetch
    });
    const api = createMockOpenApiClient();
    await selectDemoAccount({
      ownerUid: OWNER,
      ctidTraderAccountId: "123456",
      confirmPepperstone: true,
      api
    });
    const diag = await buildDiagnostics(OWNER, api);
    expect(diag.credentialsConfigured).toBe(true);
    expect(diag.oauthConnected).toBe(true);
    expect(diag.demoAccountSelected).toBe(true);
    expect(diag.tradingSafelyLocked).toBe(true);
    expect(diag.autoTrade).toBe("OFF");
    expect(JSON.stringify(diag)).not.toMatch(/access-secret|refresh-secret/);

    await disconnectOwner(OWNER);
    await expect(listDemoAccountsForOwner(OWNER, api)).rejects.toThrow(/CTRADER_NOT_CONNECTED/);
  });

  it("redacts token-like strings", () => {
    expect(redactForLogs("Bearer abc.def.ghi")).toBe("[REDACTED]");
    expect(String(redactForLogs("eyJhbGciOiJIUzI1NiJ9.payload.sig"))).toBe("[REDACTED]");
  });
});

describe("symbol suffix variants + refresh helper + friendly errors", () => {
  it("resolves XAUUSD.a style with assets", () => {
    const sym = resolveXauUsdFromCatalogue([
      {
        symbolId: 77,
        symbolName: "XAUUSD.a",
        baseAsset: "XAU",
        quoteAsset: "USD",
        digits: 2,
        tickSize: 0.01,
        minVolume: 0.01,
        stepVolume: 0.01,
        maxVolume: 50,
        lotSize: 100
      }
    ]);
    expect(sym?.symbolName).toBe("XAUUSD.a");
    expect(sym?.minVolume).toBe(0.01);
    expect(sym?.volumeStep).toBe(0.01);
  });

  it("refreshes tokens without logging secrets", async () => {
    process.env.CTRADER_REDIRECT_URI = "https://example.test/cb";
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 1200
          }),
          { status: 200 }
        )
    );
    const tokens = await refreshAccessToken({
      refreshToken: "old-refresh",
      clientId: "c",
      clientSecret: "s",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    expect(tokens.accessToken).toBe("new-access");
    expect(tokens.refreshToken).toBe("new-refresh");
  });

  it("builds frontend redirect without tokens", () => {
    const url = buildOAuthFrontendRedirect({
      webOrigin: "https://goldmeta.example",
      status: "ok"
    });
    expect(url).toContain("/brokers");
    expect(url).toContain("ctrader=oauth_ok");
    expect(url.toLowerCase()).not.toContain("token");
    expect(url.toLowerCase()).not.toContain("secret");
  });

  it("maps friendly errors", () => {
    expect(friendlyCTraderError("CTRADER_LIVE_ACCOUNT_REJECTED").impact).toMatch(/Demo/i);
    expect(friendlyCTraderError("OAUTH_STATE_REPLAY").nextStep).toMatch(/fresh/i);
  });

  it("keeps mutations and AutoTrade hard-disabled", () => {
    expect(() => cTraderOrderApi.placeMarketBuy()).toThrow();
    const flags = snapshotCTraderFlags({
      CTRADER_DEMO_ORDER_SUBMISSION_ENABLED: "true",
      CTRADER_LIVE_ENABLED: "true",
      BROKER_EXECUTION_ENABLED: "true"
    });
    expect(flags.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED).toBe(false);
  });

  it("createOAuthState expires within 10 minutes", () => {
    process.env.CTRADER_REDIRECT_URI = "https://example.test/cb";
    process.env.CTRADER_CLIENT_ID = "x";
    process.env.CTRADER_CLIENT_SECRET = "y";
    process.env.CTRADER_ENVIRONMENT = "DEMO";
    const rec = createOAuthState(OWNER);
    const ttl = Date.parse(rec.expiresAt) - Date.parse(rec.createdAt);
    expect(ttl).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(ttl).toBeGreaterThan(9 * 60 * 1000);
  });
});
