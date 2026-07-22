import { describe, expect, it } from "vitest";
import { AutoTradeService } from "../../../src/services/autoTrade/autoTradeService";
import { InMemoryAutoTradeStore } from "../../../src/services/autoTrade/autoTradeStore";
import { FakeIgBrokerAdapter } from "../../../src/services/autoTrade/fakeIgBrokerAdapter";
import {
  LIVE_EXECUTION_FEATURE_FLAG,
  buildDealReference
} from "../../../src/services/autoTrade/types";
import { redactSecrets, assertNoSecretsInText } from "../../../src/services/autoTrade/redactSecrets";
import { IG_ENDPOINTS } from "../../../src/services/autoTrade/igBrokerAdapter";
import { applyEmergencyStop, createDefaultRiskState } from "../../../src/services/autoTrade/riskEngine";

function serviceWith(scenario?: ConstructorParameters<typeof FakeIgBrokerAdapter>[0]) {
  const store = new InMemoryAutoTradeStore();
  const adapters: FakeIgBrokerAdapter[] = [];
  const service = new AutoTradeService(store, (env) => {
    const adapter = new FakeIgBrokerAdapter({ ...(scenario ?? {}), environment: env });
    adapters.push(adapter);
    return adapter;
  });
  return { store, service, adapters };
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
  it("defaults to OFF and live flag disabled", async () => {
    const { service } = serviceWith();
    const status = await service.getStatus("user-a");
    expect(status.mode).toBe("OFF");
    expect(status.displayStatus).toBe("OFF");
    expect(LIVE_EXECUTION_FEATURE_FLAG).toBe(false);
    expect(status.liveExecutionFeatureEnabled).toBe(false);
  });

  it("executes a successful demo trade", async () => {
    const { service } = serviceWith({ scenario: "happy" });
    await service.setMode("user-a", "IG_DEMO_AUTO");
    const result = await service.evaluateAndMaybeExecute("user-a", signal);
    expect(result.skipped).toBe(false);
    expect(result.intent.state).toBe("OPEN");
    expect(result.intent.dealId).toBeTruthy();
  });

  it("suppresses duplicate decision triggers via idempotency", async () => {
    const { service } = serviceWith();
    await service.setMode("user-a", "IG_DEMO_AUTO");
    const first = await service.evaluateAndMaybeExecute("user-a", signal);
    const second = await service.evaluateAndMaybeExecute("user-a", signal);
    expect(first.intent.intentId).toBe(second.intent.intentId);
    expect(second.skipped).toBe(true);
    expect(second.message).toMatch(/Duplicate/);
  });

  it("serializes concurrent evaluate calls", async () => {
    const { service } = serviceWith();
    await service.setMode("user-a", "IG_DEMO_AUTO");
    const [a, b] = await Promise.all([
      service.evaluateAndMaybeExecute("user-a", signal),
      service.evaluateAndMaybeExecute("user-a", { ...signal, decisionId: "dec-001" })
    ]);
    const ids = new Set([a.intent.intentId, b.intent.intentId]);
    expect(ids.size).toBe(1);
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
    expect(assertNoSecretsInText('CST=abc X-SECURITY-TOKEN=zzz password=nope')).toBe(false);
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
});
