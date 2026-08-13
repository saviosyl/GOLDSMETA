/** Full-validation probe: does any binary rank policy stay +EV off the subsample? */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ndjsonGzToRows } from "../../src/services/microEdge/goldHunter/compactStorage";
import {
  buildAsOfSecondRows,
  buildLabeledResearchRows,
  type RawTick
} from "../../src/services/microEdge/goldHunter/asOfDataset";
import type { GhBarCtx } from "../../src/services/microEdge/goldHunter/features";
import { chronologicalSplit } from "../../src/services/microEdge/goldHunter/chronologicalSplit";
import {
  featureVectorToV11Array,
  auditAndSelectFeatures,
  projectFeatures,
  v11FeatureKeyNames
} from "../../src/services/microEdge/goldHunter/v11/features";
import { GH_FEATURE_KEYS } from "../../src/services/microEdge/goldHunter/types";
import { classFromNets } from "../../src/services/microEdge/goldHunter/labels";
import { GH_HORIZONS_SEC } from "../../src/services/microEdge/goldHunter/config";
import {
  trainIndependentBinaryHorizon,
  predictBinarySides
} from "../../src/services/microEdge/goldHunter/v11/models";
import {
  ARCHITECTURES,
  ensembleBuyScore,
  ensembleSellScore
} from "../../src/services/microEdge/goldHunter/v11/policy";
import { runV11ShadowReplay } from "../../src/services/microEdge/goldHunter/v11/shadowReplay";
import { evaluateCandidateEligibility } from "../../src/services/microEdge/goldHunter/validationOptimizer";

function q(xs: number[], p: number): number {
  const a = [...xs].sort((u, v) => u - v);
  return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))]!;
}

async function main(): Promise<void> {
  const dir = join(process.cwd(), ".gold-hunter-data", "real-28d-pre-v1");
  const meta = JSON.parse(readFileSync(join(dir, "bars-meta.json"), "utf8"));
  const ticks = ndjsonGzToRows<RawTick>(
    readFileSync(join(dir, "ticks-bidask.ndjson.gz"))
  );
  const m1 = ndjsonGzToRows<GhBarCtx>(readFileSync(join(dir, "bars-m1.ndjson.gz")));
  const m5 = ndjsonGzToRows<GhBarCtx>(readFileSync(join(dir, "bars-m5.ndjson.gz")));
  const m15 = ndjsonGzToRows<GhBarCtx>(
    readFileSync(join(dir, "bars-m15.ndjson.gz"))
  );
  const { rows: seconds } = buildAsOfSecondRows(ticks, {
    fromMs: Date.parse(meta.fromUtc),
    toMs: Date.parse(meta.toUtc)
  });
  const labeled = buildLabeledResearchRows({
    seconds,
    theta: 0,
    m1Bars: m1,
    m5Bars: m5,
    m15Bars: m15
  });
  const split = chronologicalSplit(labeled.rows);
  const stride = Number(process.env.GOLD_HUNTER_V11_TRAIN_STRIDE ?? 4);
  const trainRows = split.train.filter((_, i) => i % stride === 0);
  const valRows = split.validation; // FULL validation
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
  const valX = projectFeatures(
    valRows.map((r) => featureVectorToV11Array(r.features)),
    keptIndices
  );
  console.log(
    JSON.stringify({
      event: "fullval_probe_start",
      train: trainRows.length,
      val: valRows.length
    })
  );

  const bundles = GH_HORIZONS_SEC.map((h) =>
    trainIndependentBinaryHorizon({
      horizonSec: h,
      trainX,
      trainBuyY: trainLab.map((l) =>
        l[h]!.netLong != null && l[h]!.netLong >= theta ? 1 : 0
      ),
      trainSellY: trainLab.map((l) =>
        l[h]!.netShort != null && l[h]!.netShort >= theta ? 1 : 0
      ),
      valX,
      valNetLong: valRows.map((r) => r.labels[h]!.netLong ?? 0),
      valNetShort: valRows.map((r) => r.labels[h]!.netShort ?? 0)
    })
  );

  const base = valRows.map((r, i) => {
    const byHorizon: Record<
      number,
      { buyScore: number; sellScore: number }
    > = {};
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

  const hits: unknown[] = [];
  const top: unknown[] = [];
  const focus = ARCHITECTURES.filter((a) =>
    ["B_15s_primary", "C_30s_primary", "E_5_15_ensemble", "F_15_30_ensemble"].includes(
      a.id
    )
  );

  for (const arch of focus) {
    const buyScores = base.map((r) =>
      ensembleBuyScore(arch.id, r.scores.byHorizon)
    );
    const sellScores = base.map((r) =>
      ensembleSellScore(arch.id, r.scores.byHorizon)
    );
    const rows = base.map((r, i) => ({
      ...r,
      scores: {
        ...r.scores,
        buyScore: buyScores[i]!,
        sellScore: sellScores[i]!
      }
    }));
    for (const rq of [0.98, 0.99, 0.995] as const) {
      for (const maxHoldSec of [5, 10, 15, 30]) {
        for (const maxSpread of [0.12, 0.14, 0.17]) {
          for (const opposeVetoScore of [999, 0.55]) {
            const policy = {
              architecture: arch.id,
              primaryHorizon: arch.primary,
              contextHorizons: arch.context,
              minEdge: 0,
              rankQuantile: rq,
              buyScoreFloor: q(buyScores, rq),
              sellScoreFloor: q(sellScores, rq),
              maxSpread,
              consecutiveEvals: 1,
              maxHoldSec,
              protectiveStop: 0.61,
              opposeVetoScore,
              theta
            };
            const trades = runV11ShadowReplay(rows, policy);
            const elig = evaluateCandidateEligibility(trades);
            const days = new Set(trades.map((t) => t.date)).size;
            const row = {
              arch: arch.id,
              rq,
              maxHoldSec,
              maxSpread,
              opposeVetoScore,
              trades: trades.length,
              days,
              exp: elig.stats.expectancy,
              net: elig.stats.netPnl,
              pf: elig.stats.profitFactor,
              dd: elig.stats.maxDrawdown,
              winRate: elig.stats.winRate,
              eligible: elig.eligible,
              reject: elig.rejectReason
            };
            top.push(row);
            if (elig.eligible && days >= 2) hits.push(row);
          }
        }
      }
    }
  }

  top.sort(
    (a, b) =>
      (b as { exp: number }).exp - (a as { exp: number }).exp
  );
  const out = {
    positiveHits: hits.length,
    bestPositive: hits.slice(0, 15),
    bestOverall: top.slice(0, 20)
  };
  writeFileSync(
    join(dir, "fullval-probe.json"),
    JSON.stringify(out, null, 2)
  );
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
