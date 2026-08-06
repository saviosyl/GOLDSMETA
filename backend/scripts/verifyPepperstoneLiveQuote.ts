#!/usr/bin/env npx tsx
/**
 * Read-only Pepperstone verification (masked output only).
 * Never prints tokens, secrets, or full account numbers.
 */
import { initializeApp, getApps } from "firebase-admin/app";
import { getConnection } from "../src/services/broker/ctrader/connectionStore";
import {
  ensureFreshAccessToken,
  assertBrokerUser
} from "../src/services/broker/ctrader/connectionService";
import { createOpenApiClient } from "../src/services/broker/ctrader/openApiClient";
import {
  isCTraderLiveEnabled,
  snapshotCTraderFlags
} from "../src/services/broker/ctrader/flags";

function maskId(id: string | number | null | undefined): string | null {
  if (id == null) return null;
  const s = String(id);
  if (s.length <= 4) return "…" + s.slice(-2);
  return s.slice(0, 2) + "…" + s.slice(-2);
}

function maskLogin(login: string | number | null | undefined): string | null {
  if (login == null) return null;
  const s = String(login);
  if (s.length <= 4) return "…" + s.slice(-2);
  return s.slice(0, 2) + "…" + s.slice(-2);
}

async function main() {
  if (!getApps().length) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || "goldmeta-web" });
  }

  const ownerUid = (
    process.env.CTRADER_QUOTE_OWNER_UID ||
    process.env.GOLDMETA_PINNED_OWNER_UID ||
    ""
  ).trim();
  assertBrokerUser(ownerUid);

  console.log(
    JSON.stringify(
      {
        step: "flags",
        flags: snapshotCTraderFlags(),
        isCTraderLiveEnabled: isCTraderLiveEnabled(),
        CTRADER_ENVIRONMENT: process.env.CTRADER_ENVIRONMENT || null,
        redirectHost: (() => {
          try {
            return new URL(process.env.CTRADER_REDIRECT_URI || "").host;
          } catch {
            return null;
          }
        })(),
        redirectPath: (() => {
          try {
            return new URL(process.env.CTRADER_REDIRECT_URI || "").pathname;
          } catch {
            return null;
          }
        })(),
        clientIdPresent: Boolean((process.env.CTRADER_CLIENT_ID || "").trim()),
        clientSecretPresent: Boolean(
          (process.env.CTRADER_CLIENT_SECRET || "").trim()
        ),
        encryptionKeyPresent: Boolean(
          (process.env.CTRADER_TOKEN_ENCRYPTION_KEY || "").trim()
        )
      },
      null,
      2
    )
  );

  const conn = await getConnection(ownerUid);
  if (!conn) {
    console.log(JSON.stringify({ step: "connection", error: "NOT_CONNECTED" }));
    process.exit(2);
  }

  console.log(
    JSON.stringify(
      {
        step: "connection",
        broker: conn.brokerName,
        brokerConfirmedPepperstone: conn.brokerConfirmedPepperstone,
        environment: conn.environment,
        selectedAccountIsLive: conn.selectedAccountIsLive,
        selectedAccountMasked: conn.selectedAccountMasked,
        selectedAccountIdMasked: maskId(conn.selectedAccountId),
        currency: conn.currency,
        symbolName: conn.symbolName,
        symbolId: conn.symbolId,
        hasEncryptedTokens: Boolean(conn.tokens?.ciphertext),
        disconnectedAt: conn.disconnectedAt ?? null,
        lastSyncAt: conn.lastSyncAt ?? null,
        connectionStatus: conn.disconnectedAt ? "DISCONNECTED" : "CONNECTED"
      },
      null,
      2
    )
  );

  const fresh = await ensureFreshAccessToken(conn, undefined, { force: true });
  const expiresAtMs = Date.parse(fresh.connection.tokens.accessExpiresAt);
  console.log(
    JSON.stringify(
      {
        step: "token_refresh",
        ok: Boolean(fresh.accessToken),
        accessTokenPresent: Boolean(fresh.accessToken),
        refreshTokenPresent: Boolean(fresh.connection.tokens?.ciphertext),
        expiresAt: fresh.connection.tokens.accessExpiresAt ?? null,
        refreshedAt: fresh.connection.tokens.refreshedAt ?? null,
        tokenExpiryStatus: Number.isFinite(expiresAtMs)
          ? expiresAtMs > Date.now()
            ? "VALID"
            : "EXPIRED"
          : "UNKNOWN"
      },
      null,
      2
    )
  );

  const api = createOpenApiClient();
  const accounts = await api.listAccountsByAccessToken(fresh.accessToken);
  const masked = accounts.map((a) => ({
    ctidTradingAccountIdMasked: maskId(a.ctidTraderAccountId),
    isLive: a.isLive,
    brokerName: a.brokerNameTitle,
    currency: a.depositCurrency,
    accountMasked: a.accountIdMasked,
    pepperstone: /pepperstone/i.test(a.brokerNameTitle || "")
  }));
  const livePepperstone = masked.filter((a) => a.isLive && a.pepperstone);
  const demoPepperstone = masked.filter((a) => !a.isLive && a.pepperstone);
  console.log(
    JSON.stringify(
      {
        step: "accounts",
        total: masked.length,
        livePepperstoneCount: livePepperstone.length,
        demoPepperstoneCount: demoPepperstone.length,
        accounts: masked,
        livePepperstone,
        demoPepperstone
      },
      null,
      2
    )
  );

  // Prefer explicitly selected LIVE Pepperstone account when present; otherwise
  // use the currently selected account for quote discovery (still read-only).
  const target =
    accounts.find(
      (a) =>
        a.isLive &&
        /pepperstone/i.test(a.brokerNameTitle || "") &&
        a.ctidTraderAccountId === fresh.connection.selectedAccountId
    ) ||
    accounts.find(
      (a) => a.isLive && /pepperstone/i.test(a.brokerNameTitle || "")
    ) ||
    accounts.find(
      (a) => a.ctidTraderAccountId === fresh.connection.selectedAccountId
    );

  if (!target) {
    console.log(JSON.stringify({ step: "quote", error: "NO_TARGET_ACCOUNT" }));
    return;
  }

  console.log(
    JSON.stringify(
      {
        step: "target_account",
        accountMasked: target.accountIdMasked,
        ctidTradingAccountIdMasked: maskId(target.ctidTraderAccountId),
        isLive: target.isLive,
        brokerName: target.brokerNameTitle,
        currency: target.depositCurrency,
        currentlySelected:
          target.ctidTraderAccountId === fresh.connection.selectedAccountId
      },
      null,
      2
    )
  );

  const symbol = await api.discoverXauUsd({
    accessToken: fresh.accessToken,
    clientId: process.env.CTRADER_CLIENT_ID!.trim(),
    clientSecret: process.env.CTRADER_CLIENT_SECRET!.trim(),
    ctidTraderAccountId: String(target.ctidTraderAccountId),
    isLive: Boolean(target.isLive)
  });
  console.log(JSON.stringify({ step: "xauusd_symbol", symbol }, null, 2));

  if (!symbol?.symbolId) {
    console.log(JSON.stringify({ step: "quote", error: "SYMBOL_NOT_FOUND" }));
    return;
  }

  const quote = await api.fetchQuote({
    accessToken: fresh.accessToken,
    clientId: process.env.CTRADER_CLIENT_ID!.trim(),
    clientSecret: process.env.CTRADER_CLIENT_SECRET!.trim(),
    ctidTraderAccountId: String(target.ctidTraderAccountId),
    symbolId: String(symbol.symbolId),
    isLive: Boolean(target.isLive)
  });
  const mid =
    quote.bid != null && quote.ask != null
      ? (quote.bid + quote.ask) / 2
      : null;
  console.log(
    JSON.stringify(
      {
        step: "quote_sample",
        bid: quote.bid,
        ask: quote.ask,
        mid,
        spread:
          quote.bid != null && quote.ask != null
            ? quote.ask - quote.bid
            : quote.spread,
        digits: symbol.digits,
        pipPosition: symbol.pipPosition,
        minVolume: symbol.minVolume,
        maxVolume: symbol.maxVolume,
        volumeStep: symbol.volumeStep,
        marketStatus: quote.marketStatus,
        brokerTimestamp: quote.timestamp,
        environment: target.isLive ? "LIVE" : "DEMO",
        source: quote.source
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(
    JSON.stringify({
      event: "verify_fatal",
      error: e instanceof Error ? e.message : String(e),
      code: (e as { code?: string })?.code ?? null
    })
  );
  process.exit(1);
});
