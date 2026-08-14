/** Quick probe: do V1.1 rank policies produce trades, and why rejected? */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ndjsonGzToRows } from "../../src/services/microEdge/goldHunter/compactStorage";
import {
  buildAsOfSecondRows,
  buildLabeledResearchRows,
  type RawTick
} from "../../src/services/microEdge/goldHunter/asOfDataset";
import type { GhBarCtx } from "../../src/services/microEdge/goldHunter/features";
import { chronologicalSplit } from "../../src/services/microEdge/goldHunter/chronologicalSplit";
import { featureVectorToV11Array, auditAndSelectFeatures, projectFeatures, v11FeatureKeyNames } from "../../src/services/microEdge/goldHunter/v11/features";
import { GH_FEATURE_KEYS } from "../../src/services/microEdge/goldHunter/types";
import { classFromNets } from "../../src/services/microEdge/goldHunter/labels";
import { GH_HORIZONS_SEC } from "../../src/services/microEdge/goldHunter/config";
import { trainIndependentBinaryHorizon, predictBinarySides, trainDirectEdgeHorizon, predictEdge } from "../../src/services/microEdge/goldHunter/v11/models";
import { ensembleBuyScore, ensembleSellScore } from "../../src/services/microEdge/goldHunter/v11/policy";
import { runV11ShadowReplay } from "../../src/services/microEdge/goldHunter/v11/shadowReplay";
import { evaluateCandidateEligibility } from "../../src/services/microEdge/goldHunter/validationOptimizer";

function q(xs: number[], p: number): number {
  const a = [...xs].sort((u, v) => u - v);
  return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))]!;
}

async function main(): Promise<void> {
  const dir = join(process.cwd(), ".gold-hunter-data", "real-28d-pre-v1");
  const meta = JSON.parse(readFileSync(join(dir, "bars-meta.json"), "utf8"));
  const ticks = ndjsonGzToRows<RawTick>(readFileSync(join(dir, "ticks-bidask.ndjson.gz")));
  const m1 = ndjsonGzToRows<GhBarCtx>(readFileSync(join(dir, "bars-m1.ndjson.gz")));
  const m5 = ndjsonGzToRows<GhBarCtx>(readFileSync(join(dir, "bars-m5.ndjson.gz")));
  const m15 = ndjsonGzToRows<GhBarCtx>(readFileSync(join(dir, "bars-m15.ndjson.gz")));
  const { rows: seconds } = buildAsOfSecondRows(ticks, {
    fromMs: Date.parse(meta.fromUtc),
    toMs: Date.parse(meta.toUtc)
  });
  const labeled = buildLabeledResearchRows({ seconds, theta: 0, m1Bars: m1, m5Bars: m5, m15Bars: m15 });
  const split = chronologicalSplit(labeled.rows);
  const stride = 4;
  const trainRows = split.train.filter((_, i) => i % stride === 0);
  const valRows = split.validation.filter((_, i) => i % 3 === 0).slice(0, 80000);
  const theta = 0.05;
  const trainLab = trainRows.map((r) => {
    const out: Record<number, (typeof r.labels)[number]> = {};
    for (const h of GH_HORIZONS_SEC) {
      const lab = r.labels[h]!;
      out[h] =
        lab.netLong == null || lab.netShort == null
          ? lab
          : { ...lab, classLabel: classFromNets(lab.netLong, lab.netShort, theta) };
    }
    return out;
  });
  const keys = v11FeatureKeyNames(GH_FEATURE_KEYS as unknown as string[]);
  const trainXfull = trainRows.map((r) => featureVectorToV11Array(r.features));
  const { keptIndices } = auditAndSelectFeatures(trainXfull, keys);
  const trainX = projectFeatures(trainXfull, keptIndices);
  const valX = projectFeatures(valRows.map((r) => featureVectorToV11Array(r.features)), keptIndices);

  const bundles = GH_HORIZONS_SEC.map((h) =>
    trainIndependentBinaryHorizon({
      horizonSec: h,
      trainX,
      trainBuyY: trainLab.map((l) => (l[h]!.netLong != null && l[h]!.netLong >= theta ? 1 : 0)),
      trainSellY: trainLab.map((l) => (l[h]!.netShort != null && l[h]!.netShort >= theta ? 1 : 0)),
      valX,
      valNetLong: valRows.map((r) => r.labels[h]!.netLong ?? 0),
      valNetShort: valRows.map((r) => r.labels[h]!.netShort ?? 0)
    })
  );
  const ridge = GH_HORIZONS_SEC.map((h) =>
    trainDirectEdgeHorizon({
      horizonSec: h,
      trainX,
      trainNetLong: trainLab.map((l) => l[h]!.netLong ?? 0),
      trainNetShort: trainLab.map((l) => l[h]!.netShort ?? 0),
      kind: "ridge"
    })
  );

  const scoreRows = valRows.map((r, i) => {
    const byHorizon: Record<number, { buyScore: number; sellScore: number }> = {};
    for (const b of bundles) {
      const p = predictBinarySides(b, valX[i]!);
      byHorizon[b.horizonSec] = { buyScore: p.pBuy, sellScore: p.pSell };
    }
    return {
      timestampMs: r.timestampMs,
      bid: r.quote.bid,
      ask: r.quote.ask,
      spread: r.quote.ask - r.quote.bid,
      regime: r.features.regime,
      dataOk: true,
      scores: {
        buyScore: byHorizon[15]!.buyScore,
        sellScore: byHorizon[15]!.sellScore,
        byHorizon
      }
    };
  });
  const buyScores = scoreRows.map((r) => ensembleBuyScore("B_15s_primary", r.scores.byHorizon));
  const sellScores = scoreRows.map((r) => ensembleSellScore("B_15s_primary", r.scores.byHorizon));
  console.log(JSON.stringify({
    pBuy: { p50: q(buyScores, 0.5), p90: q(buyScores, 0.9), p95: q(buyScores, 0.95), p99: q(buyScores, 0.99), max: Math.max(...buyScores) },
    pSell: { p50: q(sellScores, 0.5), p90: q(sellScores, 0.9), p95: q(sellScores, 0.95), max: Math.max(...sellScores) }
  }, null, 2));

  for (const rq of [0.9, 0.95, 0.98, 0.99]) {
    const policy = {
      architecture: "B_15s_primary" as const,
      primaryHorizon: 15 as const,
      contextHorizons: [5 as const, 30 as const],
      minEdge: 0,
      rankQuantile: rq,
      buyScoreFloor: q(buyScores, rq),
      sellScoreFloor: q(sellScores, rq),
      maxSpread: 0.17,
      consecutiveEvals: 1,
      maxHoldSec: 30,
      protectiveStop: 0.6,
      opposeVetoScore: 0.9,
      theta
    };
    const rows = scoreRows.map((r, i) => ({
      ...r,
      scores: { ...r.scores, buyScore: buyScores[i]!, sellScore: sellScores[i]! }
    }));
    const trades = runV11ShadowReplay(rows, policy);
    const elig = evaluateCandidateEligibility(trades);
    console.log(JSON.stringify({
      rq,
      floors: { buy: policy.buyScoreFloor, sell: policy.sellScoreFloor },
      tradeCount: trades.length,
      expectancy: elig.stats.expectancy,
      netPnl: elig.stats.netPnl,
      pf: elig.stats.profitFactor,
      eligible: elig.eligible,
      reject: elig.rejectReason,
      days: new Set(trades.map((t) => t.date)).size
    }));
  }

  // ridge top 5%
  const ridgeRows = valRows.map((r, i) => {
    const byHorizon: Record<number, { buyScore: number; sellScore: number }> = {};
    for (const b of ridge) {
      const e = predictEdge(b, valX[i]!);
      byHorizon[b.horizonSec] = { buyScore: e.expectedNetLong, sellScore: e.expectedNetShort };
    }
    return {
      timestampMs: r.timestampMs,
      bid: r.quote.bid,
      ask: r.quote.ask,
      spread: r.quote.ask - r.quote.bid,
      regime: r.features.regime,
      dataOk: true,
      scores: { buyScore: byHorizon[15]!.buyScore, sellScore: byHorizon[15]!.sellScore, byHorizon }
    };
  });
  const rb = ridgeRows.map((r) => ensembleBuyScore("B_15s_primary", r.scores.byHorizon));
  const rs = ridgeRows.map((r) => ensembleSellScore("B_15s_primary", r.scores.byHorizon));
  console.log(JSON.stringify({
    ridgeBuy: { p50: q(rb, 0.5), p95: q(rb, 0.95), max: Math.max(...rb) },
    ridgeSell: { p50: q(rs, 0.5), p95: q(rs, 0.95), max: Math.max(...rs) }
  }));
  const policyR = {
    architecture: "B_15s_primary" as const,
    primaryHorizon: 15 as const,
    contextHorizons: [5 as const, 30 as const],
    minEdge: 0,
    rankQuantile: 0.95,
    buyScoreFloor: q(rb, 0.95),
    sellScoreFloor: q(rs, 0.95),
    maxSpread: 0.17,
    consecutiveEvals: 1,
    maxHoldSec: 30,
    protectiveStop: 0.6,
    opposeVetoScore: 999,
    theta
  };
  const rowsR = ridgeRows.map((r, i) => ({
    ...r,
    scores: { ...r.scores, buyScore: rb[i]!, sellScore: rs[i]! }
  }));
  const tr = runV11ShadowReplay(rowsR, policyR);
  const el = evaluateCandidateEligibility(tr);
  console.log(JSON.stringify({
    ridgeTop5: {
      trades: tr.length,
      exp: el.stats.expectancy,
      net: el.stats.netPnl,
      pf: el.stats.profitFactor,
      eligible: el.eligible,
      reject: el.rejectReason,
      days: new Set(tr.map((t) => t.date)).size
    }
  }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
