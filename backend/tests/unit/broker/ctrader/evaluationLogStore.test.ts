import { beforeEach, describe, expect, it, vi } from "vitest";

const setMock = vi.fn(async () => undefined);
const docMock = vi.fn(() => ({ set: setMock }));
const collectionMock = vi.fn(() => ({ doc: docMock }));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: collectionMock
  }),
  FieldValue: { serverTimestamp: () => "ts" }
}));

import {
  appendEvaluation,
  fastWaitDedupeKey,
  isDuplicateFastWaitEval,
  omitUndefinedDeep
} from "../../../../src/services/broker/ctrader/evaluationLogStore";

describe("omitUndefinedDeep", () => {
  it("strips undefined so Firestore set payloads stay valid", () => {
    const sanitized = omitUndefinedDeep({
      pipeline: undefined,
      overnightRunId: null,
      fastTelemetry: {
        setupType: null,
        trigger: "BULLISH_BREAKOUT",
        nested: { skip: undefined, keep: 1 }
      }
    });
    expect(sanitized).toEqual({
      overnightRunId: null,
      fastTelemetry: {
        setupType: null,
        trigger: "BULLISH_BREAKOUT",
        nested: { keep: 1 }
      }
    });
    expect(JSON.stringify(sanitized).includes("undefined")).toBe(false);
  });
});

describe("FAST wait dedupe", () => {
  it("treats same decision + candle + wait reason as a duplicate", () => {
    const recent = [
      {
        decisionId: "dec_1",
        reasonCode: "WAIT_EXTENDED",
        fastTelemetry: { candleKey: "1:3388:3391:3388:3391" }
      }
    ];
    expect(
      isDuplicateFastWaitEval(recent, {
        decisionId: "dec_1",
        reasonCode: "WAIT_EXTENDED",
        candleKey: "1:3388:3391:3388:3391"
      })
    ).toBe(true);
  });

  it("allows a new candle or a new wait reason", () => {
    const recent = [
      {
        decisionId: "dec_1",
        reasonCode: "WAIT_EXTENDED",
        fastTelemetry: { candleKey: "1:a" }
      }
    ];
    expect(
      isDuplicateFastWaitEval(recent, {
        decisionId: "dec_1",
        reasonCode: "WAIT_EXTENDED",
        candleKey: "1:b"
      })
    ).toBe(false);
    expect(
      isDuplicateFastWaitEval(recent, {
        decisionId: "dec_1",
        reasonCode: "WAIT_NO_TRADE_SPACE",
        candleKey: "1:a"
      })
    ).toBe(false);
    expect(fastWaitDedupeKey({ decisionId: "dec_1", reasonCode: "WAIT_EXTENDED", candleKey: "1:a" })).toBe(
      "dec_1|WAIT_EXTENDED|1:a"
    );
  });

  it("does not treat non-FAST rows as duplicates", () => {
    expect(
      isDuplicateFastWaitEval(
        [{ decisionId: "dec_1", reasonCode: "WAIT_HOLD", fastTelemetry: null }],
        { decisionId: "dec_1", reasonCode: "WAIT_HOLD", candleKey: null }
      )
    ).toBe(false);
  });
});

describe("appendEvaluation FAST telemetry persistence", () => {
  beforeEach(() => {
    setMock.mockClear();
    docMock.mockClear();
    collectionMock.mockClear();
  });

  it("writes a sanitized FAST wait row with required diagnostic fields", async () => {
    const row = await appendEvaluation({
      uid: "uid-fast",
      accountMasked: "48…10",
      at: "2026-08-14T11:40:00.000Z",
      tradingDay: "2026-08-14",
      stage: "LIVE_QUALIFICATION",
      direction: "BUY",
      signalId: "dec_ctx",
      decisionId: "dec_ctx",
      confidence: 72,
      entry: null,
      stopLoss: null,
      takeProfit: null,
      riskReward: null,
      spread: 0.09,
      maxSpread: 2,
      outcome: "REJECTED",
      reasonCode: "WAIT_EXTENDED",
      passed: ["bullish directional bias"],
      failed: ["WAIT_EXTENDED"],
      pipeline: undefined,
      fastTelemetry: {
        strategyId: "FAST_AUTOTRADE_V1",
        regime: "FAST",
        bias: "BULLISH",
        setupType: "BREAKOUT",
        trigger: "BULLISH_BREAKOUT",
        qualityScore: 72,
        grade: "B+",
        m1Availability: "OK",
        m1CompletedAtMs: Date.parse("2026-08-14T11:39:00.000Z"),
        m1AgeMs: 60_000,
        tradeSpaceOk: true,
        extended: true,
        waitReason: "WAIT_EXTENDED",
        spread: 0.09,
        quoteAgeSeconds: 0.4,
        candleKey: "1:3358:3363:3357:3362"
      }
    });

    expect(collectionMock).toHaveBeenCalledWith("users/uid-fast/autotradeEvaluationLog");
    expect(setMock).toHaveBeenCalledTimes(1);
    const written = setMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(written).not.toHaveProperty("pipeline", undefined);
    expect(written.pipeline).toBeNull();
    expect(written.fastTelemetry).toMatchObject({
      strategyId: "FAST_AUTOTRADE_V1",
      regime: "FAST",
      bias: "BULLISH",
      setupType: "BREAKOUT",
      trigger: "BULLISH_BREAKOUT",
      qualityScore: 72,
      grade: "B+",
      m1Availability: "OK",
      tradeSpaceOk: true,
      extended: true,
      waitReason: "WAIT_EXTENDED",
      spread: 0.09,
      quoteAgeSeconds: 0.4
    });
    expect(row.reasonCode).toBe("WAIT_EXTENDED");
    expect(JSON.stringify(written).includes("undefined")).toBe(false);
  });
});
