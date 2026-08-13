/**
 * Phase 2A controlled historical smoke — vault + Firestore only.
 * Modest windows (not full 30-day backfill). READ-ONLY. No tokens logged.
 *
 * Usage:
 *   MICRO_STORAGE_MODE=firestore APP_ENV=production \
 *   MICRO_COLLECTOR_VAULT_UID=... \
 *   npx tsx scripts/microEdge/phase2aHistoricalSmokeCli.ts
 *
 * Optional:
 *   MICRO_SMOKE_BAR_DAYS_M1=1 MICRO_SMOKE_BAR_DAYS_M5=2 MICRO_SMOKE_BAR_DAYS_M15=3
 *   MICRO_SMOKE_TICK_HOURS=6
 */
import { initializeApp, getApps } from "firebase-admin/app";
import { MICRO_BROKER_EXECUTION_ENABLED } from "../../src/services/microEdge/config";
import {
  credentialsFromVault,
  refreshVaultTokensIfNeeded
} from "../../src/services/microEdge/marketData/oauthService";
import { createMicroTokenVault } from "../../src/services/microEdge/marketData/tokenVault";
import { createMicroMarketDataStore } from "../../src/services/microEdge/marketData/marketDataStore";
import { RealMicroCTraderTransport } from "../../src/services/microEdge/marketData/microCTraderTransport";
import { resolveMicroXauUsd } from "../../src/services/microEdge/marketData/microCTraderSymbolResolver";
import { runHistoricalBackfill } from "../../src/services/microEdge/marketData/backfill";
import { runBoundaryQuoteBackfill } from "../../src/services/microEdge/marketData/boundaryQuoteBackfill";
import { fetchHistoricalTicksWindow } from "../../src/services/microEdge/marketData/historicalTicks";
import { createMicroPacer } from "../../src/services/microEdge/marketData/pacing";
import { resolveMicroStorageMode } from "../../src/services/microEdge/marketData/storageMode";

function numEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

async function main(): Promise<void> {
  if (MICRO_BROKER_EXECUTION_ENABLED !== false) {
    throw new Error("REFUSING_TO_RUN: MICRO_BROKER_EXECUTION_ENABLED must be false");
  }
  if (getApps().length === 0) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || "goldmeta-web" });
  }

  const vaultUid = (process.env.MICRO_COLLECTOR_VAULT_UID ?? "").trim();
  if (!vaultUid) {
    throw new Error("MICRO_COLLECTOR_VAULT_UID_MISSING");
  }

  const storageMode = resolveMicroStorageMode();
  if (storageMode !== "firestore") {
    throw new Error(`REFUSING_TO_RUN: storageMode=${storageMode} (require firestore)`);
  }

  void createMicroTokenVault();
  await refreshVaultTokensIfNeeded(vaultUid);
  const creds = await credentialsFromVault(vaultUid);
  if (!creds) {
    throw new Error("MICRO_VAULT_CREDENTIALS_UNAVAILABLE");
  }
  if (creds.environment !== "DEMO") {
    throw new Error("MICRO_SMOKE_DEMO_ONLY");
  }

  const store = createMicroMarketDataStore();
  const transport = new RealMicroCTraderTransport(creds);
  if (transport.mutationSurface !== "NONE") {
    throw new Error("REFUSING_TO_RUN: mutation surface is not NONE");
  }

  const tickHours = numEnv("MICRO_SMOKE_TICK_HOURS", 6);
  const daysM1 = numEnv("MICRO_SMOKE_BAR_DAYS_M1", 1);
  const daysM5 = numEnv("MICRO_SMOKE_BAR_DAYS_M5", 2);
  const daysM15 = numEnv("MICRO_SMOKE_BAR_DAYS_M15", 3);
  const minIntervalMs = Number(process.env.MICRO_HISTORICAL_MIN_INTERVAL_MS ?? 250);

  console.log(
    JSON.stringify({
      event: "micro_phase2a_smoke_start",
      storageMode,
      environment: creds.environment,
      accountIdMasked:
        creds.accountId.length <= 4
          ? `****${creds.accountId}`
          : `****${creds.accountId.slice(-4)}`,
      mutationSurface: "NONE",
      barDays: { M1: daysM1, M5: daysM5, M15: daysM15 },
      tickHours,
      historicalMinIntervalMs: minIntervalMs
    })
  );

  await transport.connect();
  const symbols = await transport.listSymbols();
  const resolved = resolveMicroXauUsd(symbols);
  if (!resolved) {
    await transport.disconnect();
    throw new Error("MICRO_XAUUSD_NOT_FOUND");
  }
  console.log(
    JSON.stringify({
      event: "micro_phase2a_symbol_resolved",
      symbolName: resolved.symbolName,
      symbolId: resolved.symbolId
    })
  );

  const barResults = await runHistoricalBackfill({
    transport,
    store,
    symbol: "XAUUSD",
    symbolId: resolved.symbolId,
    environment: creds.environment,
    daysByTf: { M1: daysM1, M5: daysM5, M15: daysM15 },
    minIntervalMs
  });
  console.log(
    JSON.stringify({
      event: "micro_phase2a_bar_smoke",
      results: barResults.map((r) => ({
        timeframe: r.timeframe,
        status: r.status,
        inserted: r.inserted,
        skipped: r.skipped,
        conflicts: r.conflicts,
        failed: r.failed
      }))
    })
  );

  const nowMs = Date.now();
  const fromMs = nowMs - tickHours * 60 * 60 * 1000;
  const pacer = createMicroPacer({ minIntervalMs });

  const bidTicks = await fetchHistoricalTicksWindow({
    transport,
    accountId: creds.accountId,
    symbolId: resolved.symbolId,
    side: "BID",
    fromMs,
    toMs: nowMs,
    digits: resolved.digits,
    pacer
  });
  const askTicks = await fetchHistoricalTicksWindow({
    transport,
    accountId: creds.accountId,
    symbolId: resolved.symbolId,
    side: "ASK",
    fromMs,
    toMs: nowMs,
    digits: resolved.digits,
    pacer
  });

  let chronologicalOk = true;
  for (const side of [bidTicks, askTicks]) {
    for (let i = 1; i < side.length; i++) {
      if (side[i]!.brokerTimestampMs < side[i - 1]!.brokerTimestampMs) {
        chronologicalOk = false;
        break;
      }
    }
  }

  const boundary = await runBoundaryQuoteBackfill({
    transport,
    store,
    accountId: creds.accountId,
    symbol: "XAUUSD",
    symbolId: resolved.symbolId,
    environment: creds.environment,
    fromMs,
    toMs: nowMs,
    days: tickHours / 24
  });

  const counts = {
    M1: await store.countBars("M1"),
    M5: await store.countBars("M5"),
    M15: await store.countBars("M15"),
    quotes: await store.countQuotes(),
    boundaryQuotes: await store.countBoundaryQuotes()
  };

  await transport.disconnect();

  console.log(
    JSON.stringify({
      event: "micro_phase2a_smoke_done",
      bidTicks: bidTicks.length,
      askTicks: askTicks.length,
      chronologicalOk,
      paginationHandledByFetchWindow: true,
      exclusiveOlderCursor: "oldestTimestamp-1",
      timeRangeHours: tickHours,
      boundary: {
        status: boundary.status,
        inserted: boundary.inserted,
        skipped: boundary.skipped,
        unscorable: boundary.unscorable,
        labelReadyMinutes: boundary.labelReady.labelReadyMinutes
      },
      counts,
      mutationSurface: "NONE",
      brokerOrders: 0
    })
  );
}

main().catch((e) => {
  console.error("Phase2A historical smoke failed:", (e as Error).message);
  process.exit(1);
});
