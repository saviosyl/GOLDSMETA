/**
 * GOLD_HUNTER V1.2 walk-forward research on cached pre-V1.1 dataset.
 * Known stress periods loaded AFTER freeze only (no retune).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ndjsonGzToRows } from "../../src/services/microEdge/goldHunter/compactStorage";
import type { RawTick } from "../../src/services/microEdge/goldHunter/asOfDataset";
import type { GhBarCtx } from "../../src/services/microEdge/goldHunter/features";
import {
  loadStressBundleFromDir,
  runGoldHunterV12Pipeline
} from "../../src/services/microEdge/goldHunter/v12/pipeline";
import {
  V11_DEV_WINDOW_END_MS,
  V11_DEV_WINDOW_START_MS,
  V1_REAL_7D_WINDOW_END_MS,
  V1_REAL_7D_WINDOW_START_MS
} from "../../src/services/microEdge/goldHunter/v12/versions";
import { MICRO_BROKER_EXECUTION_ENABLED } from "../../src/services/microEdge/config";

async function main(): Promise<void> {
  if (MICRO_BROKER_EXECUTION_ENABLED !== false) {
    throw new Error("REFUSING: execution must be false");
  }
  const dir =
    process.env.GOLD_HUNTER_V12_DATA_DIR ??
    join(process.cwd(), ".gold-hunter-data", "real-56d-pre-v11");
  const metaPath = join(dir, "bars-meta.json");
  if (!existsSync(metaPath)) {
    throw new Error(`V12_DATA_MISSING: run gold-hunter:v12-fetch first (${dir})`);
  }
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
    fromUtc: string;
    toUtc: string;
  };
  const ticks = ndjsonGzToRows<RawTick>(
    readFileSync(join(dir, "ticks-bidask.ndjson.gz"))
  );
  const m1 = ndjsonGzToRows<GhBarCtx>(readFileSync(join(dir, "bars-m1.ndjson.gz")));
  const m5 = ndjsonGzToRows<GhBarCtx>(readFileSync(join(dir, "bars-m5.ndjson.gz")));
  const m15 = ndjsonGzToRows<GhBarCtx>(
    readFileSync(join(dir, "bars-m15.ndjson.gz"))
  );

  const stressBundles = [
    loadStressBundleFromDir(
      "V11_DEVELOPMENT",
      join(process.cwd(), ".gold-hunter-data", "real-28d-pre-v1"),
      V11_DEV_WINDOW_START_MS,
      V11_DEV_WINDOW_END_MS
    ),
    loadStressBundleFromDir(
      "AUG6_13_KNOWN_AUDIT",
      join(process.cwd(), ".gold-hunter-data", "real-7d"),
      V1_REAL_7D_WINDOW_START_MS,
      V1_REAL_7D_WINDOW_END_MS
    )
  ].filter((x): x is NonNullable<typeof x> => x != null);

  const result = await runGoldHunterV12Pipeline({
    ticks,
    m1Bars: m1,
    m5Bars: m5,
    m15Bars: m15,
    dataFromMs: Date.parse(meta.fromUtc),
    dataToMs: Date.parse(meta.toUtc),
    persist: true,
    dataDir: dir,
    trainStride: Number(process.env.GOLD_HUNTER_V12_TRAIN_STRIDE ?? 6),
    stressBundles
  });

  console.log(
    JSON.stringify({
      event: "gh_v12_research_summary",
      qualificationStatus: result.qualificationStatus,
      frozen: result.frozenConfigSha256,
      folds: result.foldCount,
      medianExp: result.stability.medianExpectancy,
      holdoutNet: result.holdout?.netPnl ?? null,
      holdoutTradesPerHour: result.holdout?.tradesPerHour ?? null,
      selectedFamily: result.selectedFamily,
      stress: result.knownStressReplay.map((s) => ({
        id: s.id,
        net: s.netPnl,
        trades: s.trades
      }))
    })
  );
}

main().catch((e) => {
  console.error(
    JSON.stringify({
      event: "gh_v12_research_blocked",
      message: e instanceof Error ? e.message : String(e)
    })
  );
  process.exit(1);
});
