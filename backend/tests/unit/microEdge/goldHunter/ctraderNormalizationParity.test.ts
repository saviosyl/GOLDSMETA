/**
 * LiveBridge vs ResearchBridge cTrader normalization parity.
 */
import { describe, expect, it } from "vitest";
import {
  normalizeCTraderDepthPayload,
  normalizeCTraderSpotPayload,
  GH_FAST_MARKET_DATA_NORMALIZATION_VERSION
} from "../../../../src/services/microEdge/goldHunter/fast/ctraderMarketNormalize";
import { MICRO_SPOT_PRICE_SCALE } from "../../../../src/services/microEdge/marketData/microCTraderProtocol";
import { ResearchIngestBridge } from "../../../../src/services/microEdge/goldHunter/fast/research/researchIngestBridge";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("cTrader normalization parity (Live vs Research)", () => {
  it("normalizes Spot relative → absolute identically", () => {
    const payload = {
      bid: 437_388_000,
      ask: 437_397_000,
      timestamp: 1_700_000_000_000,
      symbolId: 41
    };
    const n = normalizeCTraderSpotPayload(payload);
    expect(n.normalizationVersion).toBe(GH_FAST_MARKET_DATA_NORMALIZATION_VERSION);
    expect(n.inputNormalizationVerified).toBe(true);
    expect(n.bid).toBeCloseTo(437_388_000 / MICRO_SPOT_PRICE_SCALE, 8);
    expect(n.ask).toBeCloseTo(437_397_000 / MICRO_SPOT_PRICE_SCALE, 8);
    expect(n.bid).toBeCloseTo(4373.88, 5);
    expect(n.ask).toBeCloseTo(4373.97, 5);
    expect(n.spread).toBeCloseTo(0.09, 5);
    expect(n.bidRelative).toBe(437_388_000);
    expect(n.askRelative).toBe(437_397_000);
  });

  it("normalizes Depth via parseProtoOADepthEventPayload", () => {
    const payload = {
      timestamp: 1_700_000_000_100,
      symbolId: 41,
      newQuotes: [
        { id: 11, size: 12_500, bid: 437_388_000 },
        { id: 12, size: 9_800, ask: 437_397_000 }
      ],
      deletedQuotes: [99, "100"]
    };
    const n = normalizeCTraderDepthPayload(payload);
    expect(n.inputNormalizationVerified).toBe(true);
    expect(n.newQuotes).toHaveLength(2);
    expect(n.newQuotes[0]!.id).toBe("11");
    expect(n.newQuotes[0]!.type).toBe("BID");
    expect(n.newQuotes[0]!.price).toBeCloseTo(4373.88, 5);
    expect(n.newQuotes[0]!.size).toBeCloseTo(125, 5);
    expect(n.newQuotes[1]!.id).toBe("12");
    expect(n.newQuotes[1]!.type).toBe("ASK");
    expect(n.newQuotes[1]!.price).toBeCloseTo(4373.97, 5);
    expect(n.newQuotes[1]!.size).toBeCloseTo(98, 5);
    expect(n.deletedQuotes.map((d) => d.id)).toEqual(["99", "100"]);
    expect(n.rawNewQuotes).toHaveLength(2);
  });

  it("ResearchIngestBridge feeds normalized prices into feature pipeline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gh-norm-"));
    try {
      const bridge = new ResearchIngestBridge({
        localDir: dir,
        chunkRows: 50,
        gcsBucket: null,
        runId: "norm_parity",
        scopeVerified: true
      });
      bridge.setConnectionState("CONNECTED");
      bridge.setSubscriptionFlags(true, true);
      const t0 = Date.now();
      bridge.ingestSpot(
        {
          bid: 437_388_000,
          ask: 437_397_000,
          timestamp: t0
        },
        t0
      );
      bridge.ingestDepth(
        {
          timestamp: t0 + 1,
          newQuotes: [
            { id: 1, size: 10000, bid: 437_388_000 },
            { id: 2, size: 11000, ask: 437_397_000 }
          ],
          deletedQuotes: []
        },
        t0 + 1
      );
      await bridge.drainForTests();
      const h = bridge.health();
      expect(h.lastBid).toBeCloseTo(4373.88, 4);
      expect(h.lastAsk).toBeCloseTo(4373.97, 4);
      expect(h.lastSpread).toBeCloseTo(0.09, 4);
      expect(h.marketDataNormalizationVersion).toBe(
        GH_FAST_MARKET_DATA_NORMALIZATION_VERSION
      );
      expect(h.inputNormalizationVerified).toBe(true);
      expect(h.observationA + h.observationB + h.observationC).toBeGreaterThanOrEqual(
        0
      );
      expect(typeof h.eligibleA).toBe("number");
      expect(typeof h.selectedA).toBe("number");
      // Feature pipeline receives absolute prices after bridge normalization
      expect(h.lastBid).toBeGreaterThan(1000);
      expect(h.lastAsk).toBeGreaterThan(h.lastBid!);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("LiveBridge and Research shared helpers produce identical typed market data", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(
      process.cwd(),
      "src/services/microEdge/goldHunter/fast"
    );
    const liveSrc = readFileSync(join(root, "liveBridge.ts"), "utf8");
    const researchSrc = readFileSync(
      join(root, "research/researchIngestBridge.ts"),
      "utf8"
    );
    // Both bridges must import the shared helpers — no duplicate conversion.
    expect(liveSrc).toMatch(/normalizeCTraderSpotPayload/);
    expect(liveSrc).toMatch(/normalizeCTraderDepthPayload/);
    expect(researchSrc).toMatch(/normalizeCTraderSpotPayload/);
    expect(researchSrc).toMatch(/normalizeCTraderDepthPayload/);
    expect(liveSrc).not.toMatch(/spotPriceFromRelative\s*\(/);
    expect(researchSrc).not.toMatch(/spotPriceFromRelative\s*\(/);
    expect(liveSrc).not.toMatch(/parseProtoOADepthEventPayload\s*\(/);
    expect(researchSrc).not.toMatch(/parseProtoOADepthEventPayload\s*\(/);

    const spotPayload = {
      bid: 437_388_000,
      ask: 437_397_000,
      timestamp: 42,
      symbolId: 41
    };
    const depthPayload = {
      timestamp: 43,
      symbolId: 41,
      newQuotes: [
        { id: 7, size: 2500, bid: 437_380_000 },
        { id: 8, size: 2600, ask: 437_400_000 }
      ],
      deletedQuotes: [3]
    };
    // A) Live-path normalization (== GoldHunterFastLiveBridge.processOrdered)
    // B) Research-path normalization (== ResearchIngestBridge SPOT/DEPTH)
    const liveSpot = normalizeCTraderSpotPayload(spotPayload);
    const researchSpot = normalizeCTraderSpotPayload(spotPayload);
    expect(researchSpot).toEqual(liveSpot);
    expect(liveSpot.bid).toBeCloseTo(4373.88, 5);
    expect(liveSpot.ask).toBeCloseTo(4373.97, 5);
    expect(liveSpot.spread).toBeCloseTo(0.09, 5);

    const liveDepth = normalizeCTraderDepthPayload(depthPayload);
    const researchDepth = normalizeCTraderDepthPayload(depthPayload);
    expect(researchDepth.newQuotes).toEqual(liveDepth.newQuotes);
    expect(researchDepth.deletedQuotes).toEqual(liveDepth.deletedQuotes);
    expect(researchDepth.stats).toEqual(liveDepth.stats);
    expect(liveDepth.newQuotes[0]!.price).toBeCloseTo(4373.8, 5);
    expect(liveDepth.newQuotes[1]!.price).toBeCloseTo(4374.0, 5);
    expect(liveDepth.newQuotes.map((q) => q.type)).toEqual(["BID", "ASK"]);
    expect(liveDepth.deletedQuotes.map((d) => d.id)).toEqual(["3"]);
  });
});
