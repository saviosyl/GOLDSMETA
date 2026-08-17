import { describe, expect, it } from "vitest";
import { runAuthoritativeMarginSequence } from "../../../../../src/services/broker/ctrader/fastAutoTrade/marginSequence";
import {
  computeAuthoritativeMarginSnapshot,
  MARGIN_SNAPSHOT_MAX_AGE_MS
} from "../../../../../src/services/broker/ctrader/authoritativeMargin";
import type {
  AuthoritativeMarginSnapshotResult,
  ExpectedMarginResult
} from "../../../../../src/services/broker/ctrader/openApiClient";

const NOW = Date.parse("2026-08-17T01:00:00.000Z");

function snap(capturedAtMs: number): AuthoritativeMarginSnapshotResult {
  const computed = computeAuthoritativeMarginSnapshot({
    balance: 50_000,
    moneyDigits: 2,
    leverage: 30,
    openPositionCount: 0,
    reconcileOk: true,
    positionsUsedMargin: [],
    unrealisedRows: null,
    capturedAt: new Date(capturedAtMs).toISOString()
  });
  if (!computed.ok) throw new Error("snap");
  return { ok: true, snapshot: computed.snapshot };
}

const expectedOk: ExpectedMarginResult = {
  ok: true,
  expectedMargin: 1200,
  buyMargin: 1200,
  sellMargin: 1200,
  volume: 100,
  moneyDigits: 2
};

describe("FAST margin sequence", () => {
  it("1. expected-margin takes 20s, snapshot fetched AFTER, age < max → PASS", async () => {
    const order: string[] = [];
    let clock = NOW;
    const evaluated = await runAuthoritativeMarginSequence({
      fetchExpectedMargin: async () => {
        order.push("expected");
        clock += 20_000;
        return expectedOk;
      },
      fetchAuthoritativeSnapshot: async () => {
        order.push("snapshot");
        return snap(clock);
      },
      nowMs: NOW + 20_000 + 10
    });
    expect(order).toEqual(["expected", "snapshot"]);
    expect(evaluated.ok).toBe(true);
    if (evaluated.ok) {
      expect(evaluated.marginAgeMs).toBeLessThanOrEqual(MARGIN_SNAPSHOT_MAX_AGE_MS);
    }
  });

  it("2. final authoritative snapshot genuinely older than max → MARGIN_SNAPSHOT_STALE", async () => {
    const gate = await runAuthoritativeMarginSequence({
      fetchExpectedMargin: async () => expectedOk,
      fetchAuthoritativeSnapshot: async () => snap(NOW),
      nowMs: NOW + MARGIN_SNAPSHOT_MAX_AGE_MS + 1
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe("MARGIN_SNAPSHOT_STALE");
  });

  it("3. margin snapshot missing → MARGIN_UNAVAILABLE", async () => {
    const gate = await runAuthoritativeMarginSequence({
      fetchExpectedMargin: async () => expectedOk,
      fetchAuthoritativeSnapshot: async () => ({
        ok: false,
        notes: ["missing"]
      }),
      nowMs: NOW
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe("MARGIN_UNAVAILABLE");
  });

  it("4. expected margin missing → EXPECTED_MARGIN_UNAVAILABLE", async () => {
    const gate = await runAuthoritativeMarginSequence({
      fetchExpectedMargin: async () => ({ ok: false, notes: ["no expected"] }),
      fetchAuthoritativeSnapshot: async () => snap(NOW),
      nowMs: NOW + 5
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe("EXPECTED_MARGIN_UNAVAILABLE");
  });

  it("5. insufficient free margin → RISK_SIZE_EXCEEDS_MARGIN", async () => {
    const computed = computeAuthoritativeMarginSnapshot({
      balance: 100,
      moneyDigits: 2,
      leverage: 30,
      openPositionCount: 0,
      reconcileOk: true,
      positionsUsedMargin: [],
      unrealisedRows: null,
      capturedAt: new Date(NOW).toISOString()
    });
    if (!computed.ok) throw new Error("snap");
    const gate = await runAuthoritativeMarginSequence({
      fetchExpectedMargin: async () => ({
        ...expectedOk,
        expectedMargin: 5_000
      }),
      fetchAuthoritativeSnapshot: async () => ({
        ok: true,
        snapshot: computed.snapshot
      }),
      nowMs: NOW + 5
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe("RISK_SIZE_EXCEEDS_MARGIN");
  });

  it("6. Live account → blocked", async () => {
    const gate = await runAuthoritativeMarginSequence({
      fetchExpectedMargin: async () => expectedOk,
      fetchAuthoritativeSnapshot: async () => snap(NOW),
      nowMs: NOW,
      selectedAccountIsLive: true
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe("LIVE_ACCOUNT_FORBIDDEN");
  });
});
