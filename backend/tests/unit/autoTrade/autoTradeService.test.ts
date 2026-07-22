import { describe, expect, it, beforeEach } from "vitest";
import { AutoTradeService } from "../../../src/services/autoTrade/autoTradeService";
import { InMemoryAutoTradeStore } from "../../../src/services/autoTrade/inMemoryAutoTradeStore";
import { FakeIgBrokerAdapter } from "../../../src/services/autoTrade/fakeIgBrokerAdapter";
import {
  DEMO_ORDER_SUBMISSION_ENABLED,
  LIVE_EXECUTION_FEATURE_FLAG,
  buildDealReference
} from "../../../src/services/autoTrade/types";
import { redactSecrets, assertNoSecretsInText } from "../../../src/services/autoTrade/redactSecrets";
import { IG_ENDPOINTS, loadIgCredentialsFromServerEnv } from "../../../src/services/autoTrade/igBrokerAdapter";
import { applyEmergencyStop, createDefaultRiskState } from "../../../src/services/autoTrade/riskEngine";
import { createBrokerAdapterFactory, resolveAutoTradeBrokerMode } from "../../../src/services/autoTrade/runtime";
import { INTENT_LEASE_MS } from "../../../src/services/autoTrade/autoTradeStore";

function serviceWith(
  scenario?: ConstructorParameters<typeof FakeIgBrokerAdapter>[0],
  store?: InMemoryAutoTradeStore,
  ownerId?: string
) {
  const s = store ?? new InMemoryAutoTradeStore();
  const adapters: FakeIgBrokerAdapter[] = [];
  const service = new AutoTradeService(
    s,
    (env) => {
      const adapter = new FakeIgBrokerAdapter({ ...(scenario ?? {}), environment: env });
      adapters.push(adapter);
      return adapter;
    },
    { ownerId: ownerId ?? `test-${Math.random().toString(16).slice(2, 8)}` }
  );
  return { store: s, service, adapters };
}

const signal = {
  decisionId: "dec-001",
  decision: "BUY",
  score: 90,
  entry: 2385.5,
  stop: 2380.5,
  takeProfit: 2395.5,
  riskReward: 2,
  decisionAgeMs: 1000,
  session: "LONDON" as const
};

describe("AutoTradeService + FakeIgBrokerAdapter", () => {
  beforeEach(() => {
    AutoTradeService.resetRestartGateForTests();
  });

  it("defaults to OFF and live flag disabled", async () => {
    const { service } = serviceWith();
    const status = await service.getStatus("user-a");
    expect(status.mode).toBe("OFF");
    expect(status.displayStatus).toBe("OFF");
    expect(LIVE_EXECUTION_FEATURE_FLAG).toBe(false);
    expect(DEMO_ORDER_SUBMISSION_ENABLED).toBe(false);
    expect(status.liveExecutionFeatureEnabled).toBe(false);
  });

  it("executes a successful demo trade via FakeIg only", async () => {
    const { service } = serviceWith({ scenario: "happy" });
    await service.setMode("user-a", "IG_DEMO_AUTO");
    const result = await service.evaluateAndMaybeExecute("user-a", signal);
    expect(result.skipped).toBe(false);
    expect(result.intent.state).toBe("OPEN");
    expect(result.intent.dealId).toBeTruthy();
  });

  it("suppresses duplicate decision triggers via transactional claim", async () => {
    const { service } = serviceWith();
    await service.setMode("user-a", "IG_DEMO_AUTO");
    const first = await service.evaluateAndMaybeExecute("user-a", signal);
    const second = await service.evaluateAndMaybeExecute("user-a", signal);
    expect(first.intent.intentId).toBe(second.intent.intentId);
    expect(second.skipped).toBe(true);
    expect(second.message).toMatch(/Duplicate/);
  });

  it("two independent service instances never both claim the same decision", async () => {
    const shared = new InMemoryAutoTradeStore();
    const a = serviceWith({ scenario: "happy" }, shared, "owner-a");
    const b = serviceWith({ scenario: "happy" }, shared, "owner-b");
    await a.service.setMode("user-x", "IG_DEMO_AUTO");
    // Share adapters map isn't shared — connect for B too via setMode path already connected on A.
    // Re-connect B by using same store connection and attaching adapter:
    await b.service.connectBroker("user-x", "DEMO");

    const [r1, r2] = await Promise.all([
      a.service.evaluateAndMaybeExecute("user-x", { ...signal, decisionId: "dec-race" }),
      b.service.evaluateAndMaybeExecute("user-x", { ...signal, decisionId: "dec-race" })
    ]);

    const claimed = [r1, r2].filter((r) => !r.skipped || r.intent.state === "OPEN");
    const duplicates = [r1, r2].filter((r) => /Duplicate|lease/i.test(r.message));
    expect(r1.intent.intentId).toBe(r2.intent.intentId);
    expect(claimed.length + duplicates.length).toBeGreaterThanOrEqual(2);
    // At most one OPEN fill
    const opens = [r1, r2].filter((r) => r.intent.state === "OPEN");
    expect(opens.length).toBeLessThanOrEqual(1);
  });

  it("recovers expired execution leases", async () => {
    const store = new InMemoryAutoTradeStore();
    const { service } = serviceWith({}, store, "owner-1");
    await service.setMode("user-a", "IG_DEMO_AUTO");
    const connection = await store.getConnection("user-a");
    const settings = await store.getSettings("user-a");
    const dealReference = buildDealReference({
      decisionId: "dec-lease",
      accountId: connection.accountId ?? "NO_ACCOUNT",
      strategyVersion: "v6.0.0-pilot",
      environment: "DEMO"
    });
    const claimed = await store.claimIntent({
      userId: "user-a",
      dealReference,
      ownerId: "owner-old",
      leaseMs: 1,
      create: () => ({
        intentId: "intent-old",
        userId: "user-a",
        decisionId: "dec-lease",
        accountId: "pending",
        environment: "DEMO",
        mode: "IG_DEMO_AUTO",
        strategyVersion: "v6.0.0-pilot",
        state: "SUBMITTING",
        direction: "BUY",
        size: 1,
        entry: 1,
        stop: 1,
        takeProfit: 2,
        monetaryRisk: 1,
        score: 90,
        rejectionReason: null,
        dealReference,
        dealId: null,
        leaseOwnerId: null,
        leaseExpiresAt: null,
        leaseHeartbeatAt: null,
        limitsSnapshot: settings.limits,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        history: []
      })
    });
    expect(claimed.status).toBe("claimed");
    await new Promise((r) => setTimeout(r, 5));
    const reclaim = await store.claimIntent({
      userId: "user-a",
      dealReference,
      ownerId: "owner-new",
      leaseMs: INTENT_LEASE_MS,
      create: () => {
        throw new Error("should not create");
      }
    });
    expect(reclaim.status).toBe("claimed");
    expect(reclaim.intent.leaseOwnerId).toBe("owner-new");
  });

  it("persists emergency stop across service recreation", async () => {
    const store = new InMemoryAutoTradeStore();
    const first = serviceWith({}, store, "s1");
    await first.service.setMode("user-a", "SHADOW");
    await first.service.emergencyStop("user-a");
    AutoTradeService.resetRestartGateForTests();
    const second = serviceWith({}, store, "s2");
    const status = await second.service.getStatus("user-a");
    // restart policy resets mode OFF; lock from emergency stop persists
    expect(status.mode).toBe("OFF");
    expect(status.locked || status.emergencyStopActive || status.lockReason).toBeTruthy();
    const lock = await store.getLock("user-a");
    expect(lock.locked).toBe(true);
    expect(lock.reason).toBe("emergency_stop");
  });

  it("locks for reconciliation when HTTP times out after accept", async () => {
    const { service } = serviceWith({ scenario: "timeout_after_accept" });
    await service.setMode("user-a", "IG_DEMO_AUTO");
    const result = await service.evaluateAndMaybeExecute("user-a", signal);
    expect(["OPEN", "RECONCILIATION_REQUIRED", "ACCEPTED"]).toContain(result.intent.state);
    const status = await service.getStatus("user-a");
    expect(status.locked).toBe(true);
  });

  it("records rejected orders", async () => {
    const { service } = serviceWith({ scenario: "reject_order" });
    await service.setMode("user-a", "IG_DEMO_AUTO");
    const result = await service.evaluateAndMaybeExecute("user-a", signal);
    expect(result.intent.state).toBe("REJECTED");
  });

  it("locks when guaranteed stop rejected", async () => {
    const { service } = serviceWith({ scenario: "reject_stop" });
    await service.setMode("user-a", "IG_DEMO_AUTO");
    const result = await service.evaluateAndMaybeExecute("user-a", signal);
    expect(result.intent.state).toBe("REJECTED");
    const status = await service.getStatus("user-a");
    expect(status.locked).toBe(true);
    expect(status.lockReason).toBe("stop_protection_failed");
  });

  it("skips when minimum size exceeds risk", async () => {
    const { service } = serviceWith({ scenario: "min_size_large" });
    await service.setMode("user-a", "IG_DEMO_AUTO");
    const result = await service.evaluateAndMaybeExecute("user-a", signal);
    expect(result.skipped).toBe(true);
    expect(result.message).toMatch(/Trade skipped: IG minimum/);
  });

  it("blocks stale price", async () => {
    const { service } = serviceWith({ scenario: "stale_quote" });
    await service.setMode("user-a", "IG_DEMO_AUTO");
    const result = await service.evaluateAndMaybeExecute("user-a", signal);
    expect(result.skipped).toBe(true);
    expect(result.message).toMatch(/stale/i);
  });

  it("blocks closed market", async () => {
    const { service } = serviceWith({ scenario: "closed_market" });
    await service.setMode("user-a", "IG_DEMO_AUTO");
    const result = await service.evaluateAndMaybeExecute("user-a", signal);
    expect(result.skipped).toBe(true);
  });

  it("blocks excessive spread when configured", async () => {
    const { service, store } = serviceWith({ scenario: "wide_spread" });
    const settings = await store.getSettings("user-a");
    await store.saveSettings({
      ...settings,
      limits: { ...settings.limits, maxSpread: 0.5 }
    });
    await service.setMode("user-a", "IG_DEMO_AUTO");
    const result = await service.evaluateAndMaybeExecute("user-a", signal);
    expect(result.skipped).toBe(true);
  });

  it("emergency stop locks and sets OFF", async () => {
    const { service } = serviceWith();
    await service.setMode("user-a", "SHADOW");
    const status = await service.emergencyStop("user-a");
    expect(status.mode).toBe("OFF");
    expect(status.locked).toBe(true);
    expect(status.emergencyStopActive).toBe(true);
    expect(status.displayStatus).toBe("LOCKED");
  });

  it("daily loss lock prevents further trades", async () => {
    const { service, store } = serviceWith();
    await service.getStatus("user-a"); // consume restart gate at OFF
    await store.saveRiskState({
      ...createDefaultRiskState("user-a"),
      mode: "IG_DEMO_AUTO",
      dailyRealisedPnl: -10
    });
    await service.connectBroker("user-a", "DEMO");
    const result = await service.evaluateAndMaybeExecute("user-a", {
      ...signal,
      decisionId: "dec-daily"
    });
    expect(result.skipped).toBe(true);
    expect(result.message).toMatch(/Daily loss/i);
  });

  it("weekly loss lock prevents further trades", async () => {
    const { service, store } = serviceWith();
    await service.getStatus("user-a");
    const risk = {
      ...createDefaultRiskState("user-a"),
      mode: "IG_DEMO_AUTO" as const,
      weeklyRealisedPnl: -30
    };
    await store.saveRiskState(risk);
    await service.connectBroker("user-a", "DEMO");
    const result = await service.evaluateAndMaybeExecute("user-a", {
      ...signal,
      decisionId: "dec-weekly"
    });
    expect(result.skipped).toBe(true);
    expect(result.message).toMatch(/Weekly loss/i);
  });

  it("consecutive losses block eligibility", async () => {
    const { service, store } = serviceWith();
    await service.getStatus("user-a");
    await store.saveRiskState({
      ...createDefaultRiskState("user-a"),
      mode: "IG_DEMO_AUTO",
      consecutiveLosses: 2
    });
    await service.connectBroker("user-a", "DEMO");
    const result = await service.evaluateAndMaybeExecute("user-a", {
      ...signal,
      decisionId: "dec-cl"
    });
    expect(result.skipped).toBe(true);
    expect(result.message).toMatch(/consecutive/i);
  });

  it("rejects LIVE mode while feature flag is off", async () => {
    const { service } = serviceWith();
    await expect(
      service.setMode("user-a", "IG_LIVE_AUTO", {
        liveConfirmationPhrase: "ENABLE LIVE AUTOTRADE",
        riskAcknowledged: true,
        accountVerified: true
      })
    ).rejects.toMatchObject({ code: "LIVE_FEATURE_DISABLED" });
  });

  it("blocks LIVE adapter selection", async () => {
    const factory = createBrokerAdapterFactory("ig_demo");
    expect(() => factory("LIVE")).toThrow(/LIVE/);
  });

  it("fails closed when IG Demo secrets are missing", () => {
    const prevKey = process.env.IG_DEMO_API_KEY;
    const prevUser = process.env.IG_DEMO_USERNAME;
    const prevPass = process.env.IG_DEMO_PASSWORD;
    delete process.env.IG_DEMO_API_KEY;
    delete process.env.IG_DEMO_USERNAME;
    delete process.env.IG_DEMO_PASSWORD;
    expect(loadIgCredentialsFromServerEnv("DEMO")).toBeNull();
    const factory = createBrokerAdapterFactory("ig_demo");
    expect(() => factory("DEMO")).toThrow(/IG_DEMO_CREDENTIALS_NOT_CONFIGURED/);
    if (prevKey) process.env.IG_DEMO_API_KEY = prevKey;
    if (prevUser) process.env.IG_DEMO_USERNAME = prevUser;
    if (prevPass) process.env.IG_DEMO_PASSWORD = prevPass;
  });

  it("test/local broker mode resolves to fake", () => {
    expect(resolveAutoTradeBrokerMode({ APP_ENV: "test", STORAGE_BACKEND: "memory" })).toBe("fake");
  });

  it("requires confirmation to increase limits", async () => {
    const { service, store } = serviceWith();
    await expect(service.updateLimits("user-a", { maxLossPerTrade: 25 })).rejects.toMatchObject({
      code: "LIMIT_INCREASE_CONFIRMATION_REQUIRED"
    });
    const status = await service.updateLimits(
      "user-a",
      { maxLossPerTrade: 25 },
      { confirmIncrease: true, actorUserId: "user-a" }
    );
    expect(status.limits.maxLossPerTrade).toBe(25);
    const audit = await store.listAudit("user-a");
    expect(audit.some((a) => a.action === "limits_increased")).toBe(true);
  });

  it("locks on account change", async () => {
    const { service, store } = serviceWith();
    await service.connectBroker("user-a", "DEMO");
    const conn = await store.getConnection("user-a");
    await store.saveConnection({ ...conn, pinnedAccountId: "OTHER-ACCOUNT" });
    await service.connectBroker("user-a", "DEMO");
    const status = await service.getStatus("user-a");
    expect(status.locked).toBe(true);
    expect(status.lockReason).toBe("account_change");
  });

  it("keeps DEMO and LIVE endpoint bases isolated", () => {
    expect(IG_ENDPOINTS.DEMO).toContain("demo-api.ig.com");
    expect(IG_ENDPOINTS.LIVE).toBe("https://api.ig.com/gateway/deal");
    expect(IG_ENDPOINTS.DEMO).not.toBe(IG_ENDPOINTS.LIVE);
  });

  it("builds deterministic deal references", () => {
    const a = buildDealReference({
      decisionId: "d1",
      accountId: "acc",
      strategyVersion: "v6",
      environment: "DEMO"
    });
    const b = buildDealReference({
      decisionId: "d1",
      accountId: "acc",
      strategyVersion: "v6",
      environment: "DEMO"
    });
    const c = buildDealReference({
      decisionId: "d1",
      accountId: "acc",
      strategyVersion: "v6",
      environment: "LIVE"
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("redacts secrets from payloads and text", () => {
    const redacted = redactSecrets({
      password: "secret-pass",
      apiKey: "key-123",
      CST: "abc",
      "X-SECURITY-TOKEN": "tok",
      accountId: "DEMO-ACC-1234",
      nested: { token: "x", ok: true }
    });
    expect(JSON.stringify(redacted)).not.toContain("secret-pass");
    expect(JSON.stringify(redacted)).not.toContain("key-123");
    expect(redacted.accountId).toMatch(/\*+1234/);
    expect(assertNoSecretsInText("CST=abc X-SECURITY-TOKEN=zzz password=nope")).toBe(false);
    expect(assertNoSecretsInText("order accepted dealId=1")).toBe(true);
  });

  it("emergency stop helper sets OFF", () => {
    const next = applyEmergencyStop(createDefaultRiskState("u"));
    expect(next.mode).toBe("OFF");
    expect(next.locked).toBe(true);
  });

  it("does not place real IG orders (fake adapter only in tests)", async () => {
    const { service, adapters } = serviceWith();
    await service.setMode("user-a", "IG_DEMO_AUTO");
    expect(adapters[0]?.name).toBe("fake-ig");
    await service.evaluateAndMaybeExecute("user-a", signal);
    expect(adapters.every((a) => a.name === "fake-ig")).toBe(true);
  });

  it("DEMO read-only diagnostics refreshes market fields via FakeIg", async () => {
    const { service } = serviceWith();
    const status = await service.refreshDemoDiagnostics("user-diag");
    expect(status.connection.connected).toBe(true);
    expect(status.connection.environment).toBe("DEMO");
    expect(status.connection.minDealSize).toBeTruthy();
    expect(status.connection.bid).toBeTruthy();
  });
});
