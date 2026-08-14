/**
 * Ordered RESYNC_MARKER parity: ResearchIngestBridge backlog + corrected replay
 * clear feature/depth state at the SAME receiveSeq boundary.
 */
import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
  readFileSync
} from "node:fs";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGunzip, gzipSync } from "node:zlib";
import { ResearchIngestBridge } from "../../../../src/services/microEdge/goldHunter/fast/research/researchIngestBridge";
import { replayResearchCaptureNormalized } from "../../../../src/services/microEdge/goldHunter/fast/research/researchCorrectedReplay";
import {
  GH_FAST_RESEARCH_MODE,
  GH_FAST_RESEARCH_SCHEMA_VERSION
} from "../../../../src/services/microEdge/goldHunter/fast/research/researchTypes";

const rel = (px: number) => Math.round(px * 100_000);

async function readLocalCapture(dir: string): Promise<
  Array<{ receiveSeq: number; eventKind: string }>
> {
  const rows: Array<{ receiveSeq: number; eventKind: string }> = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    if (!existsSync(cur)) continue;
    for (const name of readdirSync(cur, { withFileTypes: true })) {
      const p = join(cur, name.name);
      if (name.isDirectory()) {
        stack.push(p);
      } else if (name.name.endsWith(".ndjson.gz")) {
        const stream = createReadStream(p).pipe(createGunzip());
        const rl = createInterface({ input: stream, crlfDelay: Infinity });
        for await (const line of rl) {
          if (!line.trim()) continue;
          const o = JSON.parse(line) as {
            receiveSeq: number;
            eventKind: string;
          };
          rows.push(o);
        }
      }
    }
  }
  return rows.sort((a, b) => a.receiveSeq - b.receiveSeq);
}

describe("ordered research resync parity", () => {
  it("clears pipeline only when RESYNC_MARKER is processed — not on noteResync enqueue (backlog case)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gh-resync-live-"));
    try {
      const bridge = new ResearchIngestBridge({
        localDir: dir,
        chunkRows: 200,
        gcsBucket: null,
        runId: "resync_live",
        scopeVerified: true
      });
      bridge.setConnectionState("CONNECTED");
      bridge.setSubscriptionFlags(true, true);

      const clearSpy = vi.spyOn(bridge.pipelineForTests(), "clearForResync");

      // Hold consumer so SPOT/DEPTH backlog exists before noteResync.
      bridge.closeOrderedProcessGateForTests();

      const t0 = 1_700_000_100_000;
      bridge.ingestSpot(
        { bid: rel(4373.88), ask: rel(4373.97), timestamp: t0 },
        t0
      ); // seq1
      bridge.ingestDepth(
        {
          timestamp: t0 + 1,
          newQuotes: [
            { id: 1, size: 10_000, bid: rel(4373.88) },
            { id: 2, size: 11_000, ask: rel(4373.97) }
          ],
          deletedQuotes: []
        },
        t0 + 1
      ); // seq2
      bridge.ingestSpot(
        { bid: rel(4373.9), ask: rel(4374.0), timestamp: t0 + 2 },
        t0 + 2
      ); // seq3 — remains queued behind held consumer

      // Allow a tick so pump starts and parks on the gate with backlog.
      await new Promise((r) => setTimeout(r, 5));
      expect(clearSpy).not.toHaveBeenCalled();

      bridge.noteResync("test_backlog_resync", t0 + 3); // seq4 — enqueue ONLY
      expect(clearSpy).not.toHaveBeenCalled();

      bridge.ingestSpot(
        { bid: rel(4375.0), ask: rel(4375.1), timestamp: t0 + 4 },
        t0 + 4
      ); // seq5
      bridge.ingestDepth(
        {
          timestamp: t0 + 5,
          newQuotes: [
            { id: 10, size: 5_000, bid: rel(4375.0) },
            { id: 11, size: 6_000, ask: rel(4375.1) }
          ],
          deletedQuotes: []
        },
        t0 + 5
      ); // seq6

      bridge.openOrderedProcessGateForTests();
      await bridge.drainForTests();

      expect(clearSpy).toHaveBeenCalledTimes(1);

      const rows = await readLocalCapture(dir);
      const marketKinds = rows
        .filter((r) =>
          r.eventKind === "SPOT" ||
          r.eventKind === "DEPTH" ||
          r.eventKind === "RESYNC_MARKER"
        )
        .map((r) => `${r.receiveSeq}:${r.eventKind}`);
      // Connection/subscription transitions may occupy early receiveSeqs.
      expect(marketKinds).toEqual([
        expect.stringMatching(/^\d+:SPOT$/),
        expect.stringMatching(/^\d+:DEPTH$/),
        expect.stringMatching(/^\d+:SPOT$/),
        expect.stringMatching(/^\d+:RESYNC_MARKER$/),
        expect.stringMatching(/^\d+:SPOT$/),
        expect.stringMatching(/^\d+:DEPTH$/)
      ]);
      const resyncIdx = marketKinds.findIndex((k) => k.endsWith(":RESYNC_MARKER"));
      expect(resyncIdx).toBe(3);
      const resyncSeq = Number(marketKinds[resyncIdx]!.split(":")[0]);
      const pre = rows.filter(
        (r) =>
          r.receiveSeq < resyncSeq &&
          (r.eventKind === "SPOT" || r.eventKind === "DEPTH")
      );
      const post = rows.filter(
        (r) =>
          r.receiveSeq > resyncSeq &&
          (r.eventKind === "SPOT" || r.eventKind === "DEPTH")
      );
      expect(pre).toHaveLength(3);
      expect(post).toHaveLength(2);

      // Post-resync strip is from SPOT seq5 (normalized).
      const h = bridge.health();
      expect(h.lastBid).toBeCloseTo(4375.0, 4);
      expect(h.lastAsk).toBeCloseTo(4375.1, 4);
      expect(h.lastSpread).toBeCloseTo(0.1, 4);
      expect(h.resyncCount).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("corrected replay clears at the same RESYNC receiveSeq as live bridge", async () => {
    const root = await mkdtemp(join(tmpdir(), "gh-resync-replay-"));
    try {
      const day = join(root, "2026-08-14");
      mkdirSync(day, { recursive: true });
      const safety = {
        brokerRequests: 0,
        brokerOrders: 0,
        shadowOrders: 0,
        openShadowTrade: false,
        executionAdapter: "NONE",
        mutationSurface: "NONE",
        permissionScope: "SCOPE_VIEW"
      };
      const rows = [
        {
          schemaVersion: GH_FAST_RESEARCH_SCHEMA_VERSION,
          mode: GH_FAST_RESEARCH_MODE,
          t: 1000,
          runId: "resync_parity",
          datasetId: "ds",
          receiveSeq: 1,
          eventKind: "SPOT",
          market: {
            kind: "SPOT",
            bid: rel(4373.88),
            ask: rel(4373.97),
            spread: 9000
          },
          specialists: null,
          features: null,
          safety
        },
        {
          schemaVersion: GH_FAST_RESEARCH_SCHEMA_VERSION,
          mode: GH_FAST_RESEARCH_MODE,
          t: 1001,
          runId: "resync_parity",
          datasetId: "ds",
          receiveSeq: 2,
          eventKind: "DEPTH",
          market: {
            kind: "DEPTH",
            newQuotes: [
              { id: 1, size: 10_000, bid: rel(4373.88) },
              { id: 2, size: 11_000, ask: rel(4373.97) }
            ],
            deletedQuotes: []
          },
          specialists: null,
          features: null,
          safety
        },
        {
          schemaVersion: GH_FAST_RESEARCH_SCHEMA_VERSION,
          mode: GH_FAST_RESEARCH_MODE,
          t: 1002,
          runId: "resync_parity",
          datasetId: "ds",
          receiveSeq: 3,
          eventKind: "SPOT",
          market: {
            kind: "SPOT",
            bid: rel(4373.9),
            ask: rel(4374.0),
            spread: 10000
          },
          specialists: null,
          features: null,
          safety
        },
        {
          schemaVersion: GH_FAST_RESEARCH_SCHEMA_VERSION,
          mode: GH_FAST_RESEARCH_MODE,
          t: 1003,
          runId: "resync_parity",
          datasetId: "ds",
          receiveSeq: 4,
          eventKind: "RESYNC_MARKER",
          market: { kind: "RESYNC_MARKER", reason: "test" },
          specialists: null,
          features: null,
          safety
        },
        {
          schemaVersion: GH_FAST_RESEARCH_SCHEMA_VERSION,
          mode: GH_FAST_RESEARCH_MODE,
          t: 1004,
          runId: "resync_parity",
          datasetId: "ds",
          receiveSeq: 5,
          eventKind: "SPOT",
          market: {
            kind: "SPOT",
            bid: rel(4375.0),
            ask: rel(4375.1),
            spread: 10000
          },
          specialists: null,
          features: null,
          safety
        },
        {
          schemaVersion: GH_FAST_RESEARCH_SCHEMA_VERSION,
          mode: GH_FAST_RESEARCH_MODE,
          t: 1005,
          runId: "resync_parity",
          datasetId: "ds",
          receiveSeq: 6,
          eventKind: "DEPTH",
          market: {
            kind: "DEPTH",
            newQuotes: [
              { id: 10, size: 5_000, bid: rel(4375.0) },
              { id: 11, size: 6_000, ask: rel(4375.1) }
            ],
            deletedQuotes: []
          },
          specialists: null,
          features: null,
          safety
        },
        {
          schemaVersion: GH_FAST_RESEARCH_SCHEMA_VERSION,
          mode: GH_FAST_RESEARCH_MODE,
          t: 1006,
          runId: "resync_parity",
          datasetId: "ds",
          receiveSeq: 7,
          eventKind: "SESSION_TRANSITION",
          market: {
            kind: "SESSION_TRANSITION",
            fromState: "CONNECTED",
            toState: "RECONNECTING",
            reason: "test"
          },
          specialists: null,
          features: null,
          safety
        }
      ];
      writeFileSync(
        join(day, "chunk-00000.ndjson.gz"),
        gzipSync(Buffer.from(rows.map((r) => JSON.stringify(r)).join("\n") + "\n"))
      );

      const outDir = join(root, "out");
      const result = await replayResearchCaptureNormalized({
        inputDir: root,
        outDir
      });
      expect(result.runId).toBe("resync_parity");
      expect(result.normalizedSpot).toBe(3);
      expect(result.normalizedDepth).toBe(2);
      expect(result.resyncMarkersProcessed).toBe(1);
      expect(result.sessionTransitionsSkipped).toBe(1);

      const events = readFileSync(
        join(outDir, "CORRECTED_REPLAY_EVENTS.ndjson"),
        "utf8"
      )
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as { receiveSeq: number; eventKind: string; cleared?: boolean });
      const resync = events.find((e) => e.eventKind === "RESYNC_MARKER");
      expect(resync?.receiveSeq).toBe(4);
      expect(resync?.cleared).toBe(true);
      expect(events.map((e) => `${e.receiveSeq}:${e.eventKind}`)).toEqual([
        "1:SPOT",
        "2:DEPTH",
        "3:SPOT",
        "4:RESYNC_MARKER",
        "5:SPOT",
        "6:DEPTH",
        "7:SESSION_TRANSITION"
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
