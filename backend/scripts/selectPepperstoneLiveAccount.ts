#!/usr/bin/env npx tsx
/**
 * Select one authorised Pepperstone LIVE account by masked suffix only.
 *
 * Required env:
 *   CTRADER_SELECT_LIVE_MASK_SUFFIX — last 2 digits of masked id (e.g. "06" or "41")
 *
 * Never prints tokens or full account ids.
 */
import { initializeApp, getApps } from "firebase-admin/app";
import { getConnection } from "../src/services/broker/ctrader/connectionStore";
import {
  ensureFreshAccessToken,
  selectBrokerAccountForUser,
  assertBrokerUser
} from "../src/services/broker/ctrader/connectionService";
import { createOpenApiClient } from "../src/services/broker/ctrader/openApiClient";
import { isCTraderLiveEnabled } from "../src/services/broker/ctrader/flags";

function maskId(id: string): string {
  if (id.length <= 4) return "…" + id.slice(-2);
  return id.slice(0, 2) + "…" + id.slice(-2);
}

async function main() {
  if (isCTraderLiveEnabled()) {
    throw new Error("CTRADER_LIVE_MUST_REMAIN_FALSE");
  }
  if (!getApps().length) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || "goldmeta-web" });
  }
  const suffix = (process.env.CTRADER_SELECT_LIVE_MASK_SUFFIX || "")
    .trim()
    .replace(/^…/, "");
  if (!/^\d{2}$/.test(suffix)) {
    throw new Error(
      "CTRADER_SELECT_LIVE_MASK_SUFFIX_REQUIRED (two digits, e.g. 06 or 41)"
    );
  }
  const ownerUid = (process.env.GOLDMETA_PINNED_OWNER_UID || "").trim();
  assertBrokerUser(ownerUid);
  const conn = await getConnection(ownerUid);
  if (!conn) throw new Error("CTRADER_NOT_CONNECTED");
  const fresh = await ensureFreshAccessToken(conn);
  const api = createOpenApiClient();
  const accounts = await api.listAccountsByAccessToken(fresh.accessToken);
  const livePepperstone = accounts.filter(
    (a) => a.isLive && /pepperstone/i.test(a.brokerNameTitle || "")
  );
  const matches = livePepperstone.filter((a) =>
    a.ctidTraderAccountId.endsWith(suffix)
  );
  if (matches.length !== 1) {
    console.log(
      JSON.stringify({
        error: "LIVE_ACCOUNT_MASK_NOT_UNIQUE",
        suffix,
        livePepperstoneMasked: livePepperstone.map((a) => maskId(a.ctidTraderAccountId))
      })
    );
    process.exit(2);
  }
  const target = matches[0]!;
  const selected = await selectBrokerAccountForUser({
    ownerUid,
    ctidTraderAccountId: target.ctidTraderAccountId,
    confirmPepperstone: true,
    confirmLiveSelection: true,
    api
  });
  // Persist allowlist to stdout as env hint only (masked) — caller sets secret.
  console.log(
    JSON.stringify(
      {
        ok: true,
        environment: "LIVE",
        selectedAccountMasked: selected.account.accountIdMasked,
        brokerName: selected.account.brokerName,
        currency: selected.account.currency,
        symbolName: selected.symbol?.symbolName ?? null,
        symbolId: selected.symbol?.symbolId ?? null,
        digits: selected.symbol?.digits ?? null,
        pipPosition: selected.symbol?.pipPosition ?? null,
        isCTraderLiveEnabled: isCTraderLiveEnabled(),
        orderSubmission: "HARD_LOCKED",
        allowlistHint:
          "Set CTRADER_QUOTE_ACCOUNT_ALLOWLIST to this account id in Secret Manager (do not paste in chat)."
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(
    JSON.stringify({
      error: e instanceof Error ? e.message : String(e),
      code: (e as { code?: string })?.code ?? null
    })
  );
  process.exit(1);
});
