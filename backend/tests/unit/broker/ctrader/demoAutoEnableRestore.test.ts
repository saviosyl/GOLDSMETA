/**
 * Demo Auto restore — Demo paper submission may enable; Live stays locked.
 * RR gate must accept standard GoldMeta TP1=1R / TP2=2R plans when min RR is 1.5.
 */
import { afterEach, describe, expect, it } from "vitest";
import { evaluateQualificationCandidate } from "../../../../src/services/broker/ctrader/qualificationEvaluator";
import {
  isCTraderDemoOrderSubmissionEnabled,
  isCTraderLiveEnabled,
  snapshotCTraderFlags
} from "../../../../src/services/broker/ctrader/flags";

describe("demo Auto enable restore", () => {
  const prev = process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;

  afterEach(() => {
    if (prev === undefined) delete process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
    else process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = prev;
  });

  it("keeps Live hard-locked while Demo submission can be enabled", () => {
    process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = "true";
    expect(isCTraderDemoOrderSubmissionEnabled()).toBe(true);
    expect(isCTraderLiveEnabled()).toBe(false);
    const snap = snapshotCTraderFlags();
    expect(snap.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED).toBe(true);
    expect(snap.CTRADER_LIVE_ENABLED).toBe(false);
    expect(snap.BROKER_EXECUTION_ENABLED).toBe(false);
  });

  it("rejects TP1-only 1R against minRiskReward 1.5 (legacy incorrect gate)", () => {
    const r = evaluateQualificationCandidate({
      direction: "BUY",
      signalId: "s1",
      entry: 4362.7,
      stopLoss: 4360.93,
      takeProfit: 4364.47, // TP1 ≈ 1R
      confidence: 83,
      minConfidence: 80,
      minRiskReward: 1.5,
      quoteBid: 4362,
      quoteAsk: 4363,
      quoteSpread: 1,
      quoteStale: false,
      marketStatus: "OPEN",
      maxSpread: 2,
      maxQuoteAgeSeconds: 15,
      quoteAgeSeconds: 1,
      alreadyCountedSignal: false
    });
    expect(r.failed).toContain("RR_TOO_LOW");
  });

  it("accepts standard GoldMeta plan when RR gate uses TP2 (~2R)", () => {
    const r = evaluateQualificationCandidate({
      direction: "BUY",
      signalId: "s2",
      entry: 4362.7,
      stopLoss: 4360.93,
      takeProfit: 4366.24, // TP2 ≈ 2R
      confidence: 83,
      minConfidence: 80,
      minRiskReward: 1.5,
      quoteBid: 4362,
      quoteAsk: 4363,
      quoteSpread: 1,
      quoteStale: false,
      marketStatus: "OPEN",
      maxSpread: 2,
      maxQuoteAgeSeconds: 15,
      quoteAgeSeconds: 1,
      alreadyCountedSignal: false
    });
    expect(r.ok).toBe(true);
    expect(r.failed).not.toContain("RR_TOO_LOW");
  });
});
