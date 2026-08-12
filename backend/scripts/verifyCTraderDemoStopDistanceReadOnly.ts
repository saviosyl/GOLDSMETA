/**
 * READ-ONLY Pepperstone Demo symbol stop-distance metadata smoke.
 * ZERO orders / amendments / closes.
 *
 * Usage (from backend/ with secrets loaded):
 *   npx tsx scripts/verifyCTraderDemoStopDistanceReadOnly.ts
 */

import { initializeApp, getApps, applicationDefault } from "firebase-admin/app";
import { getConnection } from "../src/services/broker/ctrader/connectionStore";
import {
  ensureFreshAccessToken,
  assertBrokerUser
} from "../src/services/broker/ctrader/connectionService";
import { createOpenApiClient } from "../src/services/broker/ctrader/openApiClient";
import {
  normalizeSlDistanceToPrice,
  parseDistanceSetIn
} from "../src/services/broker/ctrader/ctraderStopDistance";
import {
  isBrokerExecutionEnabled,
  isCTraderLiveEnabled
} from "../src/services/broker/ctrader/flags";

async function main() {
  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      projectId: process.env.GCLOUD_PROJECT || "goldmeta-web"
    });
  }
  const uid = (process.env.GOLDMETA_PINNED_OWNER_UID ?? "").trim();
  if (!uid) {
    console.error(JSON.stringify({ ok: false, error: "GOLDMETA_PINNED_OWNER_UID missing" }));
    process.exit(2);
  }
  assertBrokerUser(uid);
  const connection = await getConnection(uid);
  if (!connection?.selectedAccountId) {
    console.error(JSON.stringify({ ok: false, error: "NO_DEMO_ACCOUNT" }));
    process.exit(2);
  }
  if (connection.selectedAccountIsLive || connection.environment === "LIVE") {
    console.error(JSON.stringify({ ok: false, error: "LIVE_ACCOUNT_DENIED" }));
    process.exit(2);
  }

  const clientId = (process.env.CTRADER_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.CTRADER_CLIENT_SECRET ?? "").trim();
  const { accessToken, connection: fresh } = await ensureFreshAccessToken(connection);
  const client = createOpenApiClient();
  const symbol = await client.discoverXauUsd({
    accessToken,
    clientId,
    clientSecret,
    ctidTraderAccountId: fresh.selectedAccountId!,
    isLive: false
  });
  const quote = symbol
    ? await client.fetchQuote({
        accessToken,
        clientId,
        clientSecret,
        ctidTraderAccountId: fresh.selectedAccountId!,
        symbolId: symbol.symbolId,
        isLive: false
      })
    : null;

  const mid =
    quote?.bid != null && quote?.ask != null
      ? (quote.bid + quote.ask) / 2
      : null;
  const norm = normalizeSlDistanceToPrice({
    rawSlDistance: symbol?.rawSlDistance,
    distanceSetIn: symbol?.distanceSetIn,
    digits: symbol?.digits,
    referencePrice: mid
  });

  const out = {
    ok: true,
    readOnly: true,
    ordersSubmitted: 0,
    amendments: 0,
    closes: 0,
    liveLocks: {
      CTRADER_LIVE_ENABLED: false,
      isCTraderLiveEnabled: isCTraderLiveEnabled(),
      isBrokerExecutionEnabled: isBrokerExecutionEnabled()
    },
    accountMasked: connection.selectedAccountId
      ? `${String(connection.selectedAccountId).slice(0, 2)}…${String(connection.selectedAccountId).slice(-2)}`
      : null,
    symbol: symbol
      ? {
          symbolId: symbol.symbolId,
          symbolName: symbol.symbolName,
          digits: symbol.digits,
          pipPosition: symbol.pipPosition,
          tickSize: symbol.tickSize,
          rawSlDistance: symbol.rawSlDistance,
          distanceSetIn: symbol.distanceSetIn,
          parsedDistanceSetIn: parseDistanceSetIn(symbol.distanceSetIn),
          rawTpDistance: symbol.rawTpDistance,
          normalizedMinStopPriceDistance: symbol.normalizedMinStopPriceDistance,
          minStopDistance: symbol.minStopDistance
        }
      : null,
    quote: quote
      ? { bid: quote.bid, ask: quote.ask, spread: quote.spread }
      : null,
    normalization: norm
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    })
  );
  process.exit(1);
});
