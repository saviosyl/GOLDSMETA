/**
 * Trading 212 General Invest — read-only + paper surface tests.
 * No real order submission. Owner-only. CFD/XAU rejected.
 */

import { describe, expect, it, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import {
  BROKER_EXECUTION_ENABLED,
  T212_LIVE_EXECUTION_FEATURE_FLAG,
  T212_PAPER_ORDER_SUBMISSION_ENABLED
} from "../../../src/services/autoTrade/types";
import {
  loadT212CredentialsFromServerEnv,
  resolveT212InvestReadEnvironment,
  T212_ORDER_CREATE_PATHS,
  T212InvestClient
} from "../../../src/services/autoTrade/t212/client";
import {
  assertT212InvestReadOnlyFlags,
  classifyInvestInstrument,
  createT212InvestReadService,
  isOwnerOnlyUid,
  T212_LIVE_ORDER_SUBMISSION_ENABLED,
  T212_ORDER_SUBMISSION_ENABLED
} from "../../../src/services/autoTrade/t212/investReadService";
import { createT212InvestPaperPortfolio } from "../../../src/services/autoTrade/t212/investPaperPortfolio";
import { buildT212StockPreview } from "../../../src/services/autoTrade/t212/investPreview";
import { buildT212InvestRouter } from "../../../src/routes/t212Invest";
import { redactSecrets } from "../../../src/services/autoTrade/redactSecrets";

const PINNED = "pinned-owner-uid-fixture";

function mockFetch(handlers: Record<string, unknown>): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    const path = String(url);
    for (const [key, body] of Object.entries(handlers)) {
      if (path.includes(key)) {
        return new Response(JSON.stringify(body), { status: 200 });
      }
    }
    return new Response(JSON.stringify({ error: "unexpected", path }), { status: 500 });
  }) as typeof fetch;
}

describe("T212 invest read-only flags", () => {
  it("keeps all order and broker execution flags hard-false", () => {
    expect(T212_ORDER_SUBMISSION_ENABLED).toBe(false);
    expect(T212_LIVE_ORDER_SUBMISSION_ENABLED).toBe(false);
    expect(T212_PAPER_ORDER_SUBMISSION_ENABLED).toBe(false);
    expect(T212_LIVE_EXECUTION_FEATURE_FLAG).toBe(false);
    expect(BROKER_EXECUTION_ENABLED).toBe(false);
    expect(() => assertT212InvestReadOnlyFlags()).not.toThrow();
  });

  it("blocks order-create paths on the HTTP client", async () => {
    let called = false;
    const client = new T212InvestClient(
      "PRACTICE",
      { apiKey: "k", apiSecret: "s" },
      {
        fetchImpl: (async () => {
          called = true;
          return new Response("{}", { status: 200 });
        }) as typeof fetch
      }
    );
    for (const path of T212_ORDER_CREATE_PATHS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((client as any).request(path, { method: "POST" })).rejects.toMatchObject({
        code: "ORDER_ENDPOINT_BLOCKED"
      });
    }
    expect(called).toBe(false);
  });
});

describe("T212 credential loading", () => {
  it("loads T212_API_KEY / T212_API_SECRET / T212_ENVIRONMENT aliases", () => {
    const env = {
      T212_API_KEY: "shared-key",
      T212_API_SECRET: "shared-secret",
      T212_ENVIRONMENT: "PRACTICE"
    };
    expect(resolveT212InvestReadEnvironment(env)).toBe("PRACTICE");
    expect(loadT212CredentialsFromServerEnv("PRACTICE", env)).toEqual({
      apiKey: "shared-key",
      apiSecret: "shared-secret"
    });
  });

  it("redacts secrets from error text", () => {
    const msg = redactSecrets("Authorization Basic abcdefghijklmnop failure");
    expect(msg.toLowerCase()).not.toContain("abcdefghijklmnop");
  });
});

describe("General Invest instrument classification", () => {
  it("allows ordinary stocks and ETFs", () => {
    expect(classifyInvestInstrument({ ticker: "AAPL_US_EQ", name: "Apple", type: "STOCK" }).allowed)
      .toBe(true);
    expect(classifyInvestInstrument({ ticker: "VWCE_EQ", name: "Vanguard FTSE", type: "ETF" }).allowed)
      .toBe(true);
  });

  it("rejects CFD, XAUUSD, SIPP and leverage", () => {
    expect(classifyInvestInstrument({ ticker: "XAUUSD", name: "Gold", type: "CFD" }).allowed).toBe(
      false
    );
    expect(
      classifyInvestInstrument({ ticker: "GOLD_CFD", name: "Gold CFD", type: "CFD" }).reason
    ).toMatch(/CFD|XAU/);
    expect(
      classifyInvestInstrument({ ticker: "LEV", name: "3x Leveraged ETF", type: "ETF" }).allowed
    ).toBe(false);
    expect(
      classifyInvestInstrument({ ticker: "SIPP1", name: "SIPP wrapper", type: "SIPP" }).allowed
    ).toBe(false);
  });
});

describe("Owner-only access", () => {
  it("matches only the pinned owner UID", () => {
    const env = { GOLDMETA_PINNED_OWNER_UID: PINNED };
    expect(isOwnerOnlyUid(PINNED, env)).toBe(true);
    expect(isOwnerOnlyUid("replacement-uid", env)).toBe(false);
  });
});

describe("Paper portfolio", () => {
  it("simulates BUY and SELL OWNED without broker calls", () => {
    const paper = createT212InvestPaperPortfolio({ startingCash: 5_000 });
    const buy = paper.buy({
      ticker: "AAPL_US_EQ",
      quantity: 2,
      price: 100,
      marketOpen: true,
      priceTimestamp: new Date().toISOString()
    });
    expect(buy.ok).toBe(true);
    expect(paper.getState().positions[0]?.ticker).toBe("AAPL_US_EQ");

    const short = paper.sellOwned({
      ticker: "AAPL_US_EQ",
      quantity: 5,
      price: 110,
      marketOpen: true
    });
    expect(short.ok).toBe(false);
    expect(short.reason).toBe("SELL_EXCEEDS_OWNED");

    const sell = paper.sellOwned({
      ticker: "MSFT_US_EQ",
      quantity: 1,
      price: 100,
      marketOpen: true
    });
    expect(sell.ok).toBe(false);
    expect(sell.reason).toBe("NO_OWNED_POSITION");

    const okSell = paper.sellOwned({
      ticker: "AAPL_US_EQ",
      quantity: 1,
      price: 110,
      marketOpen: true,
      priceTimestamp: new Date().toISOString()
    });
    expect(okSell.ok).toBe(true);
    expect(paper.getState().journal[0]?.side).toBe("SELL_OWNED");
  });

  it("rejects stale prices, market closed, and emergency stop", () => {
    const paper = createT212InvestPaperPortfolio();
    expect(
      paper.buy({
        ticker: "AAPL_US_EQ",
        quantity: 1,
        price: 100,
        marketOpen: false
      }).reason
    ).toBe("MARKET_CLOSED");
    expect(
      paper.buy({
        ticker: "AAPL_US_EQ",
        quantity: 1,
        price: 100,
        marketOpen: true,
        priceTimestamp: new Date(Date.now() - 10 * 60_000).toISOString()
      }).reason
    ).toBe("STALE_PRICE");
    paper.engageEmergencyStop();
    expect(
      paper.buy({
        ticker: "AAPL_US_EQ",
        quantity: 1,
        price: 100,
        marketOpen: true,
        priceTimestamp: new Date().toISOString()
      }).reason
    ).toBe("EMERGENCY_STOP");
  });
});

describe("Stock preview engine", () => {
  it("never emits naked SELL and shows paper disclaimer", () => {
    const preview = buildT212StockPreview({
      ticker: "AAPL_US_EQ",
      currentPrice: 180,
      signalScore: 20,
      ownedQuantity: 0
    });
    expect(preview.action).not.toBe("SELL_OWNED");
    expect(preview.disclaimer).toContain("Paper preview only");
    expect(preview.ordersEnabled).toBe(false);
    expect(preview.autoTrade).toBe("OFF");
  });

  it("allows SELL_OWNED only when quantity is owned", () => {
    const preview = buildT212StockPreview({
      ticker: "AAPL_US_EQ",
      currentPrice: 180,
      signalScore: 20,
      ownedQuantity: 3
    });
    expect(preview.action).toBe("SELL_OWNED");
    expect(preview.ownedQuantity).toBe(3);
  });
});

describe("T212 invest read service", () => {
  const env = {
    GOLDMETA_PINNED_OWNER_UID: PINNED,
    T212_API_KEY: "k",
    T212_API_SECRET: "s",
    T212_ENVIRONMENT: "PRACTICE"
  };

  it("returns portfolio as General Invest read-only", async () => {
    const service = createT212InvestReadService({
      env,
      fetchImpl: mockFetch({
        "/equity/account/summary": {
          id: 998877,
          currency: "EUR",
          totalValue: 12_000,
          cash: { availableToTrade: 4_000 },
          investments: {
            currentValue: 8_000,
            unrealizedProfitLoss: 120,
            realizedProfitLoss: 40
          }
        },
        "/equity/positions": [
          {
            ticker: "VWCE_EQ",
            quantity: 10,
            averagePricePaid: 90,
            currentPrice: 100,
            currency: "EUR",
            instrument: { name: "Vanguard FTSE All-World" }
          }
        ],
        "/equity/history/orders": { items: [{ id: 1, ticker: "VWCE_EQ" }] }
      })
    });
    const portfolio = await service.getPortfolio(PINNED);
    expect(portfolio.accountType).toBe("GENERAL_INVEST");
    expect(portfolio.ordersEnabled).toBe(false);
    expect(portfolio.autoTrade).toBe("OFF");
    expect(portfolio.connectionStatus).toBe("CONNECTED");
    expect(portfolio.accountIdMasked).toMatch(/…/);
    expect(portfolio.positions[0]?.ticker).toBe("VWCE_EQ");
  });

  it("filters CFD/XAU from search results as rejected", async () => {
    const service = createT212InvestReadService({
      env,
      fetchImpl: mockFetch({
        "/equity/metadata/instruments": [
          { ticker: "AAPL_US_EQ", name: "Apple", type: "STOCK", currencyCode: "USD" },
          { ticker: "XAUUSD", name: "Gold Spot", type: "CFD", currencyCode: "USD" }
        ]
      })
    });
    const result = await service.searchInstruments("a");
    const xau = result.candidates.find((c) => c.ticker === "XAUUSD");
    const apple = result.candidates.find((c) => c.ticker === "AAPL_US_EQ");
    expect(apple?.allowed).toBe(true);
    expect(xau?.allowed).toBe(false);
  });

  it("supports watchlist add/remove in memory and rejects CFD", async () => {
    const service = createT212InvestReadService({
      env,
      watchlistStore: new Map()
    });
    await expect(
      service.addWatchlistItem(PINNED, {
        ticker: "XAUUSD",
        name: "Gold CFD",
        currency: "USD",
        exchange: null
      })
    ).rejects.toMatchObject({ code: "XAUUSD_NOT_SUPPORTED" });

    const items = await service.addWatchlistItem(PINNED, {
      ticker: "AAPL_US_EQ",
      name: "Apple",
      currency: "USD",
      exchange: "NASDAQ"
    });
    expect(items).toHaveLength(1);
    const removed = await service.removeWatchlistItem(PINNED, "AAPL_US_EQ");
    expect(removed).toHaveLength(0);
  });

  it("keeps paper fills isolated from broker order paths", () => {
    const service = createT212InvestReadService({ env, watchlistStore: new Map() });
    const buy = service.paperBuy(PINNED, {
      ticker: "AAPL_US_EQ",
      quantity: 1,
      price: 150,
      marketOpen: true,
      priceTimestamp: new Date().toISOString(),
      signalRef: "sig-1"
    });
    expect(buy.ok).toBe(true);
    const dup = service.paperBuy(PINNED, {
      ticker: "AAPL_US_EQ",
      quantity: 1,
      price: 150,
      marketOpen: true,
      priceTimestamp: new Date().toISOString(),
      signalRef: "sig-1"
    });
    expect(dup.ok).toBe(false);
    expect(dup.reason).toBe("DUPLICATE_SIGNAL");
    expect(service.blockedOrderPaths().length).toBeGreaterThan(0);
  });
});

describe("T212 invest HTTP routes", () => {
  beforeEach(() => {
    process.env.GOLDMETA_PINNED_OWNER_UID = PINNED;
  });

  function buildApp() {
    const service = createT212InvestReadService({
      env: { GOLDMETA_PINNED_OWNER_UID: PINNED },
      watchlistStore: new Map(),
      fetchImpl: mockFetch({
        "/equity/account/summary": { id: 1, currency: "EUR", totalValue: 100 },
        "/equity/positions": [],
        "/equity/history/orders": { items: [] },
        "/equity/metadata/instruments": []
      })
    });
    const app = express();
    app.use(express.json());
    app.use(buildT212InvestRouter(service));
    return { app, service };
  }

  it("denies non-owner access to portfolio", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/v1/t212/invest/portfolio")
      .set("x-test-user-id", "other-user")
      .set("x-test-role", "USER_APPROVED");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("OWNER_ONLY");
  });

  it("allows pinned owner and denies order mutations", async () => {
    const { app, service } = buildApp();
    const flags = await request(app)
      .get("/v1/t212/invest/flags")
      .set("x-test-user-id", PINNED)
      .set("x-test-role", "OWNER");
    expect(flags.status).toBe(200);
    expect(flags.body.flags.AutoTrade).toBe("OFF");
    expect(flags.body.flags.ordersEnabled).toBe(false);
    expect(service.flags().cfdSupported).toBe(false);

    const denied = await request(app)
      .post("/v1/t212/invest/orders/market")
      .set("x-test-user-id", PINNED)
      .set("x-test-role", "OWNER")
      .send({ ticker: "AAPL_US_EQ", quantity: 1 });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("ORDER_ENDPOINT_BLOCKED");
  });
});

describe("Mutation denial helpers", () => {
  it("lists all documented order create paths as blocked", () => {
    expect(T212_ORDER_CREATE_PATHS).toEqual(
      expect.arrayContaining([
        "/equity/orders/market",
        "/equity/orders/limit",
        "/equity/orders/stop",
        "/equity/orders/stop_limit"
      ])
    );
  });
});
