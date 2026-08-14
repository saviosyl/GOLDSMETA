/**
 * Offline corrected replay unit test — never mutates original capture files.
 */
import { replayResearchCaptureNormalized } from "../../../../src/services/microEdge/goldHunter/fast/research/researchCorrectedReplay";
import { GH_FAST_MARKET_DATA_NORMALIZATION_VERSION } from "../../../../src/services/microEdge/goldHunter/fast/ctraderMarketNormalize";
import { GH_FAST_RESEARCH_MODE, GH_FAST_RESEARCH_SCHEMA_VERSION } from "../../../../src/services/microEdge/goldHunter/fast/research/researchTypes";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

describe("research corrected offline replay", () => {
  it("rebuilds features from raw relative Day-1-style rows without overwrite", async () => {
    const root = await mkdtemp(join(tmpdir(), "gh-replay-"));
    const day = join(root, "2026-08-14");
    mkdirSync(day, { recursive: true });
    const rawRows = [
      {
        schemaVersion: GH_FAST_RESEARCH_SCHEMA_VERSION,
        mode: GH_FAST_RESEARCH_MODE,
        t: Date.parse("2026-08-14T12:00:00.000Z"),
        runId: "day1",
        datasetId: "ds",
        receiveSeq: 1,
        eventKind: "SPOT",
        market: {
          kind: "SPOT",
          // Pre-fix capture stored relative ints in bid/ask
          bid: 437_388_000,
          ask: 437_397_000,
          spread: 9000,
          brokerTimestampMs: null
        },
        specialists: [
          {
            setup: "A_MOMENTUM_IGNITION",
            eligible: false,
            selectedCandidate: false,
            rawQuality: 0.1
          }
        ],
        features: null,
        safety: {
          brokerRequests: 0,
          brokerOrders: 0,
          shadowOrders: 0,
          openShadowTrade: false,
          executionAdapter: "NONE",
          mutationSurface: "NONE",
          permissionScope: "SCOPE_VIEW"
        }
      },
      {
        schemaVersion: GH_FAST_RESEARCH_SCHEMA_VERSION,
        mode: GH_FAST_RESEARCH_MODE,
        t: Date.parse("2026-08-14T12:00:00.050Z"),
        runId: "day1",
        datasetId: "ds",
        receiveSeq: 2,
        eventKind: "DEPTH",
        market: {
          kind: "DEPTH",
          newQuotes: [
            { id: 1, size: 10000, bid: 437_388_000 },
            { id: 2, size: 11000, ask: 437_397_000 }
          ],
          deletedQuotes: [],
          bestBid: 437_388_000,
          bestAsk: 437_397_000,
          depthAvailable: true,
          crossed: false,
          bookGeneration: 1,
          brokerTimestampMs: null
        },
        specialists: null,
        features: null,
        safety: {
          brokerRequests: 0,
          brokerOrders: 0,
          shadowOrders: 0,
          openShadowTrade: false,
          executionAdapter: "NONE",
          mutationSurface: "NONE",
          permissionScope: "SCOPE_VIEW"
        }
      }
    ];
    const originalPath = join(day, "chunk-00000.ndjson.gz");
    writeFileSync(
      originalPath,
      gzipSync(Buffer.from(rawRows.map((r) => JSON.stringify(r)).join("\n") + "\n"))
    );
    const originalBytes = readFileSync(originalPath);

    const outDir = join(root, "replay-out");
    const result = await replayResearchCaptureNormalized({
      inputDir: root,
      outDir
    });

    expect(result.rawRows).toBe(2);
    expect(result.normalizedSpot).toBe(1);
    expect(result.normalizedDepth).toBe(1);
    expect(result.resyncMarkersProcessed).toBe(0);
    expect(result.before.A).toBe(1);
    expect(existsSync(join(outDir, "CORRECTED_REPLAY_SUMMARY.json"))).toBe(true);
    const summary = JSON.parse(
      readFileSync(join(outDir, "CORRECTED_REPLAY_SUMMARY.json"), "utf8")
    );
    expect(summary.marketDataNormalizationVersion).toBe(
      GH_FAST_MARKET_DATA_NORMALIZATION_VERSION
    );
    expect(summary.note).toMatch(/NOT modified/);
    // Original capture untouched
    expect(Buffer.compare(readFileSync(originalPath), originalBytes)).toBe(0);
    await rm(root, { recursive: true, force: true });
  });
});
