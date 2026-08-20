import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Gold Hunter remains isolated. Core / FAST AutoTrade engines are gone.
 */
describe("Gold Hunter isolation after Core/FAST removal", () => {
  it("does not import removed Fast / Core AutoTrade engines", () => {
    const files = [
      "src/services/goldHunterAdmin/demoExecutionAdapter.ts",
      "src/services/goldHunterAdmin/orderGates.ts",
      "src/services/goldHunterAdmin/statusAssembler.ts",
      "src/services/goldHunterAdmin/accountSnapshot.ts",
      "src/services/goldHunterAdmin/executionOrchestrator.ts",
      "src/services/goldHunterAdmin/strategySelector.ts",
      "src/services/goldHunterAdmin/demoAutoExecutionRuntime.ts",
      "src/services/goldHunterAdmin/demoPositionManager.ts",
      "src/services/goldHunterAdmin/marketFeedHook.ts",
      "src/services/goldHunterAdmin/closeSettlement.ts",
      "src/services/goldHunterAdmin/reconciliationRuntime.ts",
      "src/services/goldHunterAdmin/executionRuntimeStore.ts",
      "src/services/goldHunterAdmin/candidateFreshness.ts",
      "src/routes/goldHunterAdmin.ts"
    ];
    for (const f of files) {
      const text = readFileSync(resolve(process.cwd(), f), "utf8");
      expect(text).not.toMatch(/fastAutoTrade\/engine/);
      expect(text).not.toMatch(/createAutoTradeService/);
      expect(text).not.toMatch(/qualificationMachine/);
      expect(text).toMatch(
        /GOLD_HUNTER|GH_ADMIN_STRATEGY|gold-hunter|Gold Hunter|GoldHunter|cTrader/
      );
    }
    expect(
      existsSync(resolve(process.cwd(), "src/services/broker/ctrader/fastAutoTrade/engine.ts"))
    ).toBe(false);
  });

  it("execution adapter uses Demo order path with GOLD_HUNTER attribution", () => {
    const text = readFileSync(
      resolve(process.cwd(), "src/services/goldHunterAdmin/demoExecutionAdapter.ts"),
      "utf8"
    );
    expect(text).toContain("submitDemoMarketOrder");
    expect(text).toContain("strategyId: null");
    expect(text).toContain("GH_ADMIN_STRATEGY_ID");
    expect(text).toContain("assertGoldHunterDemoOnlyEnvironment");
  });
});
