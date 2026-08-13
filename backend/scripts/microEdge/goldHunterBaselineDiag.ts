/**
 * Offline diagnostics for a cached real-7d dataset (no broker, no holdout tuning).
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
import { baselineComparisons } from "../../src/services/microEdge/goldHunter/baselines";
import type { GhBarCtx } from "../../src/services/microEdge/goldHunter/features";

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
  const { rows: seconds, stats } = buildAsOfSecondRows(ticks, { fromMs, toMs });
  const labeled = buildLabeledResearchRows({
    seconds,
    theta: 0.05,
    m1Bars: m1,
    m5Bars: m5,
    m15Bars: m15
  });
  const split = chronologicalSplit(labeled.rows);
  const bal: Record<string, number> = {};
  let pos = 0;
  let neg = 0;
  let nets = 0;
  for (const r of split.validation) {
    const lab = r.labels[15]!;
    bal[lab.classLabel] = (bal[lab.classLabel] || 0) + 1;
    if (lab.netLong != null) {
      nets += 1;
      if (lab.netLong > 0) pos += 1;
      if (lab.netLong < 0) neg += 1;
    }
  }
  const bases = baselineComparisons(split.holdout.map((r) => r.quote));
  const out = {
    grid: stats,
    validationLabel15: bal,
    validationNetLongPosNeg: { pos, neg, nets },
    baselines: Object.fromEntries(
      Object.entries(bases).map(([k, v]) => [
        k,
        {
          tradeCount: v.tradeCount,
          netPnl: v.netPnl,
          expectancy: v.expectancy,
          winRate: v.winRate,
          profitFactor: v.profitFactor,
          maxDrawdown: v.maxDrawdown
        }
      ])
    ),
    holdoutRangeUtc: {
      from: new Date(split.holdoutRange!.fromMs).toISOString(),
      to: new Date(split.holdoutRange!.toMs).toISOString()
    }
  };
  writeFileSync(join(dir, "baseline-diag.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
