/**
 * npm run micro-edge:backfill-boundary-quotes
 * READ-ONLY historical Bid/Ask → boundary quotes. No token values logged.
 */
import { loadMicroCTraderCredentials } from "../../src/services/microEdge/marketData/microCTraderAuth";
import { RealMicroCTraderTransport } from "../../src/services/microEdge/marketData/microCTraderTransport";
import { resolveMicroXauUsd } from "../../src/services/microEdge/marketData/microCTraderSymbolResolver";
import { MemoryMicroMarketDataStore } from "../../src/services/microEdge/marketData/marketDataStore";
import { runBoundaryQuoteBackfill } from "../../src/services/microEdge/marketData/boundaryQuoteBackfill";
import { MICRO_BROKER_EXECUTION_ENABLED } from "../../src/services/microEdge/config";

async function main(): Promise<void> {
  if (MICRO_BROKER_EXECUTION_ENABLED !== false) {
    throw new Error("REFUSING_TO_RUN: MICRO_BROKER_EXECUTION_ENABLED must be false");
  }
  const loaded = loadMicroCTraderCredentials();
  if (!loaded.ok) {
    console.error("Missing Micro credentials:", loaded.missing.join(", "));
    console.error("Use OAuth vault / scope=accounts tokens. Do not paste secrets here.");
    process.exit(1);
  }
  const creds = loaded.credentials;
  const transport = new RealMicroCTraderTransport(creds);
  console.log("Micro Edge boundary-quote backfill (READ-ONLY)");
  console.log("Environment:", creds.environment);
  console.log("Mutation surface: NONE");

  await transport.connect();
  const symbols = await transport.listSymbols();
  const resolved = resolveMicroXauUsd(symbols);
  if (!resolved) {
    console.error("XAUUSD not resolved — fail closed.");
    await transport.disconnect();
    process.exit(1);
  }
  console.log("Resolved symbol:", resolved.symbolName);

  const store = new MemoryMicroMarketDataStore();
  const result = await runBoundaryQuoteBackfill({
    transport,
    store,
    accountId: creds.accountId,
    symbol: "XAUUSD",
    symbolId: resolved.symbolId,
    environment: creds.environment
  });
  console.log("Result:", {
    status: result.status,
    inserted: result.inserted,
    skipped: result.skipped,
    unscorable: result.unscorable,
    labelReadyMinutes: result.labelReady.labelReadyMinutes,
    coveragePercent: result.labelReady.coveragePercent
  });
  await transport.disconnect();
  console.log("Done. NO ORDERS were submitted.");
}

main().catch((e) => {
  console.error("Boundary backfill failed:", (e as Error).message);
  process.exit(1);
});
