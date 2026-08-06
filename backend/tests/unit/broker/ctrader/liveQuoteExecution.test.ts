import { describe, expect, it } from "vitest";
import { buildTradePreview } from "../../../../src/services/broker/ctrader/preview";
import { fixtureXauUsdSymbol } from "../../../../src/services/broker/ctrader/fixtures";
import { executableEntryPrice } from "../../../../src/services/broker/ctrader/liveQuote";

describe("live quote execution gates", () => {
  const symbol = fixtureXauUsdSymbol();

  it("BUY validation uses ask; SELL validation uses bid", () => {
    const quote = {
      symbolId: symbol.symbolId,
      symbolName: "XAUUSD",
      bid: 4264.66,
      ask: 4265.43,
      spread: 0.77,
      timestamp: new Date().toISOString(),
      marketStatus: "OPEN" as const,
      stale: false,
      source: "LIVE" as const
    };
    expect(executableEntryPrice("BUY", quote)).toBe(4265.43);
    expect(executableEntryPrice("SELL", quote)).toBe(4264.66);

    const buy = buildTradePreview({
      decisionId: "d1",
      decision: "BUY",
      confidence: 90,
      generatedAt: new Date().toISOString(),
      candleConfirmed: true,
      stopLoss: 4250,
      takeProfits: [4280],
      symbol,
      quote,
      position: null,
      pendingOrdersCount: 0,
      equity: 10_000,
      freeMargin: 9_000,
      accountCurrency: "EUR",
      riskAmountEur: 20,
      maxSpread: 2
    });
    expect(buy.intendedEntry).toBe(4265.43);

    const sell = buildTradePreview({
      decisionId: "d2",
      decision: "SELL",
      confidence: 90,
      generatedAt: new Date().toISOString(),
      candleConfirmed: true,
      stopLoss: 4280,
      takeProfits: [4250],
      symbol,
      quote,
      position: null,
      pendingOrdersCount: 0,
      equity: 10_000,
      freeMargin: 9_000,
      accountCurrency: "EUR",
      riskAmountEur: 20,
      maxSpread: 2
    });
    expect(sell.intendedEntry).toBe(4264.66);
  });

  it("stale / delayed quote blocks live order execution", () => {
    const preview = buildTradePreview({
      decisionId: "d3",
      decision: "BUY",
      confidence: 90,
      generatedAt: new Date().toISOString(),
      candleConfirmed: true,
      stopLoss: 4250,
      takeProfits: [4280],
      symbol,
      quote: {
        symbolId: symbol.symbolId,
        symbolName: "XAUUSD",
        bid: 4264.66,
        ask: 4265.43,
        spread: 0.77,
        timestamp: new Date(Date.now() - 60_000).toISOString(),
        marketStatus: "OPEN",
        stale: true,
        source: "LIVE"
      },
      position: null,
      pendingOrdersCount: 0,
      equity: 10_000,
      freeMargin: 9_000,
      accountCurrency: "EUR",
      riskAmountEur: 20,
      maxSpread: 2
    });
    expect(preview.failedGates).toContain("QUOTE_NOT_LIVE");
  });

  it("market-closed state blocks execution", () => {
    const preview = buildTradePreview({
      decisionId: "d4",
      decision: "BUY",
      confidence: 90,
      generatedAt: new Date().toISOString(),
      candleConfirmed: true,
      stopLoss: 4250,
      takeProfits: [4280],
      symbol,
      quote: {
        symbolId: symbol.symbolId,
        symbolName: "XAUUSD",
        bid: 4264.66,
        ask: 4265.43,
        spread: 0.77,
        timestamp: new Date().toISOString(),
        marketStatus: "CLOSED",
        stale: false,
        source: "LIVE"
      },
      position: null,
      pendingOrdersCount: 0,
      equity: 10_000,
      freeMargin: 9_000,
      accountCurrency: "EUR",
      riskAmountEur: 20,
      maxSpread: 2
    });
    expect(preview.failedGates).toContain("MARKET_CLOSED");
  });

  it("WAIT decision does not require a blocked quote path for display independence", () => {
    const preview = buildTradePreview({
      decisionId: "d5",
      decision: "WAIT",
      confidence: 40,
      generatedAt: new Date().toISOString(),
      candleConfirmed: false,
      stopLoss: null,
      takeProfits: [],
      symbol,
      quote: {
        symbolId: symbol.symbolId,
        symbolName: "XAUUSD",
        bid: 4264.66,
        ask: 4265.43,
        spread: 0.77,
        timestamp: new Date().toISOString(),
        marketStatus: "OPEN",
        stale: false,
        source: "LIVE"
      },
      position: null,
      pendingOrdersCount: 0,
      equity: 10_000,
      freeMargin: 9_000,
      accountCurrency: "EUR",
      riskAmountEur: 20,
      maxSpread: 2
    });
    expect(preview.passedGates).toContain("WAIT_NO_ORDER");
    expect(preview.passedGates).toContain("MARKET_OPEN");
  });
});
