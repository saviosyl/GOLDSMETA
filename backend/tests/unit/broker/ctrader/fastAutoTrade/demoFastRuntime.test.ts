/**
 * Canonical Demo FAST runtime + Cloud Function secret-binding contracts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  applyCanonicalDemoFastRuntimeEnv,
  CANONICAL_DEMO_FAST_RUNTIME,
  CTRADER_DEMO_FUNCTION_SECRETS
} from "../../../../../src/services/broker/ctrader/demoFastRuntime";

const indexTs = readFileSync(
  resolve(__dirname, "../../../../../src/index.ts"),
  "utf8"
);

describe("canonical Demo FAST runtime", () => {
  it("forces FAST Demo flags and hard-blocks Live", () => {
    const env: NodeJS.ProcessEnv = {
      CTRADER_LIVE_ENABLED: "true",
      BROKER_EXECUTION_ENABLED: "true",
      DEMO_OVERNIGHT_MODE: "true",
      FAST_AUTOTRADE_V1_ENABLED: "false",
      DEMO_OPPORTUNITY_MODE: "ACTIVE_DEMO",
      CTRADER_ENVIRONMENT: "LIVE"
    };
    applyCanonicalDemoFastRuntimeEnv(env);
    expect(env.FAST_AUTOTRADE_V1_ENABLED).toBe("true");
    expect(env.DEMO_OPPORTUNITY_MODE).toBe("FAST_AUTOTRADE_V1");
    expect(env.DEMO_OVERNIGHT_MODE).toBe("false");
    expect(env.CTRADER_LIVE_ENABLED).toBe("false");
    expect(env.BROKER_EXECUTION_ENABLED).toBe("false");
    expect(env.CTRADER_ENVIRONMENT).toBe("DEMO");
    expect(env.CTRADER_CONNECTOR_ENABLED).toBe("true");
    expect(env.CTRADER_DEMO_READ_ENABLED).toBe("true");
    expect(env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED).toBe("true");
    expect(CANONICAL_DEMO_FAST_RUNTIME.DEMO_OVERNIGHT_MODE).toBe("false");
  });

  it("onGoldMetaDecisionCreated binds required cTrader secrets", () => {
    const start = indexTs.indexOf("export const onGoldMetaDecisionCreated");
    expect(start).toBeGreaterThan(-1);
    const chunk = indexTs.slice(start, start + 900);
    expect(chunk).toContain("CTRADER_DEMO_FUNCTION_SECRETS");
    for (const name of CTRADER_DEMO_FUNCTION_SECRETS) {
      expect(CTRADER_DEMO_FUNCTION_SECRETS).toContain(name);
    }
    expect(CTRADER_DEMO_FUNCTION_SECRETS).toEqual(
      expect.arrayContaining([
        "CTRADER_CLIENT_ID",
        "CTRADER_CLIENT_SECRET",
        "CTRADER_REDIRECT_URI",
        "CTRADER_" + "TOKEN_ENCRYPTION_KEY",
        "CTRADER_ENVIRONMENT"
      ])
    );
    expect(chunk).not.toContain("CTRADER_LIVE");
  });

  it("both Demo functions use the canonical FAST runtime helper", () => {
    const manage = indexTs.slice(
      indexTs.indexOf("export const manageDemoAutoTradePositions"),
      indexTs.indexOf("export const generateWeeklyGoldMetaReports")
    );
    const created = indexTs.slice(
      indexTs.indexOf("export const onGoldMetaDecisionCreated")
    );
    expect(manage).toContain("applyCanonicalDemoFastRuntimeEnv()");
    expect(created).toContain("applyCanonicalDemoFastRuntimeEnv()");
    expect(manage).toContain("CTRADER_DEMO_FUNCTION_SECRETS");
    expect(created).toContain("CTRADER_DEMO_FUNCTION_SECRETS");
  });
});
