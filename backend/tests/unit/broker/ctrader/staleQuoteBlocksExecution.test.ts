import { describe, expect, it } from "vitest";
import { evaluateQualificationCandidate } from "../../../../src/services/broker/ctrader/qualificationEvaluator";
import { isCTraderLiveEnabled } from "../../../../src/services/broker/ctrader/flags";

describe("E: stale quote blocks AutoTrade execution", () => {
  it("quote age above maxQuoteAgeSeconds=15 fails QUOTE_AGE gate", () => {
    const result = evaluateQualificationCandidate({
      direction: "BUY",
      signalId: "sig_stale_test",
      entry: 4350,
      stopLoss: 4340,
      takeProfit: 4370,
      confidence: 90,
      minConfidence: 80,
      minRiskReward: 1.5,
      quoteBid: 4356.75,
      quoteAsk: 4356.85,
      quoteSpread: 0.1,
      quoteStale: false,
      marketStatus: "OPEN",
      maxSpread: 2,
      maxQuoteAgeSeconds: 15,
      quoteAgeSeconds: 180,
      alreadyCountedSignal: false
    });
    expect(result.ok).toBe(false);
    expect(result.failed).toContain("QUOTE_AGE");
  });

  it("quoteStale flag fails QUOTE_STALE gate", () => {
    const result = evaluateQualificationCandidate({
      direction: "SELL",
      signalId: "sig_stale_flag",
      entry: 4350,
      stopLoss: 4360,
      takeProfit: 4330,
      confidence: 90,
      minConfidence: 80,
      quoteBid: 4356.75,
      quoteAsk: 4356.85,
      quoteSpread: 0.1,
      quoteStale: true,
      marketStatus: "OPEN",
      maxSpread: 2,
      maxQuoteAgeSeconds: 15,
      quoteAgeSeconds: 2,
      alreadyCountedSignal: false
    });
    expect(result.ok).toBe(false);
    expect(result.failed).toContain("QUOTE_STALE");
  });

  it("G: Live remains locked", () => {
    expect(isCTraderLiveEnabled()).toBe(false);
  });
});
