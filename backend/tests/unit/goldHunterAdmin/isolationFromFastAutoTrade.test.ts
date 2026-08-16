import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Protected Core unchanged — Gold Hunter must not mutate Fast AutoTrade
 * strategy / engine / qualification ownership surfaces.
 */
describe("Gold Hunter isolation from Fast AutoTrade", () => {
  it("does not import Fast AutoTrade engine from GH admin modules", () => {
    const files = [
      "backend/src/services/goldHunterAdmin/demoExecutionAdapter.ts",
      "backend/src/services/goldHunterAdmin/orderGates.ts",
      "backend/src/services/goldHunterAdmin/statusAssembler.ts",
      "backend/src/services/goldHunterAdmin/accountSnapshot.ts",
      "backend/src/services/goldHunterAdmin/executionOrchestrator.ts",
      "backend/src/services/goldHunterAdmin/strategySelector.ts",
      "backend/src/services/goldHunterAdmin/demoAutoExecutionRuntime.ts",
      "backend/src/services/goldHunterAdmin/demoPositionManager.ts",
      "backend/src/services/goldHunterAdmin/marketFeedHook.ts",
      "backend/src/routes/goldHunterAdmin.ts"
    ];
    for (const f of files) {
      const text = readFileSync(resolve(process.cwd(), f.replace(/^backend\//, "")), "utf8");
      expect(text).not.toMatch(/fastAutoTrade\/engine/);
      expect(text).not.toMatch(/createAutoTradeService/);
      expect(text).not.toMatch(/qualificationMachine/);
      expect(text).toMatch(
        /GOLD_HUNTER|GH_ADMIN_STRATEGY|gold-hunter|Gold Hunter|GoldHunter|cTrader/
      );
    }
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
