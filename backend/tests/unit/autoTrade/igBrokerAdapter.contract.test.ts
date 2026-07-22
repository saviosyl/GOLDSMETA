/**
 * IG Demo REST contract tests.
 *
 * These tests use an injected fetch implementation and never contact IG.
 * They verify the request shape used by the read-only V6 diagnostics before
 * real Firebase secrets are configured.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IgBrokerAdapter, IG_ENDPOINTS } from "../../../src/services/autoTrade/igBrokerAdapter";

type CapturedRequest = {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
};

const jsonResponse = (
  body: unknown,
  init: ResponseInit = {}
): Response =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });

const parseBody = (body: BodyInit | null | undefined): unknown => {
  if (typeof body !== "string" || body.length === 0) return null;
  return JSON.parse(body) as unknown;
};

describe("IgBrokerAdapter DEMO read-only REST contract", () => {
  const previous = {
    apiKey: process.env.IG_DEMO_API_KEY,
    username: process.env.IG_DEMO_USERNAME,
    password: process.env.IG_DEMO_PASSWORD,
    accountId: process.env.IG_DEMO_ACCOUNT_ID
  };

  beforeEach(() => {
    process.env.IG_DEMO_API_KEY = "demo-api-key-placeholder";
    process.env.IG_DEMO_USERNAME = "demo-user";
    process.env.IG_DEMO_PASSWORD = "demo-password-placeholder";
    process.env.IG_DEMO_ACCOUNT_ID = "DEMO-2";
  });

  afterEach(() => {
    const restore = (key: string, value: string | undefined): void => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("IG_DEMO_API_KEY", previous.apiKey);
    restore("IG_DEMO_USERNAME", previous.username);
    restore("IG_DEMO_PASSWORD", previous.password);
    restore("IG_DEMO_ACCOUNT_ID", previous.accountId);
  });

  it("uses only the IG Demo host and read-only endpoints", async () => {
    const requests: CapturedRequest[] = [];

    const fetchImpl = (async (
      input: string | URL | Request,
      init?: RequestInit
    ): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers);
      requests.push({ url, method, headers, body: parseBody(init?.body) });

      const parsed = new URL(url);
      const path = `${parsed.pathname}${parsed.search}`;

      if (method === "POST" && path === "/gateway/deal/session") {
        return jsonResponse(
          {
            currentAccountId: "DEMO-1",
            dealingEnabled: true,
            hasActiveDemoAccounts: true,
            hasActiveLiveAccounts: false
          },
          {
            headers: {
              CST: "test-cst-token",
              "X-SECURITY-TOKEN": "test-security-token"
            }
          }
        );
      }

      if (method === "GET" && path === "/gateway/deal/accounts") {
        return jsonResponse({
          accounts: [
            {
              accountId: "DEMO-1",
              accountName: "Demo CFD 1",
              currency: "EUR",
              balance: { balance: 10000, available: 9600, deposit: 400 }
            },
            {
              accountId: "DEMO-2",
              accountName: "Demo CFD 2",
              currency: "EUR",
              balance: { balance: 20000, available: 19000, deposit: 1000 }
            }
          ]
        });
      }

      if (method === "PUT" && path === "/gateway/deal/session") {
        return jsonResponse({ dealingEnabled: true });
      }

      if (
        method === "GET" &&
        path === "/gateway/deal/markets?searchTerm=Spot%20Gold"
      ) {
        return jsonResponse({
          markets: [
            {
              epic: "CS.D.USCGC.TODAY.IP",
              instrumentName: "Spot Gold",
              instrumentType: "COMMODITIES",
              expiry: "-",
              marketStatus: "TRADEABLE",
              bid: 2400.1,
              offer: 2400.4
            }
          ]
        });
      }

      if (
        method === "GET" &&
        path === "/gateway/deal/markets/CS.D.USCGC.TODAY.IP"
      ) {
        return jsonResponse({
          instrument: {
            name: "Spot Gold",
            type: "COMMODITIES",
            expiry: "-",
            valueOfOnePip: "1",
            scalingFactor: 1,
            guaranteedStopsAllowed: true,
            currencies: [{ code: "EUR" }],
            marginDepositBands: [{ margin: 5 }]
          },
          snapshot: {
            marketStatus: "TRADEABLE",
            bid: 2400.1,
            offer: 2400.4,
            high: 2410,
            low: 2385,
            netChange: 4.2,
            percentageChange: 0.18,
            updateTime: "12:34:56"
          },
          dealingRules: {
            minDealSize: { value: 0.1 },
            dealSizeIncrement: { value: 0.1 },
            minNormalStopOrLimitDistance: { value: 1 },
            minControlledRiskStopDistance: { value: 2 }
          }
        });
      }

      if (method === "GET" && path === "/gateway/deal/positions") {
        return jsonResponse({
          positions: [
            {
              position: {
                dealId: "DEAL-1234",
                dealReference: "GM-READONLY",
                direction: "BUY",
                size: 0.1,
                level: 2390,
                stopLevel: 2380,
                limitLevel: 2420,
                controlledRisk: true,
                currency: "EUR",
                createdDate: "2026-07-22T08:00:00Z"
              },
              market: {
                epic: "CS.D.USCGC.TODAY.IP",
                instrumentName: "Spot Gold"
              }
            }
          ]
        });
      }

      if (method === "GET" && path === "/gateway/deal/session") {
        return jsonResponse({ accountId: "DEMO-2" });
      }

      if (method === "DELETE" && path === "/gateway/deal/session") {
        return new Response(null, { status: 204 });
      }

      return jsonResponse({ errorCode: "unexpected.test.request", path }, { status: 500 });
    }) as typeof fetch;

    const adapter = new IgBrokerAdapter({
      environment: "DEMO",
      fetchImpl,
      dryRun: false
    });

    await adapter.connect("server:test-contract");
    expect(adapter.isConnected()).toBe(true);

    const accounts = await adapter.listAccounts();
    expect(accounts).toHaveLength(2);
    expect(accounts[1]).toMatchObject({
      accountId: "DEMO-2",
      accountName: "Demo CFD 2",
      currency: "EUR",
      balance: 20000,
      available: 19000,
      marginUsed: 1000
    });

    const selected = await adapter.selectAccount("DEMO-2");
    expect(selected.accountId).toBe("DEMO-2");

    const candidates = await adapter.searchGoldMarkets();
    expect(candidates[0]).toMatchObject({
      epic: "CS.D.USCGC.TODAY.IP",
      instrumentName: "Spot Gold",
      marketStatus: "TRADEABLE"
    });

    const market = await adapter.getMarket("CS.D.USCGC.TODAY.IP");
    expect(market).toMatchObject({
      epic: "CS.D.USCGC.TODAY.IP",
      instrumentName: "Spot Gold",
      marketStatus: "TRADEABLE",
      bid: 2400.1,
      offer: 2400.4,
      minDealSize: 0.1,
      dealSizeIncrement: 0.1,
      valueOfOnePip: 1,
      guaranteedStopAvailable: true
    });

    const positions = await adapter.getOpenPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      dealId: "DEAL-1234",
      epic: "CS.D.USCGC.TODAY.IP",
      direction: "BUY",
      size: 0.1,
      guaranteedStop: true
    });

    await adapter.heartbeat();
    await adapter.renewSession();
    await adapter.disconnect();

    expect(requests.every((request) => request.url.startsWith(IG_ENDPOINTS.DEMO))).toBe(true);
    expect(requests.some((request) => request.url.startsWith(IG_ENDPOINTS.LIVE))).toBe(false);
    expect(
      requests.some((request) =>
        /\/positions\/otc|\/working-orders\/otc/.test(new URL(request.url).pathname)
      )
    ).toBe(false);

    const login = requests.find(
      (request) => request.method === "POST" && new URL(request.url).pathname.endsWith("/session")
    );
    expect(login?.headers.get("X-IG-API-KEY")).toBe("demo-api-key-placeholder");
    expect(login?.headers.get("Version")).toBe("2");
    expect(login?.body).toEqual({ identifier: "demo-user", password: "demo-password-placeholder" });

    const authenticatedReads = requests.filter((request) => request.method === "GET");
    expect(authenticatedReads.length).toBeGreaterThan(0);
    for (const request of authenticatedReads) {
      expect(request.headers.get("CST")).toBe("test-cst-token");
      expect(request.headers.get("X-SECURITY-TOKEN")).toBe("test-security-token");
    }
  });

  it("fails closed when the IG Demo login is rejected", async () => {
    const fetchImpl = (async (): Promise<Response> =>
      jsonResponse({ errorCode: "error.security.api-key-invalid" }, { status: 403 })) as typeof fetch;

    const adapter = new IgBrokerAdapter({
      environment: "DEMO",
      fetchImpl,
      dryRun: false
    });

    await expect(adapter.connect("server:test-contract")).rejects.toThrow("IG_SESSION_FAILED");
    expect(adapter.isConnected()).toBe(false);
  });
});
