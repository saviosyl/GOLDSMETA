/**
 * GOLD_HUNTER Phase 2B.1 — REAL Pepperstone DEMO 7-day research qualification.
 * READ-ONLY. No broker orders. No synthetic fallback.
 *
 *   MICRO_STORAGE_MODE=firestore MICRO_DEPLOYED_RUNTIME=true \
 *   MICRO_COLLECTOR_VAULT_UID=... \
 *   npx tsx scripts/microEdge/goldHunterReal7dCli.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { MICRO_BROKER_EXECUTION_ENABLED } from "../../src/services/microEdge/config";
import {
  credentialsFromVault,
  refreshVaultTokensIfNeeded
} from "../../src/services/microEdge/marketData/oauthService";
import { createMicroTokenVault } from "../../src/services/microEdge/marketData/tokenVault";
import { RealMicroCTraderTransport } from "../../src/services/microEdge/marketData/microCTraderTransport";
import { resolveMicroXauUsd } from "../../src/services/microEdge/marketData/microCTraderSymbolResolver";
import { fetchHistoricalTicksWindow } from "../../src/services/microEdge/marketData/historicalTicks";
import { createMicroPacer } from "../../src/services/microEdge/marketData/pacing";
import { resolveMicroStorageMode } from "../../src/services/microEdge/marketData/storageMode";
import {
  chunkHistoricalWindows,
  fetchTrendbarsWindow,
  filterCompletedBars
} from "../../src/services/microEdge/marketData/microCTraderTrendbars";
import { runGoldHunterResearchPipeline } from "../../src/services/microEdge/goldHunter/researchPipeline";
import type { RawTick } from "../../src/services/microEdge/goldHunter/asOfDataset";
import type { GhBarCtx } from "../../src/services/microEdge/goldHunter/features";
import {
  rowsToNdjson,
  writeManifest
} from "../../src/services/microEdge/goldHunter/compactStorage";
import { GH_HISTORICAL_MIN_INTERVAL_MS } from "../../src/services/microEdge/goldHunter/config";
import { writeFile } from "node:fs/promises";

function initFirebase(): void {
  if (getApps().length) return;
  const raw = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (raw) {
    const sa = JSON.parse(raw) as {
      project_id: string;
      client_email: string;
      private_key: string;
    };
    initializeApp({
      credential: cert({
        projectId: sa.project_id,
        clientEmail: sa.client_email,
        privateKey: sa.private_key
      }),
      projectId: sa.project_id
    });
    return;
  }
  initializeApp({ projectId: process.env.GCLOUD_PROJECT || "goldmeta-web" });
}

function toBars(
  raw: Array<{
    openTimeMs: number;
    closeTimeMs: number;
    open: number;
    high: number;
    low: number;
    close: number;
    tickVolume: number;
  }>
): GhBarCtx[] {
  return raw.map((b) => ({
    openTimeMs: b.openTimeMs,
    closeTimeMs: b.closeTimeMs,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    tickVolume: b.tickVolume
  }));
}

async function main(): Promise<void> {
  if (MICRO_BROKER_EXECUTION_ENABLED !== false) {
    throw new Error("REFUSING: MICRO_BROKER_EXECUTION_ENABLED must be false");
  }
  initFirebase();

  const vaultUid = (process.env.MICRO_COLLECTOR_VAULT_UID ?? "").trim();
  if (!vaultUid) throw new Error("MICRO_COLLECTOR_VAULT_UID_MISSING");

  const storageMode = resolveMicroStorageMode();
  if (storageMode !== "firestore") {
    throw new Error(`REFUSING: storageMode=${storageMode} (require firestore)`);
  }

  void createMicroTokenVault();
  await refreshVaultTokensIfNeeded(vaultUid);
  const creds = await credentialsFromVault(vaultUid);
  if (!creds) throw new Error("MICRO_VAULT_CREDENTIALS_UNAVAILABLE");
  if (creds.environment !== "DEMO") throw new Error("REAL7D_DEMO_ONLY");

  const outDir =
    process.env.GOLD_HUNTER_DATA_DIR ??
    join(process.cwd(), ".gold-hunter-data", "real-7d");
  mkdirSync(outDir, { recursive: true });

  const toMs = Date.now();
  const fromMs = toMs - 7 * 24 * 60 * 60 * 1000;
  const minIntervalMs = Number(
    process.env.MICRO_HISTORICAL_MIN_INTERVAL_MS ?? GH_HISTORICAL_MIN_INTERVAL_MS
  );
  const pacer = createMicroPacer({ minIntervalMs });

  console.log(
    JSON.stringify({
      event: "gh_real7d_start",
      fromUtc: new Date(fromMs).toISOString(),
      toUtc: new Date(toMs).toISOString(),
      environment: creds.environment,
      accountMasked:
        creds.accountId.length <= 4
          ? `****${creds.accountId}`
          : `****${creds.accountId.slice(-4)}`,
      mutationSurface: "NONE",
      minIntervalMs
    })
  );

  const transport = new RealMicroCTraderTransport(creds);
  if (transport.mutationSurface !== "NONE") {
    throw new Error("REFUSING: mutation surface is not NONE");
  }
  await transport.connect();

  try {
    const symbols = await transport.listSymbols();
    const resolved = resolveMicroXauUsd(symbols);
    if (!resolved) throw new Error("MICRO_XAUUSD_NOT_FOUND");

    console.log(
      JSON.stringify({
        event: "gh_real7d_symbol",
        symbolName: resolved.symbolName,
        symbolId: resolved.symbolId
      })
    );

    console.log(JSON.stringify({ event: "gh_real7d_fetch_bid" }));
    const bidTicks = await fetchHistoricalTicksWindow({
      transport,
      accountId: creds.accountId,
      symbolId: resolved.symbolId,
      side: "BID",
      fromMs,
      toMs,
      digits: resolved.digits ?? 2,
      pacer
    });
    console.log(
      JSON.stringify({ event: "gh_real7d_bid_done", count: bidTicks.length })
    );

    console.log(JSON.stringify({ event: "gh_real7d_fetch_ask" }));
    const askTicks = await fetchHistoricalTicksWindow({
      transport,
      accountId: creds.accountId,
      symbolId: resolved.symbolId,
      side: "ASK",
      fromMs,
      toMs,
      digits: resolved.digits ?? 2,
      pacer
    });
    console.log(
      JSON.stringify({ event: "gh_real7d_ask_done", count: askTicks.length })
    );

    if (!bidTicks.length || !askTicks.length) {
      throw Object.assign(
        new Error("REAL_HISTORY_EMPTY: no BID/ASK ticks returned"),
        { code: "REAL_HISTORY_EMPTY" }
      );
    }

    const ticks: RawTick[] = [
      ...bidTicks.map((t) => ({
        timestampMs: t.brokerTimestampMs,
        side: "BID" as const,
        price: t.price
      })),
      ...askTicks.map((t) => ({
        timestampMs: t.brokerTimestampMs,
        side: "ASK" as const,
        price: t.price
      }))
    ].sort((a, b) => a.timestampMs - b.timestampMs);

    // Persist compressed ticks (not to git)
    await writeFile(join(outDir, "ticks-bidask.ndjson.gz"), rowsToNdjson(ticks));
    await writeManifest(outDir, {
      datasetId: `real7d-${fromMs}-${toMs}`,
      featureSchemaVersion: "gh-features-v1.0.1",
      createdAt: new Date().toISOString(),
      chunks: [
        {
          chunkId: "ticks-bidask",
          fromMs,
          toMs,
          rowCount: ticks.length,
          sha256: "see-file",
          path: join(outDir, "ticks-bidask.ndjson.gz")
        }
      ],
      totalRows: ticks.length,
      datasetHash: `${fromMs}-${toMs}-${ticks.length}`
    });

    const fetchBars = async (tf: "M1" | "M5" | "M15") => {
      const chunks = chunkHistoricalWindows({
        timeframe: tf,
        fromMs,
        toMs,
        barsPerChunk: 200
      });
      const all: Array<{
        openTimeMs: number;
        closeTimeMs: number;
        open: number;
        high: number;
        low: number;
        close: number;
        tickVolume: number;
      }> = [];
      for (const ch of chunks) {
        await pacer.waitTurn();
        const res = await fetchTrendbarsWindow({
          transport,
          symbolId: resolved.symbolId,
          timeframe: tf,
          fromTimestamp: ch.fromMs,
          toTimestamp: ch.toMs,
          count: 200
        });
        all.push(...filterCompletedBars(res, toMs));
      }
      // dedupe by openTime
      const seen = new Set<number>();
      const deduped: typeof all = [];
      for (const b of all.sort((a, b) => a.openTimeMs - b.openTimeMs)) {
        if (seen.has(b.openTimeMs)) continue;
        seen.add(b.openTimeMs);
        deduped.push(b);
      }
      return toBars(deduped);
    };

    console.log(JSON.stringify({ event: "gh_real7d_fetch_bars" }));
    const m1Bars = await fetchBars("M1");
    const m5Bars = await fetchBars("M5");
    const m15Bars = await fetchBars("M15");
    console.log(
      JSON.stringify({
        event: "gh_real7d_bars_done",
        M1: m1Bars.length,
        M5: m5Bars.length,
        M15: m15Bars.length
      })
    );

    await writeFile(
      join(outDir, "bars-meta.json"),
      JSON.stringify(
        {
          fromUtc: new Date(fromMs).toISOString(),
          toUtc: new Date(toMs).toISOString(),
          M1: m1Bars.length,
          M5: m5Bars.length,
          M15: m15Bars.length,
          bidTicks: bidTicks.length,
          askTicks: askTicks.length
        },
        null,
        2
      )
    );

    console.log(JSON.stringify({ event: "gh_real7d_pipeline_start" }));
    const result = await runGoldHunterResearchPipeline({
      ticks,
      m1Bars,
      m5Bars,
      m15Bars,
      dataSource: "PEPPERSTONE_DEMO_REAL",
      requireRealData: true,
      persist: true,
      dataDir: outDir,
      dataFromMs: fromMs,
      dataToMs: toMs
    });

    const report = {
      researchRunId: result.researchRunId,
      dataSource: result.dataSource,
      qualificationStatus: result.qualificationStatus,
      lowSampleValidation: result.lowSampleValidation,
      fromUtc: new Date(fromMs).toISOString(),
      toUtc: new Date(toMs).toISOString(),
      dataQuality: result.dataQuality,
      gridStats: result.gridStats,
      bidWire: result.dataQuality.bid.totalWireTicks,
      bidValid: result.dataQuality.bid.validTicks,
      askWire: result.dataQuality.ask.totalWireTicks,
      askValid: result.dataQuality.ask.validTicks,
      m1BarCount: result.m1BarCount,
      m5BarCount: result.m5BarCount,
      m15BarCount: result.m15BarCount,
      trainCount: result.trainCount,
      validationCount: result.validationCount,
      holdoutCount: result.holdoutCount,
      purgedCount: result.purgedCount,
      trainRangeUtc: result.trainRangeUtc,
      validationRangeUtc: result.validationRangeUtc,
      holdoutRangeUtc: result.holdoutRangeUtc,
      selectedTheta: result.selectedTheta,
      selectedEntry: result.selectedEntry,
      selectedMaxHoldSec: result.selectedMaxHoldSec,
      protectiveStop: result.protectiveStop,
      frozenConfigSha256: result.frozenConfigSha256,
      optimizerBest: result.optimizer?.best
        ? {
            tradeCount: result.optimizer.best.tradeCount,
            expectancy: result.optimizer.best.expectancy,
            netPnl: result.optimizer.best.netPnl,
            score: result.optimizer.best.score,
            lowSample: result.optimizer.best.lowSampleValidation
          }
        : null,
      stopReport: result.optimizer?.stopReport,
      horizonMetrics: result.horizonMetrics,
      holdoutBacktest: result.holdoutBacktest,
      holdoutTradeCount: result.holdoutTrades.length,
      holdoutMaxLosingStreak: result.holdoutMaxLosingStreak,
      holdoutHoldBuckets: result.holdoutHoldBuckets,
      holdoutSession: result.holdoutSession,
      holdoutRegime: result.holdoutRegime,
      movement: result.movement,
      spread: result.spread,
      opportunities: result.opportunities,
      baselines: result.baselines,
      brokerOrders: 0,
      evaluationBrokerRequests: 0,
      mutationSurface: "NONE"
    };

    writeFileSync(
      join(outDir, "phase2b1-real7d-report.json"),
      JSON.stringify(report, null, 2)
    );
    console.log(JSON.stringify(report, null, 2));
    console.log(`Wrote ${join(outDir, "phase2b1-real7d-report.json")}`);
  } finally {
    await transport.disconnect();
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      event: "gh_real7d_blocked",
      code: (err as { code?: string }).code ?? "UNKNOWN",
      message: err instanceof Error ? err.message : String(err)
    })
  );
  process.exit(1);
});
