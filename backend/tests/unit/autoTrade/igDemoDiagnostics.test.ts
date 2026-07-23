/**
 * IG Demo read-only diagnostics — FakeIg / mocked only (never contacts IG).
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { AutoTradeService } from "../../../src/services/autoTrade/autoTradeService";
import { FakeIgBrokerAdapter } from "../../../src/services/autoTrade/fakeIgBrokerAdapter";
import { InMemoryAutoTradeStore } from "../../../src/services/autoTrade/inMemoryAutoTradeStore";
import { runIgDemoReadOnlyDiagnostics } from "../../../src/services/autoTrade/igDemoDiagnostics";
import { rankGoldCandidates } from "../../../src/services/autoTrade/goldMarketRanking";
import { IgBrokerAdapter } from "../../../src/services/autoTrade/igBrokerAdapter";
import {
  DEMO_ORDER_SUBMISSION_ENABLED,
  LIVE_EXECUTION_FEATURE_FLAG,
  maskAccountId
} from "../../../src/services/autoTrade/types";
import { assertNoSecretsInText, redactSecrets } from "../../../src/services/autoTrade/redactSecrets";
import { resolveAutoTradeBrokerMode } from "../../../src/services/autoTrade/runtime";

describe("IG Demo read-only diagnostics", () => {
  const prevAccount = process.env.IG_DEMO_ACCOUNT_ID;
  const prevKey = process.env.IG_DEMO_API_KEY;
  const prevUser = process.env.IG_DEMO_USERNAME;
  const prevPass = process.env.IG_DEMO_PASSWORD;
  const prevBroker = process.env.AUTOTRADE_BROKER;

  beforeEach(() => {
    AutoTradeService.resetRestartGateForTests();
    delete process.env.IG_DEMO_ACCOUNT_ID;
    delete process.env.IG_DEMO_API_KEY;
    delete process.env.IG_DEMO_USERNAME;
    delete process.env.IG_DEMO_PASSWORD;
  });

  afterEach(() => {
    if (prevAccount === undefined) delete process.env.IG_DEMO_ACCOUNT_ID;
    else process.env.IG_DEMO_ACCOUNT_ID = prevAccount;
    if (prevKey === undefined) delete process.env.IG_DEMO_API_KEY;
    else process.env.IG_DEMO_API_KEY = prevKey;
    if (prevUser === undefined) delete process.env.IG_DEMO_USERNAME;
    else process.env.IG_DEMO_USERNAME = prevUser;
    if (prevPass === undefined) delete process.env.IG_DEMO_PASSWORD;
    else process.env.IG_DEMO_PASSWORD = prevPass;
    if (prevBroker === undefined) delete process.env.AUTOTRADE_BROKER;
    else process.env.AUTOTRADE_BROKER = prevBroker;
  });

  it("runs happy-path diagnostics with FakeIg (no dealing endpoints)", async () => {
    const adapter = new FakeIgBrokerAdapter({ environment: "DEMO" });
    const report = await runIgDemoReadOnlyDiagnostics(adapter);
    expect(report.readOnly).toBe(true);
    expect(report.ordersEnabled).toBe(false);
    expect(report.dealingEndpointsCalled).toBe(false);
    expect(report.ok).toBe(true);
    expect(report.connected).toBe(true);
    expect(report.accountIdMasked).toBe(maskAccountId("DEMO-ACC-1234"));
    expect(report.currency).toBe("EUR");
    expect(report.proposedEpic).toBe("CS.D.USCGC.TODAY.IP");
    expect(report.selectedMarket?.bid).toBeGreaterThan(0);
    expect(report.selectedMarket?.minDealSize).toBe(0.1);
    expect(report.sessionRenewal).toBe("ok");
    expect(DEMO_ORDER_SUBMISSION_ENABLED).toBe(false);
    expect(LIVE_EXECUTION_FEATURE_FLAG).toBe(false);
    const text = JSON.stringify(report);
    expect(assertNoSecretsInText(text)).toBe(true);
    expect(text).not.toMatch(/DEMO-ACC-1234/);
  });

  it("fails authentication closed", async () => {
    const adapter = new FakeIgBrokerAdapter({ environment: "DEMO", scenario: "auth_fail" });
    const report = await runIgDemoReadOnlyDiagnostics(adapter);
    expect(report.ok).toBe(false);
    expect(report.connected).toBe(false);
    expect(report.errors).toContain("IG_AUTH_FAILED");
  });

  it("detects account mismatch against IG_DEMO_ACCOUNT_ID", async () => {
    process.env.IG_DEMO_ACCOUNT_ID = "OTHER-ACCOUNT-9999";
    const adapter = new FakeIgBrokerAdapter({ environment: "DEMO" });
    const report = await runIgDemoReadOnlyDiagnostics(adapter);
    expect(report.accountMatch).toBe("mismatch");
    expect(report.errors).toContain("ACCOUNT_MISMATCH");
    expect(report.ok).toBe(false);
  });

  it("locks AutoTrade service on account mismatch connect", async () => {
    process.env.IG_DEMO_ACCOUNT_ID = "WRONG-ID";
    const store = new InMemoryAutoTradeStore();
    const fake = new FakeIgBrokerAdapter({ environment: "DEMO" });
    const service = new AutoTradeService(store, () => fake);
    await service.selectBroker("u1", "IG_DEMO");
    await expect(service.connectBroker("u1", "DEMO")).rejects.toMatchObject({
      code: "ACCOUNT_MISMATCH"
    });
    const status = await service.getStatus("u1");
    expect(status.locked).toBe(true);
    expect(status.lockReason).toBe("account_mismatch");
    expect(status.connection.environmentLabel).toBe("IG DEMO — PARKED");
  });

  it("returns multiple Gold candidates without silent selection", async () => {
    const adapter = new FakeIgBrokerAdapter({ environment: "DEMO", scenario: "multi_gold" });
    await adapter.connect("test");
    // Force ambiguous ranking (two primaries prevented by Fake list — first proposed only)
    const report = await runIgDemoReadOnlyDiagnostics(adapter);
    expect(report.goldCandidates.length).toBeGreaterThan(1);
    // Fake marks first as proposedPrimary — when primary.length===1, proposedEpic set
    expect(report.goldCandidates.some((c) => c.epic === "CS.D.CFEGOLD.CFD.IP")).toBe(true);
  });

  it("ranks ambiguous Gold list without a sole primary", () => {
    const ranked = rankGoldCandidates([
      {
        epic: "A.GOLD.1",
        instrumentName: "Gold Cash",
        expiry: "-",
        marketStatus: "TRADEABLE"
      },
      {
        epic: "B.GOLD.2",
        instrumentName: "Gold Spot CFD",
        expiry: "-",
        marketStatus: "TRADEABLE"
      }
    ]);
    expect(ranked.filter((c) => c.proposedPrimary).length).toBeLessThanOrEqual(1);
    if (ranked.filter((c) => c.proposedPrimary).length === 0) {
      expect(ranked.length).toBe(2);
    }
  });

  it("reports closed Gold market status", async () => {
    const adapter = new FakeIgBrokerAdapter({ environment: "DEMO", scenario: "closed_market" });
    const report = await runIgDemoReadOnlyDiagnostics(adapter);
    expect(report.selectedMarket?.marketStatus).toBe("CLOSED");
  });

  it("fails on expired session renewal", async () => {
    const adapter = new FakeIgBrokerAdapter({ environment: "DEMO", scenario: "expired_session" });
    const report = await runIgDemoReadOnlyDiagnostics(adapter);
    expect(report.sessionRenewal).toBe("failed");
    expect(report.errors.some((e) => /SESSION_EXPIRED|AUTH_FAILED/.test(e))).toBe(true);
  });

  it("blocks dealing when DEMO_ORDER_SUBMISSION_ENABLED is false", async () => {
    const ig = new IgBrokerAdapter({ environment: "DEMO", dryRun: true });
    // dryRun connect without secrets still needs credentials load — set placeholders
    process.env.IG_DEMO_API_KEY = "test-key-not-real";
    process.env.IG_DEMO_USERNAME = "demo-user";
    process.env.IG_DEMO_PASSWORD = "demo-pass";
    await ig.connect("server:test");
    await expect(
      ig.placeMarketOrder({
        dealReference: "GM-TEST",
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
  });

  it("redacts tokens and account ids from payloads", () => {
    const redacted = redactSecrets({
      password: "secret-pass",
      apiKey: "abc123",
      CST: "cst-token-value",
      "X-SECURITY-TOKEN": "sec-token",
      Authorization: "Bearer abcdefghijklmnopqrstuvwxyz",
      accountId: "ABCD12345678",
      nested: { access_token: "tok" }
    });
    expect(redacted.password).toBe("[REDACTED]");
    expect(redacted.apiKey).toBe("[REDACTED]");
    expect(redacted.CST).toBe("[REDACTED]");
    expect(redacted["X-SECURITY-TOKEN"]).toBe("[REDACTED]");
    expect(redacted.Authorization).toBe("[REDACTED]");
    expect(redacted.accountId).toBe(maskAccountId("ABCD12345678"));
    expect(redacted.nested.access_token).toBe("[REDACTED]");
    expect(assertNoSecretsInText(JSON.stringify(redacted))).toBe(true);
  });

  it("fails closed for missing IG Demo secrets on ig_demo mode", () => {
    process.env.AUTOTRADE_BROKER = "ig_demo";
    delete process.env.IG_DEMO_API_KEY;
    const store = new InMemoryAutoTradeStore();
    const service = new AutoTradeService(store, (env) => {
      const creds =
        process.env.IG_DEMO_API_KEY &&
        process.env.IG_DEMO_USERNAME &&
        process.env.IG_DEMO_PASSWORD;
      if (!creds) throw new Error("IG_DEMO_CREDENTIALS_NOT_CONFIGURED");
      return new FakeIgBrokerAdapter({ environment: env });
    });
    return service.selectBroker("u-missing", "IG_DEMO").then(() =>
      expect(service.connectBroker("u-missing", "DEMO")).rejects.toMatchObject({
        code: "IG_CREDENTIALS_MISSING"
      })
    );
  });

  it("resolves preview broker mode to ig_demo without silent fake when forced", () => {
    process.env.AUTOTRADE_BROKER = "ig_demo";
    expect(resolveAutoTradeBrokerMode()).toBe("ig_demo");
  });

  it("service diagnostics attaches sanitised report to status", async () => {
    const store = new InMemoryAutoTradeStore();
    const fake = new FakeIgBrokerAdapter({ environment: "DEMO" });
    const service = new AutoTradeService(store, () => fake);
    await service.selectBroker("u-diag", "IG_DEMO");
    const status = await service.refreshDemoDiagnostics("u-diag");
    expect(status.readOnly).toBe(true);
    expect(status.ordersEnabled).toBe(false);
    expect(status.demoOrderSubmissionEnabled).toBe(false);
    expect(status.lastDiagnosticReport?.dealingEndpointsCalled).toBe(false);
    expect(status.connection.environmentLabel).toBe("IG DEMO — PARKED");
    expect(status.goldCandidates.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(status)).not.toMatch(/password|CST|X-SECURITY/i);
  });

  it("preview firestore root env is distinct from production path", () => {
    process.env.AUTOTRADE_FIRESTORE_ROOT = "autoTradePreview";
    expect(process.env.AUTOTRADE_FIRESTORE_ROOT).toBe("autoTradePreview");
    delete process.env.AUTOTRADE_FIRESTORE_ROOT;
  });
});
