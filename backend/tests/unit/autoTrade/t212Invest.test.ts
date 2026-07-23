/**
 * Trading 212 Invest — broker selection, mapping rules, dry-run, parked IG.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { AutoTradeService } from "../../../src/services/autoTrade/autoTradeService";
import { InMemoryAutoTradeStore } from "../../../src/services/autoTrade/inMemoryAutoTradeStore";
import { FakeIgBrokerAdapter } from "../../../src/services/autoTrade/fakeIgBrokerAdapter";
import {
  BROKER_EXECUTION_ENABLED,
  DEMO_ORDER_SUBMISSION_ENABLED,
  LIVE_EXECUTION_FEATURE_FLAG,
  T212_LIVE_EXECUTION_FEATURE_FLAG,
  T212_PAPER_ORDER_SUBMISSION_ENABLED
} from "../../../src/services/autoTrade/types";
import {
  SHORT_UNSUPPORTED_REASON,
  T212_PROXY_DISCLAIMER
} from "../../../src/services/autoTrade/t212/types";
import {
  translateXauusdToT212Invest,
  buildIdempotencyKey
} from "../../../src/services/autoTrade/t212/executionRules";
import {
  searchGoldInstruments,
  requireExplicitInstrumentSelection
} from "../../../src/services/autoTrade/t212/instruments";
import {
  loadT212CredentialsFromServerEnv,
  T212InvestClient
} from "../../../src/services/autoTrade/t212/client";
import { assertOrderSubmissionDisabled } from "../../../src/services/autoTrade/t212/diagnostics";

function serviceWithT212(fetchImpl?: typeof fetch) {
  const store = new InMemoryAutoTradeStore();
  const service = new AutoTradeService(
    store,
    (env) => new FakeIgBrokerAdapter({ environment: env }),
    {
      ownerId: "t212-test",
      t212CredentialLoader: () => ({ apiKey: "demo-key", apiSecret: "demo-secret" }),
      t212ClientFactory: (environment, credentials) =>
        new T212InvestClient(environment, credentials, {
          fetchImpl:
            fetchImpl ??
            (async (url: RequestInfo | URL) => {
              const path = String(url);
              if (path.includes("/equity/account/summary")) {
                return new Response(
                  JSON.stringify({
                    id: 12345,
                    currency: "EUR",
                    totalValue: 1000,
                    cash: { availableToTrade: 500, inPies: 0, reservedForOrders: 0 },
                    investments: { currentValue: 500, totalCost: 480 }
                  }),
                  { status: 200 }
                );
              }
              if (path.includes("/equity/positions")) {
                return new Response(JSON.stringify([]), { status: 200 });
              }
              if (path.includes("/equity/metadata/instruments")) {
                return new Response(
                  JSON.stringify([
                    {
                      ticker: "SGLD_EQ",
                      name: "Physical Gold ETC",
                      isin: "JE00B1VS3770",
                      currencyCode: "EUR",
                      type: "ETF",
                      minTradeQuantity: 0.01
                    },
                    {
                      ticker: "GLD_US",
                      name: "SPDR Gold Shares ETF",
                      isin: "US78463V1070",
                      currencyCode: "USD",
                      type: "ETF"
                    },
                    {
                      ticker: "GOLDMINER",
                      name: "Gold Mining Equity",
                      currencyCode: "EUR",
                      type: "STOCK"
                    }
                  ]),
                  { status: 200 }
                );
              }
              if (path.includes("/equity/orders") || path.includes("/equity/history")) {
                return new Response(JSON.stringify({ items: [], nextPagePath: null }), {
                  status: 200
                });
              }
              return new Response(JSON.stringify({ error: "unexpected", path }), { status: 500 });
            }) as typeof fetch
        })
    }
  );
  return { store, service };
}

describe("Trading 212 Invest broker integration", () => {
  beforeEach(() => {
    AutoTradeService.resetRestartGateForTests();
  });

  it("defaults broker to MANUAL", async () => {
    const { service } = serviceWithT212();
    const status = await service.getStatus("u1");
    expect(status.selectedBroker).toBe("MANUAL");
    expect(status.brokerBadge).toBe("MANUAL");
    expect(status.mode).toBe("OFF");
    expect(status.igParked).toBe(true);
  });

  it("keeps all order flags false", () => {
    expect(BROKER_EXECUTION_ENABLED).toBe(false);
    expect(T212_PAPER_ORDER_SUBMISSION_ENABLED).toBe(false);
    expect(T212_LIVE_EXECUTION_FEATURE_FLAG).toBe(false);
    expect(DEMO_ORDER_SUBMISSION_ENABLED).toBe(false);
    expect(LIVE_EXECUTION_FEATURE_FLAG).toBe(false);
    expect(() => assertOrderSubmissionDisabled()).not.toThrow();
  });

  it("loads T212 secrets from server env only", () => {
    const creds = loadT212CredentialsFromServerEnv("PRACTICE", {
      T212_DEMO_API_KEY: "k",
      T212_DEMO_API_SECRET: "s"
    } as NodeJS.ProcessEnv);
    expect(creds).toEqual({ apiKey: "k", apiSecret: "s" });
    expect(
      loadT212CredentialsFromServerEnv("LIVE", {
        T212_DEMO_API_KEY: "k",
        T212_DEMO_API_SECRET: "s"
      } as NodeJS.ProcessEnv)
    ).toBeNull();
  });

  it("broker switching forces OFF and clears pending proposals", async () => {
    const { service, store } = serviceWithT212();
    await service.selectBroker("u1", "T212_INVEST");
    await service.connectTrading212("u1", "PRACTICE");
    await service.confirmT212Instrument("u1", {
      instrumentId: "SGLD_EQ",
      ticker: "SGLD_EQ",
      name: "Physical Gold ETC",
      currency: "EUR"
    });
    // Force mode to SHADOW then switch broker
    await store.saveRiskState({
      ...(await store.getRiskState("u1")),
      mode: "SHADOW",
      updatedAt: new Date().toISOString()
    });
    await service.createT212ExecutionProposal("u1", {
      decisionId: "d-switch",
      decision: "BUY",
      confidence: 90,
      generatedAt: new Date().toISOString()
    });
    const after = await service.selectBroker("u1", "MANUAL");
    expect(after.mode).toBe("OFF");
    expect(after.selectedBroker).toBe("MANUAL");
    const proposals = await store.listT212Proposals("u1");
    expect(proposals.every((p) => p.status !== "AWAITING_CONFIRMATION")).toBe(true);
  });

  it("IG Demo is parked and connect is blocked while MANUAL/T212 selected", async () => {
    const { service } = serviceWithT212();
    await expect(service.connectBroker("u1", "DEMO")).rejects.toMatchObject({
      code: "IG_PARKED"
    });
    await service.selectBroker("u1", "T212_INVEST");
    await expect(service.setMode("u1", "IG_DEMO_AUTO")).rejects.toMatchObject({
      code: "IG_PARKED"
    });
    const status = await service.getStatus("u1");
    expect(status.brokerBadge).toMatch(/T212/);
    expect(status.igParked).toBe(true);
    expect(status.lastDiagnosticReport).toBeNull();
  });

  it("read-only T212 connect + diagnostics never call order endpoints", async () => {
    const called: string[] = [];
    const { service } = serviceWithT212(async (url) => {
      called.push(String(url));
      const path = String(url);
      if (path.includes("/summary")) {
        return new Response(
          JSON.stringify({
            id: 1,
            currency: "EUR",
            totalValue: 200,
            cash: { availableToTrade: 100 },
            investments: { currentValue: 100 }
          }),
          { status: 200 }
        );
      }
      if (path.includes("/positions")) return new Response(JSON.stringify([]), { status: 200 });
      if (path.includes("/instruments")) {
        return new Response(
          JSON.stringify([{ ticker: "SGLD_EQ", name: "Physical Gold ETC", currencyCode: "EUR" }]),
          { status: 200 }
        );
      }
      if (path.includes("/orders/market") || path.includes("/orders/limit")) {
        throw new Error("ORDER_ENDPOINT_SHOULD_NOT_BE_CALLED");
      }
      return new Response("{}", { status: 200 });
    });
    await service.selectBroker("u1", "T212_INVEST");
    const status = await service.connectTrading212("u1", "PRACTICE");
    expect(status.t212?.connected).toBe(true);
    expect(status.t212?.ordersEnabled).toBe(false);
    expect(status.brokerBadge).toBe("T212 PRACTICE — READ ONLY");
    expect(called.some((u) => /\/equity\/account\/summary/.test(u))).toBe(true);
    expect(called.some((u) => /\/equity\/positions/.test(u))).toBe(true);
    expect(called.some((u) => /\/equity\/account\/cash/.test(u))).toBe(false);
    expect(called.some((u) => /\/equity\/portfolio/.test(u))).toBe(false);
    expect(called.some((u) => /\/equity\/orders\/(market|limit)/.test(u))).toBe(false);
    const diag = await service.refreshT212Diagnostics("u1");
    expect(diag.t212LastDiagnosticReport?.orderEndpointsCalled).toBe(false);
    expect(diag.t212LastDiagnosticReport?.ordersEnabled).toBe(false);
  });

  it("hard-locks LIVE Trading 212 connect without loading live secrets", async () => {
    const { service } = serviceWithT212();
    await service.selectBroker("u1", "T212_INVEST");
    await expect(service.connectTrading212("u1", "LIVE")).rejects.toMatchObject({
      code: "T212_LIVE_LOCKED"
    });
  });

  it("emergency STOP cancels awaiting proposals and blocks dry-run approval", async () => {
    const { service, store } = serviceWithT212();
    await service.selectBroker("u1", "T212_INVEST");
    await service.connectTrading212("u1", "PRACTICE");
    await service.confirmT212Instrument("u1", {
      instrumentId: "SGLD_EQ",
      ticker: "SGLD_EQ",
      name: "Physical Gold ETC",
      currency: "EUR"
    });
    const created = await service.createT212ExecutionProposal(
      "u1",
      {
        decisionId: "stop-1",
        decision: "BUY",
        confidence: 90,
        generatedAt: new Date().toISOString()
      },
      { marketOpen: true }
    );
    expect(created.proposal.status).toBe("AWAITING_CONFIRMATION");
    await service.emergencyStop("u1");
    const proposals = await store.listT212Proposals("u1");
    expect(proposals.find((p) => p.proposalId === created.proposal.proposalId)?.status).toBe(
      "CANCELLED"
    );
    await expect(
      service.approveT212ProposalDryRun("u1", created.proposal.proposalId)
    ).rejects.toMatchObject({ code: "AUTOTRADE_LOCKED" });
  });

  it("instrument change after proposal rejects dry-run approval", async () => {
    const { service } = serviceWithT212();
    await service.selectBroker("u1", "T212_INVEST");
    await service.connectTrading212("u1", "PRACTICE");
    await service.confirmT212Instrument("u1", {
      instrumentId: "SGLD_EQ",
      ticker: "SGLD_EQ",
      name: "Physical Gold ETC",
      currency: "EUR"
    });
    const created = await service.createT212ExecutionProposal(
      "u1",
      {
        decisionId: "inst-change",
        decision: "BUY",
        confidence: 90,
        generatedAt: new Date().toISOString()
      },
      { marketOpen: true }
    );
    await service.confirmT212Instrument("u1", {
      instrumentId: "GLD_US",
      ticker: "GLD_US",
      name: "SPDR Gold Shares ETF",
      currency: "USD"
    });
    await expect(
      service.approveT212ProposalDryRun("u1", created.proposal.proposalId)
    ).rejects.toMatchObject({ code: "PROPOSAL_NOT_CONFIRMABLE" });
    // Prior awaiting proposal cancelled on instrument change; recreate path is separate.
  });

  it("rejects arbitrary instrument confirmation without catalogue", async () => {
    const { service } = serviceWithT212();
    await service.selectBroker("u1", "T212_INVEST");
    await expect(
      service.confirmT212Instrument("u1", {
        instrumentId: "FAKE",
        ticker: "FAKE",
        name: "Fake Gold",
        currency: "EUR"
      })
    ).rejects.toMatchObject({ code: "INSTRUMENT_CATALOGUE_REQUIRED" });
  });

  it("instrument search does not auto-select", async () => {
    const instruments = [
      { ticker: "SGLD_EQ", name: "Physical Gold ETC", currencyCode: "EUR", type: "ETF" },
      { ticker: "GLD_US", name: "SPDR Gold Shares ETF", currencyCode: "USD", type: "ETF" },
      { ticker: "GOLDMINER", name: "Gold Mining Equity", currencyCode: "EUR", type: "STOCK" },
      {
        ticker: "SBUL",
        name: "WisdomTree Gold 1x Daily Short",
        currencyCode: "USD",
        type: "ETF"
      },
      {
        ticker: "ESGP",
        name: "Gold Miners Screened (Acc)",
        currencyCode: "GBX",
        type: "ETF"
      },
      {
        ticker: "YGLD",
        name: "IncomeShares Gold+ Yield",
        currencyCode: "EUR",
        type: "ETF"
      }
    ];
    const candidates = searchGoldInstruments(instruments);
    expect(candidates.map((c) => c.ticker)).toEqual(["SGLD_EQ", "GLD_US"]);
    expect(requireExplicitInstrumentSelection(candidates, null).ok).toBe(false);
    expect(requireExplicitInstrumentSelection(candidates, "SGLD_EQ").ok).toBe(true);
  });

  it("BUY maps to selected instrument; SELL without position blocked; WAIT no order", () => {
    const instrument = {
      instrumentId: "SGLD_EQ",
      ticker: "SGLD_EQ",
      name: "Physical Gold ETC",
      currency: "EUR",
      isin: null,
      exchange: null,
      fractionalSupported: null,
      minOrderQuantity: null,
      minOrderValue: null,
      confirmedAt: new Date().toISOString(),
      confirmedBy: "u1"
    };
    const baseCtx = {
      userId: "u1",
      environment: "PRACTICE" as const,
      instrument,
      holdingQuantity: 0,
      freeCash: 200,
      totalValue: 1000,
      estimatedPrice: 50,
      marketOpen: true
    };
    const buy = translateXauusdToT212Invest(
      { decisionId: "d1", decision: "BUY", confidence: 90, generatedAt: new Date().toISOString() },
      baseCtx
    );
    expect(buy.action).toBe("BUY");
    expect(buy.side).toBe("BUY");
    expect(buy.status).toBe("SUBMISSION_DISABLED");

    const sellNone = translateXauusdToT212Invest(
      { decisionId: "d2", decision: "SELL", confidence: 90, generatedAt: new Date().toISOString() },
      baseCtx
    );
    expect(sellNone.action).toBe("WAIT");
    expect(sellNone.rejectionReason).toBe(SHORT_UNSUPPORTED_REASON);

    const sellClose = translateXauusdToT212Invest(
      { decisionId: "d3", decision: "SELL", confidence: 90, generatedAt: new Date().toISOString() },
      { ...baseCtx, holdingQuantity: 2 }
    );
    expect(sellClose.action).toBe("SELL_CLOSE");
    expect(sellClose.side).toBe("SELL");

    const wait = translateXauusdToT212Invest(
      { decisionId: "d4", decision: "WAIT", confidence: 90, generatedAt: new Date().toISOString() },
      baseCtx
    );
    expect(wait.action).toBe("WAIT");
    expect(wait.side).toBeNull();
  });

  it("rejects stale decisions, insufficient funds, market closed, and emergency STOP", async () => {
    const { service } = serviceWithT212();
    await service.selectBroker("u1", "T212_INVEST");
    await service.connectTrading212("u1", "PRACTICE");
    await service.confirmT212Instrument("u1", {
      instrumentId: "SGLD_EQ",
      ticker: "SGLD_EQ",
      name: "Physical Gold ETC",
      currency: "EUR"
    });

    const stale = await service.createT212ExecutionProposal(
      "u1",
      {
        decisionId: "stale",
        decision: "BUY",
        confidence: 90,
        generatedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString()
      },
      { marketOpen: true }
    );
    expect(stale.proposal.status).toBe("BLOCKED");
    expect(stale.proposal.rejectionReason).toBe("STALE_DECISION");

    const closed = translateXauusdToT212Invest(
      {
        decisionId: "mkt",
        decision: "BUY",
        confidence: 90,
        generatedAt: new Date().toISOString()
      },
      {
        userId: "u1",
        environment: "PRACTICE",
        instrument: {
          instrumentId: "SGLD_EQ",
          ticker: "SGLD_EQ",
          name: "Physical Gold ETC",
          currency: "EUR",
          isin: null,
          exchange: null,
          fractionalSupported: null,
          minOrderQuantity: null,
          minOrderValue: null,
          confirmedAt: new Date().toISOString(),
          confirmedBy: "u1"
        },
        holdingQuantity: 0,
        freeCash: 200,
        totalValue: 1000,
        estimatedPrice: 50,
        marketOpen: false
      }
    );
    expect(closed.rejectionReason).toBe("MARKET_CLOSED");

    const noCash = translateXauusdToT212Invest(
      {
        decisionId: "cash",
        decision: "BUY",
        confidence: 90,
        generatedAt: new Date().toISOString()
      },
      {
        userId: "u1",
        environment: "PRACTICE",
        instrument: {
          instrumentId: "SGLD_EQ",
          ticker: "SGLD_EQ",
          name: "Physical Gold ETC",
          currency: "EUR",
          isin: null,
          exchange: null,
          fractionalSupported: null,
          minOrderQuantity: null,
          minOrderValue: null,
          confirmedAt: new Date().toISOString(),
          confirmedBy: "u1"
        },
        holdingQuantity: 0,
        freeCash: 0,
        totalValue: 1000,
        estimatedPrice: 50,
        marketOpen: true
      }
    );
    expect(noCash.rejectionReason).toBe("INSUFFICIENT_FUNDS");

    const stopped = await service.emergencyStop("u1");
    expect(stopped.mode).toBe("OFF");
    expect(stopped.emergencyStopActive).toBe(true);
  });

  it("duplicate decision protection and dry-run approval only", async () => {
    const { service } = serviceWithT212();
    await service.selectBroker("u1", "T212_INVEST");
    await service.connectTrading212("u1", "PRACTICE");
    await service.confirmT212Instrument("u1", {
      instrumentId: "SGLD_EQ",
      ticker: "SGLD_EQ",
      name: "Physical Gold ETC",
      currency: "EUR"
    });
    const first = await service.createT212ExecutionProposal(
      "u1",
      {
        decisionId: "dup-1",
        decision: "BUY",
        confidence: 90,
        generatedAt: new Date().toISOString()
      },
      { marketOpen: true }
    );
    const second = await service.createT212ExecutionProposal(
      "u1",
      {
        decisionId: "dup-1",
        decision: "BUY",
        confidence: 90,
        generatedAt: new Date().toISOString()
      },
      { marketOpen: true }
    );
    expect(second.proposal.proposalId).toBe(first.proposal.proposalId);
    expect(first.proposal.idempotencyKey).toBe(
      buildIdempotencyKey({
        userId: "u1",
        decisionId: "dup-1",
        instrumentId: "SGLD_EQ",
        action: "BUY",
        environment: "PRACTICE"
      })
    );

    const approved = await service.approveT212ProposalDryRun("u1", first.proposal.proposalId, {
      confirmMethod: "manual"
    });
    expect(approved.proposal.status).toBe("DRY_RUN_APPROVED");
    expect(approved.proposal.riskEvaluation.orderSubmitted).toBe(false);
    expect(T212_PROXY_DISCLAIMER).toContain("not direct XAUUSD");
  });

  it("does not mutate Auth or TradingView via AutoTrade T212 paths", async () => {
    const { service } = serviceWithT212();
    const status = await service.selectBroker("u1", "T212_INVEST");
    expect(status.selectedBroker).toBe("T212_INVEST");
    // Sanity: service surface has no auth/webhook mutation methods
    expect((service as unknown as Record<string, unknown>).createUser).toBeUndefined();
    expect((service as unknown as Record<string, unknown>).rotateWebhook).toBeUndefined();
  });

  it("disconnect cancels all awaiting T212 proposals", async () => {
    const { service, store } = serviceWithT212();
    await service.selectBroker("u1", "T212_INVEST");
    await service.connectTrading212("u1", "PRACTICE");
    await service.confirmT212Instrument("u1", {
      instrumentId: "SGLD_EQ",
      ticker: "SGLD_EQ",
      name: "Physical Gold ETC",
      currency: "EUR"
    });
    const created = await service.createT212ExecutionProposal(
      "u1",
      {
        decisionId: "disc-1",
        decision: "BUY",
        confidence: 90,
        generatedAt: new Date().toISOString()
      },
      { marketOpen: true }
    );
    expect(created.proposal.status).toBe("AWAITING_CONFIRMATION");
    await service.disconnectTrading212("u1");
    const proposals = await store.listT212Proposals("u1");
    expect(proposals.find((p) => p.proposalId === created.proposal.proposalId)?.status).toBe(
      "CANCELLED"
    );
  });

  it("rejects cross-user proposal approval", async () => {
    const { service } = serviceWithT212();
    await service.selectBroker("owner", "T212_INVEST");
    await service.connectTrading212("owner", "PRACTICE");
    await service.confirmT212Instrument("owner", {
      instrumentId: "SGLD_EQ",
      ticker: "SGLD_EQ",
      name: "Physical Gold ETC",
      currency: "EUR"
    });
    const created = await service.createT212ExecutionProposal(
      "owner",
      {
        decisionId: "xuser-1",
        decision: "BUY",
        confidence: 90,
        generatedAt: new Date().toISOString()
      },
      { marketOpen: true }
    );
    await service.selectBroker("intruder", "T212_INVEST");
    await expect(
      service.approveT212ProposalDryRun("intruder", created.proposal.proposalId)
    ).rejects.toMatchObject({ code: "PROPOSAL_NOT_FOUND" });
  });

  it("blocks proposal creation after emergency STOP (concurrent-safe lock check)", async () => {
    const { service } = serviceWithT212();
    await service.selectBroker("u1", "T212_INVEST");
    await service.connectTrading212("u1", "PRACTICE");
    await service.confirmT212Instrument("u1", {
      instrumentId: "SGLD_EQ",
      ticker: "SGLD_EQ",
      name: "Physical Gold ETC",
      currency: "EUR"
    });
    await service.emergencyStop("u1");
    await expect(
      service.createT212ExecutionProposal(
        "u1",
        {
          decisionId: "after-stop",
          decision: "BUY",
          confidence: 90,
          generatedAt: new Date().toISOString()
        },
        { marketOpen: true }
      )
    ).rejects.toMatchObject({ code: "AUTOTRADE_LOCKED" });
  });

  it("Practice credentials never load from Live env vars and Live never from Practice", () => {
    expect(
      loadT212CredentialsFromServerEnv("PRACTICE", {
        T212_LIVE_API_KEY: "live-k",
        T212_LIVE_API_SECRET: "live-s"
      } as NodeJS.ProcessEnv)
    ).toBeNull();
    expect(
      loadT212CredentialsFromServerEnv("LIVE", {
        T212_DEMO_API_KEY: "demo-k",
        T212_DEMO_API_SECRET: "demo-s"
      } as NodeJS.ProcessEnv)
    ).toBeNull();
    expect(
      loadT212CredentialsFromServerEnv("PRACTICE", {
        T212_DEMO_API_KEY: "demo-k",
        T212_DEMO_API_SECRET: "demo-s",
        T212_LIVE_API_KEY: "live-k",
        T212_LIVE_API_SECRET: "live-s"
      } as NodeJS.ProcessEnv)
    ).toEqual({ apiKey: "demo-k", apiSecret: "demo-s" });
  });

  it("excludes leveraged/inverse/miner instruments from gold catalogue", () => {
    const candidates = searchGoldInstruments([
      { ticker: "SGLD", name: "Physical Gold ETC", currencyCode: "EUR" },
      { ticker: "NUGT", name: "Direxion Daily Gold Miners Bull 2X", currencyCode: "USD" },
      { ticker: "DUST", name: "Direxion Daily Gold Miners Bear 2X", currencyCode: "USD" },
      { ticker: "GLL", name: "ProShares UltraShort Gold", currencyCode: "USD" },
      { ticker: "MINER", name: "Gold Mining Equity", currencyCode: "EUR" }
    ]);
    expect(candidates.map((c) => c.ticker)).toEqual(["SGLD"]);
  });
});
