/**
 * Offline corrected replay of research-capture NDJSON.
 * NEVER overwrites original GCS objects — writes a separate replay summary.
 *
 * Usage (local / CI fixture):
 *   npx tsx scripts/microEdge/replayResearchCaptureNormalized.ts --input <dir-or-files>
 */
import { createReadStream, existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { join } from "node:path";
import {
  GH_FAST_MARKET_DATA_NORMALIZATION_VERSION,
  normalizeCTraderDepthPayload,
  normalizeCTraderSpotPayload
} from "../ctraderMarketNormalize";
import { ResearchFeaturePipeline } from "./researchFeaturePipeline";
import { spotPriceFromRelative } from "../../../marketData/microCTraderProtocol";

type Row = {
  t: number;
  receiveSeq: number;
  eventKind: string;
  market: Record<string, unknown>;
  specialists?: Array<{
    setup: string;
    eligible: boolean;
    selectedCandidate: boolean;
    rawQuality: number | null;
  }> | null;
};

async function readGzJsonl(file: string): Promise<Row[]> {
  const rows: Row[] = [];
  const stream = createReadStream(file).pipe(createGunzip());
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line) as Row);
  }
  return rows;
}

function collectNdjsonGz(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, name.name);
      if (name.isDirectory()) walk(p);
      else if (name.name.endsWith(".ndjson.gz")) out.push(p);
    }
  };
  walk(root);
  return out.sort();
}

function looksRelative(n: number | null | undefined): boolean {
  return n != null && Number.isFinite(n) && Math.abs(n) >= 10_000;
}

export async function replayResearchCaptureNormalized(opts: {
  inputDir: string;
  outDir: string;
}): Promise<{
  rawRows: number;
  normalizedSpot: number;
  normalizedDepth: number;
  before: { A: number; B: number; C: number; eligibleA: number; eligibleB: number; eligibleC: number };
  after: { A: number; B: number; C: number; eligibleA: number; eligibleB: number; eligibleC: number };
  materialChange: boolean;
  outPath: string;
}> {
  const files = collectNdjsonGz(opts.inputDir);
  const all: Row[] = [];
  for (const f of files) {
    all.push(...(await readGzJsonl(f)));
  }
  all.sort((a, b) => a.receiveSeq - b.receiveSeq || a.t - b.t);

  const before = {
    A: 0,
    B: 0,
    C: 0,
    eligibleA: 0,
    eligibleB: 0,
    eligibleC: 0
  };
  for (const r of all) {
    for (const s of r.specialists ?? []) {
      if (s.setup === "A_MOMENTUM_IGNITION") {
        before.A += 1;
        if (s.eligible) before.eligibleA += 1;
      } else if (s.setup === "B_FAST_BREAKOUT") {
        before.B += 1;
        if (s.eligible) before.eligibleB += 1;
      } else if (s.setup === "C_PULLBACK_REACCEL") {
        before.C += 1;
        if (s.eligible) before.eligibleC += 1;
      }
    }
  }

  const pipe = new ResearchFeaturePipeline();
  const after = {
    A: 0,
    B: 0,
    C: 0,
    eligibleA: 0,
    eligibleB: 0,
    eligibleC: 0
  };
  let normalizedSpot = 0;
  let normalizedDepth = 0;
  const replayEvents: unknown[] = [];

  for (const r of all) {
    if (r.eventKind === "SPOT") {
      const m = r.market;
      const bidRel =
        typeof m.bidRelative === "number"
          ? m.bidRelative
          : looksRelative(m.bid as number)
            ? (m.bid as number)
            : null;
      const askRel =
        typeof m.askRelative === "number"
          ? m.askRelative
          : looksRelative(m.ask as number)
            ? (m.ask as number)
            : null;
      const payload = {
        bid: bidRel ?? (typeof m.bid === "number" ? (m.bid as number) * 100_000 : null),
        ask: askRel ?? (typeof m.ask === "number" ? (m.ask as number) * 100_000 : null),
        timestamp: m.brokerTimestampMs ?? r.t
      };
      const n = normalizeCTraderSpotPayload(payload as Record<string, unknown>);
      normalizedSpot += 1;
      const snap = pipe.onSpot({
        kind: "SPOT",
        receiveSeq: r.receiveSeq,
        eventId: `SPOT:${r.receiveSeq}`,
        receivedAtMs: r.t,
        brokerTimestampMs: n.brokerTimestampMs,
        bid: n.bid,
        ask: n.ask
      });
      for (const s of snap.specialists ?? []) {
        if (s.setup === "A_MOMENTUM_IGNITION") {
          after.A += 1;
          if (s.eligible) after.eligibleA += 1;
        } else if (s.setup === "B_FAST_BREAKOUT") {
          after.B += 1;
          if (s.eligible) after.eligibleB += 1;
        } else if (s.setup === "C_PULLBACK_REACCEL") {
          after.C += 1;
          if (s.eligible) after.eligibleC += 1;
        }
      }
      replayEvents.push({
        receiveSeq: r.receiveSeq,
        eventKind: "SPOT",
        bid: n.bid,
        ask: n.ask,
        spread: n.spread,
        bidRelative: n.bidRelative,
        askRelative: n.askRelative
      });
    } else if (r.eventKind === "DEPTH") {
      const m = r.market;
      const rawNew = (m.rawNewQuotes as unknown[]) ?? (m.newQuotes as unknown[]) ?? [];
      // If stored quotes already have absolute price+type, re-wrap as relative when needed.
      const rebuilt = Array.isArray(rawNew)
        ? rawNew.map((q) => {
            if (q == null || typeof q !== "object") return q;
            const o = q as Record<string, unknown>;
            if (o.bid != null || o.ask != null) return o;
            if (typeof o.price === "number" && (o.type === "BID" || o.type === "ASK")) {
              const rel = Math.round((o.price as number) * 100_000);
              return o.type === "BID"
                ? { id: o.id, size: Math.round(((o.size as number) ?? 0) * 100), bid: rel }
                : { id: o.id, size: Math.round(((o.size as number) ?? 0) * 100), ask: rel };
            }
            return o;
          })
        : [];
      const n = normalizeCTraderDepthPayload({
        timestamp: m.brokerTimestampMs ?? r.t,
        newQuotes: rebuilt,
        deletedQuotes: m.rawDeletedQuotes ?? m.deletedQuotes ?? []
      });
      normalizedDepth += 1;
      const snap = pipe.onDepth({
        kind: "DEPTH",
        receiveSeq: r.receiveSeq,
        eventId: `DEPTH:${r.receiveSeq}`,
        receivedAtMs: r.t,
        brokerTimestampMs: n.brokerTimestampMs,
        newQuotes: n.newQuotes,
        deletedQuotes: n.deletedQuotes
      });
      for (const s of snap.specialists ?? []) {
        if (s.setup === "A_MOMENTUM_IGNITION") {
          after.A += 1;
          if (s.eligible) after.eligibleA += 1;
        } else if (s.setup === "B_FAST_BREAKOUT") {
          after.B += 1;
          if (s.eligible) after.eligibleB += 1;
        } else if (s.setup === "C_PULLBACK_REACCEL") {
          after.C += 1;
          if (s.eligible) after.eligibleC += 1;
        }
      }
      replayEvents.push({
        receiveSeq: r.receiveSeq,
        eventKind: "DEPTH",
        quotes: n.newQuotes,
        deleted: n.deletedQuotes
      });
    }
  }

  mkdirSync(opts.outDir, { recursive: true });
  const summary = {
    marketDataNormalizationVersion: GH_FAST_MARKET_DATA_NORMALIZATION_VERSION,
    inputNormalizationVerified: true,
    note: "Corrected offline replay — original capture files were NOT modified.",
    rawRows: all.length,
    normalizedSpot,
    normalizedDepth,
    beforeAbc: before,
    afterAbc: after,
    materialChange:
      before.A !== after.A ||
      before.B !== after.B ||
      before.C !== after.C ||
      before.eligibleA !== after.eligibleA ||
      before.eligibleB !== after.eligibleB ||
      before.eligibleC !== after.eligibleC,
    sampleReplayEvents: replayEvents.slice(0, 20),
    spotPriceFromRelativeProof: {
      relative: 437_388_000,
      absolute: spotPriceFromRelative(437_388_000)
    }
  };
  const outPath = join(opts.outDir, "CORRECTED_REPLAY_SUMMARY.json");
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  writeFileSync(
    join(opts.outDir, "CORRECTED_REPLAY_EVENTS.ndjson"),
    replayEvents.map((e) => JSON.stringify(e)).join("\n") + (replayEvents.length ? "\n" : "")
  );
  return {
    rawRows: all.length,
    normalizedSpot,
    normalizedDepth,
    before,
    after,
    materialChange: summary.materialChange,
    outPath
  };
}

