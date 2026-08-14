/**
 * GOLD_HUNTER FAST V2 — Phase 1 Entry Edge Discovery CLI
 *
 * Research only. Does NOT change strategy thresholds, deploy, or place orders.
 * Reconstructs A/B/C candidate evaluations from preserved market events and
 * scores forward executable labels (future prices as LABELS ONLY).
 */
import { createGunzip } from "node:zlib";
import { createReadStream, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { InMemoryDepthBook } from "../../src/services/microEdge/goldHunter/fast/depthBook";
import { FastFeatureEngine } from "../../src/services/microEdge/goldHunter/fast/features";
import { evaluateSetupsDetailed } from "../../src/services/microEdge/goldHunter/fast/setups";
import { frozenGhFastSoakConfig } from "../../src/services/microEdge/goldHunter/fast/frozenConfig";
import type {
  GhFastMarketEvent,
  GhFastSide,
  GhFastSetupId,
  GhFastSpecialistRawEval
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

type ForwardLabel = {
  horizonMs: number;
  signedExecutableMove: number | null;
  forwardMfe: number | null;
  forwardMae: number | null;
  reachedPosBeforeNeg: Record<string, boolean | null>;
  timeToFavourableMs: Record<string, number | null>;
  timeToAdverseMs: Record<string, number | null>;
  samples: number;
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
  /** Index into quotes[] at snapshot time — labels filled in a second pass. */
  quoteIdx: number;
  labels: ForwardLabel[];
};

const HORIZONS = [250, 500, 1000, 2000, 3000, 5000, 10000] as const;
const THRESHOLDS = [0.05, 0.1, 0.15, 0.2] as const;
const FRICTION = frozenGhFastSoakConfig().friction;
const GAP_MS = 2000;

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
  // Approximate Europe/Dublin summer = UTC+1
  const d = new Date(tMs + 3600_000);
  return d.getUTCHours();
}

function quantiles(xs: number[], qs = [0.1, 0.25, 0.5, 0.75, 0.9]): Record<string, number | null> {
  if (!xs.length) return Object.fromEntries(qs.map((q) => [String(q), null]));
  const s = [...xs].sort((a, b) => a - b);
  const out: Record<string, number | null> = {};
  for (const q of qs) {
    const i = (s.length - 1) * q;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    out[String(q)] = lo === hi ? s[lo]! : s[lo]! * (hi - i) + s[hi]! * (i - lo);
  }
  return out;
}

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function computeForwardLabels(
  quotes: QuotePoint[],
  startIdx: number,
  side: GhFastSide,
  entryAsk: number,
  entryBid: number
): ForwardLabel[] {
  const entryPrice = side === "BUY" ? entryAsk : entryBid;
  const t0 = quotes[startIdx]!.t;
  const out: ForwardLabel[] = [];
  for (const h of HORIZONS) {
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
    for (let i = startIdx + 1; i < quotes.length; i++) {
      const q = quotes[i]!;
      const dt = q.t - t0;
      if (dt > h) break;
      if (q.t - quotes[i - 1]!.t > GAP_MS) break; // stop at feed gap
      const exec = side === "BUY" ? q.bid : q.ask;
      const signed = side === "BUY" ? exec - entryPrice : entryPrice - exec;
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
    out.push({
      horizonMs: h,
      signedExecutableMove: lastSigned,
      forwardMfe: samples ? mfe : null,
      forwardMae: samples ? mae : null,
      reachedPosBeforeNeg: reached,
      timeToFavourableMs: timeFav,
      timeToAdverseMs: timeAdv,
      samples
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
}> {
  const rows = await readChunks(args.dir);
  const cfg = frozenGhFastSoakConfig();
  const softCfg = { ...cfg, minSetupQuality: 0.01 };
  const depth = new InMemoryDepthBook();
  const features = new FastFeatureEngine();
  const quotes: QuotePoint[] = [];
  const candidates: CandidateRow[] = [];
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

  for (const row of rows) {
    const ev = row.event as GhFastMarketEvent & { kind: string; configHash?: string };
    if ((row as any).configHash && !configHashSeen) {
      configHashSeen = String((row as any).configHash);
    }

    // Contaminating control events (may appear in Phase 0+ streams)
    if (
      ev.kind === "RESYNC" ||
      ev.kind === "RESYNC_EXIT_AUDIT" ||
      row.decision.action === "RESYNC" ||
      row.decision.exitReason === "DATA_STALE"
    ) {
      contaminationStats.resync_marker += 1;
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
      depth.clearForResync();
      features.clear();
      contaminatedUntil = Math.max(contaminatedUntil, ev.receivedAtMs + 3000);
    }
    prevT = ev.receivedAtMs;

    if (row.decision.state === "BOOK_REBUILDING") {
      contaminationStats.book_rebuilding += 1;
      contaminatedUntil = Math.max(contaminatedUntil, ev.receivedAtMs + 3000);
    }
    if (row.decision.state === "DATA_STALE") {
      contaminationStats.data_stale += 1;
      contaminatedUntil = Math.max(contaminatedUntil, ev.receivedAtMs + 1000);
    }
    if ((row.decision.reasons ?? []).includes("crossed_book")) {
      contaminationStats.crossed_book += 1;
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
    const feat = features.snapshot(ev.receivedAtMs, depthStats);
    if (!feat) {
      contaminationStats.insufficient_features += 1;
      continue;
    }

    const evalStrict = evaluateSetupsDetailed(feat, cfg);
    const evalSoft = evaluateSetupsDetailed(feat, softCfg);
    const contaminated =
      ev.receivedAtMs <= contaminatedUntil || depthStats.crossed;

    // Per-tick C structural census (independent of candidate emission)
    const cSp = evalStrict.specialists.find((s) => s.setup === "C_PULLBACK_REACCEL")!;
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

    // Emit candidate rows for each specialist that is eligible, sub-threshold, or soft-near.
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

  // Second pass: future executable prices are LABELS ONLY (no look-ahead in features).
  for (const c of candidates) {
    c.labels = computeForwardLabels(quotes, c.quoteIdx, c.side, c.ask, c.bid);
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
    configHashSeen
  };
}

function labelAt(c: CandidateRow, horizonMs: number): ForwardLabel | null {
  return c.labels.find((l) => l.horizonMs === horizonMs) ?? null;
}

function cohortMetrics(cs: CandidateRow[], horizonMs: number) {
  const labs = cs
    .map((c) => labelAt(c, horizonMs))
    .filter((l): l is ForwardLabel => l != null && l.samples > 0);
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
    return {
      decided: reached.length,
      pFavFirst: reached.length ? favFirst / reached.length : null
    };
  }
  const gross = mean(signed);
  const meanByHorizon: Record<string, number | null> = {};
  // caller may pass mixed horizons via labs already filtered; keep signed mean only
  return {
    n: cs.length,
    labeled: labs.length,
    buy: cs.filter((c) => c.side === "BUY").length,
    sell: cs.filter((c) => c.side === "SELL").length,
    pFavFirst_0_05: raceStats("0.05").pFavFirst,
    pFavFirst_0_10: raceStats("0.1").pFavFirst,
    pFavFirst_0_15: raceStats("0.15").pFavFirst,
    pFavFirst_0_20: raceStats("0.2").pFavFirst,
    avgForwardMfe: mean(mfe),
    avgForwardMae: mean(mae),
    medianForwardMfe: quantiles(mfe)["0.5"] ?? null,
    medianForwardMae: quantiles(mae)["0.5"] ?? null,
    meanSigned: gross,
    estimatedGrossEdge: gross,
    estimatedEdgeAfterFriction: gross == null ? null : gross - FRICTION,
    signedQuantiles: quantiles(signed),
    mfeQuantiles: quantiles(mfe),
    maeQuantiles: quantiles(mae),
    _unused: meanByHorizon
  };
}

type Rule = {
  id: string;
  description: string;
  pred: (c: CandidateRow) => boolean;
};

function buildRules(): Rule[] {
  return [
    {
      id: "R1_vel1s_accel_aligned",
      description: "abs(midVel1s)>=momentum band AND sign(accel)==sign(vel1s)",
      pred: (c) =>
        Math.abs(c.midVel1s) >= 0.00008 &&
        Math.sign(c.acceleration) === Math.sign(c.midVel1s || 1)
    },
    {
      id: "R2_vel_spread_tight",
      description: "abs(midVel1s)>=8e-5 AND spread<=0.10",
      pred: (c) => Math.abs(c.midVel1s) >= 0.00008 && c.spread <= 0.1
    },
    {
      id: "R3_vel_depth_agree",
      description: "side-aligned vel1s AND depthImbalance agrees with side",
      pred: (c) => {
        const velOk =
          c.side === "BUY" ? c.midVel1s >= 0.00008 : c.midVel1s <= -0.00008;
        const dOk =
          c.side === "BUY" ? c.depthImbalance >= 0.05 : c.depthImbalance <= -0.05;
        return velOk && dOk;
      }
    },
    {
      id: "R4_accel_remove_liq",
      description: "accel aligned + opposite liquidity being removed",
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
      pred: (c) =>
        c.setup === "B_FAST_BREAKOUT" &&
        (c.side === "BUY" ? c.upTouches5s : c.downTouches5s) >= 2 &&
        c.updateRate1s >= 3
    },
    {
      id: "R6_efficiency_pullback",
      description: "setup C soft + efficiency3s>0.35 + abs(midVel3s) strong",
      pred: (c) =>
        c.setup === "C_PULLBACK_REACCEL" &&
        c.efficiency3s > 0.35 &&
        Math.abs(c.midVel3s) >= 0.00012
    },
    {
      id: "R7_quality_ge_065",
      description: "rawQuality>=0.65 (control — quality alone)",
      pred: (c) => (c.rawQuality ?? c.softQuality ?? 0) >= 0.65
    },
    {
      id: "R8_imb_and_vel",
      description: "signedImbalance agrees with side AND abs(midVel250) strong",
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
    rawEligibilityCount: eligible.length,
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
      ...cohortMetrics(hit, horizonMs)
    };
  });
}

function featureSeparatorReport(discovery: CandidateRow[]) {
  const elig = discovery.filter((c) => c.eligible);
  const strong = elig.filter((c) => {
    const l = labelAt(c, 3000);
    return l?.reachedPosBeforeNeg["0.05"] === true;
  });
  const fail = elig.filter((c) => {
    const l = labelAt(c, 3000);
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
    })),
    conditional2d_vel_x_spread: (() => {
      const bins = [
        { vel: "weak", v: (x: number) => Math.abs(x) < 0.00005 },
        { vel: "mod", v: (x: number) => Math.abs(x) >= 0.00005 && Math.abs(x) < 0.00012 },
        { vel: "strong", v: (x: number) => Math.abs(x) >= 0.00012 }
      ];
      const spr = [
        { spread: "tight", s: (x: number) => x <= 0.1 },
        { spread: "mid", s: (x: number) => x > 0.1 && x <= 0.2 },
        { spread: "wide", s: (x: number) => x > 0.2 }
      ];
      const out = [];
      for (const b of bins) {
        for (const s of spr) {
          const hit = elig.filter((c) => b.v(c.midVel1s) && s.s(c.spread));
          const m = cohortMetrics(hit, 3000);
          out.push({ vel: b.vel, spread: s.spread, n: hit.length, pFavFirst_0_05: m.pFavFirst_0_05, meanSigned: m.meanSigned, edgeAfterFriction: m.estimatedEdgeAfterFriction });
        }
      }
      return out;
    })()
  };
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

  // Chronological split within the ONLY available morning — NOT credible OOS.
  const byTime = [...clean].sort((a, b) => a.t - b.t);
  const n = byTime.length;
  const discovery = byTime.slice(0, Math.floor(n * 0.5));
  const validation = byTime.slice(Math.floor(n * 0.5), Math.floor(n * 0.75));
  const holdoutPseudo = byTime.slice(Math.floor(n * 0.75));

  const rules = buildRules();
  // Discover on discovery only: rank by estimatedEdgeAfterFriction at 3s
  const discoveryRuleScores = ruleTable(discovery, rules, 3000).sort(
    (a, b) =>
      (b.estimatedEdgeAfterFriction ?? -999) -
      (a.estimatedEdgeAfterFriction ?? -999)
  );
  const topIds = discoveryRuleScores.slice(0, 4).map((r) => r.id);
  const lockedRules = rules.filter((r) => topIds.includes(r.id));

  const bySetup = (setup: GhFastSetupId) => clean.filter((c) => c.setup === setup);
  const bySide = (side: GhFastSide) => clean.filter((c) => c.side === side);

  const forwardTables: Record<string, unknown> = {};
  for (const h of [250, 500, 1000, 2000, 3000, 5000, 10000]) {
    forwardTables[`${h}ms`] = {
      allClean: cohortMetrics(clean, h),
      BUY: cohortMetrics(bySide("BUY"), h),
      SELL: cohortMetrics(bySide("SELL"), h),
      A: cohortMetrics(bySetup("A_MOMENTUM_IGNITION"), h),
      B: cohortMetrics(bySetup("B_FAST_BREAKOUT"), h),
      C: cohortMetrics(bySetup("C_PULLBACK_REACCEL"), h),
      eligibleOnly: cohortMetrics(
        clean.filter((c) => c.eligible),
        h
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
      for (const [k, v] of Object.entries(p.setupCTickStats.failedConditionCounts)) {
        acc.failedConditionCounts[k] = (acc.failedConditionCounts[k] ?? 0) + v;
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

  const inventory = {
    note: "Inventory of GOLD_HUNTER FAST live-shadow GCS runs under gold-hunter-fast/live-shadow/",
    calendarDaysWithUsableChunks: [
      "2026-08-13 (probe only)",
      "2026-08-14 (only substantial day)"
    ],
    independentMarketPeriods: 1,
    oosVerdict: "INSUFFICIENT INDEPENDENT DATA FOR OOS VALIDATION",
    oosExplanation:
      "All substantial continuous Spot+Depth streams are from a single London morning (2026-08-14). Chronological 50/25/25 splits within that morning are IN-SAMPLE RESEARCH only and must not be treated as true holdout across independent regimes.",
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
        "V1 fail run (~91 resyncs / DATA_STALE / BOOK_REBUILDING windows). Stormy early run also has frequent rebuild/stale. Contaminated windows excluded from clean set."
    },
    runsProcessed: processed.map((p) => ({
      runId: p.runId,
      label: p.label,
      eventCount: p.eventCount,
      marketEvents: p.marketEvents,
      span: p.span,
      candidateRows: p.candidates.length,
      cleanCandidates: p.candidates.filter((c) => !c.contaminated).length,
      contaminationStats: p.contaminationStats,
      setupCTickStats: p.setupCTickStats,
      configHashSeen: p.configHashSeen
    }))
  };

  const separators = featureSeparatorReport(discovery);

  const report = {
    title: "GOLD_HUNTER FAST V2 — Phase 1 Entry Edge Discovery",
    constraints: {
      pr119Frozen: true,
      pr121DraftUnmerged: true,
      deploy: false,
      thresholdChanges: false,
      brokerOrders: 0
    },
    frictionAssumed: FRICTION,
    inventory,
    sampleCounts: {
      candidatesBeforeExclusion: before,
      contaminatedExcluded: contaminated.length,
      cleanCandidates: clean.length,
      bySetupClean: {
        A: bySetup("A_MOMENTUM_IGNITION").length,
        B: bySetup("B_FAST_BREAKOUT").length,
        C: bySetup("C_PULLBACK_REACCEL").length
      },
      eligibleClean: {
        A: bySetup("A_MOMENTUM_IGNITION").filter((c) => c.eligible).length,
        B: bySetup("B_FAST_BREAKOUT").filter((c) => c.eligible).length,
        C: bySetup("C_PULLBACK_REACCEL").filter((c) => c.eligible).length
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
      contaminatedCandidates: p.candidates.filter((c) => c.contaminated).length
    })),
    excludedContaminatedPeriods: processed.map((p) => ({
      runId: p.runId,
      contaminationStats: p.contaminationStats
    })),
    setupC: {
      ...analyzeSetupC(clean),
      perTickStructuralCensus: setupCTickMerged,
      whyStructuralFails:
        "C requires impulse midVel3s + efficiency3s>0.35, pullback depth in (0.08, pullbackRetraceMax], then same-sign midVel250+acceleration+imbalance. Most feature ticks fail impulse/efficiency or pullback window — rawQuality stays null."
    },
    buyVsSell: {
      BUY: {
        n: bySide("BUY").length,
        eligible: bySide("BUY").filter((c) => c.eligible).length,
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
        n: bySide("SELL").length,
        eligible: bySide("SELL").filter((c) => c.eligible).length,
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
        "Quantile compare strong continuation vs immediate failure on DISCOVERY eligible only; 2D vel×spread conditional probs",
      ...separators,
      discoveryRuleScores3s: discoveryRuleScores,
      lockedForValidation: topIds
    },
    candidateInterpretableRules: lockedRules.map((r) => ({
      id: r.id,
      description: r.description
    })),
    discoveryResults: {
      set: "first 50% clean candidates by time (IN-SAMPLE)",
      n: discovery.length,
      rules3s: ruleTable(discovery, lockedRules, 3000),
      rules5s: ruleTable(discovery, lockedRules, 5000)
    },
    validationResults: {
      set: "next 25% clean candidates by time (IN-SAMPLE validation — same morning)",
      n: validation.length,
      rules3s: ruleTable(validation, lockedRules, 3000),
      rules5s: ruleTable(validation, lockedRules, 5000)
    },
    holdoutResults: {
      trueUntouchedIndependentHoldout: null,
      verdict: "INSUFFICIENT INDEPENDENT DATA FOR OOS VALIDATION",
      pseudoSameMorningHoldout: {
        warning:
          "NOT a true holdout. Same calendar morning / same regime. Reported only for transparency.",
        n: holdoutPseudo.length,
        rules3s: ruleTable(holdoutPseudo, lockedRules, 3000),
        rules5s: ruleTable(holdoutPseudo, lockedRules, 5000)
      }
    },
    evidenceAfterFriction: {
      anyPositiveProspectiveEdgeAfterFriction: null as boolean | null,
      note: "Requires n>=30 on discovery AND validation with after-friction meanSigned@3s > 0 for the SAME locked rule. Pseudo-holdout never used for claim.",
      details: [] as Array<{
        id: string;
        discoveryEdge: number | null;
        validationEdge: number | null;
        discoveryN: number;
        validationN: number;
        bothPositive: boolean;
      }>
    },
    overfittingWarnings: [
      "Only one independent London morning with substantial Level-II coverage.",
      "Chronological splits within that morning share microstructure regime, news window, and liquidity.",
      "Do not combine Phase 0 loss-reduction rules with Phase 1 discovery rules on the same sample.",
      "Soft near-miss expansion increases sample size but is not the live entry gate.",
      "INSUFFICIENT INDEPENDENT DATA FOR OOS VALIDATION — stop; do not pretend one morning split is strong OOS."
    ],
    moreDataRequired: true,
    dataCaptureOnlyDesign: {
      purpose:
        "Collect independent clean Spot+Depth periods for genuine OOS entry-edge research",
      scope: "SCOPE_VIEW only",
      brokerOrders: 0,
      shadowOrders: 0,
      mutationSurface: "NONE",
      capture: [
        "Spot + Depth events with receiveSeq",
        "raw transport/onSpot/onDepth callback timestamps (pre-queue)",
        "subscription flags (spotSubscribed/depthSubscribed)",
        "event-loop lag / heartbeat",
        "ordered queue depth + enqueue→process latency",
        "reconnect/resync lifecycle with classified reasons",
        "per-event raw A/B/C specialist telemetry (eligible/rawQuality/failedConditions/selected)",
        "book generation / crossed / warmingUp"
      ],
      deployNow: false,
      note: "Design only — DO NOT deploy as part of Phase 1"
    },
    artifactsCreated: [
      "backend/scripts/microEdge/goldHunterFastPhase1EntryEdgeCli.ts",
      "backend/src/services/microEdge/goldHunter/fast/artifacts/v2-phase1-entry-edge/PHASE1_REPORT.json",
      "backend/src/services/microEdge/goldHunter/fast/artifacts/v2-phase1-entry-edge/PHASE1_REPORT.md",
      "backend/src/services/microEdge/goldHunter/fast/artifacts/v2-phase1-entry-edge/DATASET_INVENTORY.json",
      "backend/src/services/microEdge/goldHunter/fast/artifacts/v2-phase1-entry-edge/candidates_clean_sample.jsonl"
    ]
  };

  // Fill evidenceAfterFriction — require BOTH discovery and validation positive
  const discRows = ruleTable(discovery, lockedRules, 3000);
  const valRows = ruleTable(validation, lockedRules, 3000);
  const evidence = discRows.map((d) => {
    const v = valRows.find((x) => x.id === d.id)!;
    const bothPositive =
      d.n >= 30 &&
      v.n >= 30 &&
      (d.estimatedEdgeAfterFriction ?? -1) > 0 &&
      (v.estimatedEdgeAfterFriction ?? -1) > 0;
    return {
      id: d.id,
      discoveryEdge: d.estimatedEdgeAfterFriction,
      validationEdge: v.estimatedEdgeAfterFriction,
      discoveryN: d.n,
      validationN: v.n,
      bothPositive
    };
  });
  report.evidenceAfterFriction.details = evidence;
  report.evidenceAfterFriction.anyPositiveProspectiveEdgeAfterFriction =
    evidence.some((e) => e.bothPositive);

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
        gcsRunChunkCounts: {
          note: "From live inventory at Phase 1 run time",
          substantial: {
            gh_fast_mssjjspo_8ubuxa: 22,
            gh_fast_mssmh2w2_ftl4pq: 3,
            gh_fast_mssnh4uq_v488yc: 32
          },
          unitTestStyle10chunkProbes: [
            "gh_fast_mssjhd5k_vpyoxj",
            "gh_fast_mssm6242_w86z29",
            "gh_fast_mssteivz_ye2udt",
            "gh_fast_msstewh4_8oa5hr",
            "gh_fast_msstfz57_b1zxva"
          ]
        }
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

  const md: string[] = [];
  md.push("# GOLD_HUNTER FAST V2 — Phase 1 Entry Edge Discovery");
  md.push("");
  md.push("Research only. No deploy. No threshold changes. No broker orders.");
  md.push("");
  md.push("## OOS verdict");
  md.push("**INSUFFICIENT INDEPENDENT DATA FOR OOS VALIDATION**");
  md.push("");
  md.push(inventory.oosExplanation);
  md.push("");
  md.push(
    `Clean candidates: ${clean.length} (excluded contaminated: ${contaminated.length} of ${before})`
  );
  md.push("");
  md.push("## 1. Dataset inventory");
  md.push(JSON.stringify(inventory.gcsRunCatalogSummary, null, 2));
  md.push("");
  md.push("## 2–3. Clean usable / excluded contaminated");
  md.push(JSON.stringify(report.cleanUsableEventPeriods, null, 2));
  md.push(JSON.stringify(report.excludedContaminatedPeriods, null, 2));
  md.push("");
  md.push("## 4. Candidate counts A/B/C (clean)");
  md.push(JSON.stringify(report.sampleCounts, null, 2));
  md.push("");
  md.push("## 5. Setup C");
  md.push(JSON.stringify(report.setupC, null, 2));
  md.push("");
  md.push("## 6–7. BUY vs SELL / forward tables");
  md.push("See PHASE1_REPORT.json keys `buyVsSell` and `forwardMovementTables`.");
  md.push("");
  md.push("## 8–9. Separators & interpretable rules");
  md.push(`Locked rules (DISCOVERY only): ${topIds.join(", ")}`);
  for (const r of discoveryRuleScores.slice(0, 6)) {
    md.push(
      `- ${r.id}: n=${r.n} edgeAfterFriction=${r.estimatedEdgeAfterFriction} meanSigned=${r.meanSigned} pFavFirst@0.05=${r.pFavFirst_0_05} pFavFirst@0.10=${r.pFavFirst_0_10}`
    );
  }
  md.push("");
  md.push("## 10–12. Discovery / validation / holdout");
  md.push(
    `- Discovery n=${discovery.length}; Validation n=${validation.length}; Pseudo-holdout n=${holdoutPseudo.length}`
  );
  md.push("- True untouched independent holdout: **null**");
  md.push("");
  md.push("## 13–15. Edge after friction / overfitting");
  md.push(
    `Any positive prospective edge (disc∩val, n≥30): **${report.evidenceAfterFriction.anyPositiveProspectiveEdgeAfterFriction}**`
  );
  md.push(JSON.stringify(report.evidenceAfterFriction.details, null, 2));
  md.push("");
  md.push("## 16–17. More data / capture-only design");
  md.push("YES — more independent periods required. Design in PHASE1_REPORT.json `dataCaptureOnlyDesign` (not deployed).");
  md.push("");
  md.push("## 18. Artifacts");
  for (const a of report.artifactsCreated) md.push(`- ${a}`);
  writeFileSync(join(outDir, "PHASE1_REPORT.md"), md.join("\n"));

  console.log(
    JSON.stringify(
      {
        outDir,
        clean: clean.length,
        contaminated: contaminated.length,
        anyPositiveEdge:
          report.evidenceAfterFriction.anyPositiveProspectiveEdgeAfterFriction,
        oos: inventory.oosVerdict,
        topDiscovery: discoveryRuleScores.slice(0, 5).map((r) => ({
          id: r.id,
          n: r.n,
          edge: r.estimatedEdgeAfterFriction
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
