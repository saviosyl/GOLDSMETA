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

  const accountMasked =
    diagnostics?.connection?.accountMasked ??
    summary?.accountMasked ??
    selectedListed?.accountIdMasked ??
    centre?.readiness?.connectionSummary?.accountMasked ??
    null;

  // Account type comes from server selection — never from the UI mode tab alone.
  const accountIsLive = Boolean(
    diagnostics?.selectedAccountIsLive ||
      diagnostics?.environment === "LIVE" ||
      selectedListed?.isLive
  );

  const accountSelected = Boolean(
    diagnostics?.accountSelected ||
      diagnostics?.demoAccountSelected ||
      diagnostics?.selectedAccountIsLive ||
      selectedListed ||
      summary?.accountMasked ||
      settings?.selectedAccountId
  );

  const connected = Boolean(
    diagnostics?.oauthConnected ||
      centre?.readiness?.connected ||
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
  const quoteLabel = !diagnostics?.quote
    ? "No quote yet"
    : marketOpen && !quoteStale
      ? "Live quote"
      : "Previous-session quote";

  const executionLabel =
    !accountSelected
      ? "Not eligible — select a broker account"
      : !marketOpen
        ? "Not eligible — market closed"
        : quoteStale
          ? "Not eligible — quote stale"
          : "Quote not eligible for execution";

  const goldOk = Boolean(diagnostics?.goldSymbolFound || summary?.symbolName);
  const checksOk = Boolean(
    diagnostics?.liveQuoteReceived ||
      diagnostics?.quote ||
      diagnostics?.marketStatusAvailable
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
}): ActivityItem[] {
  const items = [...(args.activity ?? [])];
  if (args.summary.connected && args.summary.accountSelected && args.summary.accountMasked) {
    const message = `Pepperstone ${args.summary.isLive ? "Live" : "Demo"} account ${args.summary.accountMasked} connected. AutoTrade OFF. No order placed.`;
    const alreadyCurrent =
      items[0]?.message?.includes(args.summary.accountMasked) &&
      /connected\. AutoTrade OFF/i.test(items[0]?.message ?? "");
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
