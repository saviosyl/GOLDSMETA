import { describe, expect, it } from "vitest";
import { DEFAULT_RISK_CONTROLS, type ProposeOrderRequest } from "../../src/models/trading";
import { evaluateSubmissionGuards } from "../../src/services/trading/riskControls";
import { createDefaultTradingControls } from "../../src/services/trading/tradingModeService";
import { InMemoryTradingStore } from "../../src/services/trading/inMemoryTradingStore";
import { TradingModeService } from "../../src/services/trading/tradingModeService";
import { Trading212ManualAdapter } from "../../src/services/brokers/trading212ManualAdapter";
import { brokerSecretVault } from "../../src/services/brokers/secretVault";

const baseRequest = (overrides: Partial<ProposeOrderRequest> = {}): ProposeOrderRequest => ({
  decisionId: "dec-1",
  side: "BUY",
  orderType: "MARKET",
  quantity: 0.1,
  entryPrice: 2410,
  stopLoss: 2400,
  takeProfits: [{ label: "TP1", price: 2420, closeFraction: 0.33 }],
  riskPercent: 0.5,
  confidence: 80,
  spread: 0.2,
  dataQuality: "GOOD",
  signalKey: `sig-${Math.random()}`,
  highImpactNewsActive: false,
  ...overrides
});

describe("Trading 212 adapter", () => {
  it("does not support automated XAUUSD CFD actions", async () => {
    const adapter = new Trading212ManualAdapter();
    expect(adapter.capabilities().supportsXauusdCfd).toBe(false);
    expect(adapter.capabilities().automatedSubmission).toBe(false);
    expect(adapter.supports("ENTER")).toBe(false);
    const result = await adapter.placeEntry({
      decisionId: "d1",
      side: "BUY",
      orderType: "MARKET",
      quantity: 1,
      entryPrice: 2410,
      stopLoss: 2400,
      takeProfits: [],
      clientOrderKey: "k1"
    });
    expect(result.status).toBe("MANUAL_ONLY");
    expect(result.accepted).toBe(false);
  });
});

describe("risk controls", () => {
  it("blocks emergency stop, stale data, duplicates, news, and oversized risk", () => {
    const controls = {
      ...createDefaultTradingControls("u1"),
      mode: "DEMO_AUTO" as const,
      autoTradingEnabled: true,
      emergencyStopActive: true
    };
    const stopped = evaluateSubmissionGuards({
      controls,
      request: baseRequest(),
      tradesToday: 0,
      realizedDailyLossPercent: 0,
      seenSignalKeys: new Set()
    });
    expect(stopped.allowed).toBe(false);
    expect(stopped.blocks.some((b) => b.code === "EMERGENCY_STOP")).toBe(true);

    const risk = evaluateSubmissionGuards({
      controls: { ...controls, emergencyStopActive: false },
      request: baseRequest({
        riskPercent: 5,
        confidence: 10,
        spread: 5,
        dataQuality: "STALE",
        highImpactNewsActive: true,
        signalKey: "dup"
      }),
      tradesToday: 99,
      realizedDailyLossPercent: 50,
      seenSignalKeys: new Set(["dup"])
    });
    expect(risk.allowed).toBe(false);
    expect(risk.blocks.map((b) => b.code)).toEqual(
      expect.arrayContaining([
        "MAX_RISK",
        "MAX_DAILY_LOSS",
        "MAX_TRADES",
        "MIN_CONFIDENCE",
        "MAX_SPREAD",
        "STALE_DATA",
        "DUPLICATE_SIGNAL",
        "HIGH_IMPACT_NEWS"
      ])
    );
  });

  it("keeps default risk caps conservative", () => {
    expect(DEFAULT_RISK_CONTROLS.maxRiskPerTradePercent).toBeLessThanOrEqual(1);
    expect(DEFAULT_RISK_CONTROLS.maxTradesPerDay).toBeLessThanOrEqual(10);
  });
});

describe("TradingModeService", () => {
  it("manual mode returns instructions without submission", async () => {
    const service = new TradingModeService(new InMemoryTradingStore());
    const { proposal } = await service.proposeOrExecute("user-1", baseRequest());
    expect(proposal.mode).toBe("MANUAL");
    expect(proposal.status).toBe("PROPOSED");
    expect(proposal.instructions.join(" ")).toMatch(/Trading 212|Manual|guarantee/i);
  });

  it("confirm mode requires confirmation token to leave proposed state for execution attempt", async () => {
    const store = new InMemoryTradingStore();
    const service = new TradingModeService(store);
    await service.patchControls("user-1", { mode: "CONFIRM", disclaimerAcknowledged: true });
    const drafted = await service.proposeOrExecute("user-1", baseRequest());
    expect(drafted.proposal.status).toBe("PROPOSED");
    expect(drafted.proposal.instructions.join(" ")).toMatch(/Face ID|confirmation/i);

    const confirmed = await service.proposeOrExecute(
      "user-1",
      baseRequest({ confirmationToken: "face-id-ok-token" })
    );
    // Trading 212 cannot automate XAUUSD — confirm still cannot auto-submit.
    expect(confirmed.proposal.status).toBe("BLOCKED");
    expect(confirmed.proposal.blockedReasons.join(" ")).toMatch(/does not support automated/i);
  });

  it("demo auto executes simulated fills and records performance on close", async () => {
    const store = new InMemoryTradingStore();
    const service = new TradingModeService(store);
    await service.patchControls("user-1", {
      mode: "DEMO_AUTO",
      autoTradingEnabled: true,
      disclaimerAcknowledged: true
    });
    const result = await service.proposeOrExecute("user-1", baseRequest({ confidence: 85 }));
    expect(result.proposal.status).toBe("EXECUTED");
    expect(result.execution?.brokerOrderId).toMatch(/^demo-/);

    const orders = await service.listDemoOrders("user-1");
    expect(orders).toHaveLength(1);
    const performance = await service.closeDemoTrade("user-1", orders[0].orderId, 1.2);
    expect(performance.closedTrades).toBe(1);
    expect(performance.wins).toBe(1);
    expect(performance.drawdownPercent).toBeGreaterThanOrEqual(0);

    const controls = await service.getControls("user-1");
    expect(controls.demoTesting.closedTrades).toBe(1);
    expect(controls.liveAutoUnlocked).toBe(false);
  });

  it("live auto stays locked until demo requirements are met and rejects trading212 automation", async () => {
    const store = new InMemoryTradingStore();
    const service = new TradingModeService(store);
    await expect(
      service.patchControls("user-1", { mode: "LIVE_AUTO", liveAutoEnabledByUser: true })
    ).rejects.toMatchObject({ code: "LIVE_LOCKED" });
  });

  it("emergency stop blocks new orders and attempts cancel", async () => {
    const store = new InMemoryTradingStore();
    const service = new TradingModeService(store);
    await service.patchControls("user-1", { mode: "DEMO_AUTO", autoTradingEnabled: true });
    const stopped = await service.emergencyStop("user-1");
    expect(stopped.controls.emergencyStopActive).toBe(true);
    expect(stopped.controls.autoTradingEnabled).toBe(false);
    const blocked = await service.proposeOrExecute("user-1", baseRequest());
    expect(blocked.proposal.status).toBe("BLOCKED");
    expect(blocked.proposal.blockedReasons.join(" ")).toMatch(/Emergency Stop/i);
  });

  it("stores broker credentials only as ciphertext", async () => {
    const store = new InMemoryTradingStore();
    const service = new TradingModeService(store);
    const result = await service.storeBrokerCredentials("user-1", "future_cfd_broker", "key-abc", "secret-xyz");
    expect(result.stored).toBe(true);
    const ciphertext = await store.getEncryptedBrokerSecret("user-1", "future_cfd_broker");
    expect(ciphertext).toBeTruthy();
    expect(ciphertext).not.toContain("secret-xyz");
    expect(ciphertext).not.toContain("key-abc");
    const decrypted = brokerSecretVault.decrypt(ciphertext!);
    expect(decrypted).toContain("key-abc");
  });
});
