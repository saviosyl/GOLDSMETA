import { initializeApp, getApps } from "firebase-admin/app";
import { getConnection } from "../src/services/broker/ctrader/connectionStore";
import { ensureFreshAccessToken } from "../src/services/broker/ctrader/connectionService";
import { createOpenApiClient } from "../src/services/broker/ctrader/openApiClient";
import { maskAccountId } from "../src/services/broker/ctrader/tokenCrypto";
import { writeFileSync } from "node:fs";

async function main() {
  if (!getApps().length) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || "goldmeta-web" });
  }
  const uid = (process.env.GOLDMETA_PINNED_OWNER_UID || "").trim();
  const conn = await getConnection(uid);
  if (!conn?.selectedAccountId) {
    console.log(JSON.stringify({ error: "CTRADER_NOT_CONNECTED" }));
    process.exit(2);
  }
  const { accessToken, connection } = await ensureFreshAccessToken(conn);
  const api = createOpenApiClient();
  const accountId = connection.selectedAccountId!;
  const snap = await api.fetchAccountSnapshot({
    accessToken,
    clientId: process.env.CTRADER_CLIENT_ID || "",
    clientSecret: process.env.CTRADER_CLIENT_SECRET || "",
    ctidTraderAccountId: accountId,
    isLive: Boolean(connection.selectedAccountIsLive)
  });
  let recon: Record<string, unknown> | null = null;
  try {
    recon = (await api.reconcileTradingState({
      accessToken,
      clientId: process.env.CTRADER_CLIENT_ID || "",
      clientSecret: process.env.CTRADER_CLIENT_SECRET || "",
      ctidTraderAccountId: accountId,
      isLive: Boolean(connection.selectedAccountIsLive)
    })) as unknown as Record<string, unknown>;
  } catch (e) {
    recon = { error: e instanceof Error ? e.message : String(e) };
  }
  const out = {
    maskedAccount: maskAccountId(accountId),
    selectedAccountIsLive: Boolean(connection.selectedAccountIsLive),
    environment: connection.environment,
    brokerName: connection.brokerName,
    balance: snap.balance,
    equity: snap.equity,
    freeMargin: snap.freeMargin ?? (recon && "freeMargin" in recon ? recon.freeMargin : null),
    usedMargin: snap.usedMargin ?? (recon && "usedMargin" in recon ? recon.usedMargin : null),
    currency: snap.currency ?? connection.currency,
    leverage: snap.leverage,
    reconcile: recon
      ? {
          openPositionsCount: recon.openPositionsCount ?? null,
          pendingOrdersCount: recon.pendingOrdersCount ?? null,
          equity: recon.equity ?? null,
          freeMargin: recon.freeMargin ?? null,
          usedMargin: recon.usedMargin ?? null
        }
      : null
  };
  writeFileSync(
    "/opt/cursor/artifacts/live-account-equity-snapshot.json",
    JSON.stringify(out, null, 2)
  );
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
