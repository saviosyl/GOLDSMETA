/**
 * Canonical AutoTrade summary derived from the same cTrader sources as Broker Control Centre.
 * Source of truth: server connection/diagnostics/accounts — never localStorage account caches.
 */

import type {
  BrokerControlCentreResponse,
  CTraderBrokerAccountOption,
  CTraderDiagnosticsReport,
  UserAutoTradeSettingsDto
} from "./ctraderTypes";

export type AutoTradeSyncSummary = {
  connected: boolean;
  accountSelected: boolean;
  /** Selected broker account type from server (not UI tab). */
  isLive: boolean;
  accountMasked: string | null;
  brokerName: string | null;
  accountLabel: string;
  connectionLabel: string;
  modeLabel: string;
  fundsLabel: string;
  symbolName: string;
  marketStatusRaw: string;
  marketOpen: boolean;
  marketLabel: string;
  quoteLabel: string;
  executionLabel: string;
  goldOk: boolean;
  checksOk: boolean;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  tokenRefreshHealthy: boolean | null;
};

function marketStatusPhrase(raw: string, open: boolean): string {
  if (!raw) return "status unknown";
  if (open) return "Market open";
  const u = raw.toUpperCase();
  if (u === "CLOSED" || u.includes("CLOSE")) return "Market closed";
  return raw.replace(/_/g, " ");
}

export function deriveAutoTradeSyncSummary(args: {
  mode: "demo" | "live";
  centre: BrokerControlCentreResponse | null;
  diagnostics: CTraderDiagnosticsReport | null;
  accounts: CTraderBrokerAccountOption[];
  settings: UserAutoTradeSettingsDto | null;
}): AutoTradeSyncSummary {
  const { mode, centre, diagnostics, accounts, settings } = args;
  const summary = centre?.readiness?.connectionSummary;
  const selectedListed = accounts.find((a) => a.selected) ?? null;

  // Prefer Broker Control Centre + account list first — diagnostics is optional and
  // may 504 on the Cloud Functions gateway without meaning the broker is disconnected.
  const accountMasked =
    summary?.accountMasked ??
    selectedListed?.accountIdMasked ??
    diagnostics?.connection?.accountMasked ??
    centre?.readiness?.connectionSummary?.accountMasked ??
    null;

  // Account type comes from server selection — never from the UI mode tab alone.
  const accountIsLive = Boolean(
    selectedListed?.isLive ||
      diagnostics?.selectedAccountIsLive ||
      diagnostics?.environment === "LIVE"
  );

  const accountSelected = Boolean(
    summary?.accountMasked ||
      selectedListed ||
      diagnostics?.accountSelected ||
      diagnostics?.demoAccountSelected ||
      diagnostics?.selectedAccountIsLive ||
      settings?.selectedAccountId
  );

  const connected = Boolean(
    centre?.readiness?.connected ||
      diagnostics?.oauthConnected ||
      (accountSelected && accountMasked)
  );

  const brokerName =
    diagnostics?.connection?.brokerName ??
    summary?.brokerName ??
    selectedListed?.brokerNameTitle ??
    "Pepperstone";

  const accountLabel = accountSelected && accountMasked
    ? `${brokerName} ${accountIsLive ? "Live" : "Demo"} · ${accountMasked}`
    : mode === "live"
      ? "No Live account selected"
      : "No Demo account selected";

  const connectionLabel = connected
    ? accountSelected
      ? "Connected"
      : "Action required"
    : centre?.readiness?.setupRequired || centre?.readiness?.authSetupRequired
      ? "Setup required"
      : "Disconnected";

  const symbolName =
    diagnostics?.symbol?.symbolName ??
    summary?.symbolName ??
    diagnostics?.connection?.symbolName ??
    "XAUUSD";

  const marketStatusRaw = (diagnostics?.quote?.marketStatus ?? "").trim();
  const marketOpen =
    marketStatusRaw.toUpperCase() === "OPEN" ||
    marketStatusRaw.toUpperCase().includes("TRADEABLE");
  const marketLabel = marketStatusRaw
    ? `${symbolName} · ${marketStatusPhrase(marketStatusRaw, marketOpen)}`
    : accountSelected
      ? `${symbolName} · status pending`
      : `${symbolName} · status unknown`;

  const quoteStale = Boolean(diagnostics?.quote?.stale);
  const hasCentreQuote = Boolean(summary?.lastQuoteAt);
  const quoteLabel = diagnostics?.quote
    ? marketOpen && !quoteStale
      ? "Live quote"
      : "Previous-session quote"
    : hasCentreQuote
      ? "Previous-session quote"
      : "No quote yet";

  const executionLabel =
    !accountSelected
      ? "Not eligible — select a broker account"
      : diagnostics?.quote && !marketOpen
        ? "Not eligible — market closed"
        : quoteStale
          ? "Not eligible — quote stale"
          : hasCentreQuote && !diagnostics?.quote
            ? "Not eligible — diagnostics pending"
            : "Quote not eligible for execution";

  const goldOk = Boolean(
    summary?.symbolName || diagnostics?.goldSymbolFound || diagnostics?.symbol?.symbolName
  );
  const checksOk = Boolean(
    diagnostics?.liveQuoteReceived ||
      diagnostics?.quote ||
      diagnostics?.marketStatusAvailable ||
      hasCentreQuote
  );

  return {
    connected,
    accountSelected,
    isLive: accountIsLive,
    accountMasked,
    brokerName,
    accountLabel,
    connectionLabel,
    modeLabel: accountIsLive || mode === "live" ? "Live AutoTrade" : "Demo AutoTrade",
    fundsLabel: accountIsLive || mode === "live" ? "Real money" : "Demo funds",
    symbolName,
    marketStatusRaw,
    marketOpen,
    marketLabel,
    quoteLabel,
    executionLabel,
    goldOk,
    checksOk,
    bid: diagnostics?.quote?.bid ?? null,
    ask: diagnostics?.quote?.ask ?? null,
    spread: diagnostics?.quote?.spread ?? null,
    tokenRefreshHealthy:
      diagnostics?.connection?.tokenRefreshHealthy === undefined
        ? null
        : Boolean(diagnostics.connection.tokenRefreshHealthy)
  };
}

export type ActivityItem = {
  id: string;
  at: string;
  message: string;
  level: "info" | "warn" | "error" | "success";
};

/**
 * Ensure the latest visible activity reflects current connection health.
 * Historical reconnect-required rows may remain but must not lead the feed
 * when the canonical state is Connected with a selected account.
 */
export function buildAutoTradeActivityFeed(args: {
  activity: ActivityItem[];
  summary: AutoTradeSyncSummary;
  /** Demo Auto SSOT label — never hardcode OFF when authority is ON. */
  autoTradeLabel?: "ON" | "OFF" | "PAUSED" | "LOCKED" | string;
}): ActivityItem[] {
  const items = [...(args.activity ?? [])];
  if (args.summary.connected && args.summary.accountSelected && args.summary.accountMasked) {
    const atLabel = args.autoTradeLabel ?? "OFF";
    const message = `Pepperstone ${args.summary.isLive ? "Live" : "Demo"} account ${args.summary.accountMasked} connected. AutoTrade ${atLabel}. ${
      atLabel === "ON" ? "Waiting for valid setup." : "No order placed."
    }`;
    const alreadyCurrent =
      items[0]?.message?.includes(args.summary.accountMasked) &&
      new RegExp(`connected\\. AutoTrade ${atLabel}`, "i").test(items[0]?.message ?? "");
    if (!alreadyCurrent) {
      items.unshift({
        id: `canonical-connected-${args.summary.accountMasked}`,
        at: new Date().toISOString(),
        message,
        level: "info"
      });
    }
  }
  return items.slice(0, 12);
}
