/**
 * Assemble Gold Hunter Admin status payload for Dashboard / Monitor / Control.
 * Truthful: does not invent quotes when feed is closed/stale.
 */

import { getConnection } from "../broker/ctrader/connectionStore";
import { getSharedXauusdQuote } from "../marketFeed/sharedMarketData";
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
    connected: boolean;
    environment: "DEMO" | "LIVE" | null;
    accountMasked: string | null;
    brokerName: string | null;
    balance: number | null;
    currency: string | null;
    /** Equity/margin not always in connection record — null when unknown. */
    equity: number | null;
    marginUsed: number | null;
    freeMargin: number | null;
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
    depth: "VALID" | "STALE" | "CROSSED" | "RECOVERY" | "UNKNOWN";
    strategy: "READY" | "WAITING" | "PAUSED";
    risk: "NORMAL" | "LIMITED" | "HALTED";
    autoTrade: "ACTIVE" | "OFF" | "PAUSED";
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
    // Closed market: age grows; classify honestly without calling it transport failure.
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
  isAdmin: boolean
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
  const feedState = feedStateFromAge(
    ageMs,
    marketQuote?.freshness ?? "UNAVAILABLE",
    q?.marketStatus ?? marketQuote?.marketStatus ?? "UNKNOWN"
  );

  let connection = null as Awaited<ReturnType<typeof getConnection>>;
  try {
    connection = await getConnection(ownerUid);
  } catch {
    connection = null;
  }

  const brokerConnected = Boolean(connection?.selectedAccountId);
  const brokerEnvironment: "DEMO" | "LIVE" | null = connection
    ? connection.selectedAccountIsLive
      ? "LIVE"
      : "DEMO"
    : null;

  const todayPnl = todayNetPnlEur(trades);
  const dailyLossBudget = plannedDailyLossBudgetEur(config);
  const riskBudget = plannedRiskBudgetEur(config);
  const committedEur = 0; // Open margin commitment requires broker position reconcile; fail-closed as 0 until proven.
  const availableEur = Math.max(0, config.allocatedCapitalEur - committedEur);

  const marketOpen = (q?.marketStatus ?? marketQuote?.marketStatus) === "OPEN";
  const feedFresh = feedState === "LIVE";
  // Depth cohort not yet attached to this admin status surface.
  // Health shows UNKNOWN; gate does not invent VALID. Depth blocks only when a
  // depth-requiring signal is present (none in this release → depthValid=true).
  const depthHealth: GoldHunterStatusPayload["health"]["depth"] = "UNKNOWN";
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

  let autoTradeHealth: GoldHunterStatusPayload["health"]["autoTrade"] = "OFF";
  if (config.emergencyStopActive || config.pauseNewEntries) autoTradeHealth = "PAUSED";
  else if (config.demoAutoTradeEnabled) autoTradeHealth = "ACTIVE";

  let riskHealth: GoldHunterStatusPayload["health"]["risk"] = "NORMAL";
  if (config.emergencyStopActive) riskHealth = "HALTED";
  else if (!dailyLossOk || !capitalOk) riskHealth = "LIMITED";

  let strategyHealth: GoldHunterStatusPayload["health"]["strategy"] = "WAITING";
  if (config.pauseNewEntries || config.emergencyStopActive) strategyHealth = "PAUSED";
  else if (gates.ok) strategyHealth = "READY";

  const modeLabel =
    config.mode === "DEMO_AUTO" && config.demoAutoTradeEnabled
      ? {
          primary: "DEMO AUTOTRADE",
          secondary: "CTRADER DEMO",
          tertiary: brokerConnected ? "CONNECTED" : "DISCONNECTED"
        }
      : {
          primary: "RESEARCH",
          secondary: "PAPER ONLY",
          tertiary: "NO BROKER EXECUTION"
        };

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
      marketStatus: q?.marketStatus ?? marketQuote?.marketStatus ?? "UNKNOWN",
      freshness: marketQuote?.freshness ?? "UNAVAILABLE",
      ageMs,
      feedState,
      updatedAt: marketQuote?.updatedAt ?? null
    },
    broker: {
      connected: brokerConnected,
      environment: brokerEnvironment,
      accountMasked: connection?.selectedAccountMasked ?? null,
      brokerName: connection?.brokerName ?? null,
      balance: connection?.balance ?? null,
      currency: connection?.currency ?? null,
      equity: connection?.balance ?? null,
      marginUsed: null,
      freeMargin: null
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
    gates,
    openTrades,
    unmatchedDemoPositions: [],
    performanceToday: computeDemoPerformance(trades, "today"),
    audit,
    signal: {
      present: false,
      setup: null,
      side: null,
      note: "WAIT — NO SETUP SELECTED (strategy signal engine not armed for auto-entry in this release)"
    }
  };
}
