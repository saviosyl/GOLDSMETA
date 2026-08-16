/**
 * GOLD HUNTER DEMO_ONLY execution adapter.
 * Truthful broker results — never mark FILLED without accepted evidence.
 * Never Fast AutoTrade engine.
 */

import {
  submitDemoMarketOrder,
  type SubmitDemoMarketOrderArgs
} from "../broker/ctrader/demoOrderExecution";
import type { DemoMarketOrderResult } from "../broker/ctrader/openApiClient";
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
  goldHunterTradeId: string;
  clientOrderId: string;
  symbolId?: string | null;
  marketOpen: boolean;
  feedFresh: boolean;
  depthValid: boolean;
  spreadOk: boolean;
  capitalOk: boolean;
  dailyLossOk: boolean;
  openTradeCount: number;
  signalPresent: boolean;
  signalConsumed: boolean;
  accountSnapshotValid: boolean;
  /** Injected for tests. */
  placeOrder?: (args: SubmitDemoMarketOrderArgs) => Promise<DemoMarketOrderResult>;
};

export type GoldHunterDemoSubmitOk = {
  ok: true;
  outcome:
    | "FILLED"
    | "ACCEPTED_PENDING_FILL"
    | "BROKER_REJECTED"
    | "BROKER_SUBMIT_ERROR";
  trade: GoldHunterDemoTrade | null;
  broker: DemoMarketOrderResult | null;
  errorCode: string | null;
};

export type GoldHunterDemoSubmitFail = {
  ok: false;
  blockers: string[];
  executionMode: typeof GH_ADMIN_EXECUTION_MODE;
  liveExecutionEnabled: false;
};

/**
 * Place a Gold Hunter Demo order only when ALL gates pass.
 * Persists truthful status from DemoMarketOrderResult.
 */
export async function submitGoldHunterDemoOrder(
  args: GoldHunterDemoSubmitArgs
): Promise<GoldHunterDemoSubmitOk | GoldHunterDemoSubmitFail> {
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
    accountSnapshotValid: args.accountSnapshotValid,
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

  const now = new Date().toISOString();
  const place = args.placeOrder ?? submitDemoMarketOrder;

  let broker: DemoMarketOrderResult;
  try {
    broker = await place({
      ownerUid: args.ownerUid,
      side: args.side,
      lots: args.lots,
      stopLoss: args.stopLoss,
      takeProfit: args.takeProfit,
      entryHint: args.entryHint,
      symbolId: args.symbolId,
      comment: GH_ADMIN_STRATEGY_ID,
      label: args.goldHunterTradeId,
      clientOrderId: args.clientOrderId,
      // Do NOT pass Fast AutoTrade strategy id — GH ownership is separate.
      strategyId: null
    });
  } catch (e) {
    const errorCode =
      e instanceof Error ? e.message.slice(0, 120) : "BROKER_SUBMIT_THREW";
    const trade: GoldHunterDemoTrade = {
      goldHunterTradeId: args.goldHunterTradeId,
      strategy: GH_ADMIN_STRATEGY_ID,
      environment: "DEMO",
      setup: args.setup ?? null,
      side: args.side,
      signalTs: now,
      orderTs: now,
      fillTs: null,
      closeTs: null,
      entry: null,
      exit: null,
      stop: args.stopLoss ?? null,
      entrySpread: null,
      durationMs: null,
      mfe: null,
      mae: null,
      grossPnlEur: null,
      netPnlEur: null,
      result: null,
      exitReason: null,
      brokerOrderId: null,
      brokerPositionId: null,
      status: "BROKER_SUBMIT_ERROR",
      signalId: args.signalId ?? null,
      clientOrderId: args.clientOrderId,
      errorCode
    };
    await upsertGoldHunterDemoTrade(args.ownerUid, {
      ...trade,
      createdAt: now,
      ownership: {
        strategy: GH_ADMIN_STRATEGY_ID,
        environment: "DEMO",
        ownerUid: args.ownerUid,
        signalId: args.signalId ?? null
      }
    });
    return {
      ok: true,
      outcome: "BROKER_SUBMIT_ERROR",
      trade,
      broker: null,
      errorCode
    };
  }

  if (!broker.accepted) {
    const errorCode = broker.errorCode ?? "BROKER_REJECTED";
    const trade: GoldHunterDemoTrade = {
      goldHunterTradeId: args.goldHunterTradeId,
      strategy: GH_ADMIN_STRATEGY_ID,
      environment: "DEMO",
      setup: args.setup ?? null,
      side: args.side,
      signalTs: now,
      orderTs: now,
      fillTs: null,
      closeTs: null,
      entry: null,
      exit: null,
      stop: args.stopLoss ?? null,
      entrySpread: null,
      durationMs: null,
      mfe: null,
      mae: null,
      grossPnlEur: null,
      netPnlEur: null,
      result: null,
      exitReason: null,
      brokerOrderId: broker.orderId != null ? String(broker.orderId) : null,
      brokerPositionId:
        broker.positionId != null ? String(broker.positionId) : null,
      status: "BROKER_REJECTED",
      signalId: args.signalId ?? null,
      clientOrderId: broker.clientOrderId ?? args.clientOrderId,
      errorCode: String(errorCode).slice(0, 120),
      filledVolumeLots: broker.filledVolumeLots ?? null
    };
    await upsertGoldHunterDemoTrade(args.ownerUid, {
      ...trade,
      createdAt: now,
      ownership: {
        strategy: GH_ADMIN_STRATEGY_ID,
        environment: "DEMO",
        ownerUid: args.ownerUid,
        signalId: args.signalId ?? null
      }
    });
    return {
      ok: true,
      outcome: "BROKER_REJECTED",
      trade,
      broker,
      errorCode: trade.errorCode ?? null
    };
  }

  const fillPrice =
    broker.fillPrice != null && Number.isFinite(broker.fillPrice)
      ? broker.fillPrice
      : null;
  const hasPosition =
    broker.positionId != null && String(broker.positionId).length > 0;
  const filled =
    fillPrice != null &&
    hasPosition &&
    (broker.filledVolumeLots == null || broker.filledVolumeLots > 0);

  if (!filled) {
    const trade: GoldHunterDemoTrade = {
      goldHunterTradeId: args.goldHunterTradeId,
      strategy: GH_ADMIN_STRATEGY_ID,
      environment: "DEMO",
      setup: args.setup ?? null,
      side: args.side,
      signalTs: now,
      orderTs: now,
      fillTs: null,
      closeTs: null,
      entry: fillPrice,
      exit: null,
      stop: broker.stopLoss ?? args.stopLoss ?? null,
      entrySpread: null,
      durationMs: null,
      mfe: null,
      mae: null,
      grossPnlEur: null,
      netPnlEur: null,
      result: null,
      exitReason: null,
      brokerOrderId: broker.orderId != null ? String(broker.orderId) : null,
      brokerPositionId:
        broker.positionId != null ? String(broker.positionId) : null,
      status: "ACCEPTED_PENDING_FILL",
      signalId: args.signalId ?? null,
      clientOrderId: broker.clientOrderId ?? args.clientOrderId,
      filledVolumeLots: broker.filledVolumeLots ?? null,
      takeProfit: broker.takeProfit ?? args.takeProfit ?? null
    };
    await upsertGoldHunterDemoTrade(args.ownerUid, {
      ...trade,
      createdAt: now,
      ownership: {
        strategy: GH_ADMIN_STRATEGY_ID,
        environment: "DEMO",
        ownerUid: args.ownerUid,
        signalId: args.signalId ?? null
      }
    });
    return {
      ok: true,
      outcome: "ACCEPTED_PENDING_FILL",
      trade,
      broker,
      errorCode: null
    };
  }

  const trade: GoldHunterDemoTrade = {
    goldHunterTradeId: args.goldHunterTradeId,
    strategy: GH_ADMIN_STRATEGY_ID,
    environment: "DEMO",
    setup: args.setup ?? null,
    side: args.side,
    signalTs: now,
    orderTs: now,
    fillTs: now,
    closeTs: null,
    entry: fillPrice,
    exit: null,
    stop: broker.stopLoss ?? args.stopLoss ?? null,
    entrySpread: null,
    durationMs: null,
    mfe: null,
    mae: null,
    grossPnlEur: null,
    netPnlEur: null,
    result: "OPEN",
    exitReason: null,
    brokerOrderId: broker.orderId != null ? String(broker.orderId) : null,
    brokerPositionId: String(broker.positionId),
    status: "FILLED",
    signalId: args.signalId ?? null,
    clientOrderId: broker.clientOrderId ?? args.clientOrderId,
    filledVolumeLots: broker.filledVolumeLots ?? args.lots,
    takeProfit: broker.takeProfit ?? args.takeProfit ?? null
  };

  await upsertGoldHunterDemoTrade(args.ownerUid, {
    ...trade,
    createdAt: now,
    ownership: {
      strategy: GH_ADMIN_STRATEGY_ID,
      environment: "DEMO",
      ownerUid: args.ownerUid,
      signalId: args.signalId ?? null
    }
  });

  return { ok: true, outcome: "FILLED", trade, broker, errorCode: null };
}
