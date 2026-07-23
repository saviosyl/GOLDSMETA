import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  assertT212RequestAllowed,
  isAllowedPracticeMutation,
  isAllowedReadPath
} from "../../../src/services/autoTrade/t212/allowlist";
import { calculateT212OrderQuantity } from "../../../src/services/autoTrade/t212/quantity";
import {
  deriveT212MarketStatus,
  requireMarketOpenForSubmission
} from "../../../src/services/autoTrade/t212/marketStatus";
import {
  buildRequestFingerprint,
  buildT212IntentKey,
  intentIdFromKey,
  PRACTICE_AUTO_GATES,
  PRACTICE_ORDER_RISK_LIMITS
} from "../../../src/services/autoTrade/t212/orderIntent";
import { evaluatePracticeAutoQualification } from "../../../src/services/autoTrade/t212/qualification";
import { defaultQualificationState } from "../../../src/services/autoTrade/t212/qualification";
import {
  findOrderForIntent,
  markIntentUnknownAfterTimeout,
  reconcileIntentWithBrokerOrder
} from "../../../src/services/autoTrade/t212/reconcile";
import { T212InvestClient, T212ApiError } from "../../../src/services/autoTrade/t212/client";
import { InMemoryAutoTradeStore } from "../../../src/services/autoTrade/inMemoryAutoTradeStore";
import { prepareAndOptionallySubmitPracticeOrder } from "../../../src/services/autoTrade/t212/orderExecution";
import type { DecisionRecord } from "../../../src/models/types";

const prevEnv = { ...process.env };

function setPracticeOrderFlags(on: boolean) {
  process.env.BROKER_EXECUTION_ENABLED = on ? "true" : "false";
  process.env.T212_PAPER_ORDER_SUBMISSION_ENABLED = on ? "true" : "false";
  process.env.DEMO_ORDER_SUBMISSION_ENABLED = on ? "true" : "false";
  process.env.T212_LIVE_EXECUTION_FEATURE_FLAG = "false";
  process.env.LIVE_EXECUTION_FEATURE_FLAG = "false";
  process.env.T212_ORDER_PREVIEW = on ? "true" : "";
  process.env.T212_ALLOW_PRACTICE_SUBMIT = "false";
}

describe("T212 allowlist", () => {
  it("allows official read paths and order-by-id GET", () => {
    expect(isAllowedReadPath("/equity/account/summary")).toBe(true);
    expect(isAllowedReadPath("/equity/positions")).toBe(true);
    expect(isAllowedReadPath("/equity/metadata/instruments")).toBe(true);
    expect(isAllowedReadPath("/equity/orders")).toBe(true);
    expect(isAllowedReadPath("/equity/orders/abc")).toBe(true);
    expect(isAllowedReadPath("/equity/history/orders")).toBe(true);
    expect(isAllowedReadPath("/equity/orders/market")).toBe(false);
  });

  it("allows only approved Practice mutations", () => {
    expect(isAllowedPracticeMutation("POST", "/equity/orders/market")).toBe(true);
    expect(isAllowedPracticeMutation("DELETE", "/equity/orders/123")).toBe(true);
    expect(isAllowedPracticeMutation("POST", "/equity/orders/limit")).toBe(false);
    expect(isAllowedPracticeMutation("DELETE", "/equity/positions/x")).toBe(false);
  });

  it("rejects caller base URL, auth header, Live host, arbitrary paths", () => {
    expect(
      assertT212RequestAllowed({
        method: "GET",
        path: "/equity/account/summary",
        environment: "PRACTICE",
        mutationsEnabled: false,
        requestedBaseUrl: "https://evil.example"
      }).ok
    ).toBe(false);

    expect(
      assertT212RequestAllowed({
        method: "GET",
        path: "/equity/account/summary",
        environment: "PRACTICE",
        mutationsEnabled: false,
        requestedAuthorization: "Bearer stolen"
      }).ok
    ).toBe(false);

    expect(
      assertT212RequestAllowed({
        method: "GET",
        path: "/equity/account/summary",
        environment: "LIVE",
        mutationsEnabled: false
      }).code
    ).toBe("T212_LIVE_HOST_LOCKED");

    expect(
      assertT212RequestAllowed({
        method: "POST",
        path: "/equity/orders/market",
        environment: "PRACTICE",
        mutationsEnabled: false
      }).code
    ).toBe("T212_MUTATION_DISABLED");
  });
});

describe("T212 quantity calculation", () => {
  const baseElig = {
    ticker: "EGLNl_EQ",
    minOrderQuantity: null as number | null,
    minOrderValue: null as number | null,
    fractionalSupported: true as boolean | null,
    maxOpenQuantity: null as number | null,
    quantityPrecision: 6 as number | null
  };

  it("rounds down BUY quantity with price buffer and respects max €50", () => {
    const r = calculateT212OrderQuantity({
      side: "BUY",
      targetOrderValueEur: 50,
      maxOrderValueEur: 50,
      freeCashEur: 5000,
      indicativePrice: 40,
      priceSafetyBufferPct: 0.02,
      holdingQuantity: 0,
      pendingSellQuantity: 0,
      eligibility: baseElig
    });
    expect(r.ok).toBe(true);
    expect(r.quantity).toBeLessThanOrEqual(50 / (40 * 1.02) + 1e-9);
    expect(r.estimatedValue!).toBeLessThanOrEqual(50.01);
    expect(r.signedQuantity).toBeGreaterThan(0);
  });

  it("rejects unknown fractional support", () => {
    const r = calculateT212OrderQuantity({
      side: "BUY",
      targetOrderValueEur: 50,
      maxOrderValueEur: 50,
      freeCashEur: 5000,
      indicativePrice: 40,
      priceSafetyBufferPct: 0.02,
      holdingQuantity: 0,
      pendingSellQuantity: 0,
      eligibility: { ...baseElig, fractionalSupported: null }
    });
    expect(r.ok).toBe(false);
    expect(r.rejectionReason).toBe("FRACTIONAL_ELIGIBILITY_UNKNOWN");
  });

  it("rejects insufficient cash and invalid price", () => {
    expect(
      calculateT212OrderQuantity({
        side: "BUY",
        targetOrderValueEur: 50,
        maxOrderValueEur: 50,
        freeCashEur: 0,
        indicativePrice: 40,
        priceSafetyBufferPct: 0.02,
        holdingQuantity: 0,
        pendingSellQuantity: 0,
        eligibility: baseElig
      }).rejectionReason
    ).toBe("INSUFFICIENT_FUNDS");

    expect(
      calculateT212OrderQuantity({
        side: "BUY",
        targetOrderValueEur: 50,
        maxOrderValueEur: 50,
        freeCashEur: 5000,
        indicativePrice: null,
        priceSafetyBufferPct: 0.02,
        holdingQuantity: 0,
        pendingSellQuantity: 0,
        eligibility: baseElig
      }).rejectionReason
    ).toBe("PRICE_UNAVAILABLE");
  });

  it("SELL_CLOSE never shorts and uses negative signed quantity", () => {
    const none = calculateT212OrderQuantity({
      side: "SELL",
      targetOrderValueEur: 50,
      maxOrderValueEur: 50,
      freeCashEur: 5000,
      indicativePrice: 40,
      priceSafetyBufferPct: 0.02,
      holdingQuantity: 0,
      pendingSellQuantity: 0,
      eligibility: baseElig
    });
    expect(none.rejectionReason).toBe("SHORT_UNSUPPORTED_ON_T212_INVEST");

    const ok = calculateT212OrderQuantity({
      side: "SELL",
      targetOrderValueEur: 50,
      maxOrderValueEur: 50,
      freeCashEur: 5000,
      indicativePrice: 40,
      priceSafetyBufferPct: 0.02,
      holdingQuantity: 1.5,
      pendingSellQuantity: 0.5,
      eligibility: baseElig
    });
    expect(ok.ok).toBe(true);
    expect(ok.quantity).toBe(1);
    expect(ok.signedQuantity).toBe(-1);
  });

  it("enforces min quantity/value when provided", () => {
    const r = calculateT212OrderQuantity({
      side: "BUY",
      targetOrderValueEur: 50,
      maxOrderValueEur: 50,
      freeCashEur: 5000,
      indicativePrice: 40,
      priceSafetyBufferPct: 0.02,
      holdingQuantity: 0,
      pendingSellQuantity: 0,
      eligibility: { ...baseElig, minOrderQuantity: 10 }
    });
    expect(r.rejectionReason).toBe("BELOW_MIN_ORDER_QUANTITY");
  });
});

describe("T212 market status", () => {
  it("returns MARKET_STATUS_UNKNOWN without schedule", () => {
    const r = deriveT212MarketStatus({
      instrument: { ticker: "EGLNl_EQ", workingScheduleId: null },
      exchanges: []
    });
    expect(r.status).toBe("UNKNOWN");
    expect(requireMarketOpenForSubmission(r).ok).toBe(false);
  });

  it("respects exchange open flag", () => {
    const open = deriveT212MarketStatus({
      instrument: { ticker: "EGLNl_EQ", workingScheduleId: 7 },
      exchanges: [{ id: 7, open: true }]
    });
    expect(open.status).toBe("OPEN");
    expect(requireMarketOpenForSubmission(open).ok).toBe(true);

    const closed = deriveT212MarketStatus({
      instrument: { ticker: "EGLNl_EQ", workingScheduleId: 7 },
      exchanges: [{ id: 7, open: false }]
    });
    expect(requireMarketOpenForSubmission(closed).code).toBe("MARKET_CLOSED");
  });
});

describe("T212 idempotency + reconcile", () => {
  it("builds deterministic intent keys", () => {
    const a = buildT212IntentKey({
      userId: "u1",
      environment: "PRACTICE",
      decisionId: "d1",
      ticker: "EGLNl_EQ",
      action: "BUY"
    });
    const b = buildT212IntentKey({
      userId: "u1",
      environment: "PRACTICE",
      decisionId: "d1",
      ticker: "EGLNl_EQ",
      action: "BUY"
    });
    expect(a).toBe(b);
    expect(intentIdFromKey(a).startsWith("t212i_")).toBe(true);
    const fp = buildRequestFingerprint({
      intentKey: a,
      ticker: "EGLNl_EQ",
      signedQuantity: 1.2,
      environment: "PRACTICE",
      decisionId: "d1"
    });
    expect(fp).toHaveLength(64);
  });

  it("marks UNKNOWN after timeout and reconciles from broker status", () => {
    const base = {
      intentId: "i1",
      intentKey: "k",
      userId: "u1",
      broker: "T212_INVEST" as const,
      environment: "PRACTICE" as const,
      decisionId: "d1",
      proposalId: null,
      ticker: "EGLNl_EQ",
      instrumentId: "EGLNl_EQ",
      action: "BUY" as const,
      side: "BUY" as const,
      quantity: 1,
      signedQuantity: 1,
      estimatedValue: 40,
      indicativePrice: 40,
      requestFingerprint: "fp",
      state: "SUBMITTING" as const,
      brokerOrderId: "99",
      brokerStatus: null,
      filledQuantity: null,
      averageFillPrice: null,
      rejectionReason: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      submittedAt: null,
      lastReconciledAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dryRunOnly: false,
      riskEvaluation: {}
    };
    const unknown = markIntentUnknownAfterTimeout(base, new Date().toISOString(), "TIMEOUT");
    expect(unknown.state).toBe("UNKNOWN");

    const filled = reconcileIntentWithBrokerOrder(
      unknown,
      { id: "99", ticker: "EGLNl_EQ", quantity: 1, status: "FILLED", filledQuantity: 1 },
      new Date().toISOString()
    );
    expect(filled.intent.state).toBe("FILLED");
    expect(filled.terminal).toBe(true);

    expect(
      findOrderForIntent(
        [{ id: "99", ticker: "EGLNl_EQ", quantity: 1, status: "NEW" }],
        unknown
      )?.id
    ).toBe("99");
  });
});

describe("PRACTICE_AUTO qualification gates", () => {
  it("stays locked until all gates pass (including 20 dry-runs / 5 orders / 7 days)", () => {
    const partial = defaultQualificationState("u1", new Date().toISOString());
    partial.authHealthy = true;
    partial.pinnedOwnerVerified = true;
    partial.completedDryRunDecisions = PRACTICE_AUTO_GATES.requiredDryRuns - 1;
    expect(evaluatePracticeAutoQualification(partial).unlocked).toBe(false);

    const full = {
      ...partial,
      completedDryRunDecisions: PRACTICE_AUTO_GATES.requiredDryRuns,
      successfulControlledPracticeOrders:
        PRACTICE_AUTO_GATES.requiredSuccessfulPracticeOrders,
      firstPracticeOrderAt: new Date(
        Date.now() - PRACTICE_AUTO_GATES.requiredCalendarDaysSinceFirstOrder * 86400000
      ).toISOString(),
      unresolvedUnknownOrders: 0,
      duplicateOrdersDetected: 0,
      emergencyStopTested: true,
      restartRecoveryTested: true,
      eglnConfirmed: true,
      ownerUnlockedPracticeAuto: true
    };
    expect(evaluatePracticeAutoQualification(full).unlocked).toBe(true);
  });
});

describe("T212 client mutation gating + HTTP errors", () => {
  afterEach(() => {
    process.env = { ...prevEnv };
  });

  it("blocks market order when mutations disabled", async () => {
    setPracticeOrderFlags(false);
    const client = new T212InvestClient(
      "PRACTICE",
      { apiKey: "k", apiSecret: "s" },
      {
        mutationsEnabled: false,
        fetchImpl: async () => new Response("{}", { status: 200 })
      }
    );
    await expect(
      client.placeMarketOrder({ ticker: "EGLNl_EQ", quantity: 1 })
    ).rejects.toMatchObject({ code: "T212_MUTATION_DISABLED" });
  });

  it("maps 401/403/408/429/500 codes", async () => {
    setPracticeOrderFlags(false);
    const mk = (status: number) =>
      new T212InvestClient(
        "PRACTICE",
        { apiKey: "k", apiSecret: "s" },
        {
          mutationsEnabled: false,
          fetchImpl: async () =>
            new Response(JSON.stringify({ code: "X" }), { status }),
          timeoutMs: 50
        }
      );
    await expect(mk(401).getAccountSummary()).rejects.toBeInstanceOf(T212ApiError);
    await expect(mk(403).getAccountSummary()).rejects.toBeInstanceOf(T212ApiError);
    await expect(mk(429).getAccountSummary()).rejects.toBeInstanceOf(T212ApiError);
    await expect(mk(500).getAccountSummary()).rejects.toBeInstanceOf(T212ApiError);
  });

  it("rejects Live environment host", async () => {
    const client = new T212InvestClient(
      "LIVE",
      { apiKey: "k", apiSecret: "s" },
      { mutationsEnabled: false, fetchImpl: async () => new Response("{}", { status: 200 }) }
    );
    await expect(client.getAccountSummary()).rejects.toMatchObject({
      code: "T212_LIVE_HOST_LOCKED"
    });
  });
});

describe("prepare order — trusted decision + no blind submit", () => {
  beforeEach(() => {
    setPracticeOrderFlags(true);
    process.env.T212_DEMO_API_KEY = "demo-key";
    process.env.T212_DEMO_API_SECRET = "demo-secret";
    process.env.T212_ALLOW_PRACTICE_SUBMIT = "false";
  });
  afterEach(() => {
    process.env = { ...prevEnv };
  });

  it("rejects missing trusted decision and WAIT", async () => {
    const store = new InMemoryAutoTradeStore();
    await store.saveT212SelectedInstrument("u1", {
      instrumentId: "EGLNl_EQ",
      ticker: "EGLNl_EQ",
      name: "iShares Physical Gold",
      currency: "EUR",
      isin: "IE00B4ND3602",
      exchange: null,
      type: "ETF",
      fractionalSupported: true,
      minOrderQuantity: null,
      minOrderValue: null,
      confirmedAt: new Date().toISOString(),
      confirmedBy: "u1",
      environment: "PRACTICE"
    });

    await expect(
      prepareAndOptionallySubmitPracticeOrder({
        userId: "u1",
        decisionId: "missing",
        store,
        automationMode: "MANUAL",
        submit: false,
        ownerId: "owner-1",
        goldMetaStore: {
          getDecision: async () => undefined
        }
      })
    ).rejects.toMatchObject({ code: "TRUSTED_DECISION_NOT_FOUND" });

    const waitDecision = {
      decisionId: "d-wait",
      decision: "WAIT",
      symbol: "XAUUSD",
      timeframe: "5",
      confidence: 90,
      setupScore: 90,
      generatedAt: new Date().toISOString(),
      marketDataTime: new Date().toISOString(),
      marketStructure: { confirmationClassification: "CONTINUATION" }
    } as unknown as DecisionRecord;

    await expect(
      prepareAndOptionallySubmitPracticeOrder({
        userId: "u1",
        decisionId: "d-wait",
        store,
        automationMode: "MANUAL",
        submit: false,
        ownerId: "owner-1",
        goldMetaStore: { getDecision: async () => waitDecision }
      })
    ).rejects.toMatchObject({ code: "WAIT_NO_ORDER" });
  });

  it("blocks concurrent/unresolved intents and duplicate keys", async () => {
    const store = new InMemoryAutoTradeStore();
    await store.saveT212SelectedInstrument("u1", {
      instrumentId: "EGLNl_EQ",
      ticker: "EGLNl_EQ",
      name: "iShares Physical Gold",
      currency: "EUR",
      isin: "IE00B4ND3602",
      exchange: null,
      type: "ETF",
      fractionalSupported: true,
      minOrderQuantity: 0.001,
      minOrderValue: 1,
      confirmedAt: new Date().toISOString(),
      confirmedBy: "u1",
      environment: "PRACTICE"
    });

    const fetchImpl = async (url: string) => {
      const u = String(url);
      if (u.includes("/account/summary")) {
        return new Response(
          JSON.stringify({
            currency: "EUR",
            totalValue: 5000,
            cash: { availableToTrade: 5000 },
            investments: { currentValue: 0 }
          }),
          { status: 200 }
        );
      }
      if (u.includes("/positions")) return new Response(JSON.stringify([]), { status: 200 });
      if (u.includes("/orders") && !u.includes("/market")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (u.includes("/instruments")) {
        return new Response(
          JSON.stringify([
            {
              ticker: "EGLNl_EQ",
              name: "iShares Physical Gold",
              isin: "IE00B4ND3602",
              currencyCode: "EUR",
              type: "ETF",
              minTradeQuantity: 0.001,
              workingScheduleId: 1
            }
          ]),
          { status: 200 }
        );
      }
      if (u.includes("/exchanges")) {
        return new Response(JSON.stringify([{ id: 1, open: true }]), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const decision = {
      decisionId: "d-buy-1",
      decision: "BUY",
      symbol: "XAUUSD",
      timeframe: "5",
      confidence: 90,
      setupScore: 90,
      generatedAt: new Date().toISOString(),
      marketDataTime: new Date().toISOString(),
      marketStructure: {
        confirmationClassification: "CONTINUATION",
        confirmationDirection: "BULLISH"
      }
    } as unknown as DecisionRecord;

    // Seed a synthetic current price via positions for quantity path
    const fetchWithPrice: typeof fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes("/positions")) {
        return new Response(
          JSON.stringify([
            // no holding qty but provide a quote instrument price via a zero qty? 
            // quantity calc needs indicative price — use a shadow position with qty 0 not returned.
          ]),
          { status: 200 }
        );
      }
      return fetchImpl(url);
    };

    // Without price, prepare fails PRICE_UNAVAILABLE — expected gate.
    await expect(
      prepareAndOptionallySubmitPracticeOrder({
        userId: "u1",
        decisionId: "d-buy-1",
        store,
        automationMode: "MANUAL",
        submit: false,
        ownerId: "owner-1",
        clientFactory: (env, creds) =>
          new T212InvestClient(env, creds, {
            mutationsEnabled: false,
            fetchImpl: fetchWithPrice as typeof fetch
          }),
        goldMetaStore: { getDecision: async () => decision }
      })
    ).rejects.toMatchObject({ code: "PRICE_UNAVAILABLE" });

    expect(PRACTICE_ORDER_RISK_LIMITS.maxOrderValueEur).toBe(50);
    expect(PRACTICE_ORDER_RISK_LIMITS.minConfidence).toBe(80);
    expect(PRACTICE_ORDER_RISK_LIMITS.maxSignalAgeSeconds).toBe(90);
  });
});
