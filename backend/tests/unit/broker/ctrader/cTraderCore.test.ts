import { describe, expect, it } from "vitest";
import {
  assertCTraderMutationsDisabled,
  CTRADER_DEMO_SERVER_LIMITS,
  snapshotCTraderFlags
} from "../../../../src/services/broker/ctrader/flags";
import { loadCTraderConfig } from "../../../../src/services/broker/ctrader/config";
import {
  createOAuthState,
  validateOAuthState,
  hashOwnerUid
} from "../../../../src/services/broker/ctrader/oauth";
import {
  encryptTokenPayload,
  decryptTokenPayload,
  maskAccountId
} from "../../../../src/services/broker/ctrader/tokenCrypto";
import { resolveXauUsdFromCatalogue } from "../../../../src/services/broker/ctrader/symbolResolver";
import { calculateCTraderVolume } from "../../../../src/services/broker/ctrader/sizing";
import { mapDecisionToCTraderAction } from "../../../../src/services/broker/ctrader/decisionMapping";
import {
  approveTradePreview,
  buildIntentKey,
  buildTradePreview
} from "../../../../src/services/broker/ctrader/preview";
import { evaluateDemoAutoQualification } from "../../../../src/services/broker/ctrader/qualification";
import { createCTraderMockServer } from "../../../../src/services/broker/ctrader/mockServer";
import {
  buildCTraderReadiness,
  buildDemonstrationBundle,
  cTraderOrderApi,
  getBrokerControlCentreSnapshot
} from "../../../../src/services/broker/ctrader/cTraderService";
import {
  fixtureQuote,
  fixtureXauUsdSymbol,
  FIXTURE_BANNER
} from "../../../../src/services/broker/ctrader/fixtures";
import { createPaperSimulator, PAPER_LABEL } from "../../../../src/services/broker/paper/paperSimulator";
import { CTraderMutationDisabledError } from "../../../../src/services/broker/ctrader/mutationGuard";

describe("cTrader flags", () => {
  it("allows Demo submission via env while Live stays hard-false", () => {
    const flags = snapshotCTraderFlags({
      CTRADER_DEMO_ORDER_SUBMISSION_ENABLED: "true",
      CTRADER_LIVE_ENABLED: "true",
      BROKER_EXECUTION_ENABLED: "true"
    });
    expect(flags.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED).toBe(true);
    expect(flags.CTRADER_LIVE_ENABLED).toBe(false);
    expect(flags.BROKER_EXECUTION_ENABLED).toBe(false);
    expect(flags.mutationFlagsHardFalse).toBe(true);
    expect(() => assertCTraderMutationsDisabled({})).not.toThrow();
  });

  it("fails closed when Live / broker-execution env tries to enable", () => {
    expect(() =>
      assertCTraderMutationsDisabled({
        CTRADER_LIVE_ENABLED: "true"
      })
    ).toThrow(/MUST_REMAIN_FALSE/);
    expect(() =>
      assertCTraderMutationsDisabled({
        BROKER_EXECUTION_ENABLED: "true"
      })
    ).toThrow(/MUST_REMAIN_FALSE/);
    expect(() =>
      assertCTraderMutationsDisabled({
        CTRADER_DEMO_ORDER_SUBMISSION_ENABLED: "true"
      })
    ).not.toThrow();
  });

  it("exposes server risk caps", () => {
    expect(CTRADER_DEMO_SERVER_LIMITS.maxRiskPerTradeEur).toBe(20);
    expect(CTRADER_DEMO_SERVER_LIMITS.maxTradesPerDay).toBe(3);
  });
});

describe("cTrader config", () => {
  it("reports SETUP_REQUIRED without inventing secrets", () => {
    const cfg = loadCTraderConfig({});
    expect(cfg.setupRequired).toBe(true);
    expect(cfg.missing).toContain("CTRADER_CLIENT_ID");
    expect(cfg.missingConfigurationItems).toContain("cTrader Client ID missing");
    expect(cfg.environment).toBe("DEMO");
    expect(cfg.redirectUri).toBeNull();
  });

  it("exposes public redirect hostname/path without treating production callback as mismatch", () => {
    const cfg = loadCTraderConfig({
      CTRADER_CLIENT_ID: "id",
      CTRADER_CLIENT_SECRET: "secret",
      CTRADER_REDIRECT_URI:
        "https://us-central1-goldmeta-web.cloudfunctions.net/apiCTraderPreview/v1/ctrader/oauth/callback",
      CTRADER_ENVIRONMENT: "DEMO"
    });
    expect(cfg.configured).toBe(true);
    expect(cfg.redirectUriPublic).toEqual({
      hostname: "us-central1-goldmeta-web.cloudfunctions.net",
      pathname: "/apiCTraderPreview/v1/ctrader/oauth/callback"
    });
    expect(cfg.missing).not.toContain("OAUTH_CALLBACK_MISMATCH");
  });

  it("flags localhost redirect as OAuth callback mismatch", () => {
    const cfg = loadCTraderConfig({
      CTRADER_CLIENT_ID: "id",
      CTRADER_CLIENT_SECRET: "secret",
      CTRADER_REDIRECT_URI: "http://localhost:5001/api/v1/ctrader/oauth/callback",
      CTRADER_ENVIRONMENT: "DEMO"
    });
    expect(cfg.configured).toBe(false);
    expect(cfg.missing).toContain("OAUTH_CALLBACK_MISMATCH");
    expect(cfg.missingConfigurationItems).toContain("OAuth callback mismatch");
  });
});

describe("OAuth authorization URL", () => {
  it("defaults to scope=accounts for read-only connect", async () => {
    const prev = {
      CTRADER_CLIENT_ID: process.env.CTRADER_CLIENT_ID,
      CTRADER_REDIRECT_URI: process.env.CTRADER_REDIRECT_URI,
      CTRADER_ENVIRONMENT: process.env.CTRADER_ENVIRONMENT
    };
    process.env.CTRADER_CLIENT_ID = "demo-client";
    process.env.CTRADER_REDIRECT_URI =
      "https://us-central1-goldmeta-web.cloudfunctions.net/apiCTraderPreview/v1/ctrader/oauth/callback";
    process.env.CTRADER_ENVIRONMENT = "DEMO";
    try {
      const { buildAuthorizationUrl } = await import(
        "../../../../src/services/broker/ctrader/oauth"
      );
      const url = buildAuthorizationUrl({
        state: "st",
        codeChallenge: "ch",
        clientId: "demo-client"
      });
      const parsed = new URL(url);
      expect(parsed.searchParams.get("scope")).toBe("accounts");
      expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
      expect(parsed.searchParams.get("redirect_uri")).toBe(
        process.env.CTRADER_REDIRECT_URI
      );
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("requests scope=trading only for Authorise Demo Trading", async () => {
    const prev = {
      CTRADER_CLIENT_ID: process.env.CTRADER_CLIENT_ID,
      CTRADER_REDIRECT_URI: process.env.CTRADER_REDIRECT_URI,
      CTRADER_ENVIRONMENT: process.env.CTRADER_ENVIRONMENT
    };
    process.env.CTRADER_CLIENT_ID = "demo-client";
    process.env.CTRADER_REDIRECT_URI =
      "https://us-central1-goldmeta-web.cloudfunctions.net/apiCTraderPreview/v1/ctrader/oauth/callback";
    process.env.CTRADER_ENVIRONMENT = "DEMO";
    try {
      const { buildAuthorizationUrl } = await import(
        "../../../../src/services/broker/ctrader/oauth"
      );
      const url = buildAuthorizationUrl({
        state: "st",
        codeChallenge: "ch",
        clientId: "demo-client",
        scope: "trading"
      });
      expect(new URL(url).searchParams.get("scope")).toBe("trading");
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe("OAuth state + PKCE", () => {
  it("validates matching state and rejects mismatch/expiry/replay/bad redirect", () => {
    const prev = {
      CTRADER_REDIRECT_URI: process.env.CTRADER_REDIRECT_URI,
      CTRADER_CLIENT_ID: process.env.CTRADER_CLIENT_ID,
      CTRADER_CLIENT_SECRET: process.env.CTRADER_CLIENT_SECRET,
      CTRADER_ENVIRONMENT: process.env.CTRADER_ENVIRONMENT
    };
    process.env.CTRADER_REDIRECT_URI = "https://example.test/cb";
    process.env.CTRADER_CLIENT_ID = "test-client";
    process.env.CTRADER_CLIENT_SECRET = "test-secret";
    process.env.CTRADER_ENVIRONMENT = "DEMO";
    try {
      const rec = createOAuthState("owner-uid-1");
      expect(
        validateOAuthState({
          stored: rec,
          providedState: rec.state,
          ownerUid: "owner-uid-1"
        }).ok
      ).toBe(true);
      expect(
        validateOAuthState({
          stored: rec,
          providedState: "wrong",
          ownerUid: "owner-uid-1"
        })
      ).toEqual({ ok: false, code: "OAUTH_STATE_MISMATCH" });
      expect(
        validateOAuthState({
          stored: rec,
          providedState: rec.state,
          ownerUid: "other-owner"
        })
      ).toEqual({ ok: false, code: "OAUTH_STATE_OWNER_MISMATCH" });
      expect(
        validateOAuthState({
          stored: { ...rec, expiresAt: new Date(Date.now() - 1000).toISOString() },
          providedState: rec.state,
          ownerUid: "owner-uid-1"
        })
      ).toEqual({ ok: false, code: "OAUTH_STATE_EXPIRED" });
      expect(
        validateOAuthState({
          stored: rec,
          providedState: rec.state,
          ownerUid: "owner-uid-1",
          alreadyConsumed: true
        })
      ).toEqual({ ok: false, code: "OAUTH_STATE_REPLAY" });
      expect(
        validateOAuthState({
          stored: { ...rec, redirectUri: "https://evil.test/cb" },
          providedState: rec.state,
          ownerUid: "owner-uid-1"
        })
      ).toEqual({ ok: false, code: "OAUTH_REDIRECT_NOT_ALLOWLISTED" });
      expect(hashOwnerUid("owner-uid-1")).toHaveLength(16);
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe("token crypto", () => {
  it("round-trips encrypted tokens and masks account ids", () => {
    const enc = encryptTokenPayload("secret-token", "unit-test-secret");
    expect(enc.startsWith("v1:")).toBe(true);
    expect(decryptTokenPayload(enc, "unit-test-secret")).toBe("secret-token");
    expect(maskAccountId("12345678")).toContain("…");
  });
});

describe("symbol resolution", () => {
  it("accepts only confirmed gold/USD metadata", () => {
    const ok = resolveXauUsdFromCatalogue([
      {
        symbolId: 9,
        symbolName: "XAUUSD",
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
    expect(ok?.metadataComplete).toBe(true);
    const incomplete = resolveXauUsdFromCatalogue([
      { symbolId: 1, symbolName: "XAUUSD" }
    ]);
    expect(incomplete?.symbolName).toBe("XAUUSD");
    expect(incomplete?.metadataComplete).toBe(false);
    expect(
      resolveXauUsdFromCatalogue([
        {
          symbolId: 2,
          symbolName: "EURUSD",
          baseAsset: "EUR",
          quoteAsset: "USD",
          digits: 5,
          tickSize: 0.00001,
          minVolume: 0.01,
          stepVolume: 0.01,
          maxVolume: 100,
          lotSize: 100000
        }
      ])
    ).toBeNull();
    // Prefer exact XAUUSD over forwards / spread-bets
    const preferred = resolveXauUsdFromCatalogue([
      {
        symbolId: 99,
        symbolName: "XAUUSD-F",
        baseAsset: "XAU",
        quoteAsset: "USD",
        digits: 2,
        tickSize: 0.01,
        minVolume: 0.01,
        stepVolume: 0.01,
        maxVolume: 50,
        lotSize: 100
      },
      {
        symbolId: 41,
        symbolName: "XAUUSD",
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
    expect(preferred?.symbolId).toBe("41");
  });
});

describe("sizing", () => {
  it("rounds down and rejects missing stop / metadata", () => {
    const good = calculateCTraderVolume({
      equity: 10000,
      freeMargin: 9000,
      accountCurrency: "EUR",
      riskAmountEur: 20,
      entryPrice: 2350,
      stopLoss: 2340,
      lotSize: 100,
      tickSize: 0.01,
      minVolume: 0.01,
      volumeStep: 0.01,
      maxVolume: 50,
      marginPerLot: 200,
      eurToAccountRate: 1
    });
    expect(good.ok).toBe(true);
    expect(good.volume).toBeGreaterThan(0);
    expect(good.volume! % 0.01).toBeCloseTo(0, 8);

    expect(
      calculateCTraderVolume({
        equity: 10000,
        freeMargin: 9000,
        accountCurrency: "EUR",
        riskAmountEur: 20,
        entryPrice: 2350,
        stopLoss: null,
        lotSize: 100,
        tickSize: 0.01,
        minVolume: 0.01,
        volumeStep: 0.01,
        maxVolume: 50,
        marginPerLot: 200,
        eurToAccountRate: 1
      }).rejectionReason
    ).toBe("STOP_LOSS_REQUIRED");
  });
});

describe("decision mapping", () => {
  it("maps BUY/SELL/EXIT/WAIT with CLOSE_ONLY default", () => {
    expect(mapDecisionToCTraderAction({ decision: "BUY", position: "FLAT" }).brokerMutation).toBe(
      "OPEN_LONG"
    );
    expect(mapDecisionToCTraderAction({ decision: "SELL", position: "FLAT" }).brokerMutation).toBe(
      "OPEN_SHORT"
    );
    expect(
      mapDecisionToCTraderAction({ decision: "BUY", position: "SHORT" }).action
    ).toBe("EXIT_SHORT");
    expect(mapDecisionToCTraderAction({ decision: "WAIT", position: "FLAT" }).brokerMutation).toBe(
      "NONE"
    );
  });
});

describe("preview engine", () => {
  it("builds blocked and ready previews; approve never submits", () => {
    const symbol = fixtureXauUsdSymbol();
    const quote = fixtureQuote("OPEN");
    const ready = buildTradePreview({
      decisionId: "d1",
      decision: "BUY",
      confidence: 90,
      generatedAt: new Date().toISOString(),
      candleConfirmed: true,
      stopLoss: 2340,
      takeProfits: [2365],
      symbol,
      quote,
      position: null,
      pendingOrdersCount: 0,
      equity: 10000,
      freeMargin: 9000,
      accountCurrency: "EUR",
      riskAmountEur: 20,
      maxSpread: 1,
      demonstration: true,
      eurToAccountRate: 1,
      marginPerLot: 200
    });
    expect(ready.orderSubmissionEnabled).toBe(false);
    expect(ready.label).toContain("NO ORDER");
    const approved = approveTradePreview(ready);
    expect(approved.state).toBe("PREVIEW_APPROVED");
    expect(approved.orderSubmissionEnabled).toBe(false);

    const blocked = buildTradePreview({
      decisionId: "d2",
      decision: "BUY",
      confidence: 10,
      generatedAt: new Date(Date.now() - 120_000).toISOString(),
      candleConfirmed: false,
      stopLoss: null,
      takeProfits: [],
      symbol,
      quote,
      position: null,
      pendingOrdersCount: 1,
      equity: 10000,
      freeMargin: 9000,
      accountCurrency: "EUR",
      riskAmountEur: 20,
      maxSpread: 0.01,
      demonstration: true,
      eurToAccountRate: 1
    });
    expect(blocked.state).toBe("BLOCKED");
    expect(blocked.failedGates.length).toBeGreaterThan(0);

    const marginUnknown = buildTradePreview({
      decisionId: "d3",
      decision: "BUY",
      confidence: 90,
      generatedAt: new Date().toISOString(),
      candleConfirmed: true,
      stopLoss: 2340,
      takeProfits: [2365],
      symbol,
      quote,
      position: null,
      pendingOrdersCount: 0,
      equity: 10000,
      freeMargin: null,
      accountCurrency: "EUR",
      riskAmountEur: 20,
      maxSpread: 1,
      demonstration: false,
      eurToAccountRate: 1,
      marginPerLot: 200
    });
    expect(marginUnknown.state).toBe("BLOCKED");
    expect(marginUnknown.failedGates).toContain("MARGIN_ELIGIBILITY_UNKNOWN");
    expect(marginUnknown.orderSubmissionEnabled).toBe(false);

    const key = buildIntentKey({
      ownerUid: "u",
      broker: "pepperstone_ctrader",
      accountId: "a",
      environment: "DEMO",
      decisionId: "d1",
      symbolId: "s",
      action: "BUY"
    });
    expect(key).toHaveLength(64);
  });
});

describe("qualification", () => {
  it("keeps Demo Auto inactive when Demo submission env is off", () => {
    const prev = process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
    delete process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
    const r = evaluateDemoAutoQualification({
      authHealthy: true,
      pinnedOwnerVerified: true,
      oauthHealthy: true,
      pepperstoneDemoConfirmed: true,
      xauusdMetadataComplete: true,
      completedPreviews: 20,
      approvedControlledDemoTrades: 5,
      firstDemoTradeAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
      unresolvedUnknownOrders: 0,
      duplicateOrders: 0,
      restartRecoveryTested: true,
      emergencyStopTested: true,
      dailyLossLockTested: true,
      ownerUnlockedDemoAuto: true
    });
    expect(r.unlocked).toBe(true);
    expect(r.canActivate).toBe(false);
    if (prev === undefined) delete process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
    else process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = prev;
  });

  it("allows Demo Auto activate when Demo submission is enabled", () => {
    const prev = process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
    process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = "true";
    const r = evaluateDemoAutoQualification({
      authHealthy: true,
      pinnedOwnerVerified: true,
      oauthHealthy: true,
      pepperstoneDemoConfirmed: true,
      xauusdMetadataComplete: true,
      completedPreviews: 0,
      approvedControlledDemoTrades: 0,
      firstDemoTradeAt: null,
      unresolvedUnknownOrders: 0,
      duplicateOrders: 0,
      restartRecoveryTested: false,
      emergencyStopTested: false,
      dailyLossLockTested: false,
      ownerUnlockedDemoAuto: true,
      tradingScopeGranted: true
    });
    expect(r.canActivate).toBe(true);
    if (prev === undefined) delete process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
    else process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = prev;
  });
});

describe("mutation guard + service", () => {
  it("denies all order methods", () => {
    expect(() => cTraderOrderApi.placeMarketBuy()).toThrow(CTraderMutationDisabledError);
    expect(() => cTraderOrderApi.closePosition()).toThrow(CTraderMutationDisabledError);
  });

  it("readiness and control centre stay disconnected with AutoTrade OFF", () => {
    // Isolate from deploy-shell env (CTRADER_DEMO_ORDER_SUBMISSION_ENABLED may be true).
    const prev = process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
    delete process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
    const readiness = buildCTraderReadiness();
    expect(readiness.connected).toBe(false);
    expect(readiness.autoTrade).toBe("OFF");
    expect(readiness.orderSubmissionEnabled).toBe(false);
    if (prev === undefined) delete process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
    else process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = prev;
    expect(readiness.wizardSteps).toHaveLength(8);
    expect(readiness.wizardSteps[0]?.title).toMatch(/Create Pepperstone/i);
    expect(readiness.wizardSteps[7]?.title).toMatch(/Enable Demo Auto/i);
    expect(readiness.label).toMatch(/Pepperstone connection required/i);
    const centre = getBrokerControlCentreSnapshot();
    expect(centre.autoTrade).toBe("OFF");
    expect(centre.brokers.some((b) => b.id === "pepperstone_ctrader")).toBe(true);
    expect(centre.brokers.find((b) => b.id === "pepperstone_ctrader")?.name).toMatch(/Pepperstone/i);
    expect(centre.defaultBroker).toBe("pepperstone_ctrader");
    expect(centre.brokers.some((b) => b.id === "ig")).toBe(false);
    const demo = buildDemonstrationBundle();
    expect(demo.banner).toBe(FIXTURE_BANNER);
  });
});

describe("Spotware account list HTTP", () => {
  it("parses axios-style JSON without double-parse and filters Live/deleted", async () => {
    const { fetchTradingAccountsByAccessToken } = await import(
      "../../../../src/services/broker/ctrader/openApiClient"
    );
    const payload = [
      {
        accountId: 48100001,
        live: true,
        brokerTitle: "Pepperstone - Europe",
        depositCurrency: "EUR",
        leverage: 30,
        deleted: false
      },
      {
        accountId: 48100002,
        live: false,
        brokerTitle: "Pepperstone - Europe",
        depositCurrency: "EUR",
        leverage: 30,
        deleted: false
      },
      {
        accountId: 48100003,
        live: false,
        brokerTitle: "Pepperstone - Europe",
        depositCurrency: "EUR",
        leverage: 30,
        deleted: true
      }
    ];
    const fetchImpl = async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    const accounts = await fetchTradingAccountsByAccessToken("tok", fetchImpl as typeof fetch);
    expect(accounts).toHaveLength(2);
    expect(accounts.filter((a) => a.isLive)).toHaveLength(1);
    expect(accounts.filter((a) => !a.isLive)).toHaveLength(1);
    expect(accounts.find((a) => !a.isLive)?.brokerNameTitle).toMatch(/Pepperstone/i);
    expect(accounts.find((a) => !a.isLive)?.ctidTraderAccountId).toBe("48100002");
  });
});

describe("mock server + paper simulator", () => {
  it("labels fixtures and rejects live accounts in live_account_rejected", () => {
    const mock = createCTraderMockServer("live_account_rejected");
    expect(mock.label).toContain("TEST FIXTURE");
    expect(mock.listAccounts()).toEqual([]);
    mock.setScenario("demo_accounts");
    expect(mock.listAccounts()[0]?.isDemo).toBe(true);
  });

  it("paper simulator never claims broker identity", () => {
    const paper = createPaperSimulator();
    expect(paper.label).toBe(PAPER_LABEL);
    const opened = paper.openMarket({
      direction: "LONG",
      volume: 0.01,
      quote: {
        bid: 2350,
        ask: 2350.3,
        timestamp: new Date().toISOString(),
        source: "HISTORICAL_FIXTURE"
      },
      stopLoss: 2340,
      takeProfit: 2360,
      slippage: 0.05,
      maxTradesPerDay: 3
    });
    expect(opened.ok).toBe(true);
    paper.engageEmergencyStop();
    expect(
      paper.openMarket({
        direction: "SHORT",
        volume: 0.01,
        quote: {
          bid: 2350,
          ask: 2350.3,
          timestamp: new Date().toISOString(),
          source: "HISTORICAL_FIXTURE"
        },
        stopLoss: 2360,
        takeProfit: 2330,
        slippage: 0,
        maxTradesPerDay: 3
      }).reason
    ).toBe("EMERGENCY_STOP");
  });
});
