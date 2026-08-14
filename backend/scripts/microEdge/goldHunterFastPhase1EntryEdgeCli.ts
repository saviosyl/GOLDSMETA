/**
 * GOLD_HUNTER FAST V2 — Phase 1 Entry Edge Discovery CLI (corrected)
 *
 * Research only. Does NOT change strategy thresholds, deploy, or place orders.
 * Reconstructs A/B/C candidate evaluations from preserved market events and
 * scores forward executable labels (future prices as LABELS ONLY).
 *
 * Corrections vs first Phase 1 pass:
 * 1) Forward clock starts at candidate.t (not last SPOT quote time)
 * 2) Per-horizon CONTAMINATED_FUTURE_WINDOW when contamination hits the label window
 * 3) Unique market-event counts + dedupe for cross-setup rules
 */
import { createGunzip } from "node:zlib";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { InMemoryDepthBook } from "../../src/services/microEdge/goldHunter/fast/depthBook";
import { FastFeatureEngine } from "../../src/services/microEdge/goldHunter/fast/features";
import { evaluateSetupsDetailed } from "../../src/services/microEdge/goldHunter/fast/setups";
import { frozenGhFastSoakConfig } from "../../src/services/microEdge/goldHunter/fast/frozenConfig";
import type {
  GhFastMarketEvent,
  GhFastSide,
  GhFastSetupId
} from "../../src/services/microEdge/goldHunter/fast/types";

type CollectorRow = {
  t: number;
  event: GhFastMarketEvent & { kind: string };
  decision: {
    action: string;
    state: string;
    setup: string | null;
    setupQuality: number;
    side: string | null;
    exitReason: string | null;
    reasons?: string[];
  };
  status: {
    bid: number | null;
    ask: number | null;
    spread: number | null;
    depthImbalance: number;
    velocity: number;
    acceleration: number;
    setup: string | null;
    setupQuality: number;
    state?: string;
  };
};

type QuotePoint = { t: number; seq: number; bid: number; ask: number };

type ContamEvent = {
  t: number;
  reason:
    | "RESYNC"
    | "RESYNC_EXIT_AUDIT"
    | "BOOK_REBUILDING"
    | "DATA_STALE"
    | "crossed_book"
    | "feed_gap";
};

type ForwardLabel = {
  horizonMs: number;
  signedExecutableMove: number | null;
  forwardMfe: number | null;
  forwardMae: number | null;
  reachedPosBeforeNeg: Record<string, boolean | null>;
  timeToFavourableMs: Record<string, number | null>;
  timeToAdverseMs: Record<string, number | null>;
  samples: number;
  futureWindowStatus: "CLEAN" | "CONTAMINATED_FUTURE_WINDOW";
  futureContaminationReasons: string[];
  /** Legacy clock (last SPOT t0) for material-change audit only */
  legacySignedExecutableMove: number | null;
  legacySamples: number;
};

type CandidateRow = {
  runId: string;
  t: number;
  receiveSeq: number;
  side: GhFastSide;
  setup: GhFastSetupId;
  eligible: boolean;
  selected: boolean;
  rawQuality: number | null;
  softEligible: boolean;
  softQuality: number | null;
  failedConditions: string[];
  bid: number;
  ask: number;
  spread: number;
  midVel250: number;
  midVel500: number;
  midVel1s: number;
  midVel2s: number;
  midVel3s: number;
  acceleration: number;
  efficiency1s: number;
  efficiency3s: number;
  signedImbalance1s: number;
  depthImbalance: number;
  weightedImbalance: number;
  removeRateBid: number;
  removeRateAsk: number;
  addRateBid: number;
  addRateAsk: number;
  updateRate1s: number;
  distHigh5s: number;
  distLow5s: number;
  upTouches5s: number;
  downTouches5s: number;
  bidLevels: number;
  askLevels: number;
  bookGeneration: number;
  dublinHour: number;
  contaminated: boolean;
  contaminationReasons: string[];
  quoteIdx: number;
  labels: ForwardLabel[];
};

const HORIZONS = [250, 500, 1000, 2000, 3000, 5000, 10000] as const;
const THRESHOLDS = [0.05, 0.1, 0.15, 0.2] as const;
const FRICTION = frozenGhFastSoakConfig().friction;
const GAP_MS = 2000;
const MATERIAL_MOVE_EPS = 0.01;

async function readChunks(dir: string): Promise<CollectorRow[]> {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".ndjson.gz"))
    .sort();
  const rows: CollectorRow[] = [];
  for (const file of files) {
    const stream = createReadStream(join(dir, file)).pipe(createGunzip());
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      rows.push(JSON.parse(line) as CollectorRow);
    }
  }
  rows.sort((a, b) => a.event.receiveSeq - b.event.receiveSeq);
  return rows;
}

function dublinHour(tMs: number): number {
  const d = new Date(tMs + 3600_000);
  return d.getUTCHours();
}

function quantiles(
  xs: number[],
  qs = [0.1, 0.25, 0.5, 0.75, 0.9]
): Record<string, number | null> {
  if (!xs.length) return Object.fromEntries(qs.map((q) => [String(q), null]));
  const s = [...xs].sort((a, b) => a - b);
  const out: Record<string, number | null> = {};
  for (const q of qs) {
    const i = (s.length - 1) * q;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    out[String(q)] =
      lo === hi ? s[lo]! : s[lo]! * (hi - i) + s[hi]! * (i - lo);
  }
  return out;
}

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function eventKey(c: CandidateRow): string {
  return `${c.runId}:${c.receiveSeq}`;
}

function eventSideKey(c: CandidateRow): string {
  return `${c.runId}:${c.receiveSeq}:${c.side}`;
}

function uniqueEventCount(cs: CandidateRow[]): number {
  return new Set(cs.map(eventKey)).size;
}

/** For cross-setup rules: one observation per market event + side. */
function dedupeByEventSide(cs: CandidateRow[]): CandidateRow[] {
  const map = new Map<string, CandidateRow>();
  for (const c of cs) {
    const k = eventSideKey(c);
    const prev = map.get(k);
    if (!prev) {
      map.set(k, c);
      continue;
    }
    // Prefer selected, then eligible, then higher rawQuality
    const score = (x: CandidateRow) =>
      (x.selected ? 4 : 0) +
      (x.eligible ? 2 : 0) +
      (x.rawQuality ?? x.softQuality ?? 0);
    if (score(c) > score(prev)) map.set(k, c);
  }
  return [...map.values()];
}

function futureContamInWindow(
  timeline: ContamEvent[],
  t0: number,
  horizonMs: number
): ContamEvent[] {
  const t1 = t0 + horizonMs;
  return timeline.filter((e) => e.t > t0 && e.t <= t1);
}

function computeHorizonLabel(args: {
  quotes: QuotePoint[];
  quoteIdx: number;
  candidateT: number;
  side: GhFastSide;
  entryAsk: number;
  entryBid: number;
  horizonMs: number;
  timeline: ContamEvent[];
  /** If true, use last-SPOT quote time as t0 (legacy bug — audit only). */
  legacyClock: boolean;
}): Omit<
  ForwardLabel,
  "legacySignedExecutableMove" | "legacySamples" | "futureWindowStatus" | "futureContaminationReasons"
> & {
  samples: number;
  signedExecutableMove: number | null;
  forwardMfe: number | null;
  forwardMae: number | null;
} {
  const entryPrice = args.side === "BUY" ? args.entryAsk : args.entryBid;
  const t0 = args.legacyClock
    ? args.quotes[args.quoteIdx]!.t
    : args.candidateT;
  let mfe = 0;
  let mae = 0;
  let lastSigned: number | null = null;
  let samples = 0;
  const timeFav: Record<string, number | null> = {};
  const timeAdv: Record<string, number | null> = {};
  const reached: Record<string, boolean | null> = {};
  for (const th of THRESHOLDS) {
    timeFav[String(th)] = null;
    timeAdv[String(th)] = null;
    reached[String(th)] = null;
  }

  let prevQuoteT = t0;
  for (let i = 0; i < args.quotes.length; i++) {
    const q = args.quotes[i]!;
    // Correct clock: strictly after candidate.t; legacy used startIdx+1 which
    // is approximately quotes after last SPOT.
    if (!args.legacyClock) {
      if (q.t <= args.candidateT) continue;
      if (q.t > args.candidateT + args.horizonMs) break;
    } else {
      if (i <= args.quoteIdx) continue;
      const dtLegacy = q.t - t0;
      if (dtLegacy > args.horizonMs) break;
    }

    // Do not silently carry prices across a feed gap / RESYNC hole.
    if (q.t - prevQuoteT > GAP_MS) break;
    prevQuoteT = q.t;

    const dt = q.t - t0;
    if (dt > args.horizonMs) break;
    if (dt <= 0 && !args.legacyClock) continue;

    const exec = args.side === "BUY" ? q.bid : q.ask;
    const signed =
      args.side === "BUY" ? exec - entryPrice : entryPrice - exec;
    mfe = Math.max(mfe, signed);
    mae = Math.min(mae, signed);
    lastSigned = signed;
    samples += 1;
    for (const th of THRESHOLDS) {
      const key = String(th);
      if (timeFav[key] == null && signed >= th) timeFav[key] = dt;
      if (timeAdv[key] == null && signed <= -th) timeAdv[key] = dt;
    }
  }

  for (const th of THRESHOLDS) {
    const key = String(th);
    const tf = timeFav[key];
    const ta = timeAdv[key];
    if (tf == null && ta == null) reached[key] = null;
    else if (tf != null && (ta == null || tf <= ta)) reached[key] = true;
    else reached[key] = false;
  }

  return {
    horizonMs: args.horizonMs,
    signedExecutableMove: lastSigned,
    forwardMfe: samples ? mfe : null,
    forwardMae: samples ? mae : null,
    reachedPosBeforeNeg: reached,
    timeToFavourableMs: timeFav,
    timeToAdverseMs: timeAdv,
    samples
  };
}

function computeForwardLabels(
  quotes: QuotePoint[],
  quoteIdx: number,
  candidateT: number,
  side: GhFastSide,
  entryAsk: number,
  entryBid: number,
  timeline: ContamEvent[]
): ForwardLabel[] {
  const out: ForwardLabel[] = [];
  for (const h of HORIZONS) {
    const hits = futureContamInWindow(timeline, candidateT, h);
    const corrected = computeHorizonLabel({
      quotes,
      quoteIdx,
      candidateT,
      side,
      entryAsk,
      entryBid,
      horizonMs: h,
      timeline,
      legacyClock: false
    });
    const legacy = computeHorizonLabel({
      quotes,
      quoteIdx,
      candidateT,
      side,
      entryAsk,
      entryBid,
      horizonMs: h,
      timeline,
      legacyClock: true
    });
    out.push({
      ...corrected,
      futureWindowStatus:
        hits.length > 0 ? "CONTAMINATED_FUTURE_WINDOW" : "CLEAN",
      futureContaminationReasons: [...new Set(hits.map((x) => x.reason))],
      legacySignedExecutableMove: legacy.signedExecutableMove,
      legacySamples: legacy.samples
    });
  }
  return out;
}

async function processRun(args: {
  runId: string;
  dir: string;
  label: string;
}): Promise<{
  runId: string;
  label: string;
  eventCount: number;
  marketEvents: number;
  candidates: CandidateRow[];
  contaminationStats: Record<string, number>;
  setupCTickStats: {
    featureTicks: number;
    eligible: number;
    subThreshold: number;
    structuralFail: number;
    selected: number;
    failedConditionCounts: Record<string, number>;
  };
  span: { start: string; end: string; hours: number } | null;
  configHashSeen: string | null;
  contamTimelineCount: number;
}> {
  const rows = await readChunks(args.dir);
  const cfg = frozenGhFastSoakConfig();
  const softCfg = { ...cfg, minSetupQuality: 0.01 };
  const depth = new InMemoryDepthBook();
  const features = new FastFeatureEngine();
  const quotes: QuotePoint[] = [];
  const candidates: CandidateRow[] = [];
  const timeline: ContamEvent[] = [];
  const contaminationStats: Record<string, number> = {
    book_rebuilding: 0,
    data_stale: 0,
    feed_gap: 0,
    crossed_book: 0,
    resync_marker: 0,
    insufficient_features: 0
  };
  const setupCTickStats = {
    featureTicks: 0,
    eligible: 0,
    subThreshold: 0,
    structuralFail: 0,
    selected: 0,
    failedConditionCounts: {} as Record<string, number>
  };

  let prevT: number | null = null;
  let contaminatedUntil = 0;
  let configHashSeen: string | null = null;

  const pushContam = (t: number, reason: ContamEvent["reason"]) => {
    const last = timeline[timeline.length - 1];
    // Collapse dense same-reason spam (e.g. every tick in DATA_STALE) to
    // interval starts / changes so future-window checks stay meaningful.
    if (last && last.reason === reason && t - last.t < 50) return;
    timeline.push({ t, reason });
  };

  for (const row of rows) {
    const ev = row.event as GhFastMarketEvent & {
      kind: string;
      configHash?: string;
    };
    if ((row as any).configHash && !configHashSeen) {
      configHashSeen = String((row as any).configHash);
    }

    if (ev.kind === "RESYNC") {
      contaminationStats.resync_marker += 1;
      pushContam(ev.receivedAtMs, "RESYNC");
      depth.clearForResync();
      features.clear();
      contaminatedUntil = Math.max(contaminatedUntil, ev.receivedAtMs + 3000);
      continue;
    }
    if (ev.kind === "RESYNC_EXIT_AUDIT") {
      contaminationStats.resync_marker += 1;
      pushContam(ev.receivedAtMs, "RESYNC_EXIT_AUDIT");
      continue;
    }
    if (row.decision.action === "RESYNC" || row.decision.exitReason === "DATA_STALE") {
      contaminationStats.resync_marker += 1;
      pushContam(
        ev.receivedAtMs,
        row.decision.exitReason === "DATA_STALE" ? "DATA_STALE" : "RESYNC"
      );
      depth.clearForResync();
      features.clear();
      contaminatedUntil = Math.max(contaminatedUntil, ev.receivedAtMs + 3000);
      if (ev.kind !== "SPOT" && ev.kind !== "DEPTH") continue;
    }

    if (ev.kind !== "SPOT" && ev.kind !== "DEPTH") continue;

    const gap =
      prevT != null && ev.receivedAtMs - prevT > GAP_MS
        ? ev.receivedAtMs - prevT
        : 0;
    if (gap > 0) {
      contaminationStats.feed_gap += 1;
      // Mark contamination at the start of the silence (prevT) and at resume.
      if (prevT != null) pushContam(prevT + 1, "feed_gap");
      pushContam(ev.receivedAtMs, "feed_gap");
      depth.clearForResync();
      features.clear();
      contaminatedUntil = Math.max(contaminatedUntil, ev.receivedAtMs + 3000);
    }
    prevT = ev.receivedAtMs;

    if (row.decision.state === "BOOK_REBUILDING") {
      contaminationStats.book_rebuilding += 1;
      pushContam(ev.receivedAtMs, "BOOK_REBUILDING");
      contaminatedUntil = Math.max(contaminatedUntil, ev.receivedAtMs + 3000);
    }
    if (row.decision.state === "DATA_STALE") {
      contaminationStats.data_stale += 1;
      pushContam(ev.receivedAtMs, "DATA_STALE");
      contaminatedUntil = Math.max(contaminatedUntil, ev.receivedAtMs + 1000);
    }
    if ((row.decision.reasons ?? []).includes("crossed_book")) {
      contaminationStats.crossed_book += 1;
      pushContam(ev.receivedAtMs, "crossed_book");
      contaminatedUntil = Math.max(contaminatedUntil, ev.receivedAtMs + 1000);
    }

    if (ev.kind === "SPOT") {
      if (ev.bid != null && ev.ask != null && ev.bid > 0 && ev.ask > 0) {
        features.onSpot(ev.receivedAtMs, ev.bid, ev.ask);
        quotes.push({
          t: ev.receivedAtMs,
          seq: ev.receiveSeq,
          bid: ev.bid,
          ask: ev.ask
        });
      }
    } else {
      depth.applyDepthEvent(ev);
    }

    const depthStats = depth.stats(cfg.depthTopN);
    if (depthStats.crossed) {
      pushContam(ev.receivedAtMs, "crossed_book");
    }

    const feat = features.snapshot(ev.receivedAtMs, depthStats);
    if (!feat) {
      contaminationStats.insufficient_features += 1;
      continue;
    }

    const evalStrict = evaluateSetupsDetailed(feat, cfg);
    const evalSoft = evaluateSetupsDetailed(feat, softCfg);
    const contaminated =
      ev.receivedAtMs <= contaminatedUntil || depthStats.crossed;

    const cSp = evalStrict.specialists.find(
      (s) => s.setup === "C_PULLBACK_REACCEL"
    )!;
    setupCTickStats.featureTicks += 1;
    if (cSp.eligible) setupCTickStats.eligible += 1;
    if (cSp.selected) setupCTickStats.selected += 1;
    if (!cSp.eligible && cSp.rawQuality != null) setupCTickStats.subThreshold += 1;
    if (cSp.rawQuality == null) {
      setupCTickStats.structuralFail += 1;
      for (const f of cSp.failedConditions) {
        setupCTickStats.failedConditionCounts[f] =
          (setupCTickStats.failedConditionCounts[f] ?? 0) + 1;
      }
    }

    for (let i = 0; i < 3; i++) {
      const sp = evalStrict.specialists[i]!;
      const soft = evalSoft.specialists[i]!;
      const softNear = soft.rawQuality != null || soft.candidateSide != null;
      const interesting =
        sp.eligible || sp.rawQuality != null || softNear;
      if (!interesting) continue;
      const side = sp.candidateSide ?? soft.candidateSide;
      if (!side) continue;
      const quoteIdx = quotes.length - 1;
      if (quoteIdx < 0) continue;

      const reasons = [
        ...(gap > 0 ? ["feed_gap"] : []),
        ...(row.decision.state === "BOOK_REBUILDING" ? ["book_rebuilding"] : []),
        ...(row.decision.state === "DATA_STALE" ? ["data_stale"] : []),
        ...(depthStats.crossed ? ["crossed_book"] : []),
        ...(ev.receivedAtMs <= contaminatedUntil && contaminated
          ? ["post_contam_holdoff"]
          : [])
      ];

      candidates.push({
        runId: args.runId,
        t: ev.receivedAtMs,
        receiveSeq: ev.receiveSeq,
        side,
        setup: sp.setup,
        eligible: sp.eligible,
        selected: sp.selected,
        rawQuality: sp.rawQuality,
        softEligible: soft.eligible || soft.rawQuality != null,
        softQuality: soft.rawQuality,
        failedConditions: sp.failedConditions,
        bid: feat.bid,
        ask: feat.ask,
        spread: feat.spread,
        midVel250: feat.midVel250,
        midVel500: feat.midVel500,
        midVel1s: feat.midVel1s,
        midVel2s: feat.midVel2s,
        midVel3s: feat.midVel3s,
        acceleration: feat.acceleration,
        efficiency1s: feat.efficiency1s,
        efficiency3s: feat.efficiency3s,
        signedImbalance1s: feat.signedImbalance1s,
        depthImbalance: feat.depth.depthImbalance,
        weightedImbalance: feat.depth.weightedImbalance,
        removeRateBid: feat.depth.removeRateBid,
        removeRateAsk: feat.depth.removeRateAsk,
        addRateBid: feat.depth.addRateBid,
        addRateAsk: feat.depth.addRateAsk,
        updateRate1s: feat.updateRate1s,
        distHigh5s: feat.distHigh5s,
        distLow5s: feat.distLow5s,
        upTouches5s: feat.upTouches5s,
        downTouches5s: feat.downTouches5s,
        bidLevels: feat.depth.bidLevels,
        askLevels: feat.depth.askLevels,
        bookGeneration: feat.depth.bookGeneration,
        dublinHour: dublinHour(ev.receivedAtMs),
        contaminated,
        contaminationReasons: reasons,
        quoteIdx,
        labels: []
      });
    }
  }

  for (const c of candidates) {
    c.labels = computeForwardLabels(
      quotes,
      c.quoteIdx,
      c.t,
      c.side,
      c.ask,
      c.bid,
      timeline
    );
  }

  const span =
    rows.length > 0
      ? {
          start: new Date(rows[0]!.t).toISOString(),
          end: new Date(rows[rows.length - 1]!.t).toISOString(),
          hours: (rows[rows.length - 1]!.t - rows[0]!.t) / 3.6e6
        }
      : null;

  return {
    runId: args.runId,
    label: args.label,
    eventCount: rows.length,
    marketEvents: rows.filter(
      (r) => r.event.kind === "SPOT" || r.event.kind === "DEPTH"
    ).length,
    candidates,
    contaminationStats,
    setupCTickStats,
    span,
    configHashSeen,
    contamTimelineCount: timeline.length
  };
}

function labelAt(c: CandidateRow, horizonMs: number): ForwardLabel | null {
  return c.labels.find((l) => l.horizonMs === horizonMs) ?? null;
}

function cleanLabel(
  c: CandidateRow,
  horizonMs: number
): ForwardLabel | null {
  const l = labelAt(c, horizonMs);
  if (!l || l.futureWindowStatus !== "CLEAN" || l.samples <= 0) return null;
  return l;
}

function cohortMetrics(
  cs: CandidateRow[],
  horizonMs: number,
  opts?: { dedupeEventSide?: boolean }
) {
  const rows = opts?.dedupeEventSide ? dedupeByEventSide(cs) : cs;
  const pairs = rows
    .map((c) => ({ c, l: cleanLabel(c, horizonMs) }))
    .filter((x): x is { c: CandidateRow; l: ForwardLabel } => x.l != null);
  const labs = pairs.map((p) => p.l);
  const signed = labs
    .map((l) => l.signedExecutableMove)
    .filter((x): x is number => x != null);
  const mfe = labs
    .map((l) => l.forwardMfe)
    .filter((x): x is number => x != null);
  const mae = labs
    .map((l) => l.forwardMae)
    .filter((x): x is number => x != null);
  function raceStats(thr: string) {
    const reached = labs
      .map((l) => l.reachedPosBeforeNeg[thr])
      .filter((x): x is boolean => x != null);
    const favFirst = reached.filter(Boolean).length;
    return reached.length ? favFirst / reached.length : null;
  }
  const gross = mean(signed);
  return {
    candidateRowCount: cs.length,
    uniqueCandidateEventCount: uniqueEventCount(cs),
    nAfterDedupe: rows.length,
    labeledClean: labs.length,
    buy: rows.filter((c) => c.side === "BUY").length,
    sell: rows.filter((c) => c.side === "SELL").length,
    pFavFirst_0_05: raceStats("0.05"),
    pFavFirst_0_10: raceStats("0.1"),
    pFavFirst_0_15: raceStats("0.15"),
    pFavFirst_0_20: raceStats("0.2"),
    avgForwardMfe: mean(mfe),
    avgForwardMae: mean(mae),
    medianForwardMfe: quantiles(mfe)["0.5"] ?? null,
    medianForwardMae: quantiles(mae)["0.5"] ?? null,
    meanSigned: gross,
    estimatedGrossEdge: gross,
    estimatedEdgeAfterFriction: gross == null ? null : gross - FRICTION,
    signedQuantiles: quantiles(signed),
    mfeQuantiles: quantiles(mfe),
    maeQuantiles: quantiles(mae)
  };
}

type Rule = {
  id: string;
  description: string;
  setupSpecific: boolean;
  pred: (c: CandidateRow) => boolean;
};

function buildRules(): Rule[] {
  return [
    {
      id: "R1_vel1s_accel_aligned",
      description: "abs(midVel1s)>=momentum band AND sign(accel)==sign(vel1s)",
      setupSpecific: false,
      pred: (c) =>
        Math.abs(c.midVel1s) >= 0.00008 &&
        Math.sign(c.acceleration) === Math.sign(c.midVel1s || 1)
    },
    {
      id: "R2_vel_spread_tight",
      description: "abs(midVel1s)>=8e-5 AND spread<=0.10",
      setupSpecific: false,
      pred: (c) => Math.abs(c.midVel1s) >= 0.00008 && c.spread <= 0.1
    },
    {
      id: "R3_vel_depth_agree",
      description: "side-aligned vel1s AND depthImbalance agrees with side",
      setupSpecific: false,
      pred: (c) => {
        const velOk =
          c.side === "BUY" ? c.midVel1s >= 0.00008 : c.midVel1s <= -0.00008;
        const dOk =
          c.side === "BUY"
            ? c.depthImbalance >= 0.05
            : c.depthImbalance <= -0.05;
        return velOk && dOk;
      }
    },
    {
      id: "R4_accel_remove_liq",
      description: "accel aligned + opposite liquidity being removed",
      setupSpecific: false,
      pred: (c) => {
        if (c.side === "BUY") {
          return c.acceleration > 0 && c.removeRateAsk >= c.removeRateBid + 0.5;
        }
        return c.acceleration < 0 && c.removeRateBid >= c.removeRateAsk + 0.5;
      }
    },
    {
      id: "R5_breakout_touches_pressure",
      description: "setup B soft + touches>=2 + updateRate>=3",
      setupSpecific: true,
      pred: (c) =>
        c.setup === "B_FAST_BREAKOUT" &&
        (c.side === "BUY" ? c.upTouches5s : c.downTouches5s) >= 2 &&
        c.updateRate1s >= 3
    },
    {
      id: "R6_efficiency_pullback",
      description: "setup C soft + efficiency3s>0.35 + abs(midVel3s) strong",
      setupSpecific: true,
      pred: (c) =>
        c.setup === "C_PULLBACK_REACCEL" &&
        c.efficiency3s > 0.35 &&
        Math.abs(c.midVel3s) >= 0.00012
    },
    {
      id: "R7_quality_ge_065",
      description: "rawQuality>=0.65 (control — quality alone)",
      setupSpecific: false,
      pred: (c) => (c.rawQuality ?? c.softQuality ?? 0) >= 0.65
    },
    {
      id: "R8_imb_and_vel",
      description: "signedImbalance agrees with side AND abs(midVel250) strong",
      setupSpecific: false,
      pred: (c) => {
        const imbOk =
          c.side === "BUY"
            ? c.signedImbalance1s > 0.2
            : c.signedImbalance1s < -0.2;
        const vOk =
          c.side === "BUY" ? c.midVel250 > 0.00005 : c.midVel250 < -0.00005;
        return imbOk && vOk;
      }
    }
  ];
}

function analyzeSetupC(clean: CandidateRow[]) {
  const cAll = clean.filter((x) => x.setup === "C_PULLBACK_REACCEL");
  const eligible = cAll.filter((x) => x.eligible);
  const sub = cAll.filter((x) => !x.eligible && x.rawQuality != null);
  const selected = cAll.filter((x) => x.selected);
  const softOnly = cAll.filter(
    (x) => !x.eligible && x.rawQuality == null && x.softEligible
  );
  const failCounts: Record<string, number> = {};
  for (const c of cAll) {
    for (const f of c.failedConditions) {
      failCounts[f] = (failCounts[f] ?? 0) + 1;
    }
  }
  const eligibleNotSelected = eligible.filter((x) => !x.selected);
  return {
    candidateRowCount: cAll.length,
    uniqueCandidateEventCount: uniqueEventCount(cAll),
    rawEligibilityCount: eligible.length,
    uniqueEligibleEventCount: uniqueEventCount(eligible),
    subThresholdCount: sub.length,
    softNearCount: softOnly.length,
    selectedCount: selected.length,
    failedConditionCounts: failCounts,
    eligibleNotSelected: {
      n: eligibleNotSelected.length,
      forward3s: cohortMetrics(eligibleNotSelected, 3000),
      forward5s: cohortMetrics(eligibleNotSelected, 5000)
    },
    eligibleForward3s: cohortMetrics(eligible, 3000),
    selectedForward3s: cohortMetrics(selected, 3000)
  };
}

function ruleTable(cs: CandidateRow[], rules: Rule[], horizonMs: number) {
  return rules.map((r) => {
    const hit = cs.filter(r.pred);
    return {
      id: r.id,
      description: r.description,
      setupSpecific: r.setupSpecific,
      specialistRows: cohortMetrics(hit, horizonMs, { dedupeEventSide: false }),
      uniqueMarketEventSide: cohortMetrics(hit, horizonMs, {
        dedupeEventSide: !r.setupSpecific
      })
    };
  });
}

function featureSeparatorReport(discovery: CandidateRow[]) {
  const elig = discovery.filter((c) => c.eligible);
  const strong = elig.filter((c) => {
    const l = cleanLabel(c, 3000);
    return l?.reachedPosBeforeNeg["0.05"] === true;
  });
  const fail = elig.filter((c) => {
    const l = cleanLabel(c, 3000);
    return l?.reachedPosBeforeNeg["0.05"] === false;
  });
  const keys: Array<keyof CandidateRow> = [
    "midVel250",
    "midVel500",
    "midVel1s",
    "midVel2s",
    "midVel3s",
    "acceleration",
    "efficiency1s",
    "efficiency3s",
    "signedImbalance1s",
    "depthImbalance",
    "weightedImbalance",
    "removeRateBid",
    "removeRateAsk",
    "spread",
    "rawQuality",
    "upTouches5s",
    "downTouches5s",
    "updateRate1s"
  ];
  const row = (cs: CandidateRow[], k: keyof CandidateRow) => {
    const xs = cs
      .map((c) => c[k])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    return { n: xs.length, mean: mean(xs), ...quantiles(xs) };
  };
  return {
    strongContinuationN: strong.length,
    immediateFailureN: fail.length,
    features: keys.map((k) => ({
      feature: k,
      strongContinuation: row(strong, k),
      immediateFailure: row(fail, k)
    }))
  };
}

function materialLabelChangeAudit(clean: CandidateRow[]) {
  let compared = 0;
  let materialMoveChange = 0;
  let sampleCountChange = 0;
  let newlyEmpty = 0;
  let newlyNonEmpty = 0;
  const byHorizon: Record<string, { compared: number; material: number }> = {};
  for (const h of HORIZONS) {
    byHorizon[`${h}ms`] = { compared: 0, material: 0 };
  }
  for (const c of clean) {
    for (const l of c.labels) {
      // Compare corrected vs legacy clock on the same horizon regardless of
      // future-window status (clock bug is independent of contamination mark).
      compared += 1;
      byHorizon[`${l.horizonMs}ms`]!.compared += 1;
      const a = l.signedExecutableMove;
      const b = l.legacySignedExecutableMove;
      if ((l.samples === 0) !== (l.legacySamples === 0)) {
        sampleCountChange += 1;
        if (l.samples === 0) newlyEmpty += 1;
        else newlyNonEmpty += 1;
      }
      if (a == null && b == null) continue;
      if (a == null || b == null || Math.abs(a - b) >= MATERIAL_MOVE_EPS) {
        materialMoveChange += 1;
        byHorizon[`${l.horizonMs}ms`]!.material += 1;
      }
    }
  }
  return {
    materialMoveEps: MATERIAL_MOVE_EPS,
    labelPairsCompared: compared,
    materialSignedMoveChanges: materialMoveChange,
    samplePresenceChanges: sampleCountChange,
    newlyEmptyUnderCorrectClock: newlyEmpty,
    newlyNonEmptyUnderCorrectClock: newlyNonEmpty,
    byHorizon
  };
}

function cleanLabelAvailability(clean: CandidateRow[]) {
  const out: Record<string, number> = {
    cleanCandidateSnapshots: clean.length,
    uniqueCleanCandidateEvents: uniqueEventCount(clean)
  };
  for (const h of [1000, 2000, 3000, 5000, 10000] as const) {
    out[`clean${h / 1000}sLabels`] = clean.filter(
      (c) => cleanLabel(c, h) != null
    ).length;
    out[`uniqueClean${h / 1000}sLabelEvents`] = uniqueEventCount(
      clean.filter((c) => cleanLabel(c, h) != null)
    );
  }
  return out;
}

async function main(): Promise<void> {
  const outDir = join(
    process.cwd(),
    "src/services/microEdge/goldHunter/fast/artifacts/v2-phase1-entry-edge"
  );
  mkdirSync(outDir, { recursive: true });

  const runs = [
    {
      runId: "gh_fast_mssjjspo_8ubuxa",
      dir: "/tmp/phase1-data/gh_fast_mssjjspo_8ubuxa",
      label:
        "EARLY_SAME_DAY_PRE_QUAL — 2026-08-14 ~06:03–07:25 UTC (stormy/pre-fix period)"
    },
    {
      runId: "gh_fast_mssmh2w2_ftl4pq",
      dir: "/tmp/phase1-data/gh_fast_mssmh2w2_ftl4pq",
      label: "BRIDGE_SEGMENT — 2026-08-14 ~07:28–07:38 UTC (3 chunks)"
    },
    {
      runId: "gh_fast_mssnh4uq_v488yc",
      dir: "/tmp/phase1-data/gh_fast_mssnh4uq_v488yc",
      label: "V1_EARLY_QUALIFICATION_FAIL — 2026-08-14 ~07:53–10:06 UTC"
    }
  ].filter((r) => existsSync(r.dir));

  const processed = [];
  for (const r of runs) {
    console.error(`processing ${r.runId}...`);
    processed.push(await processRun(r));
  }

  const allCandidates = processed.flatMap((p) => p.candidates);
  const before = allCandidates.length;
  const clean = allCandidates.filter((c) => !c.contaminated);
  const contaminated = allCandidates.filter((c) => c.contaminated);

  const byTime = [...clean].sort((a, b) => a.t - b.t);
  const n = byTime.length;
  const discovery = byTime.slice(0, Math.floor(n * 0.5));
  const validation = byTime.slice(Math.floor(n * 0.5), Math.floor(n * 0.75));
  const holdoutPseudo = byTime.slice(Math.floor(n * 0.75));

  const rules = buildRules();
  const discoveryRuleScores = ruleTable(discovery, rules, 3000)
    .map((r) => ({
      ...r,
      // Rank generic rules on deduped unique-event metrics; setup-specific on specialist rows
      rankEdge:
        (r.setupSpecific
          ? r.specialistRows.estimatedEdgeAfterFriction
          : r.uniqueMarketEventSide.estimatedEdgeAfterFriction) ?? -999,
      rankN: r.setupSpecific
        ? r.specialistRows.labeledClean
        : r.uniqueMarketEventSide.labeledClean
    }))
    .sort((a, b) => b.rankEdge - a.rankEdge);

  const topIds = discoveryRuleScores.slice(0, 4).map((r) => r.id);
  const lockedRules = rules.filter((r) => topIds.includes(r.id));

  const bySetup = (setup: GhFastSetupId) =>
    clean.filter((c) => c.setup === setup);
  const bySide = (side: GhFastSide) => clean.filter((c) => c.side === side);

  const forwardTables: Record<string, unknown> = {};
  for (const h of [250, 500, 1000, 2000, 3000, 5000, 10000]) {
    forwardTables[`${h}ms`] = {
      allCleanSpecialistRows: cohortMetrics(clean, h),
      allCleanUniqueEventSide: cohortMetrics(clean, h, {
        dedupeEventSide: true
      }),
      BUY_eligible: cohortMetrics(
        bySide("BUY").filter((c) => c.eligible),
        h
      ),
      SELL_eligible: cohortMetrics(
        bySide("SELL").filter((c) => c.eligible),
        h
      ),
      A: cohortMetrics(bySetup("A_MOMENTUM_IGNITION"), h),
      B: cohortMetrics(bySetup("B_FAST_BREAKOUT"), h),
      C: cohortMetrics(bySetup("C_PULLBACK_REACCEL"), h),
      eligibleOnlySpecialistRows: cohortMetrics(
        clean.filter((c) => c.eligible),
        h
      ),
      eligibleOnlyUniqueEventSide: cohortMetrics(
        clean.filter((c) => c.eligible),
        h,
        { dedupeEventSide: true }
      )
    };
  }

  const setupCTickMerged = processed.reduce(
    (acc, p) => {
      acc.featureTicks += p.setupCTickStats.featureTicks;
      acc.eligible += p.setupCTickStats.eligible;
      acc.subThreshold += p.setupCTickStats.subThreshold;
      acc.structuralFail += p.setupCTickStats.structuralFail;
      acc.selected += p.setupCTickStats.selected;
      for (const [k, v] of Object.entries(
        p.setupCTickStats.failedConditionCounts
      )) {
        acc.failedConditionCounts[k] =
          (acc.failedConditionCounts[k] ?? 0) + v;
      }
      return acc;
    },
    {
      featureTicks: 0,
      eligible: 0,
      subThreshold: 0,
      structuralFail: 0,
      selected: 0,
      failedConditionCounts: {} as Record<string, number>
    }
  );

  const calendarDays = [
    ...new Set(
      clean.map((c) => new Date(c.t).toISOString().slice(0, 10))
    )
  ];
  const spanMs =
    clean.length > 0
      ? byTime[byTime.length - 1]!.t - byTime[0]!.t
      : 0;
  const insufficientOos = calendarDays.length < 2 || spanMs < 6 * 3600_000;

  const inventory = {
    note: "Inventory of GOLD_HUNTER FAST live-shadow GCS runs under gold-hunter-fast/live-shadow/",
    calendarDaysWithUsableChunks: [
      "2026-08-13 (probe only)",
      "2026-08-14 (only substantial day)"
    ],
    independentMarketPeriods: 1,
    oosVerdict: insufficientOos
      ? "INSUFFICIENT INDEPENDENT DATA FOR OOS VALIDATION"
      : "SUFFICIENT_INDEPENDENT_PERIODS",
    oosExplanation: insufficientOos
      ? "All substantial continuous Spot+Depth streams are from a single London morning (2026-08-14). Chronological 50/25/25 splits within that morning are IN-SAMPLE RESEARCH only and must not be treated as true holdout across independent regimes."
      : "Multiple independent calendar periods present.",
    gcsRunCatalogSummary: {
      totalRunIds: 28,
      substantialUsable: [
        "gh_fast_mssjjspo_8ubuxa (22 chunks, ~06:03–07:25)",
        "gh_fast_mssmh2w2_ftl4pq (3 chunks, ~07:28–07:38)",
        "gh_fast_mssnh4uq_v488yc (32 chunks, ~07:53–10:06)"
      ],
      unitTestOrTinyProbe:
        "Most other 10-chunk runs are unit-test uploads with rowCount=2 per chunk (configHash=default). Not usable for feature research.",
      knownInfrastructureContamination:
        "V1 fail run has frequent BOOK_REBUILDING/DATA_STALE/feed gaps. Stormy early run is mostly DATA_STALE. Contaminated entry snapshots and CONTAMINATED_FUTURE_WINDOW horizons excluded from clean edge metrics."
    },
    runsProcessed: processed.map((p) => ({
      runId: p.runId,
      label: p.label,
      eventCount: p.eventCount,
      marketEvents: p.marketEvents,
      span: p.span,
      candidateRows: p.candidates.length,
      uniqueCandidateEvents: uniqueEventCount(p.candidates),
      cleanCandidates: p.candidates.filter((c) => !c.contaminated).length,
      uniqueCleanEvents: uniqueEventCount(
        p.candidates.filter((c) => !c.contaminated)
      ),
      contaminationStats: p.contaminationStats,
      contamTimelineCount: p.contamTimelineCount,
      setupCTickStats: p.setupCTickStats,
      configHashSeen: p.configHashSeen
    }))
  };

  const labelChangeAudit = materialLabelChangeAudit(clean);
  const labelAvailability = cleanLabelAvailability(clean);
  const separators = featureSeparatorReport(discovery);

  const discRows = ruleTable(discovery, lockedRules, 3000);
  const valRows = ruleTable(validation, lockedRules, 3000);
  const evidence = discRows.map((d) => {
    const v = valRows.find((x) => x.id === d.id)!;
    const dMetric = d.setupSpecific
      ? d.specialistRows
      : d.uniqueMarketEventSide;
    const vMetric = v.setupSpecific
      ? v.specialistRows
      : v.uniqueMarketEventSide;
    const bothPositive =
      dMetric.labeledClean >= 30 &&
      vMetric.labeledClean >= 30 &&
      (dMetric.estimatedEdgeAfterFriction ?? -1) > 0 &&
      (vMetric.estimatedEdgeAfterFriction ?? -1) > 0;
    return {
      id: d.id,
      setupSpecific: d.setupSpecific,
      discoveryEdge: dMetric.estimatedEdgeAfterFriction,
      validationEdge: vMetric.estimatedEdgeAfterFriction,
      discoveryN: dMetric.labeledClean,
      validationN: vMetric.labeledClean,
      discoveryUniqueEvents: dMetric.uniqueCandidateEventCount,
      validationUniqueEvents: vMetric.uniqueCandidateEventCount,
      bothPositive
    };
  });
  const anyPositive = evidence.some((e) => e.bothPositive);

  const report = {
    title: "GOLD_HUNTER FAST V2 — Phase 1 Entry Edge Discovery (CORRECTED)",
    correctionsApplied: [
      "Forward label clock starts at candidate.t (not last SPOT quote t)",
      "Per-horizon CONTAMINATED_FUTURE_WINDOW when contamination hits (candidate.t, candidate.t+horizon]",
      "Unique market-event counts (runId+receiveSeq); cross-setup rules deduped by event+side"
    ],
    constraints: {
      pr119Frozen: true,
      pr121DraftUnmerged: true,
      pr122DraftUnmerged: true,
      deploy: false,
      thresholdChanges: false,
      brokerOrders: 0
    },
    frictionAssumed: FRICTION,
    inventory,
    labelClockCorrectionAudit: labelChangeAudit,
    cleanLabelAvailability: labelAvailability,
    sampleCounts: {
      candidatesBeforeExclusion: before,
      uniqueEventsBeforeExclusion: uniqueEventCount(allCandidates),
      contaminatedExcluded: contaminated.length,
      cleanCandidates: clean.length,
      uniqueCleanEvents: uniqueEventCount(clean),
      bySetupClean: {
        A: {
          rows: bySetup("A_MOMENTUM_IGNITION").length,
          uniqueEvents: uniqueEventCount(bySetup("A_MOMENTUM_IGNITION"))
        },
        B: {
          rows: bySetup("B_FAST_BREAKOUT").length,
          uniqueEvents: uniqueEventCount(bySetup("B_FAST_BREAKOUT"))
        },
        C: {
          rows: bySetup("C_PULLBACK_REACCEL").length,
          uniqueEvents: uniqueEventCount(bySetup("C_PULLBACK_REACCEL"))
        }
      },
      eligibleClean: {
        A: {
          rows: bySetup("A_MOMENTUM_IGNITION").filter((c) => c.eligible).length,
          uniqueEvents: uniqueEventCount(
            bySetup("A_MOMENTUM_IGNITION").filter((c) => c.eligible)
          )
        },
        B: {
          rows: bySetup("B_FAST_BREAKOUT").filter((c) => c.eligible).length,
          uniqueEvents: uniqueEventCount(
            bySetup("B_FAST_BREAKOUT").filter((c) => c.eligible)
          )
        },
        C: {
          rows: bySetup("C_PULLBACK_REACCEL").filter((c) => c.eligible).length,
          uniqueEvents: uniqueEventCount(
            bySetup("C_PULLBACK_REACCEL").filter((c) => c.eligible)
          )
        }
      },
      selectedClean: {
        A: bySetup("A_MOMENTUM_IGNITION").filter((c) => c.selected).length,
        B: bySetup("B_FAST_BREAKOUT").filter((c) => c.selected).length,
        C: bySetup("C_PULLBACK_REACCEL").filter((c) => c.selected).length
      }
    },
    cleanUsableEventPeriods: processed.map((p) => ({
      runId: p.runId,
      span: p.span,
      cleanCandidates: p.candidates.filter((c) => !c.contaminated).length,
      uniqueCleanEvents: uniqueEventCount(
        p.candidates.filter((c) => !c.contaminated)
      ),
      contaminatedCandidates: p.candidates.filter((c) => c.contaminated)
        .length
    })),
    excludedContaminatedPeriods: processed.map((p) => ({
      runId: p.runId,
      contaminationStats: p.contaminationStats,
      contamTimelineCount: p.contamTimelineCount
    })),
    setupC: {
      ...analyzeSetupC(clean),
      perTickStructuralCensus: setupCTickMerged,
      whyStructuralFails:
        "C requires impulse midVel3s + efficiency3s>0.35, pullback depth in (0.08, pullbackRetraceMax], then same-sign midVel250+acceleration+imbalance. Most feature ticks fail impulse/efficiency or pullback window — rawQuality stays null."
    },
    buyVsSell: {
      BUY: {
        specialistRows: bySide("BUY").filter((c) => c.eligible).length,
        uniqueEvents: uniqueEventCount(
          bySide("BUY").filter((c) => c.eligible)
        ),
        forward: Object.fromEntries(
          [1000, 2000, 3000, 5000, 10000].map((h) => [
            h,
            cohortMetrics(
              bySide("BUY").filter((c) => c.eligible),
              h
            )
          ])
        )
      },
      SELL: {
        specialistRows: bySide("SELL").filter((c) => c.eligible).length,
        uniqueEvents: uniqueEventCount(
          bySide("SELL").filter((c) => c.eligible)
        ),
        forward: Object.fromEntries(
          [1000, 2000, 3000, 5000, 10000].map((h) => [
            h,
            cohortMetrics(
              bySide("SELL").filter((c) => c.eligible),
              h
            )
          ])
        )
      }
    },
    forwardMovementTables: forwardTables,
    featureSeparators: {
      method:
        "Quantile compare strong continuation vs immediate failure on DISCOVERY eligible with CLEAN 3s labels only",
      ...separators,
      discoveryRuleScores3s: discoveryRuleScores,
      lockedForValidation: topIds
    },
    candidateInterpretableRules: lockedRules.map((r) => ({
      id: r.id,
      description: r.description,
      setupSpecific: r.setupSpecific
    })),
    discoveryResults: {
      set: "first 50% clean candidates by time (IN-SAMPLE)",
      candidateRowCount: discovery.length,
      uniqueCandidateEventCount: uniqueEventCount(discovery),
      rules3s: ruleTable(discovery, lockedRules, 3000),
      rules5s: ruleTable(discovery, lockedRules, 5000)
    },
    validationResults: {
      set: "next 25% clean candidates by time (IN-SAMPLE validation — same morning)",
      candidateRowCount: validation.length,
      uniqueCandidateEventCount: uniqueEventCount(validation),
      rules3s: ruleTable(validation, lockedRules, 3000),
      rules5s: ruleTable(validation, lockedRules, 5000)
    },
    holdoutResults: {
      trueUntouchedIndependentHoldout: null,
      verdict: inventory.oosVerdict,
      pseudoSameMorningHoldout: {
        warning:
          "NOT a true holdout. Same calendar morning / same regime. Reported only for transparency.",
        candidateRowCount: holdoutPseudo.length,
        uniqueCandidateEventCount: uniqueEventCount(holdoutPseudo),
        rules3s: ruleTable(holdoutPseudo, lockedRules, 3000),
        rules5s: ruleTable(holdoutPseudo, lockedRules, 5000)
      }
    },
    evidenceAfterFriction: {
      anyPositiveProspectiveEdgeAfterFriction: anyPositive,
      note: "Requires labeledClean>=30 on discovery AND validation with after-friction meanSigned@3s > 0 for the SAME locked rule. Generic rules use event+side dedupe. Pseudo-holdout never used for claim.",
      details: evidence
    },
    phase1Verdict: {
      insufficientIndependentDataForOos: insufficientOos,
      oosStatement: inventory.oosVerdict,
      positiveProspectiveEntryEdgeFound: anyPositive,
      positiveEdgeStatement: anyPositive
        ? "POSITIVE_PROSPECTIVE_ENTRY_EDGE_CANDIDATE (still not shippable without independent OOS)"
        : "NO POSITIVE PROSPECTIVE ENTRY EDGE FOUND",
      conclusionChangedVsPriorPhase1Pass:
        "Re-derived after clock + future-window + unique-event corrections; see labelClockCorrectionAudit and evidenceAfterFriction."
    },
    overfittingWarnings: [
      "Only one independent London morning with substantial Level-II coverage.",
      "Chronological splits within that morning share microstructure regime, news window, and liquidity.",
      "Do not combine Phase 0 loss-reduction rules with Phase 1 discovery rules on the same sample.",
      "Soft near-miss expansion increases sample size but is not the live entry gate.",
      ...(insufficientOos
        ? [
            "INSUFFICIENT INDEPENDENT DATA FOR OOS VALIDATION — stop; do not pretend one morning split is strong OOS."
          ]
        : [])
    ],
    moreDataRequired: insufficientOos || !anyPositive,
    artifactsCreated: [
      "backend/scripts/microEdge/goldHunterFastPhase1EntryEdgeCli.ts",
      "backend/src/services/microEdge/goldHunter/fast/artifacts/v2-phase1-entry-edge/PHASE1_REPORT.json",
      "backend/src/services/microEdge/goldHunter/fast/artifacts/v2-phase1-entry-edge/PHASE1_REPORT.md",
      "backend/src/services/microEdge/goldHunter/fast/artifacts/v2-phase1-entry-edge/DATASET_INVENTORY.json",
      "backend/src/services/microEdge/goldHunter/fast/artifacts/v2-phase1-entry-edge/candidates_clean_sample.jsonl",
      "backend/src/services/microEdge/goldHunter/fast/artifacts/v2-phase2-data-capture/PHASE2_COLLECTOR_DESIGN.md",
      "backend/src/services/microEdge/goldHunter/fast/artifacts/v2-phase2-data-capture/PHASE2_COLLECTOR_DESIGN.json"
    ]
  };

  writeFileSync(join(outDir, "PHASE1_REPORT.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(outDir, "DATASET_INVENTORY.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        ...inventory,
        gcsRunIdsListed: 28,
        processedLocally: processed.map((p) => p.runId),
        contaminationExcluded: contaminated.length,
        cleanUsableCandidateRows: clean.length,
        uniqueCleanMarketEvents: uniqueEventCount(clean),
        cleanLabelAvailability: labelAvailability,
        labelClockCorrectionAudit: labelChangeAudit
      },
      null,
      2
    )
  );

  const exportRows = clean.filter(
    (c, i) => c.eligible || c.selected || i % 25 === 0
  );
  writeFileSync(
    join(outDir, "candidates_clean_sample.jsonl"),
    exportRows
      .map((c) =>
        JSON.stringify({
          ...c,
          labels: c.labels.filter((l) =>
            [1000, 3000, 5000, 10000].includes(l.horizonMs)
          )
        })
      )
      .join("\n")
  );

  const fmt = (x: number | null | undefined) =>
    x == null || Number.isNaN(x) ? "null" : x.toFixed(4);

  const md: string[] = [];
  md.push("# GOLD_HUNTER FAST V2 — Phase 1 Entry Edge Discovery (CORRECTED)");
  md.push("");
  md.push(
    "Research only. **No deploy. No threshold changes. No broker/shadow orders. No V2 trading logic.**"
  );
  md.push("");
  md.push("## Corrections applied");
  md.push("");
  for (const c of report.correctionsApplied) md.push(`- ${c}`);
  md.push("");
  md.push("## Verdict (re-derived)");
  md.push("");
  md.push(`**${report.phase1Verdict.oosStatement}**`);
  md.push("");
  md.push(`**${report.phase1Verdict.positiveEdgeStatement}**`);
  md.push("");
  md.push(inventory.oosExplanation);
  md.push("");
  md.push(
    `- Clean candidate rows: **${clean.length}** (unique events: **${uniqueEventCount(clean)}**)`
  );
  md.push(
    `- Contaminated entry snapshots excluded: ${contaminated.length} of ${before}`
  );
  md.push(`- Friction assumed: **${FRICTION}**`);
  md.push(
    `- Any positive prospective edge after friction: **${anyPositive}**`
  );
  md.push("");
  md.push("## Label clock correction impact");
  md.push("");
  md.push("```json");
  md.push(JSON.stringify(labelChangeAudit, null, 2));
  md.push("```");
  md.push("");
  md.push("## Clean forward label availability");
  md.push("");
  md.push("```json");
  md.push(JSON.stringify(labelAvailability, null, 2));
  md.push("```");
  md.push("");
  md.push("## Sample counts (rows vs unique events)");
  md.push("");
  md.push("```json");
  md.push(JSON.stringify(report.sampleCounts, null, 2));
  md.push("```");
  md.push("");
  md.push("## Setup C");
  md.push("");
  md.push("```json");
  md.push(JSON.stringify(report.setupC, null, 2));
  md.push("```");
  md.push("");
  md.push("## BUY vs SELL (eligible, CLEAN forward labels @3s)");
  md.push("");
  const buy3 = report.buyVsSell.BUY.forward["3000"];
  const sell3 = report.buyVsSell.SELL.forward["3000"];
  md.push(
    `| Side | rows | uniqueEvents | labeledClean | meanSigned | edgeAF | pFav@0.05 |`
  );
  md.push(
    `|------|-----:|-------------:|-------------:|-----------:|-------:|----------:|`
  );
  md.push(
    `| BUY | ${buy3.candidateRowCount} | ${buy3.uniqueCandidateEventCount} | ${buy3.labeledClean} | ${fmt(buy3.meanSigned)} | ${fmt(buy3.estimatedEdgeAfterFriction)} | ${fmt(buy3.pFavFirst_0_05)} |`
  );
  md.push(
    `| SELL | ${sell3.candidateRowCount} | ${sell3.uniqueCandidateEventCount} | ${sell3.labeledClean} | ${fmt(sell3.meanSigned)} | ${fmt(sell3.estimatedEdgeAfterFriction)} | ${fmt(sell3.pFavFirst_0_05)} |`
  );
  md.push("");
  md.push("## Forward tables (eligible, unique event+side dedupe)");
  md.push("");
  md.push(
    `| Horizon | labeledClean | meanSigned | edgeAF | pFav@0.05 |`
  );
  md.push(`|--------:|-------------:|-----------:|-------:|----------:|`);
  for (const h of ["1000ms", "2000ms", "3000ms", "5000ms", "10000ms"]) {
    const m = (forwardTables[h] as any).eligibleOnlyUniqueEventSide;
    md.push(
      `| ${h} | ${m.labeledClean} | ${fmt(m.meanSigned)} | ${fmt(m.estimatedEdgeAfterFriction)} | ${fmt(m.pFavFirst_0_05)} |`
    );
  }
  md.push("");
  md.push("## Entry rules (discovery top / locked) — both tables");
  md.push("");
  for (const r of discRows) {
    md.push(`### ${r.id} (${r.setupSpecific ? "setup-specific" : "generic"})`);
    md.push(
      `- specialistRows: labeledClean=${r.specialistRows.labeledClean} edgeAF=${fmt(r.specialistRows.estimatedEdgeAfterFriction)}`
    );
    md.push(
      `- uniqueMarketEventSide: labeledClean=${r.uniqueMarketEventSide.labeledClean} edgeAF=${fmt(r.uniqueMarketEventSide.estimatedEdgeAfterFriction)} uniqueEvents=${r.uniqueMarketEventSide.uniqueCandidateEventCount}`
    );
  }
  md.push("");
  md.push("## Evidence after friction");
  md.push("");
  md.push("```json");
  md.push(JSON.stringify(report.evidenceAfterFriction, null, 2));
  md.push("```");
  md.push("");
  md.push("## True holdout");
  md.push("");
  md.push("**null** — insufficient independent periods.");
  md.push("");
  md.push("## Artifacts");
  md.push("");
  for (const a of report.artifactsCreated) md.push(`- \`${a}\``);
  writeFileSync(join(outDir, "PHASE1_REPORT.md"), md.join("\n"));

  console.log(
    JSON.stringify(
      {
        outDir,
        cleanRows: clean.length,
        uniqueCleanEvents: uniqueEventCount(clean),
        contaminated: contaminated.length,
        anyPositiveEdge: anyPositive,
        oos: inventory.oosVerdict,
        labelChangeAudit,
        labelAvailability,
        topDiscovery: discoveryRuleScores.slice(0, 5).map((r) => ({
          id: r.id,
          edge: r.rankEdge,
          n: r.rankN
        }))
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
