#!/usr/bin/env npx tsx
/**
 * Switch selected Pepperstone account to LIVE masked …06 and write private allowlist.
 * Never prints tokens or full account ids.
 */
import { initializeApp, getApps } from "firebase-admin/app";
import { writeFileSync, readFileSync } from "node:fs";
import { getConnection } from "../src/services/broker/ctrader/connectionStore";
import {
  ensureFreshAccessToken,
  selectBrokerAccountForUser,
  assertBrokerUser
} from "../src/services/broker/ctrader/connectionService";
import { createOpenApiClient } from "../src/services/broker/ctrader/openApiClient";
import { isCTraderLiveEnabled } from "../src/services/broker/ctrader/flags";

function errInfo(e: unknown) {
  if (e instanceof Error) {
    return { message: e.message, code: (e as { code?: string }).code ?? null };
  }
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    return {
      message: String(o.message ?? o.code ?? JSON.stringify(o)),
      code: typeof o.code === "string" ? o.code : null
    };
  }
  return { message: String(e), code: null };
}

async function main() {
  if (isCTraderLiveEnabled()) throw new Error("CTRADER_LIVE_MUST_REMAIN_FALSE");
  if (!getApps().length) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || "goldmeta-web" });
  }
  const ownerUid = (process.env.GOLDMETA_PINNED_OWNER_UID || "").trim();
  assertBrokerUser(ownerUid);

  const conn = await getConnection(ownerUid);
  if (!conn) throw new Error("CTRADER_NOT_CONNECTED");

  console.log(
    JSON.stringify({
      step: "before",
      selectedMasked: conn.selectedAccountMasked,
      selectedAccountIsLive: conn.selectedAccountIsLive,
      environment: conn.environment
    })
  );

  const fresh = await ensureFreshAccessToken(conn);
  const api = createOpenApiClient();
  const accounts = await api.listAccountsByAccessToken(fresh.accessToken);
  const livePepperstone = accounts.filter(
    (a) => a.isLive && /pepperstone/i.test(a.brokerNameTitle || "")
  );
  const matches = livePepperstone.filter((a) =>
    a.ctidTraderAccountId.endsWith("06")
  );
  if (matches.length !== 1) {
    throw Object.assign(new Error("LIVE_ACCOUNT_06_NOT_UNIQUE"), {
      code: "LIVE_ACCOUNT_06_NOT_UNIQUE",
      count: matches.length
    });
  }
  const target = matches[0]!;

  const selected = await selectBrokerAccountForUser({
    ownerUid,
    ctidTraderAccountId: target.ctidTraderAccountId,
    confirmPepperstone: true,
    confirmLiveSelection: true,
    api
  });

  const after = await getConnection(ownerUid);
  if (!after?.selectedAccountIsLive || after.environment !== "LIVE") {
    throw new Error("SELECTION_DID_NOT_PERSIST_LIVE");
  }
  if (!(after.selectedAccountMasked || "").endsWith("06")) {
    throw new Error("SELECTION_MASK_NOT_06");
  }

  writeFileSync(
    "/tmp/gm-secrets/CTRADER_QUOTE_ACCOUNT_ALLOWLIST",
    target.ctidTraderAccountId,
    { mode: 0o600 }
  );
  const allow = readFileSync(
    "/tmp/gm-secrets/CTRADER_QUOTE_ACCOUNT_ALLOWLIST",
    "utf8"
  ).trim();
  if (!allow.endsWith("06")) throw new Error("ALLOWLIST_NOT_06");
  for (const demo of accounts.filter((a) => !a.isLive)) {
    if (allow === demo.ctidTraderAccountId) {
      throw new Error("DEMO_STILL_ALLOWLISTED");
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        broker: selected.account.brokerName,
        environment: "LIVE",
        currency: selected.account.currency,
        selectedMasked: selected.account.accountIdMasked,
        selectedAccountIsLive: true,
        symbolName: selected.symbol?.symbolName ?? after.symbolName,
        symbolId: selected.symbol?.symbolId ?? after.symbolId,
        digits: selected.symbol?.digits ?? null,
        pipPosition: selected.symbol?.pipPosition ?? null,
        minVolume: selected.symbol?.minVolume ?? null,
        maxVolume: selected.symbol?.maxVolume ?? null,
        volumeStep: selected.symbol?.volumeStep ?? null,
        demoAllowlisted: false,
        allowlistOnlyLive06: true,
        isCTraderLiveEnabled: isCTraderLiveEnabled(),
        orderSubmission: "HARD_LOCKED"
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(JSON.stringify({ error: errInfo(e) }));
  process.exit(1);
});
