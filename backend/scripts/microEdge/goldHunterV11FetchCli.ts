/**
 * GOLD_HUNTER V1.1 — fetch REAL Pepperstone DEMO history for the
 * pre-V1 development window ending BEFORE 2026-08-06T11:49:08.494Z.
 *
 * READ-ONLY. No broker orders. Chunks into <=7-day windows.
 *
 *   GOLD_HUNTER_REUSE_LOCAL=1 skips re-download when artifacts exist.
 */
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
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
import {
  fetchHistoricalTicksWindow,
  splitIntoTickWindows
} from "../../src/services/microEdge/marketData/historicalTicks";
import { createMicroPacer } from "../../src/services/microEdge/marketData/pacing";
import { resolveMicroStorageMode } from "../../src/services/microEdge/marketData/storageMode";
import {
  chunkHistoricalWindows,
  fetchTrendbarsWindow,
  filterCompletedBars
} from "../../src/services/microEdge/marketData/microCTraderTrendbars";
import type { RawTick } from "../../src/services/microEdge/goldHunter/asOfDataset";
import type { GhBarCtx } from "../../src/services/microEdge/goldHunter/features";
import {
  ndjsonGzToRows,
  rowsToNdjson
} from "../../src/services/microEdge/goldHunter/compactStorage";
import { GH_HISTORICAL_MIN_INTERVAL_MS } from "../../src/services/microEdge/goldHunter/config";
import { writeFile, readFile } from "node:fs/promises";
import {
  V1_REAL_7D_WINDOW_START_MS,
  V11_DEV_WINDOW_DAYS
} from "../../src/services/microEdge/goldHunter/v11/versions";

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

function assertGoldPrices(ticks: RawTick[]): void {
  const sample = ticks.slice(0, Math.min(ticks.length, 8000));
  const bad = sample.filter((t) => t.price < 500 || t.price > 10000).length;
  if (sample.length && bad / sample.length > 0.01) {
    throw Object.assign(
      new Error(`V11_TICK_PRICE_SANITY_FAILED: ${bad}/${sample.length}`),
      { code: "REAL_TICK_PRICE_SANITY_FAILED" }
    );
  }
}

async function main(): Promise<void> {
  if (MICRO_BROKER_EXECUTION_ENABLED !== false) {
    throw new Error("REFUSING: MICRO_BROKER_EXECUTION_ENABLED must be false");
  }
  initFirebase();
  const vaultUid = (process.env.MICRO_COLLECTOR_VAULT_UID ?? "").trim();
  if (!vaultUid) throw new Error("MICRO_COLLECTOR_VAULT_UID_MISSING");
  if (resolveMicroStorageMode() !== "firestore") {
    throw new Error("REFUSING: require firestore storage");
  }
  void createMicroTokenVault();
  await refreshVaultTokensIfNeeded(vaultUid);
  const creds = await credentialsFromVault(vaultUid);
  if (!creds) throw new Error("MICRO_VAULT_CREDENTIALS_UNAVAILABLE");
  if (creds.environment !== "DEMO") throw new Error("V11_DEMO_ONLY");

  const toMs = V1_REAL_7D_WINDOW_START_MS - 1; // exclusive of inspected V1 window
  const fromMs = toMs - V11_DEV_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const outDir =
    process.env.GOLD_HUNTER_V11_DATA_DIR ??
    join(process.cwd(), ".gold-hunter-data", "real-28d-pre-v1");
  mkdirSync(outDir, { recursive: true });

  const ticksPath = join(outDir, "ticks-bidask.ndjson.gz");
  const barsM1Path = join(outDir, "bars-m1.ndjson.gz");
  const barsM5Path = join(outDir, "bars-m5.ndjson.gz");
  const barsM15Path = join(outDir, "bars-m15.ndjson.gz");
  const metaPath = join(outDir, "bars-meta.json");
  const reuse = process.env.GOLD_HUNTER_REUSE_LOCAL === "1";

  console.log(
    JSON.stringify({
      event: "gh_v11_fetch_start",
      fromUtc: new Date(fromMs).toISOString(),
      toUtc: new Date(toMs).toISOString(),
      days: V11_DEV_WINDOW_DAYS,
      note: "ends before inspected V1 window",
      reuse
    })
  );

  if (
    reuse &&
    existsSync(ticksPath) &&
    existsSync(barsM1Path) &&
    existsSync(barsM5Path) &&
    existsSync(barsM15Path) &&
    existsSync(metaPath)
  ) {
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    console.log(JSON.stringify({ event: "gh_v11_reuse_local", meta }));
    return;
  }

  const pacer = createMicroPacer({
    minIntervalMs: Number(
      process.env.MICRO_HISTORICAL_MIN_INTERVAL_MS ?? GH_HISTORICAL_MIN_INTERVAL_MS
    )
  });
  const transport = new RealMicroCTraderTransport(creds);
  if (transport.mutationSurface !== "NONE") {
    throw new Error("REFUSING: mutation surface is not NONE");
  }
  await transport.connect();
  try {
    const resolved = resolveMicroXauUsd(await transport.listSymbols());
    if (!resolved) throw new Error("MICRO_XAUUSD_NOT_FOUND");

    const windows = splitIntoTickWindows(fromMs, toMs);
    console.log(
      JSON.stringify({
        event: "gh_v11_windows",
        count: windows.length,
        windows: windows.map((w) => ({
          from: new Date(w.fromMs).toISOString(),
          to: new Date(w.toMs).toISOString()
        }))
      })
    );

    const allBids: Array<{ timestampMs: number; price: number }> = [];
    const allAsks: Array<{ timestampMs: number; price: number }> = [];
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i]!;
      console.log(
        JSON.stringify({
          event: "gh_v11_fetch_window",
          i: i + 1,
          of: windows.length,
          side: "BID",
          from: new Date(w.fromMs).toISOString()
        })
      );
      const bids = await fetchHistoricalTicksWindow({
        transport,
        accountId: creds.accountId,
        symbolId: resolved.symbolId,
        side: "BID",
        fromMs: w.fromMs,
        toMs: w.toMs,
        digits: resolved.digits ?? 2,
        pacer
      });
      for (const t of bids) {
        allBids.push({ timestampMs: t.brokerTimestampMs, price: t.price });
      }
      console.log(
        JSON.stringify({
          event: "gh_v11_fetch_window",
          i: i + 1,
          of: windows.length,
          side: "ASK"
        })
      );
      const asks = await fetchHistoricalTicksWindow({
        transport,
        accountId: creds.accountId,
        symbolId: resolved.symbolId,
        side: "ASK",
        fromMs: w.fromMs,
        toMs: w.toMs,
        digits: resolved.digits ?? 2,
        pacer
      });
      for (const t of asks) {
        allAsks.push({ timestampMs: t.brokerTimestampMs, price: t.price });
      }
      console.log(
        JSON.stringify({
          event: "gh_v11_window_done",
          i: i + 1,
          bid: bids.length,
          ask: asks.length
        })
      );
    }

    const ticks: RawTick[] = [];
    for (const t of allBids) {
      ticks.push({ timestampMs: t.timestampMs, side: "BID", price: t.price });
    }
    for (const t of allAsks) {
      ticks.push({ timestampMs: t.timestampMs, side: "ASK", price: t.price });
    }
    ticks.sort((a, b) => a.timestampMs - b.timestampMs);

    // dedupe
    const seen = new Set<string>();
    const deduped: RawTick[] = [];
    for (const t of ticks) {
      const k = `${t.side}_${t.timestampMs}_${t.price}`;
      if (seen.has(k)) continue;
      seen.add(k);
      deduped.push(t);
    }
    assertGoldPrices(deduped);
    await writeFile(ticksPath, rowsToNdjson(deduped));

    const fetchBars = async (tf: "M1" | "M5" | "M15"): Promise<GhBarCtx[]> => {
      const chunks = chunkHistoricalWindows({
        timeframe: tf,
        fromMs,
        toMs,
        barsPerChunk: 200
      });
      const all: GhBarCtx[] = [];
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
        for (const b of filterCompletedBars(res, toMs)) {
          all.push({
            openTimeMs: b.openTimeMs,
            closeTimeMs: b.closeTimeMs,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
            tickVolume: b.tickVolume
          });
        }
      }
      const s = new Set<number>();
      const out: GhBarCtx[] = [];
      for (const b of all.sort((a, b) => a.openTimeMs - b.openTimeMs)) {
        if (s.has(b.openTimeMs)) continue;
        s.add(b.openTimeMs);
        out.push(b);
      }
      return out;
    };

    console.log(JSON.stringify({ event: "gh_v11_fetch_bars" }));
    const m1 = await fetchBars("M1");
    const m5 = await fetchBars("M5");
    const m15 = await fetchBars("M15");
    await writeFile(barsM1Path, rowsToNdjson(m1));
    await writeFile(barsM5Path, rowsToNdjson(m5));
    await writeFile(barsM15Path, rowsToNdjson(m15));
    const meta = {
      datasetRole: "GH_REAL_28D_PRE_V1",
      fromUtc: new Date(fromMs).toISOString(),
      toUtc: new Date(toMs).toISOString(),
      M1: m1.length,
      M5: m5.length,
      M15: m15.length,
      bidTicks: deduped.filter((t) => t.side === "BID").length,
      askTicks: deduped.filter((t) => t.side === "ASK").length,
      totalTicks: deduped.length,
      v1WindowExcludedFrom: new Date(V1_REAL_7D_WINDOW_START_MS).toISOString()
    };
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    console.log(JSON.stringify({ event: "gh_v11_fetch_done", ...meta }));
  } finally {
    await transport.disconnect();
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      event: "gh_v11_fetch_blocked",
      code: (err as { code?: string }).code ?? "UNKNOWN",
      message: err instanceof Error ? err.message : String(err)
    })
  );
  process.exit(1);
});
