/**
 * npm run micro-edge:diagnostics
 * Prints safe Micro diagnostics — never tokens.
 */
import { MemoryMicroMarketDataStore } from "../../src/services/microEdge/marketData/marketDataStore";
import { computeLabelReadyDiagnostics } from "../../src/services/microEdge/marketData/historicalTicks";
import {
  MICRO_BROKER_EXECUTION_ENABLED,
  MICRO_NAMESPACE,
  MICRO_SHADOW_ONLY
} from "../../src/services/microEdge/config";
import { publicCredentialStatus, loadMicroCTraderCredentials } from "../../src/services/microEdge/marketData/microCTraderAuth";
import { loadMicroCTraderAppConfig } from "../../src/services/microEdge/marketData/microCTraderAuth";

async function main(): Promise<void> {
  const store = new MemoryMicroMarketDataStore();
  const boundaries = await store.listBoundaryQuotes();
  const labelReady = computeLabelReadyDiagnostics(boundaries);
  const creds = loadMicroCTraderCredentials();
  const app = loadMicroCTraderAppConfig();
  console.log(
    JSON.stringify(
      {
        namespace: MICRO_NAMESPACE,
        shadowOnly: MICRO_SHADOW_ONLY,
        brokerExecutionEnabled: MICRO_BROKER_EXECUTION_ENABLED,
        mutationSurface: "NONE",
        appConfigured: app.ok,
        missingAppConfig: app.ok ? [] : app.missing,
        credentialsEnv: publicCredentialStatus(creds),
        bars: {
          M1: await store.countBars("M1"),
          M5: await store.countBars("M5"),
          M15: await store.countBars("M15")
        },
        quoteSamples: await store.countQuotes(),
        boundaryQuotes: await store.countBoundaryQuotes(),
        labelReady,
        redirectUri: app.ok ? app.config.redirectUri : null,
        note: "Process-local memory store in CLI — production uses Micro Firestore namespace.",
        realConnection: "AWAITING_USER_AUTHORIZATION unless vault/collector attached",
        accessToken: undefined,
        refreshToken: undefined
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
