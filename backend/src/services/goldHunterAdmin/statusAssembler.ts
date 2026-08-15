/**
 * Assemble Gold Hunter Admin status payload for Dashboard / Monitor / Control.
 * Truthful: does not invent quotes or broker money fields.
 */

import { getSharedXauusdQuote } from "../marketFeed/sharedMarketData";
import {
  evaluateGoldHunterArmingReadiness,
  fetchGoldHunterAccountSnapshot,
  type GoldHunterAccountSnapshot
} from "./accountSnapshot";
import { loadGoldHunterConfig, listGoldHunterAudit } from "./configStore";
import { evaluateGoldHunterOrderGates } from "./orderGates";
import {
  plannedDailyLossBudgetEur,
  plannedRiskBudgetEur
} from "./riskSizing";
import {
  computeDemoPerformance,
  listGoldHunterDemoTrades,
  todayNetPnlEur
} from "./tradeStore";
import {
  GH_ADMIN_EXECUTION_MODE,
  GH_ADMIN_STRATEGY_ID,
  type GoldHunterDemoTrade
} from "./types";

const FEED_STALE_MS = 45_000;
const FEED_HARD_STALE_MS = 120_000;

/** Gold Hunter A/B/C selector is not wired on this product surface yet. */
export const GH_STRATEGY_SELECTOR_CONNECTED = false;

export type GoldHunterStatusPayload = {
  product: "GOLD_HUNTER";
  strategy: typeof GH_ADMIN_STRATEGY_ID;
  executionMode: typeof GH_ADMIN_EXECUTION_MODE;
  liveExecutionEnabled: false;
  runtimeSha: string | null;
  config: Awaited<ReturnType<typeof loadGoldHunterConfig>>;
  modeLabel: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
  market: {
    symbol: "XAUUSD";
    bid: number | null;
    ask: number | null;
    mid: number | null;
    spread: number | null;
    marketStatus: string;
    freshness: string;
    ageMs: number | null;
    feedState: "LIVE" | "STALE" | "HARD_STALE" | "UNAVAILABLE";
    updatedAt: string | null;
  };
  broker: {
    provider: "cTrader";
    connected: boolean;
    environment: "DEMO" | "LIVE" | null;
    authState: GoldHunterAccountSnapshot["authState"];
    authorised: boolean;
    accountMasked: string | null;
    brokerName: string | null;
    balance: number | null;
    currency: string | null;
    equity: number | null;
    marginUsed: number | null;
    freeMargin: number | null;
    openPositionCount: number | null;
    snapshotAgeMs: number | null;
    lastSyncAt: string | null;
    snapshotSource: GoldHunterAccountSnapshot["source"];
    demoOrderSubmissionEnabled: boolean;
    validForRisk: boolean;
  };
  capital: {
    allocatedEur: number;
    committedEur: number;
    availableEur: number;
    todayPnlEur: number;
    riskBudgetEur: number;
    dailyLossBudgetEur: number;
  };
  health: {
    marketFeed: "LIVE" | "STALE" | "HARD_STALE" | "UNAVAILABLE";
    transport: "CONNECTED" | "DISCONNECTED";
    depth: "VALID" | "STALE" | "CROSSED" | "RECOVERY" | "UNKNOWN" | "UNAVAILABLE";
    strategy: "READY" | "WAITING" | "PAUSED" | "WAITING_FOR_MARKET";
    risk: "NORMAL" | "LIMITED" | "HALTED";
    autoTrade: "ACTIVE" | "OFF" | "PAUSED";
  };
  strategyPipeline: {
    connected: boolean;
    spot: "LIVE" | "STALE" | "HARD_STALE" | "UNAVAILABLE" | "CLOSED";
    depth: string;
    selector: "CONNECTED" | "NOT_CONNECTED";
    state: string;
    lastSelectedCandidate: null;
  };
  arming: {
    ready: boolean;
    blockers: string[];
    strategySelectorConnected: boolean;
  };
  gates: ReturnType<typeof evaluateGoldHunterOrderGates>;
  openTrades: GoldHunterDemoTrade[];
  unmatchedDemoPositions: Array<{
    label: "UNMATCHED DEMO POSITION";
    brokerPositionId: string;
    note: string;
  }>;
  performanceToday: ReturnType<typeof computeDemoPerformance>;
  audit: Awaited<ReturnType<typeof listGoldHunterAudit>>;
  signal: {
    present: boolean;
    setup: "A" | "B" | "C" | null;
    side: "BUY" | "SELL" | null;
    note: string;
  };
};

function feedStateFromAge(
  ageMs: number | null,
  freshness: string,
  marketStatus: string
): "LIVE" | "STALE" | "HARD_STALE" | "UNAVAILABLE" {
  if (freshness === "UNAVAILABLE" || ageMs == null) return "UNAVAILABLE";
  if (marketStatus === "CLOSED") {
    if (ageMs > FEED_HARD_STALE_MS) return "HARD_STALE";
    if (ageMs > FEED_STALE_MS) return "STALE";
    return "STALE";
  }
  if (ageMs > FEED_HARD_STALE_MS) return "HARD_STALE";
  if (ageMs > FEED_STALE_MS || freshness === "STALE") return "STALE";
  return "LIVE";
}

export async function assembleGoldHunterStatus(
  ownerUid: string,
  isAdmin: boolean,
  opts?: { forceAccountRefresh?: boolean }
): Promise<GoldHunterStatusPayload> {
  const config = await loadGoldHunterConfig(ownerUid);
  const trades = await listGoldHunterDemoTrades(ownerUid, { limit: 200 });
  const openTrades = trades.filter(
    (t) => t.status !== "CLOSED" && (t.result === "OPEN" || t.result == null)
  );
  const audit = await listGoldHunterAudit(ownerUid, 20);

  let marketQuote: Awaited<ReturnType<typeof getSharedXauusdQuote>> | null = null;
  try {
    marketQuote = await getSharedXauusdQuote({ refreshIfNeeded: true });
  } catch {
    marketQuote = null;
  }

  const q = marketQuote?.quote ?? null;
  const ageMs = q?.ageMs ?? null;
  const marketStatus = q?.marketStatus ?? marketQuote?.marketStatus ?? "UNKNOWN";
  const feedState = feedStateFromAge(
    ageMs,
    marketQuote?.freshness ?? "UNAVAILABLE",
    marketStatus
  );

  const account = await fetchGoldHunterAccountSnapshot({
    ownerUid,
    forceRefresh: opts?.forceAccountRefresh === true
  });

  const brokerConnected =
    account.authState === "AUTHORISED" ||
    account.authState === "STALE" ||
    account.authState === "CONNECTED";
  const brokerEnvironment = account.environment;

  const todayPnl = todayNetPnlEur(trades);
  const dailyLossBudget = plannedDailyLossBudgetEur(config);
  const riskBudget = plannedRiskBudgetEur(config);
  const committedEur = 0;
  const availableEur = Math.max(0, config.allocatedCapitalEur - committedEur);

  const marketOpen = marketStatus === "OPEN";
  const feedFresh = feedState === "LIVE";
  const depthHealth: GoldHunterStatusPayload["health"]["depth"] =
    marketStatus === "CLOSED" ? "UNAVAILABLE" : "UNKNOWN";
  const signalPresent = false;
  const depthValid = !signalPresent;

  const spreadOk =
    q != null && Number.isFinite(q.spread) ? q.spread <= 1.5 : false;
  const capitalOk = availableEur > 0 && config.allocatedCapitalEur > 0;
  const dailyLossOk = todayPnl > -dailyLossBudget;

  const gates = evaluateGoldHunterOrderGates({
    config,
    brokerEnvironment,
    brokerConnected,
    accountSnapshotValid: account.validForRisk,
    marketOpen,
    feedFresh,
    depthValid,
    spreadOk,
    capitalOk,
    dailyLossOk,
    openTradeCount: openTrades.length,
    signalPresent,
    signalConsumed: false,
    isAdmin
  });

  const arming = evaluateGoldHunterArmingReadiness({
    snapshot: account,
    allocatedCapitalEur: config.allocatedCapitalEur,
    riskPerTradePct: config.riskPerTradePct,
    strategySelectorConnected: GH_STRATEGY_SELECTOR_CONNECTED
  });

  let autoTradeHealth: GoldHunterStatusPayload["health"]["autoTrade"] = "OFF";
  if (config.emergencyStopActive || config.pauseNewEntries) autoTradeHealth = "PAUSED";
  else if (config.demoAutoTradeEnabled) autoTradeHealth = "ACTIVE";

  let riskHealth: GoldHunterStatusPayload["health"]["risk"] = "NORMAL";
  if (config.emergencyStopActive) riskHealth = "HALTED";
  else if (!dailyLossOk || !capitalOk || !account.validForRisk) riskHealth = "LIMITED";

  let strategyHealth: GoldHunterStatusPayload["health"]["strategy"] = "WAITING";
  if (config.pauseNewEntries || config.emergencyStopActive) strategyHealth = "PAUSED";
  else if (!marketOpen) strategyHealth = "WAITING_FOR_MARKET";
  else if (gates.ok) strategyHealth = "READY";

  const modeLabel =
    config.mode === "DEMO_AUTO" && config.demoAutoTradeEnabled
      ? {
          primary: "DEMO AUTOTRADE",
          secondary: "CTRADER DEMO",
          tertiary:
            account.authState === "AUTHORISED"
              ? "CONNECTED"
              : account.authState === "STALE"
                ? "STALE"
                : account.authState
        }
      : marketOpen
        ? {
            primary: "RESEARCH",
            secondary: "PAPER ONLY",
            tertiary: "NO BROKER EXECUTION"
          }
        : {
            primary: config.demoAutoTradeEnabled ? "DEMO AUTOTRADE" : "RESEARCH",
            secondary: "CTRADER DEMO",
            tertiary: marketOpen ? "READY" : "WAITING FOR MARKET"
          };

  const spotPipeline =
    marketStatus === "CLOSED"
      ? ("CLOSED" as const)
      : feedState === "LIVE"
        ? ("LIVE" as const)
        : feedState;

  return {
    product: "GOLD_HUNTER",
    strategy: GH_ADMIN_STRATEGY_ID,
    executionMode: GH_ADMIN_EXECUTION_MODE,
    liveExecutionEnabled: false,
    runtimeSha: process.env.K_REVISION ?? process.env.GIT_COMMIT_SHA ?? null,
    config,
    modeLabel,
    market: {
      symbol: "XAUUSD",
      bid: q?.bid ?? null,
      ask: q?.ask ?? null,
      mid: q?.mid ?? null,
      spread: q?.spread ?? null,
      marketStatus,
      freshness: marketQuote?.freshness ?? "UNAVAILABLE",
      ageMs,
      feedState,
      updatedAt: marketQuote?.updatedAt ?? null
    },
    broker: {
      provider: "cTrader",
      connected: brokerConnected,
      environment: brokerEnvironment,
      authState: account.authState,
      authorised: account.authorised,
      accountMasked: account.accountMasked,
      brokerName: account.brokerName,
      balance: account.balance,
      currency: account.currency,
      equity: account.equity,
      marginUsed: account.marginUsed,
      freeMargin: account.freeMargin,
      openPositionCount: account.openPositionCount,
      snapshotAgeMs: account.ageMs,
      lastSyncAt: account.capturedAt,
      snapshotSource: account.source,
      demoOrderSubmissionEnabled: account.demoOrderSubmissionEnabled,
      validForRisk: account.validForRisk
    },
    capital: {
      allocatedEur: config.allocatedCapitalEur,
      committedEur,
      availableEur,
      todayPnlEur: todayPnl,
      riskBudgetEur: riskBudget,
      dailyLossBudgetEur: dailyLossBudget
    },
    health: {
      marketFeed: feedState,
      transport: brokerConnected ? "CONNECTED" : "DISCONNECTED",
      depth: depthHealth,
      strategy: strategyHealth,
      risk: riskHealth,
      autoTrade: autoTradeHealth
    },
    strategyPipeline: {
      connected: GH_STRATEGY_SELECTOR_CONNECTED,
      spot: spotPipeline,
      depth: depthHealth,
      selector: GH_STRATEGY_SELECTOR_CONNECTED ? "CONNECTED" : "NOT_CONNECTED",
      state: !marketOpen
        ? "WAITING_FOR_MARKET"
        : GH_STRATEGY_SELECTOR_CONNECTED
          ? "EVALUATING"
          : "SELECTOR_NOT_CONNECTED",
      lastSelectedCandidate: null
    },
    arming,
    gates,
    openTrades,
    unmatchedDemoPositions: [],
    performanceToday: computeDemoPerformance(trades, "today"),
    audit,
    signal: {
      present: false,
      setup: null,
      side: null,
      note: GH_STRATEGY_SELECTOR_CONNECTED
        ? "WAIT — NO SETUP SELECTED"
        : "WAIT — NO SETUP SELECTED (Gold Hunter A/B/C selector not connected — Demo AutoTrade remains fail-closed for natural entries)"
    }
  };
}
