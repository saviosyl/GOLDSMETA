/**
 * First controlled Demo order checkpoint — prepare full preview, never submit.
 * Owner must reply APPROVE FIRST DEMO ORDER before any market order is placed.
 */

import { getConnection } from "./connectionStore";
import { buildDiagnostics, buildLiveDemoPreview } from "./connectionService";
import { getUserAutoTradeSettings } from "./userAutoTradeSettings";
import { isCTraderDemoOrderSubmissionEnabled } from "./flags";

export type CheckpointCheck = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
};

export type FirstDemoOrderCheckpoint = {
  checkpoint: "FIRST_DEMO_ORDER";
  status: "READY_FOR_OWNER_APPROVAL" | "BLOCKED";
  autoTrade: "OFF";
  orderSubmissionEnabled: false;
  submissionArmed: false;
  requiresOwnerReply: "APPROVE FIRST DEMO ORDER";
  account: {
    masked: string | null;
    isLive: boolean;
    environment: "DEMO" | "LIVE" | null;
    oauthScope: "accounts" | "trading" | null;
    currency: string | null;
    equity: number | null;
    freeMargin: number | null;
    balance: number | null;
  };
  market: {
    symbolName: string | null;
    symbolId: string | null;
    bid: number | null;
    ask: number | null;
    spread: number | null;
    quoteAgeSeconds: number | null;
    marketStatus: string | null;
    stale: boolean;
    digits: number | null;
    minVolume: number | null;
    maxVolume: number | null;
    volumeStep: number | null;
    contractSize: number | null;
  };
  proposed: {
    side: "BUY" | "SELL" | "WAIT";
    entry: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    requestedLotSize: number | null;
    brokerRoundedLotSize: number | null;
    estimatedLossAtStop: number | null;
    expectedMargin: number | null;
    riskReward: number | null;
    confidence: number | null;
    signalSource: string;
  };
  checks: CheckpointCheck[];
  notice: string;
};

export async function buildFirstDemoOrderCheckpoint(args: {
  ownerUid: string;
  decision?: "BUY" | "SELL" | "WAIT";
  confidence?: number;
}): Promise<FirstDemoOrderCheckpoint> {
  const decision = args.decision ?? "BUY";
  const confidence = args.confidence ?? 85;
  const connection = await getConnection(args.ownerUid);
  const diagnostics = await buildDiagnostics(args.ownerUid).catch(() => null);
  const settings = await getUserAutoTradeSettings(args.ownerUid, "demo").catch(() => null);

  const quote = diagnostics?.quote ?? null;
  const symbol = diagnostics?.symbol ?? null;
  const account = diagnostics?.account ?? null;
  const quoteAgeSeconds =
    quote?.timestamp != null
      ? Math.max(0, (Date.now() - Date.parse(quote.timestamp)) / 1000)
      : null;
  const marketOpen = String(quote?.marketStatus ?? "")
    .toUpperCase()
    .includes("OPEN") ||
    String(quote?.marketStatus ?? "")
      .toUpperCase()
      .includes("TRADEABLE");

  let preview: Awaited<ReturnType<typeof buildLiveDemoPreview>> | null = null;
  if (decision === "BUY" || decision === "SELL") {
    try {
      preview = await buildLiveDemoPreview({
        ownerUid: args.ownerUid,
        decision,
        confidence
      });
    } catch {
      preview = null;
    }
  }

  const p = preview?.preview ?? null;
  const side = decision === "WAIT" ? "WAIT" : decision;
  const entry =
    side === "BUY" ? quote?.ask ?? null : side === "SELL" ? quote?.bid ?? null : null;

  const checks: CheckpointCheck[] = [
    {
      id: "oauth_trading_scope",
      label: "Trading scope authorised",
      ok: connection?.oauthScope === "trading",
      detail:
        connection?.oauthScope === "trading"
          ? "OAuth scope=trading granted"
          : "Authorise Demo Trading required (scope=trading)"
    },
    {
      id: "demo_account_selected",
      label: "Demo account selected",
      ok: Boolean(
        connection?.selectedAccountId &&
          !connection.selectedAccountIsLive &&
          connection.environment !== "LIVE"
      ),
      detail: connection?.selectedAccountMasked
        ? `Selected ${connection.selectedAccountMasked}${
            connection.selectedAccountIsLive ? " (LIVE — blocked)" : " (Demo)"
          }`
        : "No Demo account selected"
    },
    {
      id: "not_live",
      label: "Not a Live account",
      ok: !connection?.selectedAccountIsLive,
      detail: connection?.selectedAccountIsLive
        ? "Live account selected — stop"
        : "Demo account path"
    },
    {
      id: "market_open",
      label: "XAUUSD market open",
      ok: Boolean(marketOpen && quote && !quote.stale),
      detail: marketOpen
        ? quote?.stale
          ? "Market open flag set but quote is stale/previous-session"
          : `Market status ${quote?.marketStatus ?? "OPEN"}`
        : `Market status ${quote?.marketStatus ?? "unknown"} — do not use weekend/stale quotes`
    },
    {
      id: "fresh_quote",
      label: "Quote age within limit",
      ok:
        quoteAgeSeconds != null &&
        quoteAgeSeconds <= (settings?.maxQuoteAgeSeconds ?? 15) &&
        !quote?.stale,
      detail:
        quoteAgeSeconds == null
          ? "No quote timestamp"
          : `Age ${quoteAgeSeconds.toFixed(1)}s (limit ${settings?.maxQuoteAgeSeconds ?? 15}s)`
    },
    {
      id: "spread",
      label: "Spread within limit",
      ok:
        quote?.spread != null &&
        quote.spread <= (settings?.maxSpread ?? 2),
      detail:
        quote?.spread == null
          ? "Spread unavailable"
          : `Spread ${quote.spread} (limit ${settings?.maxSpread ?? 2})`
    },
    {
      id: "symbol_meta",
      label: "Symbol metadata",
      ok: Boolean(symbol?.symbolName && (symbol.minVolume != null || symbol.volumeStep != null)),
      detail: symbol?.symbolName
        ? `${symbol.symbolName} min=${symbol.minVolume ?? "?"} step=${symbol.volumeStep ?? "?"}`
        : "Symbol unresolved"
    },
    {
      id: "equity_margin",
      label: "Equity / usable margin",
      ok: account?.equity != null || account?.freeMargin != null || account?.balance != null,
      detail: `equity=${account?.equity ?? "—"} freeMargin=${account?.freeMargin ?? "—"}`
    },
    {
      id: "emergency_stop",
      label: "Emergency STOP inactive",
      ok: !settings?.emergencyStopActive,
      detail: settings?.emergencyStopActive ? "STOP active" : "STOP inactive"
    },
    {
      id: "submission_still_off",
      label: "Order submission still OFF (checkpoint)",
      ok: !isCTraderDemoOrderSubmissionEnabled(),
      detail: "Submission stays OFF until owner replies APPROVE FIRST DEMO ORDER"
    }
  ];

  const blocked = checks.some(
    (c) =>
      !c.ok &&
      c.id !== "submission_still_off" &&
      c.id !== "market_open" &&
      c.id !== "fresh_quote"
  );
  // Market-closed on weekend is an expected BLOCKED state for the checkpoint.
  const status: FirstDemoOrderCheckpoint["status"] =
    blocked || !marketOpen || Boolean(quote?.stale)
      ? "BLOCKED"
      : checks.every((c) => c.id === "submission_still_off" || c.ok)
        ? "READY_FOR_OWNER_APPROVAL"
        : "BLOCKED";

  return {
    checkpoint: "FIRST_DEMO_ORDER",
    status,
    autoTrade: "OFF",
    orderSubmissionEnabled: false,
    submissionArmed: false,
    requiresOwnerReply: "APPROVE FIRST DEMO ORDER",
    account: {
      masked: connection?.selectedAccountMasked ?? diagnostics?.connection?.accountMasked ?? null,
      isLive: Boolean(connection?.selectedAccountIsLive),
      environment: connection?.environment ?? null,
      oauthScope: connection?.oauthScope ?? null,
      currency: account?.currency ?? connection?.currency ?? null,
      equity: account?.equity ?? null,
      freeMargin: account?.freeMargin ?? null,
      balance: account?.balance ?? connection?.balance ?? null
    },
    market: {
      symbolName: symbol?.symbolName ?? connection?.symbolName ?? "XAUUSD",
      symbolId: symbol?.symbolId ?? connection?.symbolId ?? null,
      bid: quote?.bid ?? null,
      ask: quote?.ask ?? null,
      spread: quote?.spread ?? null,
      quoteAgeSeconds,
      marketStatus: quote?.marketStatus ?? null,
      stale: Boolean(quote?.stale),
      digits: (symbol as { digits?: number } | null)?.digits ?? null,
      minVolume: symbol?.minVolume ?? null,
      maxVolume: (symbol as { maxVolume?: number } | null)?.maxVolume ?? null,
      volumeStep: symbol?.volumeStep ?? null,
      contractSize: (symbol as { lotSize?: number } | null)?.lotSize ?? null
    },
    proposed: {
      side,
      entry,
      stopLoss: (p as { stopLoss?: number } | null)?.stopLoss ?? null,
      takeProfit: (p as { takeProfit?: number } | null)?.takeProfit ?? null,
      requestedLotSize: (p as { proposedVolume?: number } | null)?.proposedVolume ?? null,
      brokerRoundedLotSize: (p as { proposedVolume?: number } | null)?.proposedVolume ?? null,
      estimatedLossAtStop: (p as { riskAmount?: number } | null)?.riskAmount ?? settings?.fixedRiskAmount ?? null,
      expectedMargin: (p as { expectedMargin?: number } | null)?.expectedMargin ?? null,
      riskReward: settings?.minRiskReward ?? null,
      confidence,
      signalSource: "GoldMeta controlled Demo checkpoint (manual preview)"
    },
    checks,
    notice:
      status === "READY_FOR_OWNER_APPROVAL"
        ? "First Demo order is prepared. Reply APPROVE FIRST DEMO ORDER to submit exactly one minimum Demo order. AutoTrade stays OFF."
        : "First Demo order checkpoint is blocked. Fix failed checks (and wait for market open). No order was submitted."
  };
}
