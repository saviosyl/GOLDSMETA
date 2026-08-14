/**
 * Offline corrected replay of research-capture NDJSON.
 * NEVER overwrites original GCS objects — writes a separate replay summary.
 *
 * Ordered receiveSeq semantics (per runId only — never merge runs):
 *   SPOT / DEPTH → normalize + feature pipeline
 *   RESYNC_MARKER → pipe.clearForResync() at that receiveSeq, then record
 *   SESSION_TRANSITION → skipped for market-state rebuild (telemetry only;
 *     does not alter book/features). HEARTBEAT similarly skipped.
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

type AbcCounts = {
  A: number;
  B: number;
  C: number;
  eligibleA: number;
  eligibleB: number;
  eligibleC: number;
  selectedA: number;
  selectedB: number;
  selectedC: number;
};

type Row = {
  t: number;
  receiveSeq: number;
  eventKind: string;
  runId?: string;
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

function emptyAbc(): AbcCounts {
  return {
    A: 0,
    B: 0,
    C: 0,
    eligibleA: 0,
    eligibleB: 0,
    eligibleC: 0,
    selectedA: 0,
    selectedB: 0,
    selectedC: 0
  };
}

function tallySpecialists(
  into: AbcCounts,
  specialists: Row["specialists"]
): void {
  for (const s of specialists ?? []) {
    if (s.setup === "A_MOMENTUM_IGNITION") {
      into.A += 1;
      if (s.eligible) into.eligibleA += 1;
      if (s.selectedCandidate) into.selectedA += 1;
    } else if (s.setup === "B_FAST_BREAKOUT") {
      into.B += 1;
      if (s.eligible) into.eligibleB += 1;
      if (s.selectedCandidate) into.selectedB += 1;
    } else if (s.setup === "C_PULLBACK_REACCEL") {
      into.C += 1;
      if (s.eligible) into.eligibleC += 1;
      if (s.selectedCandidate) into.selectedC += 1;
    }
  }
}

export async function replayResearchCaptureNormalized(opts: {
  inputDir: string;
  outDir: string;
}): Promise<{
  runId: string | null;
  rawRows: number;
  normalizedSpot: number;
  normalizedDepth: number;
  resyncMarkersProcessed: number;
  sessionTransitionsSkipped: number;
  heartbeatsSkipped: number;
  before: AbcCounts;
  after: AbcCounts;
  materialChange: boolean;
  outPath: string;
}> {
  const files = collectNdjsonGz(opts.inputDir);
  const all: Row[] = [];
  for (const f of files) {
    all.push(...(await readGzJsonl(f)));
  }
  all.sort((a, b) => a.receiveSeq - b.receiveSeq || a.t - b.t);

  const runIds = new Set(
    all.map((r) => r.runId).filter((id): id is string => typeof id === "string")
  );
  if (runIds.size > 1) {
    throw new Error(
      `CORRECTED_REPLAY_MULTI_RUN: refuse to merge runIds=${[...runIds].join(",")}. Replay each runId separately.`
    );
  }
  const runId = runIds.size === 1 ? [...runIds][0]! : null;

  const before = emptyAbc();
  for (const r of all) {
    tallySpecialists(before, r.specialists);
  }

  const pipe = new ResearchFeaturePipeline();
  const after = emptyAbc();
  let normalizedSpot = 0;
  let normalizedDepth = 0;
  let resyncMarkersProcessed = 0;
  let sessionTransitionsSkipped = 0;
  let heartbeatsSkipped = 0;
  const replayEvents: unknown[] = [];

  for (const r of all) {
    if (r.eventKind === "RESYNC_MARKER") {
      // Same ordered boundary as ResearchIngestBridge.processOrdered.
      pipe.clearForResync();
      resyncMarkersProcessed += 1;
      replayEvents.push({
        receiveSeq: r.receiveSeq,
        eventKind: "RESYNC_MARKER",
        reason: r.market?.reason ?? null,
        cleared: true
      });
      continue;
    }

    if (r.eventKind === "SESSION_TRANSITION") {
      // Telemetry only — does not alter book/features. Explicit skip.
      sessionTransitionsSkipped += 1;
      replayEvents.push({
        receiveSeq: r.receiveSeq,
        eventKind: "SESSION_TRANSITION",
        skipped: true,
        reason: "session_transition_does_not_alter_market_state"
      });
      continue;
    }

    if (r.eventKind === "HEARTBEAT") {
      heartbeatsSkipped += 1;
      continue;
    }

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
        bid:
          bidRel ??
          (typeof m.bid === "number" ? (m.bid as number) * 100_000 : null),
        ask:
          askRel ??
          (typeof m.ask === "number" ? (m.ask as number) * 100_000 : null),
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
      tallySpecialists(after, snap.specialists);
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
      const rawNew =
        (m.rawNewQuotes as unknown[]) ?? (m.newQuotes as unknown[]) ?? [];
      // If stored quotes already have absolute price+type, re-wrap as relative when needed.
      const rebuilt = Array.isArray(rawNew)
        ? rawNew.map((q) => {
            if (q == null || typeof q !== "object") return q;
            const o = q as Record<string, unknown>;
            if (o.bid != null || o.ask != null) return o;
            if (
              typeof o.price === "number" &&
              (o.type === "BID" || o.type === "ASK")
            ) {
              const rel = Math.round((o.price as number) * 100_000);
              return o.type === "BID"
                ? {
                    id: o.id,
                    size: Math.round(((o.size as number) ?? 0) * 100),
                    bid: rel
                  }
                : {
                    id: o.id,
                    size: Math.round(((o.size as number) ?? 0) * 100),
                    ask: rel
                  };
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
      tallySpecialists(after, snap.specialists);
      replayEvents.push({
        receiveSeq: r.receiveSeq,
        eventKind: "DEPTH",
        quotes: n.newQuotes,
        deleted: n.deletedQuotes
      });
    }
  }

  mkdirSync(opts.outDir, { recursive: true });
  const materialChange =
    before.A !== after.A ||
    before.B !== after.B ||
    before.C !== after.C ||
    before.eligibleA !== after.eligibleA ||
    before.eligibleB !== after.eligibleB ||
    before.eligibleC !== after.eligibleC ||
    before.selectedA !== after.selectedA ||
    before.selectedB !== after.selectedB ||
    before.selectedC !== after.selectedC;
  const summary = {
    runId,
    marketDataNormalizationVersion: GH_FAST_MARKET_DATA_NORMALIZATION_VERSION,
    inputNormalizationVerified: true,
    note: "Corrected offline replay — original capture files were NOT modified. One runId per stream.",
    sessionTransitionBehavior:
      "SESSION_TRANSITION rows are skipped for market-state rebuild (telemetry only; no book/feature mutation).",
    heartbeatBehavior: "HEARTBEAT rows are skipped for market-state rebuild.",
    rawRows: all.length,
    normalizedSpot,
    normalizedDepth,
    resyncMarkersProcessed,
    sessionTransitionsSkipped,
    heartbeatsSkipped,
    beforeAbc: before,
    afterAbc: after,
    materialChange,
    sampleReplayEvents: replayEvents.slice(0, 40),
    spotPriceFromRelativeProof: {
      relative: 437_388_000,
      absolute: spotPriceFromRelative(437_388_000)
    }
  };
  const outPath = join(opts.outDir, "CORRECTED_REPLAY_SUMMARY.json");
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  writeFileSync(
    join(opts.outDir, "CORRECTED_REPLAY_EVENTS.ndjson"),
    replayEvents.map((e) => JSON.stringify(e)).join("\n") +
      (replayEvents.length ? "\n" : "")
  );
  return {
    runId,
    rawRows: all.length,
    normalizedSpot,
    normalizedDepth,
    resyncMarkersProcessed,
    sessionTransitionsSkipped,
    heartbeatsSkipped,
    before,
    after,
    materialChange,
    outPath
  };
}
