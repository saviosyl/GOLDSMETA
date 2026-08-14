/**
 * Probe why validation optimizer produced ZERO_TRADES (no broker).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ndjsonGzToRows } from "../../src/services/microEdge/goldHunter/compactStorage";
import {
  buildAsOfSecondRows,
  buildLabeledResearchRows,
  type RawTick
} from "../../src/services/microEdge/goldHunter/asOfDataset";
import { chronologicalSplit } from "../../src/services/microEdge/goldHunter/chronologicalSplit";
import type { GhBarCtx } from "../../src/services/microEdge/goldHunter/features";
import {
  predictHorizon,
  trainHorizonModel
} from "../../src/services/microEdge/goldHunter/model";
import { GH_HORIZONS_SEC } from "../../src/services/microEdge/goldHunter/config";
import { classFromNets } from "../../src/services/microEdge/goldHunter/labels";
import { buildForecast } from "../../src/services/microEdge/goldHunter/forecastBuilder";
import { buildQuoteBook } from "../../src/services/microEdge/goldHunter/quoteValidity";
import {
  isBuyCandidate as buyGate,
  isSellCandidate as sellGate
} from "../../src/services/microEdge/goldHunter/signalPolicy";

function relabel(
  labels: Record<number, import("../../src/services/microEdge/goldHunter/types").GhLabel>,
  theta: number
) {
  const out: typeof labels = {};
  for (const h of GH_HORIZONS_SEC) {
    const lab = labels[h]!;
    if (
      lab.classLabel === "UNSCORABLE_DATA_GAP" ||
      lab.netLong == null ||
      lab.netShort == null
    ) {
      out[h] = lab;
    } else {
      out[h] = {
        ...lab,
        classLabel: classFromNets(lab.netLong, lab.netShort, theta)
      };
    }
  }
  return out;
}

async function main(): Promise<void> {
  const dir =
    process.env.GOLD_HUNTER_DATA_DIR ??
    join(process.cwd(), ".gold-hunter-data", "real-7d");
  const meta = JSON.parse(readFileSync(join(dir, "bars-meta.json"), "utf8")) as {
    fromUtc: string;
    toUtc: string;
  };
  const fromMs = Date.parse(meta.fromUtc);
  const toMs = Date.parse(meta.toUtc);
  const ticks = ndjsonGzToRows<RawTick>(
    readFileSync(join(dir, "ticks-bidask.ndjson.gz"))
  );
  const m1 = ndjsonGzToRows<GhBarCtx>(readFileSync(join(dir, "bars-m1.ndjson.gz")));
  const m5 = ndjsonGzToRows<GhBarCtx>(readFileSync(join(dir, "bars-m5.ndjson.gz")));
  const m15 = ndjsonGzToRows<GhBarCtx>(
    readFileSync(join(dir, "bars-m15.ndjson.gz"))
  );
  const { rows: seconds } = buildAsOfSecondRows(ticks, { fromMs, toMs });
  const labeled = buildLabeledResearchRows({
    seconds,
    theta: 0,
    m1Bars: m1,
    m5Bars: m5,
    m15Bars: m15
  });
  const split = chronologicalSplit(labeled.rows);
  const theta = 0.05;
  const train = split.train.map((r) => ({ ...r, labels: relabel(r.labels, theta) }));
  const val = split.validation.map((r) => ({
    ...r,
    labels: relabel(r.labels, theta)
  }));

  // subsample for speed
  const trainStep = 5;
  const trainSub = train.filter((_, i) => i % trainStep === 0);
  const bundles = GH_HORIZONS_SEC.map((h) =>
    trainHorizonModel(
      h,
      trainSub.map((r) => r.features),
      trainSub.map((r) => r.labels[h]!),
      val.map((r) => r.features),
      val.map((r) => r.labels[h]!)
    )
  );

  const loose = {
    pUp5: 0.4,
    pUp15: 0.4,
    pUp30: 0.4,
    pDown5: 0.4,
    pDown15: 0.4,
    pDown30: 0.4,
    p60OpposeMax: 0.9,
    consecutiveEvals: 1
  };
  const coarse = {
    pUp5: 0.6,
    pUp15: 0.6,
    pUp30: 0.55,
    pDown5: 0.6,
    pDown15: 0.6,
    pDown30: 0.55,
    p60OpposeMax: 0.55,
    consecutiveEvals: 1
  };

  let maxPUp5 = 0;
  let maxJoint = 0;
  let buyLoose = 0;
  let buyCoarse = 0;
  let sellLoose = 0;
  let sellCoarse = 0;
  let edgePosBuy = 0;
  let edgePosSell = 0;
  let highProbNoEdge = 0;
  const calPosBins: Record<string, number> = {};

  for (const b of bundles) {
    const posUp = b.calibrationUp.filter((x) => x.avgRealizedNet > 0 && x.count > 0);
    const posDown = b.calibrationDown.filter(
      (x) => x.avgRealizedNet > 0 && x.count > 0
    );
    calPosBins[`${b.horizonSec}`] = posUp.length + posDown.length;
  }

  for (const row of val) {
    const book = buildQuoteBook({
      nowMs: row.timestampMs,
      brokerTimestampMs: row.timestampMs,
      bid: row.quote.bid,
      ask: row.quote.ask,
      bidUpdatedMs: row.timestampMs,
      askUpdatedMs: row.timestampMs
    });
    const forecast = buildForecast({
      book,
      features: row.features,
      bundles,
      dataQuality: book.valid ? "OK" : "INVALID",
      thresholds: loose,
      researchModel: true
    });
    const h5 = forecast.horizons[5];
    const h15 = forecast.horizons[15];
    const h30 = forecast.horizons[30];
    maxPUp5 = Math.max(maxPUp5, h5.pUp);
    const joint = Math.min(h5.pUp, h15.pUp, h30.pUp);
    maxJoint = Math.max(maxJoint, joint);
    if ([h5, h15, h30].some((h) => h.expectedNetBuy > 0)) edgePosBuy += 1;
    if ([h5, h15, h30].some((h) => h.expectedNetSell > 0)) edgePosSell += 1;
    if (h5.pUp >= 0.6 && h15.pUp >= 0.6 && h30.pUp >= 0.55) {
      if (!(h5.expectedNetBuy > 0 || h15.expectedNetBuy > 0 || h30.expectedNetBuy > 0)) {
        highProbNoEdge += 1;
      }
    }
    if (buyGate(forecast, loose)) buyLoose += 1;
    if (buyGate(forecast, coarse)) buyCoarse += 1;
    if (sellGate(forecast, loose)) sellLoose += 1;
    if (sellGate(forecast, coarse)) sellCoarse += 1;
    void predictHorizon;
  }

  const out = {
    trainSubRows: trainSub.length,
    valRows: val.length,
    maxPUp5,
    maxJoint,
    buyLoose,
    buyCoarse,
    sellLoose,
    sellCoarse,
    edgePosBuy,
    edgePosSell,
    highProbNoEdge,
    calPosBins,
    calibSample: bundles.map((b) => ({
      h: b.horizonSec,
      up: b.calibrationUp.filter((x) => x.count > 0).slice(-3),
      down: b.calibrationDown.filter((x) => x.count > 0).slice(-3)
    }))
  };
  writeFileSync(join(dir, "zero-trade-probe.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
