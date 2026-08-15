/**
 * GOLD HUNTER DEMO_ONLY execution adapter.
 * Wraps cTrader Demo market order path. Never Live. Never Fast AutoTrade engine.
 */

import { randomBytes } from "crypto";
import { submitDemoMarketOrder } from "../broker/ctrader/demoOrderExecution";
import {
  isCTraderDemoOrderSubmissionEnabled,
  isCTraderLiveEnabled
} from "../broker/ctrader/flags";
import { getConnection } from "../broker/ctrader/connectionStore";
import {
  assertGoldHunterDemoOnlyEnvironment,
  evaluateGoldHunterOrderGates
} from "./orderGates";
import { loadGoldHunterConfig } from "./configStore";
import { upsertGoldHunterDemoTrade } from "./tradeStore";
import {
  GH_ADMIN_EXECUTION_MODE,
  GH_ADMIN_STRATEGY_ID,
  type GoldHunterDemoTrade
} from "./types";

export type GoldHunterDemoSubmitArgs = {
  ownerUid: string;
  isAdmin: boolean;
  side: "BUY" | "SELL";
  lots: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  entryHint?: number | null;
  setup?: "A" | "B" | "C" | null;
  signalId?: string | null;
  marketOpen: boolean;
  feedFresh: boolean;
  depthValid: boolean;
  spreadOk: boolean;
  capitalOk: boolean;
  dailyLossOk: boolean;
  openTradeCount: number;
  signalPresent: boolean;
  signalConsumed: boolean;
};

/**
 * Place a Gold Hunter Demo order only when ALL gates pass.
 * strategy comment/label = GOLD_HUNTER for ownership attribution.
 */
export async function submitGoldHunterDemoOrder(
  args: GoldHunterDemoSubmitArgs
): Promise<
  | {
      ok: true;
      trade: GoldHunterDemoTrade;
      broker: unknown;
    }
  | {
      ok: false;
      blockers: string[];
      executionMode: typeof GH_ADMIN_EXECUTION_MODE;
      liveExecutionEnabled: false;
    }
> {
  if (isCTraderLiveEnabled()) {
    return {
      ok: false,
      blockers: ["WAIT — LIVE ENVIRONMENT REFUSED"],
      executionMode: GH_ADMIN_EXECUTION_MODE,
      liveExecutionEnabled: false
    };
  }
  if (!isCTraderDemoOrderSubmissionEnabled()) {
    return {
      ok: false,
      blockers: ["WAIT — BROKER DISCONNECTED"],
      executionMode: GH_ADMIN_EXECUTION_MODE,
      liveExecutionEnabled: false
    };
  }

  const connection = await getConnection(args.ownerUid);
  const brokerEnvironment =
    connection?.selectedAccountIsLive === true
      ? "LIVE"
      : connection
        ? "DEMO"
        : null;

  try {
    assertGoldHunterDemoOnlyEnvironment(brokerEnvironment);
  } catch {
    return {
      ok: false,
      blockers: ["WAIT — LIVE ENVIRONMENT REFUSED"],
      executionMode: GH_ADMIN_EXECUTION_MODE,
      liveExecutionEnabled: false
    };
  }

  const config = await loadGoldHunterConfig(args.ownerUid);
  const gates = evaluateGoldHunterOrderGates({
    config,
    brokerEnvironment,
    brokerConnected: Boolean(connection),
    marketOpen: args.marketOpen,
    feedFresh: args.feedFresh,
    depthValid: args.depthValid,
    spreadOk: args.spreadOk,
    capitalOk: args.capitalOk,
    dailyLossOk: args.dailyLossOk,
    openTradeCount: args.openTradeCount,
    signalPresent: args.signalPresent,
    signalConsumed: args.signalConsumed,
    isAdmin: args.isAdmin
  });

  if (!gates.ok) {
    return {
      ok: false,
      blockers: gates.blockers,
      executionMode: GH_ADMIN_EXECUTION_MODE,
      liveExecutionEnabled: false
    };
  }

  if (!(args.lots > 0) || !Number.isFinite(args.lots)) {
    return {
      ok: false,
      blockers: ["WAIT — CONFIG INVALID"],
      executionMode: GH_ADMIN_EXECUTION_MODE,
      liveExecutionEnabled: false
    };
  }

  const goldHunterTradeId = `GH-D-${randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();

  const broker = await submitDemoMarketOrder({
    ownerUid: args.ownerUid,
    side: args.side,
    lots: args.lots,
    stopLoss: args.stopLoss,
    takeProfit: args.takeProfit,
    entryHint: args.entryHint,
    comment: GH_ADMIN_STRATEGY_ID,
    label: goldHunterTradeId,
    // Do NOT pass Fast AutoTrade strategy id — GH ownership is separate.
    strategyId: null
  });

  const trade: GoldHunterDemoTrade = {
    goldHunterTradeId,
    strategy: GH_ADMIN_STRATEGY_ID,
    environment: "DEMO",
    setup: args.setup ?? null,
    side: args.side,
    signalTs: now,
    orderTs: now,
    fillTs: now,
    closeTs: null,
    entry: args.entryHint ?? null,
    exit: null,
    stop: args.stopLoss ?? null,
    entrySpread: null,
    durationMs: null,
    mfe: null,
    mae: null,
    grossPnlEur: null,
    netPnlEur: null,
    result: "OPEN",
    exitReason: null,
    brokerOrderId:
      broker && typeof broker === "object" && "orderId" in broker
        ? String((broker as { orderId?: unknown }).orderId ?? "") || null
        : null,
    brokerPositionId:
      broker && typeof broker === "object" && "positionId" in broker
        ? String((broker as { positionId?: unknown }).positionId ?? "") || null
        : null,
    status: "FILLED"
  };

  await upsertGoldHunterDemoTrade(args.ownerUid, {
    ...trade,
    signalId: args.signalId ?? null,
    createdAt: now,
    ownership: {
      strategy: GH_ADMIN_STRATEGY_ID,
      environment: "DEMO",
      ownerUid: args.ownerUid
    }
  });

  return { ok: true, trade, broker };
}
