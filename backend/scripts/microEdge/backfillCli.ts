/**
 * Local CLI: npm run micro-edge:backfill
 * READ-ONLY historical collection. Requires MICRO_CTRADER_* credentials.
 */
import { loadMicroCTraderCredentials } from "../../src/services/microEdge/marketData/microCTraderAuth";
import { RealMicroCTraderTransport } from "../../src/services/microEdge/marketData/microCTraderTransport";
import { resolveMicroXauUsd } from "../../src/services/microEdge/marketData/microCTraderSymbolResolver";
import { MemoryMicroMarketDataStore } from "../../src/services/microEdge/marketData/marketDataStore";
import {
  DEFAULT_BACKFILL_DAYS,
  runHistoricalBackfill
} from "../../src/services/microEdge/marketData/backfill";
import { MICRO_BROKER_EXECUTION_ENABLED } from "../../src/services/microEdge/config";

async function main(): Promise<void> {
  if (MICRO_BROKER_EXECUTION_ENABLED !== false) {
    throw new Error("REFUSING_TO_RUN: MICRO_BROKER_EXECUTION_ENABLED must be false");
  }
  const loaded = loadMicroCTraderCredentials();
  if (!loaded.ok) {
    console.error("Missing Micro credentials:", loaded.missing.join(", "));
    console.error(
      "Provision view-only tokens (scope=accounts) via MICRO_CTRADER_* env vars."
    );
    process.exit(1);
  }
  const creds = loaded.credentials;
  const transport = new RealMicroCTraderTransport(creds);
  if (transport.mutationSurface !== "NONE") {
    throw new Error("REFUSING_TO_RUN: mutation surface is not NONE");
  }

  console.log("Micro Edge historical backfill (READ-ONLY)");
  console.log("Environment:", creds.environment);
  console.log("Account id configured: yes");
  console.log("Proposed windows (days):", DEFAULT_BACKFILL_DAYS);
  console.log("Mutation surface: NONE");

  await transport.connect();
  const symbols = await transport.listSymbols();
  const resolved = resolveMicroXauUsd(symbols);
  if (!resolved) {
    console.error("XAUUSD could not be confidently resolved — fail closed.");
    await transport.disconnect();
    process.exit(1);
  }
  console.log("Resolved symbol:", resolved.symbolName, "id=", resolved.symbolId);

  const store = new MemoryMicroMarketDataStore();
  // Note: CLI uses memory unless FIRESTORE is wired; print counts for this run.
  const results = await runHistoricalBackfill({
    transport,
    store,
    symbol: "XAUUSD",
    symbolId: resolved.symbolId,
    environment: creds.environment
  });
  console.log("Backfill results:");
  for (const r of results) {
    console.log(
      `  ${r.timeframe}: status=${r.status} inserted=${r.inserted} skipped=${r.skipped} conflicts=${r.conflicts} failed=${r.failed}`
    );
  }
  await transport.disconnect();
  console.log("Done. NO ORDERS were submitted.");
}

main().catch((e) => {
  console.error("Backfill failed:", (e as Error).message);
  process.exit(1);
});
