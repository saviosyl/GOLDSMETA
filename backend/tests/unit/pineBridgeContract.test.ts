import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import plan15Fixture from "../fixtures/pine3Plan15mPayload.json";
import confirm5Fixture from "../fixtures/pine3Confirm5mPayload.json";
import quote1Fixture from "../fixtures/pine3Quote1mPayload.json";
import { tradingViewPayloadSchema } from "../../src/models/types";
import { normalizePlanSourceKey } from "../../src/services/decision/alertRole";

const backendRoot = resolve(__dirname, "../..");
const repoRoot = resolve(backendRoot, "..");
const pineBridgePath = resolve(repoRoot, "pine/GoldMetaBridge.pine");

const ROLE_PLAN_15M = "PLAN_15M";
const ROLE_CONFIRM_5M = "CONFIRM_5M";
const ROLE_QUOTE_1M = "QUOTE_1M";

const sessionNameForUtcHour = (hour: number): string =>
  hour >= 0 && hour < 7
    ? "ASIA"
    : hour >= 7 && hour < 13
      ? "LONDON"
      : hour >= 13 && hour < 17
        ? "OVERLAP"
        : hour >= 17 && hour < 22
          ? "NEWYORK"
          : "UNKNOWN";

const sessionNameFromMs = (closeTimeMs: number): string =>
  sessionNameForUtcHour(new Date(closeTimeMs).getUTCHours());

const roleAwarePlanSourceKey = (args: {
  role: "PLAN_15M" | "CONFIRM_5M" | "QUOTE_1M";
  tickerId: string;
  plan15CloseTsCurrentMs: number;
  plan15CloseTsPreviousMs: number;
}): string => {
  const closeMs =
    args.role === ROLE_PLAN_15M ? args.plan15CloseTsCurrentMs : args.plan15CloseTsPreviousMs;
  return `${args.tickerId}|${sessionNameFromMs(closeMs)}|${closeMs}|PLAN_15M`;
};

describe("GoldMeta Pine bridge contract regressions", () => {
  it("uses non-repainting 1H request.security pattern and emits explicit oneHour bias metadata", () => {
    const source = readFileSync(pineBridgePath, "utf8");
    expect(source).toMatch(
      /request\.security\(syminfo\.tickerid,\s*directionTfInput,\s*\[\s*close\[1\],\s*ta\.ema\(close,\s*emaFastLen\)\[1\],\s*ta\.ema\(close,\s*emaSlowLen\)\[1\],\s*ta\.ema\(close,\s*ema200Len\)\[1\],\s*ta\.atr\(atrLength\)\[1\],\s*time_close\[1\]\s*\],\s*gaps=barmerge\.gaps_off,\s*lookahead=barmerge\.lookahead_on\)/s
    );
    expect(source).not.toMatch(
      /request\.security\(syminfo\.tickerid,\s*directionTfInput,\s*\[\s*close\[1\],\s*ta\.ema\(close,\s*emaFastLen\)\[1\],\s*ta\.ema\(close,\s*emaSlowLen\)\[1\],\s*ta\.ema\(close,\s*ema200Len\)\[1\],\s*ta\.atr\(atrLength\)\[1\],\s*time_close\[1\]\s*\],\s*gaps=barmerge\.gaps_off,\s*lookahead=barmerge\.lookahead_off\)/s
    );
    expect(source).toContain("oneHourBiasConfirmed");
    expect(source).toContain("oneHourBiasSourceTime");
  });

  it("derives planSourceKey from role-aware confirmed 15M timestamps", () => {
    const source = readFileSync(pineBridgePath, "utf8");
    expect(source).toContain("plan15CloseTsCurrent");
    expect(source).toContain("plan15CloseTsPrevious");
    expect(source).toContain(
      "planSourceCloseTs = alertRoleInput == ROLE_PLAN_15M ? plan15CloseTsCurrent : plan15CloseTsPrevious"
    );
    expect(source).toContain("planSourceSession = f_session_name_from_ts(planSourceCloseTs)");
    expect(source).toMatch(
      /\[plan15CloseTsPrevious\]\s*=\s*request\.security\(syminfo\.tickerid,\s*structureTfInput,\s*\[time_close\[1\]\],\s*gaps=barmerge\.gaps_off,\s*lookahead=barmerge\.lookahead_on\)/
    );
    expect(source).not.toMatch(
      /\[plan15CloseTsPrevious\]\s*=\s*request\.security\(syminfo\.tickerid,\s*structureTfInput,\s*\[time_close\[1\]\],\s*gaps=barmerge\.gaps_off,\s*lookahead=barmerge\.lookahead_off\)/
    );
  });

  it("keeps PLAN_15M, CONFIRM_5M, and QUOTE_1M fixtures on the exact same normalized key", () => {
    const plan = tradingViewPayloadSchema.parse(plan15Fixture);
    const confirm = tradingViewPayloadSchema.parse(confirm5Fixture);
    const quote = tradingViewPayloadSchema.parse(quote1Fixture);

    const planKey = normalizePlanSourceKey((plan.metadata?.planSourceKey as string | undefined) ?? null);
    const confirmKey = normalizePlanSourceKey(
      (confirm.metadata?.planSourceKey as string | undefined) ?? null
    );
    const quoteKey = normalizePlanSourceKey((quote.metadata?.planSourceKey as string | undefined) ?? null);

    expect(planKey).toBeTruthy();
    expect(confirmKey).toBe(planKey);
    expect(quoteKey).toBe(planKey);

    for (const payload of [plan, confirm, quote]) {
      expect(typeof payload.metadata?.oneHourBiasConfirmed).toBe("boolean");
      expect(typeof payload.metadata?.oneHourBiasSourceTime).toBe("string");
    }
  });

  it("session-boundary timeline uses last closed 15M key for confirm/quote and avoids developing key drift", () => {
    const ticker = "OANDA:XAUUSD";
    const activeClosedPlanMs = Date.parse("2026-07-20T16:45:00Z"); // OVERLAP
    const developingNextPlanMs = Date.parse("2026-07-20T17:00:00Z"); // NEWYORK boundary

    const planKey = roleAwarePlanSourceKey({
      role: ROLE_PLAN_15M,
      tickerId: ticker,
      plan15CloseTsCurrentMs: activeClosedPlanMs,
      plan15CloseTsPreviousMs: Date.parse("2026-07-20T16:30:00Z")
    });
    const confirmKey = roleAwarePlanSourceKey({
      role: ROLE_CONFIRM_5M,
      tickerId: ticker,
      plan15CloseTsCurrentMs: developingNextPlanMs,
      plan15CloseTsPreviousMs: activeClosedPlanMs
    });
    const quoteKey = roleAwarePlanSourceKey({
      role: ROLE_QUOTE_1M,
      tickerId: ticker,
      plan15CloseTsCurrentMs: developingNextPlanMs,
      plan15CloseTsPreviousMs: activeClosedPlanMs
    });

    expect(confirmKey).toBe(planKey);
    expect(quoteKey).toBe(planKey);
    expect(confirmKey).toContain("|OVERLAP|");

    const naiveDevelopingKey = `${ticker}|${sessionNameFromMs(developingNextPlanMs)}|${developingNextPlanMs}|PLAN_15M`;
    expect(naiveDevelopingKey).toContain("|NEWYORK|");
    expect(naiveDevelopingKey).not.toBe(planKey);
  });
});
