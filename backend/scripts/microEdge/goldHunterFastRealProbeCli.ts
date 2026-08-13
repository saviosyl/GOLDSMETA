/**
 * GOLD_HUNTER FAST — REAL read-only DEMO Level-II protocol probe.
 *
 * SCOPE_VIEW only. NO orders. NO mutations.
 * Uses vault credentials. Subscribes spots + depth for XAUUSD.
 * Feeds the SAME stream into GoldHunterFastLiveBridge (shadow only).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import {
  credentialsFromVault,
  refreshVaultTokensIfNeeded
} from "../../src/services/microEdge/marketData/oauthService";
import { createMicroTokenVault } from "../../src/services/microEdge/marketData/tokenVault";
import { RealMicroCTraderTransport } from "../../src/services/microEdge/marketData/microCTraderTransport";
import { resolveMicroXauUsd } from "../../src/services/microEdge/marketData/microCTraderSymbolResolver";
import { MICRO_SPOT_PRICE_SCALE } from "../../src/services/microEdge/marketData/microCTraderProtocol";
import {
  GoldHunterFastLiveBridge,
  parseProtoOADepthEventPayload,
  MICRO_DEPTH_SIZE_SCALE
} from "../../src/services/microEdge/goldHunter/fast";
import { MICRO_BROKER_EXECUTION_ENABLED } from "../../src/services/microEdge/config";

type SizeSample = number;

function pct(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]!;
}

function initFirebase(): void {
  if (getApps().length) return;
  const raw = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GCP_SERVICE_ACCOUNT_JSON missing");
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
    projectId: process.env.GCLOUD_PROJECT || sa.project_id
  });
}

async function main(): Promise<void> {
  if (MICRO_BROKER_EXECUTION_ENABLED !== false) {
    throw new Error("REFUSING: MICRO_BROKER_EXECUTION_ENABLED must be false");
  }
  process.env.GOLD_HUNTER_FAST_SHADOW_ENABLED = "true";
  process.env.MICRO_BROKER_EXECUTION_ENABLED = "false";

  initFirebase();
  createMicroTokenVault();
  const vaultUid = (process.env.MICRO_COLLECTOR_VAULT_UID ?? "").trim();
  if (!vaultUid) throw new Error("MICRO_COLLECTOR_VAULT_UID_MISSING");

  await refreshVaultTokensIfNeeded(vaultUid);
  const creds = await credentialsFromVault(vaultUid);
  if (!creds) throw new Error("VAULT_CREDENTIALS_MISSING");
  if (creds.environment !== "DEMO") {
    console.log(
      JSON.stringify({
        event: "gh_fast_probe_warn",
        message: "expected DEMO environment",
        environment: creds.environment
      })
    );
  }

  const outDir = join(
    process.cwd(),
    ".gold-hunter-data",
    "fast-real-probe",
    `run_${Date.now()}`
  );
  mkdirSync(outDir, { recursive: true });

  const transport = new RealMicroCTraderTransport(creds);
  await transport.connect();

  const symbols = await transport.listSymbols();
  const xau = resolveMicroXauUsd(symbols);
  if (!xau) throw new Error("XAUUSD_NOT_FOUND");

  const bridge = new GoldHunterFastLiveBridge({
    enabled: true,
    enableCollector: true,
    collectDir: join(outDir, "chunks")
  });

  let spotCount = 0;
  let depthCount = 0;
  let newQuoteCount = 0;
  let deletedQuoteCount = 0;
  let decodedBid = 0;
  let decodedAsk = 0;
  let invalidDepth = 0;
  let bookAvailableSamples = 0;
  let bookSamples = 0;
  let bestBidOk = 0;
  let crossed = 0;
  let exceptions = 0;
  const sizes: SizeSample[] = [];
  const levels: number[] = [];
  let lastSpotBid: number | null = null;
  let lastSpotAsk: number | null = null;
  let lastDepthBid: number | null = null;
  let lastDepthAsk: number | null = null;

  const started = Date.now();
  const maxMs = Number(process.env.GOLD_HUNTER_FAST_PROBE_MS ?? 180_000);
  const targetSpot = Number(process.env.GOLD_HUNTER_FAST_PROBE_SPOT_TARGET ?? 1000);
  const targetDepth = Number(
    process.env.GOLD_HUNTER_FAST_PROBE_DEPTH_TARGET ?? 5000
  );

  transport.on("ProtoOASpotEvent", (_n, payload) => {
    try {
      spotCount += 1;
      const bid =
        typeof payload.bid === "number"
          ? payload.bid / MICRO_SPOT_PRICE_SCALE
          : null;
      const ask =
        typeof payload.ask === "number"
          ? payload.ask / MICRO_SPOT_PRICE_SCALE
          : null;
      if (bid != null) lastSpotBid = bid;
      if (ask != null) lastSpotAsk = ask;
      bridge.ingestRawForTests("SPOT", payload);
    } catch {
      exceptions += 1;
    }
  });

  transport.on("ProtoOADepthEvent", (_n, payload) => {
    try {
      depthCount += 1;
      const parsed = parseProtoOADepthEventPayload(payload);
      newQuoteCount += parsed.newQuotes.length;
      deletedQuoteCount += parsed.deletedQuotes.length;
      decodedBid += parsed.stats.decodedBid;
      decodedAsk += parsed.stats.decodedAsk;
      invalidDepth += parsed.stats.invalid;
      for (const q of parsed.newQuotes) sizes.push(q.size);
      bridge.ingestRawForTests("DEPTH", payload);
      const st = bridge.engine.depth.stats(10);
      bookSamples += 1;
      levels.push(st.bidLevels + st.askLevels);
      if (st.available) bookAvailableSamples += 1;
      if (st.bestBid != null && st.bestAsk != null) {
        lastDepthBid = st.bestBid;
        lastDepthAsk = st.bestAsk;
        if (st.bestBid < st.bestAsk) bestBidOk += 1;
        if (st.crossed) crossed += 1;
      }
    } catch {
      exceptions += 1;
    }
  });

  await transport.subscribeSpots(xau.symbolId);
  await transport.subscribeDepthQuotes(xau.symbolId);

  console.log(
    JSON.stringify({
      event: "gh_fast_probe_subscribed",
      symbolId: xau.symbolId,
      symbolName: xau.symbolName,
      environment: creds.environment,
      spotSub: transport.getSubscribeSpotsCallCount(),
      depthSub: transport.getSubscribeDepthCallCount(),
      mutationSurface: "NONE",
      brokerExecutionEnabled: false,
      maxMs,
      targetSpot,
      targetDepth
    })
  );

  while (Date.now() - started < maxMs) {
    if (spotCount >= targetSpot && depthCount >= targetDepth) break;
    await new Promise((r) => setTimeout(r, 500));
    if ((Date.now() - started) % 15_000 < 600) {
      console.log(
        JSON.stringify({
          event: "gh_fast_probe_progress",
          elapsedSec: Math.round((Date.now() - started) / 1000),
          spotCount,
          depthCount,
          decodedBid,
          decodedAsk
        })
      );
    }
  }

  await bridge.drainForTests();
  await transport.disconnect();

  const sizesSorted = [...sizes].sort((a, b) => a - b);
  const levelsSorted = [...levels].sort((a, b) => a - b);
  const health = bridge.health();
  const runtimeMin = (Date.now() - started) / 60_000;
  const q = bridge.queue.stats();

  const report = {
    event: "gh_fast_real_probe_report",
    classificationHint:
      depthCount > 0 && decodedBid > 0 && decodedAsk > 0 && exceptions === 0
        ? "PIPELINE_VERIFIED_CANDIDATE"
        : "BLOCKED_INSUFFICIENT_OR_INVALID_DEPTH",
    runtimeMinutes: Number(runtimeMin.toFixed(3)),
    environment: creds.environment,
    permissionScope: "SCOPE_VIEW",
    mutationSurface: "NONE",
    brokerRequests: 0,
    brokerOrders: 0,
    symbolId: xau.symbolId,
    spotSubscribed: transport.getSubscribeSpotsCallCount() >= 1,
    depthSubscribed: transport.getSubscribeDepthCallCount() >= 1,
    realSpotEventCount: spotCount,
    realDepthEventCount: depthCount,
    newQuotes: newQuoteCount,
    deletedQuotes: deletedQuoteCount,
    decodedBid,
    decodedAsk,
    invalidDepth,
    depthBookAvailablePct:
      bookSamples > 0 ? bookAvailableSamples / bookSamples : 0,
    bestDepthBid: lastDepthBid,
    bestDepthAsk: lastDepthAsk,
    spotBid: lastSpotBid,
    spotAsk: lastSpotAsk,
    depthSpread:
      lastDepthBid != null && lastDepthAsk != null
        ? lastDepthAsk - lastDepthBid
        : null,
    spotSpread:
      lastSpotBid != null && lastSpotAsk != null
        ? lastSpotAsk - lastSpotBid
        : null,
    depthSize: {
      min: sizesSorted[0] ?? null,
      median: pct(sizesSorted, 0.5),
      p95: pct(sizesSorted, 0.95),
      max: sizesSorted[sizesSorted.length - 1] ?? null,
      scaleNote: `raw/OpenAPI size ÷ ${MICRO_DEPTH_SIZE_SCALE}`
    },
    depthLevels: {
      min: levelsSorted[0] ?? null,
      median: pct(levelsSorted, 0.5),
      p95: pct(levelsSorted, 0.95)
    },
    deletedQuoteHitRate: bridge.engine.depth.deleteHitRate(),
    bookReconstructionExceptions: exceptions,
    crossedSnapshots: crossed,
    bestBidAskSane: bestBidOk,
    eventsPerSec:
      runtimeMin > 0 ? (spotCount + depthCount) / (runtimeMin * 60) : 0,
    decisions: health.decisions,
    decisionsPerSec: runtimeMin > 0 ? health.decisions / (runtimeMin * 60) : 0,
    setupA: health.setupA,
    setupB: health.setupB,
    setupC: health.setupC,
    shadowEntries: health.shadowEntries,
    shadowExits: health.shadowExits,
    completedShadowTrades: bridge.engine.closed.length,
    openShadowTrade: health.openShadowTrade,
    closedDiagnostic: bridge.engine.closed.map((t) => ({
      side: t.side,
      setup: t.setup,
      netMove: t.netMove,
      result: t.result,
      exitReason: t.exitReason,
      durationMs: t.durationMs
    })),
    computeLatencyMs: health.eventToDecision,
    queueWaitMs: health.queueWait,
    processingLatencyMs: {
      p50: q.processing.p50,
      p95: q.processing.p95,
      p99: q.processing.p99
    },
    persistenceQueue: bridge.collector?.stats().persistenceQueue ?? null,
    durableMode: bridge.collector?.stats().durableMode ?? null,
    eventsDropped: health.eventsDropped,
    outDir,
    latencyInterpretation:
      "eventToDecision is LOCAL COMPUTE only — not network or broker execution latency"
  };

  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(
    JSON.stringify({
      event: "gh_fast_probe_failed",
      message: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
      brokerOrders: 0,
      mutationSurface: "NONE"
    })
  );
  process.exit(1);
});
