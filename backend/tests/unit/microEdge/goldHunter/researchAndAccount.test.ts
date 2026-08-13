import { describe, expect, it } from "vitest";
import {
  runGoldHunterResearchPipeline,
  synthesizeResearchTicks
} from "../../../../src/services/microEdge/goldHunter/researchPipeline";
import { FakeMicroCTraderTransport } from "../../../../src/services/microEdge/marketData/microCTraderTransport";
import { fetchMicroTraderAccountSummary } from "../../../../src/services/microEdge/goldHunter/accountTraderRead";
import { MICRO_ALLOWED_READ_COMMANDS } from "../../../../src/services/microEdge/marketData/microCTraderProtocol";
import { finalizeDataQualityReport, emptyTickAudit } from "../../../../src/services/microEdge/goldHunter/dataQuality";
import { rowsToNdjson, ndjsonGzToRows } from "../../../../src/services/microEdge/goldHunter/compactStorage";

describe("GOLD_HUNTER research pipeline", () => {
  it("runs train/val/holdout freeze without broker orders", async () => {
    const ticks = synthesizeResearchTicks({
      fromMs: Date.UTC(2026, 7, 11, 7, 0, 0),
      seconds: 60 * 45,
      seed: 99
    });
    const result = await runGoldHunterResearchPipeline({ ticks, persist: false });
    expect(result.bidTicks).toBeGreaterThan(0);
    expect(result.askTicks).toBeGreaterThan(0);
    expect(result.trainCount + result.validationCount + result.holdoutCount).toBeGreaterThan(0);
    expect(result.artifact.brokerExecutionEnabled ?? false).toBeFalsy();
    expect(["HOLDOUT_POSITIVE", "HOLDOUT_NEGATIVE", "INSUFFICIENT_DATA", "TRAINED_RESEARCH"]).toContain(
      result.artifact.qualificationStatus
    );
    // baselines present
    expect(result.baselines.always_wait.tradeCount).toBe(0);
  }, 120_000);

  it("fails closed on high invalid price rate", () => {
    const bid = emptyTickAudit("BID");
    bid.totalWireTicks = 1000;
    bid.invalidPriceTicks = 20;
    bid.validTicks = 980;
    const ask = emptyTickAudit("ASK");
    ask.totalWireTicks = 1000;
    ask.validTicks = 1000;
    const r = finalizeDataQualityReport(bid, ask, 0.005);
    expect(r.datasetStatus).toBe("DATA_QUALITY_FAILED");
    expect(r.invalidPriceRate).toBeGreaterThan(0.005);
  });
});

describe("account trader read-only", () => {
  it("allowlists ProtoOATraderReq and returns balance without account id", async () => {
    expect(MICRO_ALLOWED_READ_COMMANDS.has("ProtoOATraderReq")).toBe(true);
    const summary = await fetchMicroTraderAccountSummary(
      {
        mutationSurface: "NONE",
        connect: async () => undefined,
        disconnect: async () => undefined,
        isConnected: () => true,
        isApplicationAuthenticated: () => true,
        isAccountAuthenticated: () => true,
        getAccountAuthMeta: () => null,
        sendReadCommand: async (command: string) => {
          expect(command).toBe("ProtoOATraderReq");
          return {
            trader: { balance: 50_000_00, moneyDigits: 2, depositCurrency: "EUR" }
          };
        },
        on: () => undefined,
        off: () => undefined,
        getTrendbars: async () => ({}),
        subscribeSpots: async () => undefined,
        listSymbols: async () => [],
        getTickData: async () => ({}),
        getSubscribeSpotsCallCount: () => 0
      },
      "999999"
    );
    expect(summary?.balance).toBe(50000);
    expect(summary?.depositCurrency).toBe("EUR");
    expect(summary?.accountIdExposed).toBe(false);

    // Fake transport also answers TraderReq
    const fake = new FakeMicroCTraderTransport();
    await fake.connect();
    const raw = (await fake.sendReadCommand("ProtoOATraderReq", {
      ctidTraderAccountId: 123
    })) as { trader?: { depositCurrency?: string } };
    expect(raw.trader?.depositCurrency).toBe("EUR");
  });
});

describe("compact storage", () => {
  it("round-trips ndjson.gz chunks", () => {
    const rows = [
      { timestampMs: 1, bid: 1, ask: 1.1 },
      { timestampMs: 2, bid: 1.01, ask: 1.11 }
    ];
    const buf = rowsToNdjson(rows);
    const back = ndjsonGzToRows<typeof rows[0]>(buf);
    expect(back).toEqual(rows);
  });
});
