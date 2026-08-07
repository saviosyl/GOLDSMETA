#!/usr/bin/env npx tsx
/**
 * Confirm the currently selected Pepperstone account and write a private
 * allowlist file for worker deploy. Never prints full account ids or tokens.
 */
import { initializeApp, getApps } from "firebase-admin/app";
import { writeFileSync, mkdirSync } from "node:fs";
import { getConnection } from "../src/services/broker/ctrader/connectionStore";
import {
  ensureFreshAccessToken,
  assertBrokerUser
} from "../src/services/broker/ctrader/connectionService";
import { createOpenApiClient } from "../src/services/broker/ctrader/openApiClient";

async function main() {
  if (!getApps().length) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || "goldmeta-web" });
  }
  const ownerUid = (process.env.GOLDMETA_PINNED_OWNER_UID || "").trim();
  assertBrokerUser(ownerUid);
  const expectedSuffix = (process.env.CTRADER_EXPECT_MASK_SUFFIX || "10").trim();

  const conn = await getConnection(ownerUid);
  if (!conn?.selectedAccountId) throw new Error("NO_SELECTED_ACCOUNT");

  const suffix = String(conn.selectedAccountId).slice(-2);
  const mask = conn.selectedAccountMasked || "";
  if (suffix !== expectedSuffix && !mask.endsWith(expectedSuffix)) {
    throw new Error(
      `SELECTED_ACCOUNT_MISMATCH expectedSuffix=${expectedSuffix} mask=${mask}`
    );
  }

  const fresh = await ensureFreshAccessToken(conn);
  const api = createOpenApiClient();
  const accounts = await api.listAccountsByAccessToken(fresh.accessToken);
  const match = accounts.find(
    (a) => a.ctidTraderAccountId === fresh.connection.selectedAccountId
  );
  if (!match) throw new Error("SELECTED_NOT_AUTHORISED");
  if (!/pepperstone/i.test(match.brokerNameTitle || "")) {
    throw new Error("NOT_PEPPERSTONE");
  }

  mkdirSync("/tmp/gm-secrets", { recursive: true, mode: 0o700 });
  writeFileSync(
    "/tmp/gm-secrets/CTRADER_QUOTE_ACCOUNT_ALLOWLIST",
    match.ctidTraderAccountId,
    { mode: 0o600 }
  );
  const meta = {
    masked: match.accountIdMasked,
    isLive: match.isLive,
    environment: match.isLive ? "LIVE" : "DEMO",
    brokerName: match.brokerNameTitle,
    currency: match.depositCurrency,
    symbolId: fresh.connection.symbolId,
    symbolName: fresh.connection.symbolName,
    connectionStatus: "CONNECTED",
    tokenExpiryStatus:
      Date.parse(fresh.connection.tokens.accessExpiresAt) > Date.now()
        ? "VALID"
        : "EXPIRED"
  };
  writeFileSync(
    "/tmp/gm-secrets/SELECTED_ACCOUNT_META.json",
    JSON.stringify(meta, null, 2),
    { mode: 0o600 }
  );
  console.log(JSON.stringify({ ok: true, ...meta, allowlistSet: true }, null, 2));
}

main().catch((e) => {
  console.error(
    JSON.stringify({
      error: e instanceof Error ? e.message : String(e)
    })
  );
  process.exit(1);
});
