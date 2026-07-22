/**
 * IG Demo REST contract tests.
 *
 * These tests use an injected fetch implementation and never contact IG.
 * They verify the request shape used by the read-only V6 diagnostics before
 * real Firebase secrets are configured.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  IgBrokerAdapter,
  IG_ENDPOINTS,
  loadIgCredentialsFromServerEnv
} from "../../../src/services/autoTrade/igBrokerAdapter";
import {
  DEMO_ORDER_SUBMISSION_ENABLED,
  LIVE_EXECUTION_FEATURE_FLAG
} from "../../../src/services/autoTrade/types";
import { assertNoSecretsInText, redactSecrets } from "../../../src/services/autoTrade/redactSecrets";
import { createBrokerAdapterFactory } from "../../../src/services/autoTrade/runtime";
import { runIgDemoReadOnlyDiagnostics } from "../../../src/services/autoTrade/igDemoDiagnostics";

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

function createDemoFetch(opts: {
  loginAccountId?: string;
  requests: CapturedRequest[];
  allowDealing?: boolean;
}): typeof fetch {
  const loginAccountId = opts.loginAccountId ?? "DEMO-1";
  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    opts.requests.push({ url, method, headers, body: parseBody(init?.body) });

    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;

    if (method === "POST" && path === "/gateway/deal/session") {
      return jsonResponse(
        {
          currentAccountId: loginAccountId,
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

    if (method === "GET" && path === "/gateway/deal/markets?searchTerm=Spot%20Gold") {
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

    if (method === "GET" && path === "/gateway/deal/markets/CS.D.USCGC.TODAY.IP") {
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
              createdDate: "2026-07-22T08:00:00Z",
              upl: 12.5
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
      return jsonResponse({ accountId: loginAccountId, currentAccountId: loginAccountId });
    }

    if (method === "DELETE" && path === "/gateway/deal/session") {
      return new Response(null, { status: 204 });
    }

    if (
      opts.allowDealing !== true &&
      /\/positions\/otc|\/working-orders/.test(path)
    ) {
      return jsonResponse({ errorCode: "dealing.must.not.be.called" }, { status: 500 });
    }

    return jsonResponse({ errorCode: "unexpected.test.request", path }, { status: 500 });
  }) as typeof fetch;
}

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
    const fetchImpl = createDemoFetch({ requests, loginAccountId: "DEMO-1" });

    const adapter = new IgBrokerAdapter({
      environment: "DEMO",
      fetchImpl,
      dryRun: false
    });

    await adapter.connect("server:test-contract");
    expect(adapter.isConnected()).toBe(true);
    expect(adapter.getSessionAccountId()).toBe("DEMO-1");

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
    expect(adapter.getSessionAccountId()).toBe("DEMO-2");

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
    expect(adapter.isConnected()).toBe(false);
    expect(adapter.getSessionAccountId()).toBeNull();

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

  it("skips PUT /session when the configured account is already active", async () => {
    const requests: CapturedRequest[] = [];
    const fetchImpl = createDemoFetch({ requests, loginAccountId: "DEMO-2" });
    const adapter = new IgBrokerAdapter({
      environment: "DEMO",
      fetchImpl,
      dryRun: false
    });

    await adapter.connect("server:test-already-active");
    expect(adapter.getSessionAccountId()).toBe("DEMO-2");
    await adapter.selectAccount("DEMO-2");

    const putSession = requests.filter(
      (r) => r.method === "PUT" && new URL(r.url).pathname.endsWith("/session")
    );
    expect(putSession).toHaveLength(0);
    expect(requests.every((r) => r.url.startsWith(IG_ENDPOINTS.DEMO))).toBe(true);
  });

  it("issues PUT /session only when switching to a different account", async () => {
    const requests: CapturedRequest[] = [];
    const fetchImpl = createDemoFetch({ requests, loginAccountId: "DEMO-1" });
    const adapter = new IgBrokerAdapter({
      environment: "DEMO",
      fetchImpl,
      dryRun: false
    });

    await adapter.connect("server:test-switch");
    await adapter.selectAccount("DEMO-2");

    const putSession = requests.filter(
      (r) => r.method === "PUT" && new URL(r.url).pathname.endsWith("/session")
    );
    expect(putSession).toHaveLength(1);
    expect(putSession[0]?.body).toEqual({ accountId: "DEMO-2" });
  });

  it("isolates Demo host — DEMO adapter never calls Live", async () => {
    expect(IG_ENDPOINTS.DEMO).toBe("https://demo-api.ig.com/gateway/deal");
    expect(IG_ENDPOINTS.LIVE).toBe("https://api.ig.com/gateway/deal");
    expect(IG_ENDPOINTS.DEMO).not.toBe(IG_ENDPOINTS.LIVE);

    const requests: CapturedRequest[] = [];
    const fetchImpl = createDemoFetch({ requests, loginAccountId: "DEMO-2" });
    const adapter = new IgBrokerAdapter({
      environment: "DEMO",
      fetchImpl,
      dryRun: false
    });
    await adapter.connect("server:host-isolation");
    await adapter.listAccounts();
    await adapter.searchGoldMarkets();
    await adapter.getOpenPositions();
    await adapter.disconnect();

    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r.url.startsWith("https://demo-api.ig.com/gateway/deal"))).toBe(
      true
    );
    expect(requests.some((r) => r.url.includes("api.ig.com") && !r.url.includes("demo-api"))).toBe(
      false
    );
  });

  it("blocks Demo order submission and never hits dealing endpoints", async () => {
    expect(DEMO_ORDER_SUBMISSION_ENABLED).toBe(false);
    expect(LIVE_EXECUTION_FEATURE_FLAG).toBe(false);

    const requests: CapturedRequest[] = [];
    const fetchImpl = createDemoFetch({ requests, loginAccountId: "DEMO-2" });
    const adapter = new IgBrokerAdapter({
      environment: "DEMO",
      fetchImpl,
      dryRun: false
    });
    await adapter.connect("server:dealing-block");

    await expect(
      adapter.placeMarketOrder({
        dealReference: "GM-BLOCK",
        epic: "CS.D.USCGC.TODAY.IP",
        direction: "BUY",
        size: 0.1,
        orderType: "MARKET",
        stopLevel: 2300,
        limitLevel: 2400,
        guaranteedStop: true,
        forceOpen: true,
        currencyCode: "EUR"
      })
    ).rejects.toThrow("DEMO_ORDER_SUBMISSION_DISABLED");

    await expect(adapter.closePosition("DEAL-1")).rejects.toThrow("DEMO_ORDER_SUBMISSION_DISABLED");
    await expect(adapter.amendStops("DEAL-1", { stopLevel: 2300 })).rejects.toThrow(
      "DEMO_ORDER_SUBMISSION_DISABLED"
    );

    expect(
      requests.some((r) => /\/positions\/otc|\/working-orders/.test(new URL(r.url).pathname))
    ).toBe(false);
  });

  it("blocks LIVE adapter creation while LIVE_EXECUTION_FEATURE_FLAG is false", () => {
    expect(LIVE_EXECUTION_FEATURE_FLAG).toBe(false);
    const factory = createBrokerAdapterFactory("ig_demo");
    expect(() => factory("LIVE")).toThrow(/LIVE_EXECUTION_FEATURE_DISABLED|LIVE_ADAPTER_BLOCKED/);
  });

  it("fails closed when the IG Demo login is rejected", async () => {
    const fetchImpl = (async (): Promise<Response> =>
      jsonResponse({ errorCode: "error.security.api-key-invalid" }, { status: 403 })) as typeof fetch;

    const adapter = new IgBrokerAdapter({
      environment: "DEMO",
      fetchImpl,
      dryRun: false
    });

    await expect(adapter.connect("server:test-contract")).rejects.toThrow(
      "error.security.api-key-invalid"
    );
    expect(adapter.isConnected()).toBe(false);
  });

  describe("safe IG login errorCode diagnostics", () => {
    const secretPassword = "super-secret-password-never-log";
    const secretUser = "secret-username-never-log";
    const secretKey = "secret-api-key-never-log-0123456789abcdef";

    beforeEach(() => {
      process.env.IG_DEMO_API_KEY = secretKey;
      process.env.IG_DEMO_USERNAME = secretUser;
      process.env.IG_DEMO_PASSWORD = secretPassword;
      process.env.IG_DEMO_ACCOUNT_ID = "DEMO-2";
    });

    async function connectExpecting(
      status: number,
      errorCode: string,
      expectedUi: string
    ): Promise<{ requests: CapturedRequest[]; logs: string[] }> {
      const requests: CapturedRequest[] = [];
      const logs: string[] = [];
      const errorSpy = vi.spyOn(console, "error").mockImplementation((line: unknown) => {
        logs.push(String(line));
      });

      const fetchImpl = (async (
        input: string | URL | Request,
        init?: RequestInit
      ): Promise<Response> => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        requests.push({
          url,
          method: (init?.method ?? "GET").toUpperCase(),
          headers: new Headers(init?.headers),
          body: parseBody(init?.body)
        });
        return jsonResponse(
          {
            errorCode,
            // Poison fields that must never appear in logs
            password: secretPassword,
            identifier: secretUser,
            apiKey: secretKey,
            CST: "must-not-log-cst",
            "X-SECURITY-TOKEN": "must-not-log-sec",
            accountId: "FULL-ACCOUNT-ID-SHOULD-NOT-LOG",
            rawDump: "entire-body-must-not-be-logged"
          },
          { status }
        );
      }) as typeof fetch;

      const adapter = new IgBrokerAdapter({
        environment: "DEMO",
        fetchImpl,
        dryRun: false
      });

      await expect(adapter.connect("server:diag")).rejects.toThrow(expectedUi);
      expect(adapter.isConnected()).toBe(false);
      errorSpy.mockRestore();
      return { requests, logs };
    }

    function assertNoSecretsInLogs(logs: string[]): void {
      const joined = logs.join("\n");
      expect(joined).not.toContain(secretPassword);
      expect(joined).not.toContain(secretUser);
      expect(joined).not.toContain(secretKey);
      expect(joined).not.toContain("must-not-log-cst");
      expect(joined).not.toContain("must-not-log-sec");
      expect(joined).not.toContain("FULL-ACCOUNT-ID-SHOULD-NOT-LOG");
      expect(joined).not.toContain("entire-body-must-not-be-logged");
      expect(joined).not.toMatch(/X-SECURITY-TOKEN|CST[=:]/i);
    }

    it("captures HTTP 400 invalid.input", async () => {
      const { requests, logs } = await connectExpecting(400, "invalid.input", "invalid.input");
      expect(logs.some((l) => /"status":400/.test(l))).toBe(true);
      expect(logs.some((l) => /"errorCode":"invalid\.input"/.test(l))).toBe(true);
      expect(logs.some((l) => /"environment":"DEMO"/.test(l))).toBe(true);
      expect(logs.some((l) => /"timestamp":"/.test(l))).toBe(true);
      assertNoSecretsInLogs(logs);
      expect(requests.every((r) => r.url.startsWith(IG_ENDPOINTS.DEMO))).toBe(true);
      expect(
        requests.some((r) => /\/positions\/otc|\/working-orders/.test(new URL(r.url).pathname))
      ).toBe(false);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.method).toBe("POST");
      expect(new URL(requests[0]!.url).pathname).toBe("/gateway/deal/session");
    });

    it("captures HTTP 401 invalid-details", async () => {
      const { requests, logs } = await connectExpecting(
        401,
        "error.security.invalid-details",
        "error.security.invalid-details"
      );
      expect(logs.some((l) => /"status":401/.test(l))).toBe(true);
      expect(logs.some((l) => /"errorCode":"error\.security\.invalid-details"/.test(l))).toBe(true);
      assertNoSecretsInLogs(logs);
      expect(
        requests.some((r) => /\/positions\/otc|\/working-orders/.test(new URL(r.url).pathname))
      ).toBe(false);
    });

    it("captures HTTP 403 api-key-invalid", async () => {
      const { requests, logs } = await connectExpecting(
        403,
        "error.security.api-key-invalid",
        "error.security.api-key-invalid"
      );
      expect(logs.some((l) => /"status":403/.test(l))).toBe(true);
      expect(logs.some((l) => /"errorCode":"error\.security\.api-key-invalid"/.test(l))).toBe(true);
      assertNoSecretsInLogs(logs);
      expect(
        requests.some((r) => /\/positions\/otc|\/working-orders/.test(new URL(r.url).pathname))
      ).toBe(false);
    });

    it("never logs password, username, API key or response body", async () => {
      const { logs } = await connectExpecting(400, "invalid.input", "invalid.input");
      assertNoSecretsInLogs(logs);
      // Log context must only include the safe diagnostic fields
      const sessionFail = logs.find((l) => l.includes("IG session failed"));
      expect(sessionFail).toBeTruthy();
      const parsed = JSON.parse(sessionFail!) as {
        context: Record<string, unknown>;
      };
      expect(Object.keys(parsed.context).sort()).toEqual(
        ["environment", "errorCode", "status", "timestamp"].sort()
      );
    });

    it("maps unknown safe codes to UNKNOWN_IG_LOGIN_ERROR without leaking body", async () => {
      const { logs } = await connectExpecting(
        400,
        "error.some.unlisted.code",
        "UNKNOWN_IG_LOGIN_ERROR"
      );
      expect(logs.some((l) => /"errorCode":"error\.some\.unlisted\.code"/.test(l))).toBe(true);
      assertNoSecretsInLogs(logs);
    });

    it("keeps dealing endpoint count at zero on login failure", async () => {
      const { requests } = await connectExpecting(400, "invalid.input", "invalid.input");
      const dealing = requests.filter((r) =>
        /\/positions\/otc|\/working-orders/.test(new URL(r.url).pathname)
      );
      expect(dealing).toHaveLength(0);
      expect(DEMO_ORDER_SUBMISSION_ENABLED).toBe(false);
      expect(LIVE_EXECUTION_FEATURE_FLAG).toBe(false);
    });
  });

  it("fails closed when Demo credentials are missing", () => {
    delete process.env.IG_DEMO_API_KEY;
    delete process.env.IG_DEMO_USERNAME;
    delete process.env.IG_DEMO_PASSWORD;
    expect(loadIgCredentialsFromServerEnv("DEMO")).toBeNull();
    const factory = createBrokerAdapterFactory("ig_demo");
    expect(() => factory("DEMO")).toThrow("IG_DEMO_CREDENTIALS_NOT_CONFIGURED");
  });

  it("never logs tokens, API key, password, or Authorization in redacted payloads", () => {
    const redacted = redactSecrets({
      apiKey: "demo-api-key-placeholder",
      password: "demo-password-placeholder",
      CST: "test-cst-token",
      "X-SECURITY-TOKEN": "test-security-token",
      Authorization: "Bearer super-secret-token-value",
      accountId: "DEMO-2-FULL-ID-9999",
      note: "Authorization: Bearer leaked-should-redact-if-key"
    });
    const text = JSON.stringify(redacted);
    expect(text).not.toContain("demo-api-key-placeholder");
    expect(text).not.toContain("demo-password-placeholder");
    expect(text).not.toContain("test-cst-token");
    expect(text).not.toContain("test-security-token");
    expect(text).not.toContain("super-secret-token-value");
    expect(text).not.toContain("DEMO-2-FULL-ID-9999");
    expect(assertNoSecretsInText(text)).toBe(true);
  });

  it("runs mocked diagnostics without dealing calls and without Live host", async () => {
    const requests: CapturedRequest[] = [];
    const fetchImpl = createDemoFetch({ requests, loginAccountId: "DEMO-2" });
    const adapter = new IgBrokerAdapter({
      environment: "DEMO",
      fetchImpl,
      dryRun: false
    });

    const report = await runIgDemoReadOnlyDiagnostics(adapter);
    expect(report.ok).toBe(true);
    expect(report.readOnly).toBe(true);
    expect(report.dealingEndpointsCalled).toBe(false);
    expect(report.accountMatch).toBe("matched");
    expect(report.notes.some((n) => /skipped PUT \/session/i.test(n))).toBe(true);
    expect(report.openPositionsCount).toBe(1);
    expect(report.balance).toBe(20000);
    expect(JSON.stringify(report)).not.toMatch(/test-cst-token|demo-password|demo-api-key/i);

    expect(requests.every((r) => r.url.startsWith(IG_ENDPOINTS.DEMO))).toBe(true);
    expect(
      requests.some((r) => /\/positions\/otc|\/working-orders/.test(new URL(r.url).pathname))
    ).toBe(false);
    const puts = requests.filter(
      (r) => r.method === "PUT" && new URL(r.url).pathname.endsWith("/session")
    );
    expect(puts).toHaveLength(0);
  });

  it("binds IG Demo secrets only to apiV6Preview — production api has none", () => {
    const root = join(__dirname, "../../..");
    const preview = readFileSync(join(root, "src/previewApi.ts"), "utf8");
    const index = readFileSync(join(root, "src/index.ts"), "utf8");

    for (const name of [
      "IG_DEMO_API_KEY",
      "IG_DEMO_USERNAME",
      "IG_DEMO_PASSWORD",
      "IG_DEMO_ACCOUNT_ID"
    ]) {
      expect(preview).toContain(`defineSecret("${name}")`);
    }
    expect(preview).toMatch(
      /secrets:\s*\[\s*igDemoApiKey,\s*igDemoUsername,\s*igDemoPassword,\s*igDemoAccountId\s*\]/
    );
    expect(preview).toContain("export const apiV6Preview");

    // Production `api` onRequest options must not declare secrets / IG Demo bindings.
    const apiBlock = index.slice(index.indexOf("export const api = onRequest"));
    const apiOpts = apiBlock.slice(0, apiBlock.indexOf("app\n);") + 10);
    expect(apiOpts).not.toMatch(/secrets\s*:/);
    expect(apiOpts).not.toMatch(/IG_DEMO_/);
    expect(apiOpts).not.toMatch(/defineSecret/);
  });
});
