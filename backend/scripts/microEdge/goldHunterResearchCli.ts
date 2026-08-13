/**
 * Offline GOLD_HUNTER research CLI (synthetic ticks when no live history file).
 * Does NOT place broker orders. Does NOT deploy.
 *
 * Usage:
 *   npx tsx scripts/microEdge/goldHunterResearchCli.ts
 *   GOLD_HUNTER_TICKS_JSON=./ticks.json npx tsx scripts/microEdge/goldHunterResearchCli.ts
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  runGoldHunterResearchPipeline,
  synthesizeResearchTicks
} from "../../src/services/microEdge/goldHunter/researchPipeline";
import type { RawTick } from "../../src/services/microEdge/goldHunter/asOfDataset";
import { getGoldHunterStore } from "../../src/services/microEdge/goldHunter/goldHunterStore";
import { buildDailySummary } from "../../src/services/microEdge/goldHunter/dailyPnL";

async function main(): Promise<void> {
  let ticks: RawTick[] = [];
  const path = process.env.GOLD_HUNTER_TICKS_JSON;
  if (path && existsSync(path)) {
    ticks = JSON.parse(readFileSync(path, "utf8")) as RawTick[];
    console.log(`Loaded ${ticks.length} ticks from ${path}`);
  } else {
    // ~2 trading days of 1s ticks for offline pipeline smoke
    const fromMs = Date.UTC(2026, 7, 10, 7, 0, 0);
    ticks = synthesizeResearchTicks({ fromMs, seconds: 60 * 60 * 8, seed: 7 });
    console.log(
      `Synthesized ${ticks.length} ticks for offline research (${ticks.length / 2} seconds)`
    );
  }

  const result = await runGoldHunterResearchPipeline({
    ticks,
    persist: true,
    dataDir: join(process.cwd(), ".gold-hunter-data")
  });

  const store = getGoldHunterStore();
  store.setArtifact(result.artifact);
  store.setDataQuality(result.dataQuality);
  for (const t of result.holdoutTrades) {
    // seed store via shadow completed list
  }
  // Manually inject trades into store
  const shadow = store.getShadowState();
  store.setShadowState({
    ...shadow,
    completedTrades: result.holdoutTrades
  });
  if (result.holdoutTrades.length) {
    const date = result.holdoutTrades[0]!.date;
    store.upsertDaily(buildDailySummary(result.holdoutTrades, { date }));
  }

  const outDir = join(process.cwd(), ".gold-hunter-data");
  mkdirSync(outDir, { recursive: true });
  const report = {
    strategyVersion: result.artifact.strategyVersion,
    modelVersion: result.artifact.modelVersion,
    qualificationStatus: result.artifact.qualificationStatus,
    dataQuality: result.dataQuality,
    bidTicks: result.bidTicks,
    askTicks: result.askTicks,
    secondRows: result.secondRows,
    unscorableFeatureRows: result.unscorableFeatureRows,
    unscorableLabelRows: result.unscorableLabelRows,
    trainCount: result.trainCount,
    validationCount: result.validationCount,
    holdoutCount: result.holdoutCount,
    trainRange: result.trainRange,
    validationRange: result.validationRange,
    holdoutRange: result.holdoutRange,
    selectedTheta: result.selectedTheta,
    selectedEntry: result.selectedEntry,
    selectedMaxHoldSec: result.selectedMaxHoldSec,
    horizonMetrics: result.horizonMetrics,
    holdoutBacktest: result.holdoutBacktest,
    baselines: result.baselines,
    holdoutTradeCount: result.holdoutTrades.length,
    brokerOrders: 0,
    evaluationBrokerRequests: 0
  };
  writeFileSync(join(outDir, "phase2b-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${join(outDir, "phase2b-report.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
