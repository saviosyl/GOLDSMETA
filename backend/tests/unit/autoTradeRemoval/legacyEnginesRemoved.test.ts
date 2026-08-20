import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isBrokerExecutionEnabled, isCTraderLiveEnabled } from "../../../src/services/broker/ctrader/flags";
import {
  evaluateGoldHunterOrderGates,
  type GoldHunterGateInput
} from "../../../src/services/goldHunterAdmin/orderGates";
import { GH_ADMIN_DEFAULT_CONFIG } from "../../../src/services/goldHunterAdmin/types";

const backendRoot = resolve(__dirname, "../../..");
const repoRoot = resolve(backendRoot, "..");

function read(rel: string): string {
  return readFileSync(resolve(backendRoot, rel), "utf8");
}

function walkTs(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walkTs(full, acc);
    } else if (entry.name.endsWith(".ts")) {
      acc.push(full);
    }
  }
  return acc;
}

function gate(over: Partial<GoldHunterGateInput> = {}) {
  return evaluateGoldHunterOrderGates({
    config: {
      ...GH_ADMIN_DEFAULT_CONFIG,
      demoAutoTradeEnabled: true,
      allocatedCapitalEur: 1000,
      riskPerTradePct: 1,
      dailyLossLimitPct: 3,
      maxOpenTrades: 1
    },
    brokerEnvironment: "DEMO",
    brokerConnected: true,
    accountSnapshotValid: true,
    marketOpen: true,
    feedFresh: true,
    depthValid: true,
    spreadOk: true,
    capitalOk: true,
    dailyLossOk: true,
    openTradeCount: 0,
    signalPresent: true,
    signalConsumed: false,
    isAdmin: true,
    ...over
  });
}

describe("legacy Core / FAST AutoTrade removal", () => {
  it("1-2. DecisionRecord BUY/SELL cannot automatically place an order", () => {
    const index = read("src/index.ts");
    expect(index).toContain("decision_autotrade_retired");
    expect(index).not.toContain("processDecisionForAutoTrade");
    expect(index).not.toContain("processDecisionForQualification");
    expect(index).not.toMatch(/submitDemoMarketOrder/);
    expect(existsSync(resolve(backendRoot, "src/services/autoTrade/decisionTrigger.ts"))).toBe(
      false
    );
    expect(
      existsSync(resolve(backendRoot, "src/services/broker/ctrader/qualificationService.ts"))
    ).toBe(false);
  });

  it("3. old ArmedCandidate cannot place an order", () => {
    expect(
      existsSync(resolve(backendRoot, "src/services/broker/ctrader/armedCandidate.ts"))
    ).toBe(false);
    expect(
      existsSync(resolve(backendRoot, "src/services/broker/ctrader/armedCandidateStore.ts"))
    ).toBe(false);
    const src = walkTs(resolve(backendRoot, "src")).map((f) => readFileSync(f, "utf8"));
    expect(src.some((t) => /createArmedCandidate|armedCandidate/.test(t))).toBe(false);
  });

  it("4. FAST signal / engine cannot exist or run", () => {
    expect(
      existsSync(resolve(backendRoot, "src/services/broker/ctrader/fastAutoTrade/engine.ts"))
    ).toBe(false);
    expect(
      existsSync(resolve(backendRoot, "src/services/broker/ctrader/fastAutoTrade/config.ts"))
    ).toBe(false);
    expect(
      existsSync(resolve(backendRoot, "src/services/broker/ctrader/fastAutoTrade/scan.ts"))
    ).toBe(false);
    const src = walkTs(resolve(backendRoot, "src"))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    expect(src).not.toMatch(/evaluateFastAutoTrade\s*\(/);
    expect(src).not.toMatch(/isFastAutoTradeV1Enabled\s*\(/);
    expect(src).not.toMatch(/FAST_AUTOTRADE_STRATEGY_ID/);
  });

  it("5. FAST scheduler cannot execute", () => {
    const index = read("src/index.ts");
    expect(index).not.toContain("runFastAutoTradeScanPass");
    expect(index).not.toContain("runBoundedFastScanCycle");
    expect(index).toContain("manage_demo_positions_retired");
    expect(
      existsSync(resolve(backendRoot, "src/services/broker/ctrader/fastAutoTrade/scanScheduler.ts"))
    ).toBe(false);
  });

  it("6. Core scheduler cannot execute", () => {
    const index = read("src/index.ts");
    expect(index).not.toContain("runDemoPositionManagementPass");
    expect(index).not.toContain("createAutoTradeService");
    expect(existsSync(resolve(backendRoot, "src/routes/autoTrade.ts"))).toBe(false);
    expect(existsSync(resolve(backendRoot, "src/services/autoTrade/runtime.ts"))).toBe(false);
  });

  it("7. Gold Hunter still evaluates independently of removed engines", () => {
    const adapter = read("src/services/goldHunterAdmin/demoExecutionAdapter.ts");
    expect(adapter).toContain("submitDemoMarketOrder");
    expect(adapter).toContain("strategyId: null");
    expect(adapter).toContain("GH_ADMIN_STRATEGY_ID");
    expect(adapter).not.toMatch(/fastAutoTrade\/engine/);
    expect(
      existsSync(resolve(backendRoot, "src/services/goldHunterAdmin/strategySelector.ts"))
    ).toBe(true);
  });

  it("10. Gold Hunter risk controls still block unsafe entries", () => {
    expect(gate({ dailyLossOk: false }).blockers).toContain("WAIT — DAILY LOSS LIMIT");
    expect(gate({ capitalOk: false }).blockers).toContain("WAIT — CAPITAL LIMIT");
    expect(gate({ openTradeCount: 1 }).blockers).toContain("WAIT — MAX OPEN TRADES");
    expect(gate({ feedFresh: false }).blockers).toContain("WAIT — FEED STALE");
    expect(gate({ spreadOk: false }).blockers).toContain("WAIT — SPREAD TOO WIDE");
  });

  it("11. Gold Hunter duplicate protection still works", () => {
    const dup = gate({ signalConsumed: true });
    expect(dup.ok).toBe(false);
    expect(dup.blockers).toContain("WAIT — DUPLICATE SIGNAL");
  });

  it("12. Live remains blocked", () => {
    expect(isCTraderLiveEnabled()).toBe(false);
    expect(isBrokerExecutionEnabled()).toBe(false);
    expect(
      isCTraderLiveEnabled({ CTRADER_LIVE_ENABLED: "true" } as NodeJS.ProcessEnv)
    ).toBe(false);
    const live = gate({ brokerEnvironment: "LIVE" });
    expect(live.ok).toBe(false);
    expect(live.blockers).toContain("WAIT — LIVE ENVIRONMENT REFUSED");
  });

  it("14-15. only Gold Hunter automatically reaches submitDemoMarketOrder", () => {
    const automaticSubmitters: string[] = [];
    for (const file of walkTs(resolve(backendRoot, "src"))) {
      const rel = file.slice(backendRoot.length + 1);
      const text = readFileSync(file, "utf8");
      if (!/\bsubmitDemoMarketOrder\b/.test(text)) continue;
      if (rel.endsWith("demoOrderExecution.ts")) continue;
      if (rel.includes("shadowQualification/brokerMutationGuard.ts")) continue;
      automaticSubmitters.push(rel.replace(/^src\//, ""));
    }
    expect(automaticSubmitters.sort()).toEqual([
      "routes/ctrader.ts",
      "services/goldHunterAdmin/demoExecutionAdapter.ts"
    ]);
    expect(read("src/routes/ctrader.ts")).toContain('router.post("/v1/ctrader/orders/market"');
    expect(read("src/services/goldHunterAdmin/demoExecutionAdapter.ts")).toContain(
      "GH_ADMIN_STRATEGY_ID"
    );
  });

  it("does not leave FAST_AUTOTRADE_V1 enabled in runtime helpers", () => {
    const runtime = read("src/services/broker/ctrader/demoFastRuntime.ts");
    expect(runtime).not.toMatch(/FAST_AUTOTRADE_V1_ENABLED:\s*"true"/);
    expect(runtime).toContain("delete source.FAST_AUTOTRADE_V1_ENABLED");
    const index = read("src/index.ts");
    expect(index).toContain('delete process.env.FAST_AUTOTRADE_V1_ENABLED');
  });

  it("frontend no longer mounts Core AutoTrade pages", () => {
    const app = readFileSync(resolve(repoRoot, "web/src/App.tsx"), "utf8");
    expect(app).not.toContain("AutoTradePage");
    expect(app).not.toContain('path="/autotrade"');
    expect(app).not.toContain('path="/autotrade/performance"');
    expect(app).toContain('path="/gold-hunter"');
    expect(
      existsSync(resolve(repoRoot, "web/src/pages/AutoTradePage.tsx"))
    ).toBe(false);
    expect(
      existsSync(resolve(repoRoot, "backend/src/services/broker/ctrader/fastAutoTrade"))
    ).toBe(false);
  });
});
