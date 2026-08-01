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
  it("keeps mutation flags hard-false even if env tries to enable", () => {
    const flags = snapshotCTraderFlags({
      CTRADER_DEMO_ORDER_SUBMISSION_ENABLED: "true",
      CTRADER_LIVE_ENABLED: "true",
      BROKER_EXECUTION_ENABLED: "true"
    });
    expect(flags.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED).toBe(false);
    expect(flags.CTRADER_LIVE_ENABLED).toBe(false);
    expect(flags.BROKER_EXECUTION_ENABLED).toBe(false);
    expect(flags.mutationFlagsHardFalse).toBe(true);
    expect(() => assertCTraderMutationsDisabled({})).not.toThrow();
  });

  it("fails closed when source env attempts mutation enablement", () => {
    expect(() =>
      assertCTraderMutationsDisabled({
        CTRADER_DEMO_ORDER_SUBMISSION_ENABLED: "true"
      })
    ).toThrow(/MUST_REMAIN_FALSE/);
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
    expect(cfg.environment).toBe("DEMO");
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
    expect(
      resolveXauUsdFromCatalogue([{ symbolId: 1, symbolName: "XAUUSD" }])
    ).toBeNull();
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
  it("keeps Demo Auto locked even when gates pass", () => {
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
  });
});

describe("mutation guard + service", () => {
  it("denies all order methods", () => {
    expect(() => cTraderOrderApi.placeMarketBuy()).toThrow(CTraderMutationDisabledError);
    expect(() => cTraderOrderApi.closePosition()).toThrow(CTraderMutationDisabledError);
  });

  it("readiness and control centre stay disconnected with AutoTrade OFF", () => {
    const readiness = buildCTraderReadiness();
    expect(readiness.connected).toBe(false);
    expect(readiness.autoTrade).toBe("OFF");
    expect(readiness.orderSubmissionEnabled).toBe(false);
    expect(readiness.wizardSteps).toHaveLength(8);
    expect(readiness.wizardSteps[0]?.title).toMatch(/Create Pepperstone/i);
    expect(readiness.wizardSteps[7]?.title).toMatch(/Demo trading approval/i);
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
