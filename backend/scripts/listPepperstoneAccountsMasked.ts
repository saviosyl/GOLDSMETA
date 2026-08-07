#!/usr/bin/env npx tsx
/** Masked account inventory for LIVE selection — no tokens/secrets. */
import { initializeApp, getApps } from "firebase-admin/app";
import { getConnection } from "../src/services/broker/ctrader/connectionStore";
import {
  ensureFreshAccessToken,
  assertBrokerUser
} from "../src/services/broker/ctrader/connectionService";
import { createOpenApiClient } from "../src/services/broker/ctrader/openApiClient";

function maskId(id: string | number | null | undefined): string | null {
  if (id == null) return null;
  const s = String(id);
  if (s.length <= 4) return "…" + s.slice(-2);
  return s.slice(0, 2) + "…" + s.slice(-2);
}

async function main() {
  if (!getApps().length) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || "goldmeta-web" });
  }
  const ownerUid = (process.env.GOLDMETA_PINNED_OWNER_UID || "").trim();
  assertBrokerUser(ownerUid);
  const conn = await getConnection(ownerUid);
  if (!conn) throw new Error("NOT_CONNECTED");
  const fresh = await ensureFreshAccessToken(conn);
  const api = createOpenApiClient();
  const accounts = await api.listAccountsByAccessToken(fresh.accessToken);
  const { clientId, clientSecret } = {
    clientId: process.env.CTRADER_CLIENT_ID!.trim(),
    clientSecret: process.env.CTRADER_CLIENT_SECRET!.trim()
  };
  const rows = [];
  for (const a of accounts) {
    let snap: Awaited<ReturnType<typeof api.fetchAccountSnapshot>> | null =
      null;
    try {
      snap = await api.fetchAccountSnapshot({
        accessToken: fresh.accessToken,
        clientId,
        clientSecret,
        ctidTraderAccountId: a.ctidTraderAccountId
      });
    } catch (e) {
      snap = null;
    }
    rows.push({
      ctidTradingAccountIdMasked: maskId(a.ctidTraderAccountId),
      accountMasked: a.accountIdMasked,
      isLive: a.isLive,
      brokerName: a.brokerNameTitle,
      currency: snap?.currency ?? a.depositCurrency,
      leverage: snap?.leverage ?? a.leverage,
      balancePresent: snap?.balance != null,
      equityPresent: snap?.equity != null,
      currentlySelected:
        a.ctidTraderAccountId === fresh.connection.selectedAccountId
    });
  }
  console.log(
    JSON.stringify(
      {
        currentlySelectedMasked: fresh.connection.selectedAccountMasked,
        currentlySelectedIsLive: fresh.connection.selectedAccountIsLive,
        accounts: rows
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(
    JSON.stringify({
      error: e instanceof Error ? e.message : String(e)
    })
  );
  process.exit(1);
});
