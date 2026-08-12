import { describe, expect, it, vi } from "vitest";
import {
  assertConfiguredAccountAuthorized,
  buildMicroAccountsAuthorizationUrl,
  exchangeMicroAuthorizationCode,
  extractAuthorizedAccountIds,
  loadMicroCTraderCredentials,
  refreshMicroAccessToken
} from "../../../src/services/microEdge/marketData/microCTraderAuth";
import {
  FakeMicroCTraderTransport,
  RealMicroCTraderTransport
} from "../../../src/services/microEdge/marketData/microCTraderTransport";
import type { MicroCTraderCredentials } from "../../../src/services/microEdge/marketData/microCTraderAuth";
import {
  applySpotEvent,
  createEmptySpotBook,
  publishQuoteFromBook
} from "../../../src/services/microEdge/marketData/microCTraderQuotes";
import { MICRO_SPOT_PRICE_SCALE } from "../../../src/services/microEdge/marketData/microCTraderProtocol";
import { MemoryMicroMarketDataStore, makeRawBar } from "../../../src/services/microEdge/marketData/marketDataStore";
import {
  createFakeLiveSession,
  MicroLiveMarketSession
} from "../../../src/services/microEdge/marketData/liveSession";
import { redactSecrets } from "../../../src/services/microEdge/marketData/microCTraderProtocol";

async function flush(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

describe("Micro auth + persistent spot corrective", () => {
  it("authorization URL is scope=accounts only with documented params (no PKCE/trading)", () => {
    const url = buildMicroAccountsAuthorizationUrl({
      clientId: "cid_dummy",
      redirectUri: "https://example.test/cb"
    });
    const u = new URL(url);
    expect(u.searchParams.get("scope")).toBe("accounts");
    expect(u.searchParams.get("product")).toBe("web");
    expect(u.searchParams.get("client_id")).toBe("cid_dummy");
    expect(u.searchParams.get("redirect_uri")).toBe("https://example.test/cb");
    expect(u.searchParams.has("code_challenge")).toBe(false);
    expect(u.searchParams.has("code_challenge_method")).toBe(false);
    expect(u.searchParams.has("state")).toBe(false);
    expect(url).not.toMatch(/trading/i);
    expect([...u.searchParams.keys()].sort()).toEqual([
      "client_id",
      "product",
      "redirect_uri",
      "scope"
    ]);
  });

  it("authorization-code exchange uses GET query params (dummy secrets)", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({
          accessToken: "access_dummy",
          refreshToken: "refresh_dummy",
          expiresIn: 1000
        })
      } as Response;
    });
    const result = await exchangeMicroAuthorizationCode({
      code: "code_dummy",
      clientId: "cid_dummy",
      clientSecret: "sec_dummy",
      redirectUri: "https://example.test/cb",
      tokenUrl: "https://openapi.ctrader.com/apps/token",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    expect(result.accessToken).toBe("access_dummy");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init?.method).toBe("GET");
    const u = new URL(calls[0]!.url);
    expect(u.searchParams.get("grant_type")).toBe("authorization_code");
    expect(u.searchParams.get("code")).toBe("code_dummy");
    expect(u.searchParams.get("client_id")).toBe("cid_dummy");
    expect(u.searchParams.get("client_secret")).toBe("sec_dummy");
    expect(u.searchParams.get("redirect_uri")).toBe("https://example.test/cb");
  });

  it("refresh-token request uses POST query params (dummy secrets)", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      const u = new URL(url);
      expect(u.searchParams.get("grant_type")).toBe("refresh_token");
      expect(u.searchParams.get("refresh_token")).toBe("refresh_dummy");
      expect(u.searchParams.get("client_id")).toBe("cid_dummy");
      expect(u.searchParams.get("client_secret")).toBe("sec_dummy");
      return {
        ok: true,
        json: async () => ({
          accessToken: "access2",
          refreshToken: "refresh2",
          expiresIn: 2000
        })
      } as Response;
    });
    const result = await refreshMicroAccessToken({
      refreshToken: "refresh_dummy",
      clientId: "cid_dummy",
      clientSecret: "sec_dummy",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    expect(result.refreshToken).toBe("refresh2");
  });

  it("redacts tokens from log strings", () => {
    expect(redactSecrets('access_token=abc123secret')).toMatch(/REDACTED/);
    expect(redactSecrets("Bearer supersecrettoken")).toMatch(/REDACTED/);
  });

  it("account list validation A/B/C", () => {
    expect(
      assertConfiguredAccountAuthorized({
        configuredAccountId: "123",
        authorizedAccountIds: ["123", "456"]
      }).configuredAccountAuthorized
    ).toBe(true);
    expect(() =>
      assertConfiguredAccountAuthorized({
        configuredAccountId: "999",
        authorizedAccountIds: ["123", "456"]
      })
    ).toThrow(/NOT_AUTHORIZED|account_not_authorized/i);
    expect(() =>
      assertConfiguredAccountAuthorized({
        configuredAccountId: "123",
        authorizedAccountIds: []
      })
    ).toThrow(/EMPTY|account_not_authorized/i);
  });

  it("extractAuthorizedAccountIds parses official-shaped response", () => {
    expect(
      extractAuthorizedAccountIds({
        ctidTraderAccount: [
          { ctidTraderAccountId: 123 },
          { ctidTraderAccountId: 456 }
        ]
      })
    ).toEqual(["123", "456"]);
  });

  it("D/E account-list failure and missing token fail closed", async () => {
    expect(loadMicroCTraderCredentials({}).ok).toBe(false);

    const store = new MemoryMicroMarketDataStore();
    const fake = new FakeMicroCTraderTransport();
    fake.failAccountList = true;
    const { session } = createFakeLiveSession(store, fake);
    await expect(session.connect()).rejects.toMatchObject({
      code: "account_not_authorized"
    });

    const fakeEmpty = new FakeMicroCTraderTransport();
    fakeEmpty.emptyAccountList = true;
    const s2 = createFakeLiveSession(store, fakeEmpty);
    await expect(s2.session.connect()).rejects.toMatchObject({
      code: "account_not_authorized"
    });
  });

  it("unauthorized configured account fails before trading", async () => {
    const store = new MemoryMicroMarketDataStore();
    const fake = new FakeMicroCTraderTransport();
    fake.authorizedAccountIds = ["123", "456"];
    fake.configuredAccountId = "999";
    const session = new MicroLiveMarketSession({
      store,
      transport: fake,
      credentials: {
        clientId: "t",
        clientSecret: "t",
        accessToken: "a",
        refreshToken: "r",
        accountId: "999",
        environment: "DEMO",
        tokenUrl: "x",
        authUrl: "y",
        redirectUri: null
      }
    });
    await expect(session.connect()).rejects.toMatchObject({
      code: "account_not_authorized"
    });
  });

  it("one spot subscription per connection; status polling does not re-subscribe", async () => {
    const store = new MemoryMicroMarketDataStore();
    const now = Date.parse("2026-08-12T12:00:00.000Z");
    const { session, fake } = createFakeLiveSession(store, undefined, () => now + 500);
    fake.nextSpot = {
      bid: 2000 * MICRO_SPOT_PRICE_SCALE,
      ask: 2000.1 * MICRO_SPOT_PRICE_SCALE,
      timestamp: now,
      symbolId: 41
    };
    await session.connect();
    await flush();
    expect(fake.getSubscribeSpotsCallCount()).toBe(1);
    await session.getState();
    await session.getState();
    await session.refreshQuote();
    expect(fake.getSubscribeSpotsCallCount()).toBe(1);
  });

  it("partial bid/ask events combine; invalid ask<bid rejected; stale side unhealthy", () => {
    const now = Date.parse("2026-08-12T12:00:00.000Z");
    let book = createEmptySpotBook("41");
    book = applySpotEvent(
      book,
      { bid: 2000 * MICRO_SPOT_PRICE_SCALE, timestamp: now, symbolId: 41 },
      "41"
    );
    expect(publishQuoteFromBook({ book, nowMs: now }).ok).toBe(false);
    book = applySpotEvent(
      book,
      { ask: 2000.2 * MICRO_SPOT_PRICE_SCALE, timestamp: now + 10, symbolId: 41 },
      "41"
    );
    const pub = publishQuoteFromBook({ book, nowMs: now + 20 });
    expect(pub.ok).toBe(true);
    if (pub.ok) {
      expect(pub.quote.bid).toBeCloseTo(2000, 5);
      expect(pub.quote.ask).toBeCloseTo(2000.2, 5);
    }
    // ask < bid invalid
    let bad = createEmptySpotBook("41");
    bad = applySpotEvent(
      bad,
      {
        bid: 2000 * MICRO_SPOT_PRICE_SCALE,
        ask: 1999 * MICRO_SPOT_PRICE_SCALE,
        timestamp: now,
        symbolId: 41
      },
      "41"
    );
    expect(publishQuoteFromBook({ book: bad, nowMs: now }).ok).toBe(false);
    // stale side
    expect(
      publishQuoteFromBook({ book, nowMs: now + 120_000, maxSideAgeMs: 30_000 }).ok
    ).toBe(false);
  });

  it("reconnect clears subscription and re-subscribes exactly once", async () => {
    const store = new MemoryMicroMarketDataStore();
    let t = Date.parse("2026-08-12T12:00:00.000Z");
    const { session, fake } = createFakeLiveSession(store, undefined, () => t);
    fake.nextSpot = {
      bid: 1 * MICRO_SPOT_PRICE_SCALE,
      ask: 1.1 * MICRO_SPOT_PRICE_SCALE,
      timestamp: t,
      symbolId: 41
    };
    await session.connect();
    await flush();
    expect(fake.getSubscribeSpotsCallCount()).toBe(1);
    await session.disconnect();
    fake.nextSpot = {
      bid: 1 * MICRO_SPOT_PRICE_SCALE,
      ask: 1.1 * MICRO_SPOT_PRICE_SCALE,
      timestamp: t,
      symbolId: 41
    };
    await session.connect();
    await flush();
    expect(fake.getSubscribeSpotsCallCount()).toBe(2);
  });

  it("constructor-provided credentials report configured=true without process.env", async () => {
    const store = new MemoryMicroMarketDataStore();
    const now = Date.parse("2026-08-12T12:00:00.000Z");
    const { session, fake } = createFakeLiveSession(store, undefined, () => now);
    fake.nextSpot = {
      bid: 1 * MICRO_SPOT_PRICE_SCALE,
      ask: 1.1 * MICRO_SPOT_PRICE_SCALE,
      timestamp: now,
      symbolId: 41
    };
    await session.connect();
    await flush();
    await store.upsertBar(
      makeRawBar({
        symbol: "XAUUSD",
        symbolId: "41",
        timeframe: "M1",
        openTimeMs: now - 60_000,
        closeTimeMs: now,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.1,
        tickVolume: 1,
        environment: "DEMO"
      })
    );
    const state = await session.getState();
    expect(state.credentialsConfigured).toBe(true);
    expect(state.spotSubscribed).toBe(true);
    expect(session.mutationSurface).toBe("NONE");
  });

  it("GetAccountList command is allowlisted", async () => {
    const fake = new FakeMicroCTraderTransport();
    await fake.connect();
    const res = await fake.sendReadCommand("ProtoOAGetAccountListByAccessTokenReq", {
      accessToken: "dummy"
    });
    expect(extractAuthorizedAccountIds(res).length).toBeGreaterThan(0);
  });

  it("Real transport: official account-list auth + no silent account[0] fallback", async () => {
    const cmds: string[] = [];
    const creds: MicroCTraderCredentials = {
      clientId: "cid_dummy",
      clientSecret: "sec_dummy",
      accessToken: "tok_dummy",
      refreshToken: "ref_dummy",
      accountId: "123",
      environment: "DEMO",
      tokenUrl: "https://example.test/token",
      authUrl: "https://example.test/auth",
      redirectUri: null
    };
    const factory = () => ({
      open: async () => undefined,
      close: async () => undefined,
      sendCommand: async (cmd: string, payload: Record<string, unknown>) => {
        cmds.push(cmd);
        if (cmd === "ProtoOAApplicationAuthReq") return {};
        if (cmd === "ProtoOAGetAccountListByAccessTokenReq") {
          return {
            ctidTraderAccount: [
              { ctidTraderAccountId: 123 },
              { ctidTraderAccountId: 456 }
            ]
          };
        }
        if (cmd === "ProtoOAAccountAuthReq") {
          expect(payload.ctidTraderAccountId).toBe(123);
          return {};
        }
        return {};
      },
      on: () => undefined,
      off: () => undefined,
      removeListener: () => undefined
    });
    const t = new RealMicroCTraderTransport(creds, factory);
    await t.connect();
    expect(cmds).toEqual([
      "ProtoOAApplicationAuthReq",
      "ProtoOAGetAccountListByAccessTokenReq",
      "ProtoOAAccountAuthReq"
    ]);
    expect(t.getAccountAuthMeta()).toEqual({
      authorizedAccountCount: 2,
      configuredAccountAuthorized: true
    });

    const bad = new RealMicroCTraderTransport(
      { ...creds, accountId: "999" },
      () => ({
        open: async () => undefined,
        close: async () => undefined,
        sendCommand: async (cmd: string) => {
          if (cmd === "ProtoOAGetAccountListByAccessTokenReq") {
            return {
              ctidTraderAccount: [
                { ctidTraderAccountId: 123 },
                { ctidTraderAccountId: 456 }
              ]
            };
          }
          return {};
        },
        on: () => undefined
      })
    );
    await expect(bad.connect()).rejects.toMatchObject({
      code: "account_not_authorized"
    });
    expect(bad.isAccountAuthenticated()).toBe(false);
  });

  it("Real transport: handlers registered before connect attach once; no duplicates", async () => {
    const nativeCounts = new Map<string, number>();
    const listeners = new Map<string, Set<(evt: unknown) => void>>();
    const factory = () => ({
      open: async () => undefined,
      close: async () => undefined,
      sendCommand: async (cmd: string) => {
        if (cmd === "ProtoOAGetAccountListByAccessTokenReq") {
          return { ctidTraderAccount: [{ ctidTraderAccountId: 123 }] };
        }
        return {};
      },
      on: (event: string, cb: (evt: unknown) => void) => {
        nativeCounts.set(event, (nativeCounts.get(event) ?? 0) + 1);
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(cb);
      },
      off: (event: string, cb: (evt: unknown) => void) => {
        listeners.get(event)?.delete(cb);
      },
      removeListener: (event: string, cb: (evt: unknown) => void) => {
        listeners.get(event)?.delete(cb);
      }
    });
    const creds: MicroCTraderCredentials = {
      clientId: "c",
      clientSecret: "s",
      accessToken: "a",
      refreshToken: "r",
      accountId: "123",
      environment: "DEMO",
      tokenUrl: "x",
      authUrl: "y",
      redirectUri: null
    };
    const t = new RealMicroCTraderTransport(creds, factory);
    let hits = 0;
    const handler = () => {
      hits += 1;
    };
    t.on("ProtoOASpotEvent", handler);
    t.on("ProtoOASpotEvent", handler); // Set dedupe
    await t.connect();
    expect(nativeCounts.get("ProtoOASpotEvent")).toBe(1);
    for (const cb of listeners.get("ProtoOASpotEvent") ?? []) {
      cb({ bid: 1 });
    }
    expect(hits).toBe(1);
    await t.disconnect();
    expect(listeners.get("ProtoOASpotEvent")?.size ?? 0).toBe(0);
    // reconnect: same logical handler re-attaches once
    await t.connect();
    expect(nativeCounts.get("ProtoOASpotEvent")).toBe(2);
    t.off("ProtoOASpotEvent", handler);
  });
});
