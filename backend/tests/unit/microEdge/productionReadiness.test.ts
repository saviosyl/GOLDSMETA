import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  resetUsedOAuthCodesForTests,
  selectMicroOAuthAccount,
  startMicroOAuth,
  credentialsFromVault
} from "../../../src/services/microEdge/marketData/oauthService";
import {
  assertViewOnlyPermissionScope,
  selectMicroAccount
} from "../../../src/services/microEdge/marketData/accountSelection";
import {
  decodeHistoricalTickData,
  fetchHistoricalTicksWindow
} from "../../../src/services/microEdge/marketData/historicalTicks";
import { FakeMicroCTraderTransport } from "../../../src/services/microEdge/marketData/microCTraderTransport";
import {
  MemoryMicroMarketDataStore,
  resetMicroMarketDataStoreForTests,
  makeRawBar
} from "../../../src/services/microEdge/marketData/marketDataStore";
import {
  resetMicroCollectorStatusStoreForTests,
  evaluatePersistentCollectorHealth
} from "../../../src/services/microEdge/marketData/collectorStatusStore";
import { buildMarketDataStatusPayload } from "../../../src/services/microEdge/marketData/marketDataService";
import {
  assertMicroRuntimeReadyForPersistentCollection
} from "../../../src/services/microEdge/marketData/runtimeReady";
import {
  isDeployedMicroRuntime,
  resolveMicroStorageMode
} from "../../../src/services/microEdge/marketData/storageMode";
import { MICRO_PERMISSION_SCOPE } from "../../../src/services/microEdge/marketData/accountSelection";

describe("Micro production-readiness corrective", () => {
  beforeEach(() => {
    resetMicroTokenVaultForTests();
    resetMicroOAuthSessionStoreForTests();
    resetUsedOAuthCodesForTests();
    resetMicroMarketDataStoreForTests();
    resetMicroCollectorStatusStoreForTests();
    process.env.MICRO_CTRADER_CLIENT_ID = "micro-client";
    process.env.MICRO_CTRADER_CLIENT_SECRET = "micro-secret";
    process.env.MICRO_CTRADER_REDIRECT_URI =
      "https://app.example.test/micro-edge/connect/callback";
    process.env.MICRO_CTRADER_ENVIRONMENT = "DEMO";
    process.env.MICRO_CTRADER_BROKER_ALLOWLIST = "Pepperstone";
    process.env["MICRO_CTRADER_" + "TOKEN_ENCRYPTION_KEY"] =
      "unit-test-micro-token-encryption-key-32b";
    process.env.MICRO_STORAGE_MODE = "memory";
    delete process.env.MICRO_DEPLOYED_RUNTIME;
    delete process.env.K_SERVICE;
  });

  it("mixed DEMO/LIVE: selecting LIVE account is rejected", async () => {
    const vault = resetMicroTokenVaultForTests();
    const sessions = resetMicroOAuthSessionStoreForTests();
    const fetchImpl = (async () =>
      ({
        ok: true,
        json: async () => ({
          accessToken: "tok-a",
          refreshToken: "tok-r",
          expiresIn: 1800
        })
      }) as Response) as typeof fetch;

    const accounts = [
      {
        accountId: "111",
        isLive: false,
        traderLogin: "1",
        brokerHint: "Pepperstone"
      },
      {
        accountId: "113",
        isLive: false,
        traderLogin: "3",
        brokerHint: "Pepperstone"
      },
      {
        accountId: "222",
        isLive: true,
        traderLogin: "2",
        brokerHint: "Pepperstone"
      }
    ];

    const started = await startMicroOAuth("uid-mix", { sessions });
    const cb = await completeMicroOAuthCallback({
      uid: "uid-mix",
      code: "code-mix",
      sessionId: started.sessionId,
      deps: {
        vault,
        sessions,
        fetchImpl,
        fetchAuthorizedAccounts: async () => accounts
      }
    });
    expect(cb.ok).toBe(true);
    if (cb.ok) expect(cb.status).toBe("ACCOUNT_SELECTION_REQUIRED");

    const rejected = await selectMicroOAuthAccount({
      uid: "uid-mix",
      accountId: "222",
      deps: {
        vault,
        fetchAuthorizedAccounts: async () => accounts
      }
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.code).toBe("LIVE_ACCOUNT_NOT_ALLOWED");
  });

  it("SCOPE_TRADE account-list response is rejected", async () => {
    expect(() =>
      assertViewOnlyPermissionScope({
        permissionScope: MICRO_PERMISSION_SCOPE.SCOPE_TRADE
      })
    ).toThrow(/MICRO_TRADING_SCOPE_REJECTED/);

    const vault = resetMicroTokenVaultForTests();
    const sessions = resetMicroOAuthSessionStoreForTests();
    const fetchImpl = (async () =>
      ({
        ok: true,
        json: async () => ({
          accessToken: "tok-trade",
          refreshToken: "tok-r",
          expiresIn: 1800
        })
      }) as Response) as typeof fetch;
    const started = await startMicroOAuth("uid-trade", { sessions });
    const result = await completeMicroOAuthCallback({
      uid: "uid-trade",
      code: "code-trade",
      sessionId: started.sessionId,
      deps: {
        vault,
        sessions,
        fetchImpl,
        fetchAuthorizedAccounts: async () => {
          throw Object.assign(new Error("MICRO_TRADING_SCOPE_REJECTED"), {
            code: "MICRO_TRADING_SCOPE_REJECTED"
          });
        }
      }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MICRO_TRADING_SCOPE_REJECTED");
    expect(await vault.getTokens("uid-trade")).toBeNull();
  });

  it("never infers isLive from Micro environment string list", () => {
    // Stored ids alone cannot authorize selection without broker metadata.
    const sel = selectMicroAccount({
      accounts: [
        { accountId: "1", isLive: null, traderLogin: null, brokerHint: "Pepperstone" }
      ],
      intendedEnvironment: "DEMO",
      explicitAccountId: "1"
    });
    expect(sel.ok).toBe(false);
    if (!sel.ok) expect(sel.reason).toBe("ACCOUNT_ISLIVE_UNKNOWN");
  });

  it("OAuth cross-instance: shared session + shared vault", async () => {
    const sharedDocs = new Map();
    const sharedSessions = new Map();
    const crypto = new MicroTokenCrypto(
      "unit-test-micro-token-encryption-key-32b"
    );
    const vaultA = new MemoryMicroCTraderTokenVault(crypto, sharedDocs);
    const vaultB = new MemoryMicroCTraderTokenVault(crypto, sharedDocs);
    const sessionsA = new MemoryMicroOAuthSessionStore(sharedSessions);
    const sessionsB = new MemoryMicroOAuthSessionStore(sharedSessions);
    const fetchImpl = (async () =>
      ({
        ok: true,
        json: async () => ({
          accessToken: "access-x",
          refreshToken: "refresh-x",
          expiresIn: 3600
        })
      }) as Response) as typeof fetch;

    // Instance A starts OAuth
    const started = await startMicroOAuth("uid-x", { sessions: sessionsA });
    // Instance B completes callback
    const done = await completeMicroOAuthCallback({
      uid: "uid-x",
      code: "code-x",
      sessionId: started.sessionId,
      deps: {
        vault: vaultB,
        sessions: sessionsB,
        fetchImpl,
        fetchAuthorizedAccounts: async () => [
          {
            accountId: "55",
            isLive: false,
            traderLogin: "9",
            brokerHint: "Pepperstone"
          }
        ]
      }
    });
    expect(done.ok).toBe(true);

    // Instance C (collector) reads same vault
    const vaultC = new MemoryMicroCTraderTokenVault(crypto, sharedDocs);
    const creds = await credentialsFromVault("uid-x", { vault: vaultC });
    expect(creds?.accountId).toBe("55");
    expect(creds?.accessToken).toBe("access-x");
    const tok = await vaultC.getTokens("uid-x");
    expect(tok?.tokenVersion).toBe(1);
    expect(tok?.permissionScope).toBe("SCOPE_VIEW");
  });

  it("token restart persistence with same key; wrong key fails", async () => {
    const shared = new Map();
    const key = "unit-test-micro-token-encryption-key-32b";
    const v1 = new MemoryMicroCTraderTokenVault(new MicroTokenCrypto(key), shared);
    await v1.saveTokens({
      uid: "uid-restart",
      accessToken: "a1",
      refreshToken: "r1",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      expiresIn: 3600,
      environment: "DEMO",
      authorizedAccountIds: ["9"],
      authorizedAccounts: [
        {
          accountId: "9",
          isLive: false,
          traderLoginMasked: "****9",
          brokerTitleShort: "Pepperstone",
          observedAt: new Date().toISOString()
        }
      ],
      selectedAccountId: "9",
      selectedAccountMeta: {
        accountId: "9",
        isLive: false,
        traderLoginMasked: "****9",
        brokerTitleShort: "Pepperstone",
        observedAt: new Date().toISOString()
      },
      permissionScope: "SCOPE_VIEW",
      brokerVerified: true,
      scope: "accounts",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastRefreshAt: null,
      tokenVersion: 3,
      status: "CONNECTED"
    });

    const v2 = new MemoryMicroCTraderTokenVault(new MicroTokenCrypto(key), shared);
    const loaded = await v2.getTokens("uid-restart");
    expect(loaded?.accessToken).toBe("a1");
    expect(loaded?.selectedAccountId).toBe("9");
    expect(loaded?.tokenVersion).toBe(3);
    expect(loaded?.scope).toBe("accounts");

    const vWrong = new MemoryMicroCTraderTokenVault(
      new MicroTokenCrypto("wrong-key-wrong-key-wrong-key-wrong"),
      shared
    );
    await expect(vWrong.getTokens("uid-restart")).rejects.toThrow();
  });

  it("worker/API shared market data via shared memory store", async () => {
    const sharedStore = new MemoryMicroMarketDataStore();
    resetMicroMarketDataStoreForTests(sharedStore);
    const statusShared = { current: null as null };
    resetMicroCollectorStatusStoreForTests(statusShared);

    // Worker-like writes
    await sharedStore.upsertBar(
      makeRawBar({
        symbol: "XAUUSD",
        symbolId: "41",
        timeframe: "M1",
        openTimeMs: 1_700_000_000_000,
        closeTimeMs: 1_700_000_060_000,
        open: 2100,
        high: 2101,
        low: 2099,
        close: 2100.5,
        tickVolume: 10,
        environment: "DEMO"
      })
    );
    await sharedStore.saveQuoteSample({
      id: "q1",
      symbol: "XAUUSD",
      symbolId: "41",
      bid: 2100,
      ask: 2100.2,
      mid: 2100.1,
      spread: 0.2,
      brokerTimestamp: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      ageMs: 0,
      freshness: "LIVE",
      source: "CTRADER_OPEN_API",
      environment: "DEMO"
    });
    await sharedStore.saveCollectorHeartbeat(new Date().toISOString(), {
      ok: true
    });

    // API-like new service object using same store factory reset
    const apiStore = resetMicroMarketDataStoreForTests(sharedStore);
    expect(await apiStore.countBars("M1")).toBe(1);
    expect(await apiStore.countQuotes()).toBe(1);
    expect(await apiStore.getCollectorHeartbeat()).not.toBeNull();

    const payload = await buildMarketDataStatusPayload();
    expect(payload.historicalObservationCounts).toMatchObject({ M1: 1 });
  });

  it("deployed mode forbids memory storage and requires vault UID + encryption key", () => {
    const env = {
      ...process.env,
      MICRO_DEPLOYED_RUNTIME: "true",
      MICRO_STORAGE_MODE: "memory"
    } as NodeJS.ProcessEnv;
    expect(isDeployedMicroRuntime(env)).toBe(true);
    expect(() => resolveMicroStorageMode(env)).toThrow(
      /MICRO_STORAGE_MEMORY_FORBIDDEN/
    );

    const ready = assertMicroRuntimeReadyForPersistentCollection({
      ...process.env,
      MICRO_DEPLOYED_RUNTIME: "true",
      MICRO_STORAGE_MODE: "firestore",
      MICRO_COLLECTOR_VAULT_UID: "",
      ["MICRO_CTRADER_" + "TOKEN_ENCRYPTION_KEY"]: "short"
    } as NodeJS.ProcessEnv);
    expect(ready.ok).toBe(false);
  });

  it("canonical newest-first historical tick decoder fixture", () => {
    // 10:00:05.000 newest, then 1000ms older, then 2500ms older
    const newest = Date.parse("2026-08-13T10:00:05.000Z");
    const raw = [
      { timestamp: newest, tick: 210_000_000 },
      { timestamp: 1000, tick: 209_999_000 },
      { timestamp: 2500, tick: 209_998_000 }
    ];
    const decoded = decodeHistoricalTickData(raw, {
      side: "BID",
      fromMs: newest - 10_000,
      toMs: newest
    });
    expect(decoded.map((t) => t.brokerTimestampMs)).toEqual([
      newest - 3500, // 10:00:01.500
      newest - 1000, // 10:00:04.000
      newest // 10:00:05.000
    ]);
    const ask = decodeHistoricalTickData(raw, {
      side: "ASK",
      fromMs: newest - 10_000,
      toMs: newest
    });
    expect(ask[2]!.side).toBe("ASK");
  });

  it("hasMore pagination moves strictly older without infinite loop", async () => {
    const fake = new FakeMicroCTraderTransport();
    await fake.connect();
    const t0 = 1_700_000_100_000;
    let page = 0;
    // Override getTickData to return two pages
    fake.getTickData = async (args) => {
      page += 1;
      if (page === 1) {
        expect(args.toTimestamp).toBeGreaterThan(args.fromTimestamp);
        return {
          hasMore: true,
          tickData: [
            { timestamp: t0, tick: 210_000_000 },
            { timestamp: 1000, tick: 209_999_000 }
          ]
        };
      }
      // Page 2 older
      return {
        hasMore: false,
        tickData: [
          { timestamp: t0 - 2000, tick: 209_998_000 },
          { timestamp: 500, tick: 209_997_000 }
        ]
      };
    };

    const ticks = await fetchHistoricalTicksWindow({
      transport: fake,
      accountId: "123",
      symbolId: "41",
      side: "BID",
      fromMs: t0 - 10_000,
      toMs: t0
    });
    expect(page).toBe(2);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    // Ascending unique
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]!.brokerTimestampMs).toBeGreaterThanOrEqual(
        ticks[i - 1]!.brokerTimestampMs
      );
    }
  });

  it("requested-window invariant rejects out-of-range ticks", () => {
    const newest = 1_700_000_000_000;
    expect(() =>
      decodeHistoricalTickData(
        [{ timestamp: newest + 5_000, tick: 210_000_000 }],
        { side: "BID", fromMs: newest, toMs: newest + 1000 }
      )
    ).toThrow(/HISTORICAL_TICK_TIMESTAMP_INVALID/);
  });

  it("persistent heartbeat staleness marks not connected", () => {
    const now = Date.now();
    const health = evaluatePersistentCollectorHealth(
      {
        connectionState: "LIVE_CONNECTED",
        oauthStatus: "CONNECTED",
        accountAuthorized: true,
        environment: "DEMO",
        broker: "Pepperstone",
        brokerVerified: true,
        symbolId: "41",
        symbolName: "XAUUSD",
        spotSubscribed: true,
        lastSpotEventAt: new Date(now).toISOString(),
        lastValidQuoteAt: new Date(now).toISOString(),
        lastQuoteBrokerTimestamp: new Date(now).toISOString(),
        lastQuoteBid: 1,
        lastQuoteAsk: 1.1,
        lastCompletedM1: new Date(now).toISOString(),
        lastCompletedM5: null,
        lastCompletedM15: null,
        heartbeatAt: new Date(now - 120_000).toISOString(),
        reconnectAttempts: 0,
        collectorVersion: "v",
        permissionScope: "SCOPE_VIEW",
        mutationSurface: "NONE",
        updatedAt: new Date(now - 120_000).toISOString()
      },
      now
    );
    expect(health.liveConnected).toBe(false);
    expect(health.reasons).toContain("collector_heartbeat_stale");
  });

  it("firestore rules deny client access to microEdge/**", () => {
    const rules = readFileSync(
      resolve(__dirname, "../../../firestore.rules"),
      "utf8"
    );
    expect(rules).toMatch(/match \/microEdge\/\{document=\*\*\}/);
    const block = rules.match(
      /match \/microEdge\/\{document=\*\*\} \{[\s\S]*?\n\s*\}/
    )?.[0];
    expect(block).toBeTruthy();
    expect(block!).toMatch(/allow read,\s*write:\s*if false/);
  });
});
