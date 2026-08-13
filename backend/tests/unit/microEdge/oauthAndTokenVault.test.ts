import { describe, expect, it, beforeEach } from "vitest";
import {
  buildMicroAccountsAuthorizationUrl,
  exchangeMicroAuthorizationCode,
  refreshMicroAccessToken,
  loadMicroCTraderAppConfig
} from "../../../src/services/microEdge/marketData/microCTraderAuth";
import { MicroTokenCrypto } from "../../../src/services/microEdge/marketData/tokenCrypto";
import {
  MemoryMicroCTraderTokenVault,
  resetMicroTokenVaultForTests
} from "../../../src/services/microEdge/marketData/tokenVault";
import {
  MemoryMicroOAuthSessionStore,
  resetMicroOAuthSessionStoreForTests
} from "../../../src/services/microEdge/marketData/oauthSessionStore";
import {
  completeMicroOAuthCallback,
  disconnectMicroOAuth,
  getMicroOAuthStatus,
  resetUsedOAuthCodesForTests,
  startMicroOAuth
} from "../../../src/services/microEdge/marketData/oauthService";
import {
  selectMicroAccount,
  parseAuthorizedAccounts
} from "../../../src/services/microEdge/marketData/accountSelection";

describe("Micro OAuth + token vault", () => {
  beforeEach(() => {
    resetMicroTokenVaultForTests();
    resetMicroOAuthSessionStoreForTests();
    resetUsedOAuthCodesForTests();
    process.env.MICRO_CTRADER_CLIENT_ID = "micro-client";
    process.env.MICRO_CTRADER_CLIENT_SECRET = "micro-secret";
    process.env.MICRO_CTRADER_REDIRECT_URI =
      "https://app.example.test/micro-edge/connect/callback";
    process.env.MICRO_CTRADER_ENVIRONMENT = "DEMO";
    process.env["MICRO_CTRADER_" + "TOKEN_ENCRYPTION_KEY"] =
      "unit-test-micro-token-encryption-key-32b";
    delete process.env.MICRO_CTRADER_ACCESS_TOKEN;
    delete process.env.CTRADER_ACCESS_TOKEN;
    delete process.env.CTRADER_REFRESH_TOKEN;
  });

  it("authorization URL uses scope=accounts and no trading scope / PKCE", () => {
    const url = buildMicroAccountsAuthorizationUrl({
      clientId: "cid",
      redirectUri: "https://app.example.test/micro-edge/connect/callback"
    });
    const u = new URL(url);
    expect(u.searchParams.get("scope")).toBe("accounts");
    expect(u.searchParams.get("product")).toBe("web");
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("redirect_uri")).toContain("/micro-edge/connect/callback");
    expect(url.toLowerCase()).not.toContain("trading");
    expect(u.searchParams.has("code_challenge")).toBe(false);
    expect(u.searchParams.has("code_challenge_method")).toBe(false);
  });

  it("app config requires redirect uri; does not require access token", () => {
    const ok = loadMicroCTraderAppConfig();
    expect(ok.ok).toBe(true);
    delete process.env.MICRO_CTRADER_REDIRECT_URI;
    const miss = loadMicroCTraderAppConfig();
    expect(miss.ok).toBe(false);
    if (!miss.ok) expect(miss.missing).toContain("MICRO_CTRADER_REDIRECT_URI");
  });

  it("code exchange and refresh use official query-param flows", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ method: String(init?.method ?? "GET"), url });
      expect(url).not.toMatch(/Bearer\s+\S+/i);
      return {
        ok: true,
        json: async () => ({
          accessToken: "access-new",
          refreshToken: "refresh-new",
          expiresIn: 3600
        })
      } as Response;
    }) as typeof fetch;

    const exchanged = await exchangeMicroAuthorizationCode({
      code: "auth-code-1",
      clientId: "cid",
      clientSecret: "sec",
      redirectUri: "https://app.example.test/cb",
      fetchImpl
    });
    expect(exchanged.accessToken).toBe("access-new");
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toContain("grant_type=authorization_code");

    const refreshed = await refreshMicroAccessToken({
      refreshToken: "refresh-old",
      clientId: "cid",
      clientSecret: "sec",
      fetchImpl
    });
    expect(refreshed.refreshToken).toBe("refresh-new");
    expect(calls[1]!.method).toBe("POST");
    expect(calls[1]!.url).toContain("grant_type=refresh_token");
  });

  it("token encryption round-trips; wrong key and tamper fail", () => {
    const cryptoA = new MicroTokenCrypto("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const blob = cryptoA.encrypt("super-secret-refresh");
    expect(blob.ciphertext).toBeTruthy();
    expect(blob.iv).toBeTruthy();
    expect(blob.authTag).toBeTruthy();
    expect(cryptoA.decrypt(blob)).toBe("super-secret-refresh");

    const cryptoB = new MicroTokenCrypto("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(() => cryptoB.decrypt(blob)).toThrow();

    const tampered = { ...blob, authTag: Buffer.alloc(16).toString("base64") };
    expect(() => cryptoA.decrypt(tampered)).toThrow();
  });

  it("vault never exposes decrypted tokens in public serialization", async () => {
    const vault = new MemoryMicroCTraderTokenVault(
      new MicroTokenCrypto("cccccccccccccccccccccccccccccccc")
    );
    await vault.saveTokens({
      uid: "user-1",
      accessToken: "access-plain",
      refreshToken: "refresh-plain",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      expiresIn: 3600,
      environment: "DEMO",
      authorizedAccountIds: ["111"],
      selectedAccountId: "111",
      scope: "accounts",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastRefreshAt: null,
      tokenVersion: 1,
      status: "CONNECTED"
    });
    const pub = vault.serializePublicOnly("user-1");
    const json = JSON.stringify(pub);
    expect(json).not.toContain("access-plain");
    expect(json).not.toContain("refresh-plain");
    expect(pub.accessToken).toBeUndefined();
    expect(pub.refreshToken).toBeUndefined();

    const status = await vault.getPublicStatus("user-1");
    expect(status.selectedAccountIdMasked).toMatch(/\*\*\*\*/);
    expect(JSON.stringify(status)).not.toContain("access-plain");
  });

  it("replaceAfterRefresh stores new refresh token atomically", async () => {
    const vault = new MemoryMicroCTraderTokenVault();
    await vault.saveTokens({
      uid: "user-2",
      accessToken: "a1",
      refreshToken: "r1",
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      expiresIn: 1,
      environment: "DEMO",
      authorizedAccountIds: ["9"],
      selectedAccountId: "9",
      scope: "accounts",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastRefreshAt: null,
      tokenVersion: 1,
      status: "CONNECTED"
    });
    const next = await vault.replaceAfterRefresh("user-2", {
      accessToken: "a2",
      refreshToken: "r2",
      expiresIn: 3600
    });
    expect(next.refreshToken).toBe("r2");
    expect(next.tokenVersion).toBe(2);
    const loaded = await vault.getTokens("user-2");
    expect(loaded?.refreshToken).toBe("r2");
    expect(loaded?.accessToken).toBe("a2");
  });

  it("oauth start + callback with account list; code single-use", async () => {
    const vault = new MemoryMicroCTraderTokenVault();
    const sessions = new MemoryMicroOAuthSessionStore();
    const fetchImpl = (async () =>
      ({
        ok: true,
        json: async () => ({
          accessToken: "tok-a",
          refreshToken: "tok-r",
          expiresIn: 1800
        })
      }) as Response) as typeof fetch;

    const started = await startMicroOAuth("uid-a", { sessions });
    expect(started.scope).toBe("accounts");
    expect(started.tradingScopeRequested).toBe(false);
    expect(started.confirmation.tradingPermission).toBe("NOT REQUESTED");

    const first = await completeMicroOAuthCallback({
      uid: "uid-a",
      code: "once-code",
      sessionId: started.sessionId,
      deps: {
        vault,
        sessions,
        fetchImpl,
        fetchAuthorizedAccounts: async () => [
          { accountId: "42", isLive: false, traderLogin: "1", brokerHint: "Pepperstone" }
        ]
      }
    });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.status).toBe("CONNECTED");

    const reuse = await completeMicroOAuthCallback({
      uid: "uid-a",
      code: "once-code",
      sessionId: started.sessionId,
      deps: { vault, sessions, fetchImpl }
    });
    expect(reuse.ok).toBe(false);
  });

  it("multiple accounts require selection — no account[0] fallback", () => {
    const accounts = parseAuthorizedAccounts({
      ctidTraderAccount: [
        { ctidTraderAccountId: 1, isLive: false },
        { ctidTraderAccountId: 2, isLive: false }
      ]
    });
    const sel = selectMicroAccount({
      accounts,
      intendedEnvironment: "DEMO"
    });
    expect(sel.ok).toBe(false);
    if (!sel.ok) expect(sel.reason).toBe("MULTIPLE_COMPATIBLE_NEED_SELECTION");
  });

  it("single DEMO account may auto-select; LIVE cannot silently replace DEMO", () => {
    const demoOnly = selectMicroAccount({
      accounts: [{ accountId: "7", isLive: false, traderLogin: null, brokerHint: null }],
      intendedEnvironment: "DEMO"
    });
    expect(demoOnly.ok).toBe(true);

    const liveOnly = selectMicroAccount({
      accounts: [{ accountId: "8", isLive: true, traderLogin: null, brokerHint: null }],
      intendedEnvironment: "DEMO"
    });
    expect(liveOnly.ok).toBe(false);
    if (!liveOnly.ok) expect(liveOnly.reason).toBe("NO_DEMO_WHEN_DEMO_REQUIRED");

    const explicitLive = selectMicroAccount({
      accounts: [{ accountId: "8", isLive: true, traderLogin: null, brokerHint: null }],
      intendedEnvironment: "DEMO",
      explicitAccountId: "8"
    });
    expect(explicitLive.ok).toBe(false);
    if (!explicitLive.ok) {
      expect(explicitLive.reason).toBe("LIVE_FORBIDDEN_FOR_DEMO_ACTIVATION");
    }
  });

  it("unauthorized account rejected; disconnect isolates Micro only", async () => {
    const vault = new MemoryMicroCTraderTokenVault();
    const sessions = new MemoryMicroOAuthSessionStore();
    const fetchImpl = (async () =>
      ({
        ok: true,
        json: async () => ({
          accessToken: "x",
          refreshToken: "y",
          expiresIn: 100
        })
      }) as Response) as typeof fetch;
    const started = await startMicroOAuth("uid-b", { sessions });
    const rejected = await completeMicroOAuthCallback({
      uid: "uid-b",
      code: "code-b",
      sessionId: started.sessionId,
      explicitAccountId: "999",
      deps: {
        vault,
        sessions,
        fetchImpl,
        fetchAuthorizedAccounts: async () => [
          { accountId: "1", isLive: false, traderLogin: null, brokerHint: null }
        ]
      }
    });
    expect(rejected.ok).toBe(false);

    // Connected path then disconnect
    const started2 = await startMicroOAuth("uid-c", { sessions });
    await completeMicroOAuthCallback({
      uid: "uid-c",
      code: "code-c",
      sessionId: started2.sessionId,
      deps: {
        vault,
        sessions,
        fetchImpl,
        fetchAuthorizedAccounts: async () => [
          { accountId: "55", isLive: false, traderLogin: null, brokerHint: null }
        ]
      }
    });
    const disc = await disconnectMicroOAuth("uid-c", { vault });
    expect(disc.ok).toBe(true);
    expect(disc.coreUnaffected).toBe(true);
    expect(disc.remoteRevocation).toBe("NOT_CLAIMED");
    const status = await getMicroOAuthStatus("uid-c", { vault });
    expect(status.oauth.configured).toBe(false);
  });
});
