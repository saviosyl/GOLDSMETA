/**
 * GOLD_HUNTER V1.1 research on cached 28d pre-V1 dataset + post-audit on V1 7d.
 * No broker. No retune after freeze.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ndjsonGzToRows } from "../../src/services/microEdge/goldHunter/compactStorage";
import type { RawTick } from "../../src/services/microEdge/goldHunter/asOfDataset";
import type { GhBarCtx } from "../../src/services/microEdge/goldHunter/features";
import { runGoldHunterV11Pipeline } from "../../src/services/microEdge/goldHunter/v11/pipeline";
import {
  V1_REAL_7D_WINDOW_END_MS,
  V1_REAL_7D_WINDOW_START_MS
} from "../../src/services/microEdge/goldHunter/v11/versions";
import { MICRO_BROKER_EXECUTION_ENABLED } from "../../src/services/microEdge/config";

async function main(): Promise<void> {
  if (MICRO_BROKER_EXECUTION_ENABLED !== false) {
    throw new Error("REFUSING: execution must be false");
  }
  const dir =
    process.env.GOLD_HUNTER_V11_DATA_DIR ??
    join(process.cwd(), ".gold-hunter-data", "real-28d-pre-v1");
  const metaPath = join(dir, "bars-meta.json");
  if (!existsSync(metaPath)) {
    throw new Error(`V11_DATA_MISSING: run gold-hunter:v11-fetch first (${dir})`);
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

  const postDir =
    process.env.GOLD_HUNTER_V1_7D_DIR ??
    join(process.cwd(), ".gold-hunter-data", "real-7d");
  let postAuditTicks: RawTick[] | undefined;
  let postM1: GhBarCtx[] | undefined;
  let postM5: GhBarCtx[] | undefined;
  let postM15: GhBarCtx[] | undefined;
  if (existsSync(join(postDir, "ticks-bidask.ndjson.gz"))) {
    postAuditTicks = ndjsonGzToRows<RawTick>(
      readFileSync(join(postDir, "ticks-bidask.ndjson.gz"))
    );
    postM1 = existsSync(join(postDir, "bars-m1.ndjson.gz"))
      ? ndjsonGzToRows<GhBarCtx>(readFileSync(join(postDir, "bars-m1.ndjson.gz")))
      : [];
    postM5 = existsSync(join(postDir, "bars-m5.ndjson.gz"))
      ? ndjsonGzToRows<GhBarCtx>(readFileSync(join(postDir, "bars-m5.ndjson.gz")))
      : [];
    postM15 = existsSync(join(postDir, "bars-m15.ndjson.gz"))
      ? ndjsonGzToRows<GhBarCtx>(readFileSync(join(postDir, "bars-m15.ndjson.gz")))
      : [];
  }

  const result = await runGoldHunterV11Pipeline({
    ticks,
    m1Bars: m1,
    m5Bars: m5,
    m15Bars: m15,
    dataFromMs: Date.parse(meta.fromUtc),
    dataToMs: Date.parse(meta.toUtc),
    postAuditTicks,
    postAuditM1: postM1,
    postAuditM5: postM5,
    postAuditM15: postM15,
    postAuditFromMs: V1_REAL_7D_WINDOW_START_MS,
    postAuditToMs: V1_REAL_7D_WINDOW_END_MS,
    persist: true,
    dataDir: dir,
    trainStride: Number(process.env.GOLD_HUNTER_V11_TRAIN_STRIDE ?? 2),
    recoveryMode: true
  });

  console.log(JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      event: "gh_v11_research_done",
      qualificationStatus: result.qualificationStatus,
      frozen: result.frozenConfigSha256,
      holdoutLabel: result.holdoutLabel,
      holdoutNet: result.holdout?.netPnl ?? null,
      selectedFamily: result.selectedFamily,
      validationTradesPerHour: result.validation?.tradesPerHour ?? null,
      activityBand: result.validation?.activity.activityBand ?? null
    })
  );
}

main().catch((e) => {
  console.error(
    JSON.stringify({
      event: "gh_v11_research_blocked",
      message: e instanceof Error ? e.message : String(e)
    })
  );
  process.exit(1);
});
