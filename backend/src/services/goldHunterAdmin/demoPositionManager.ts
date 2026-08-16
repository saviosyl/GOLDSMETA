/**
 * GoldHunterDemoPositionManager — manages ONLY proven GOLD_HUNTER DEMO positions
 * using frozen ABC exit helpers (updateOpenTrade / evaluateOpenExit).
 * Never Fast AutoTrade. Never widen broker protection.
 */
import {
  amendDemoStopLoss,
  closeDemoBrokerPosition
} from "../broker/ctrader/demoPositionMutations";
import { lotsToOrderVolumeUnits } from "../broker/ctrader/volumeUnits";
import type { DemoPositionMutationResult } from "../broker/ctrader/openApiClient";
import {
  evaluateOpenExit,
  openTrade,
  updateOpenTrade
} from "./abc/exits";
import { frozenGhFastSoakConfig } from "./abc";
import type {
  GhFastOpenTrade,
  GhFastExitReason,
  GhFastSetupId
} from "./abc";
import { getOwnerQueue } from "./boundedQueue";
import {
  reconcileGoldHunterDemoPositions,
  type BrokerDemoPositionLite
} from "./reconcilePositions";
import { getGoldHunterStrategySelector } from "./strategySelector";
import {
  listGoldHunterDemoTrades,
  upsertGoldHunterDemoTrade
} from "./tradeStore";
import {
  GH_ADMIN_STRATEGY_ID,
  type GoldHunterDemoTrade
} from "./types";

export type PositionManagerHooks = {
  closePosition?: (args: {
    ownerUid: string;
    positionId: string;
    volumeUnits: number;
  }) => Promise<DemoPositionMutationResult>;
  amendStop?: (args: {
    ownerUid: string;
    positionId: string;
    stopLoss: number;
  }) => Promise<DemoPositionMutationResult>;
  listBrokerPositions?: (
    ownerUid: string
  ) => Promise<BrokerDemoPositionLite[]>;
};

let hooks: PositionManagerHooks = {};

const managed = new Map<string, Map<string, GhFastOpenTrade>>();

export function setGoldHunterPositionManagerHooksForTests(
  h: PositionManagerHooks
): void {
  hooks = h;
}

export function resetGoldHunterPositionManagerForTests(): void {
  hooks = {};
  managed.clear();
}

function ownerMap(ownerUid: string): Map<string, GhFastOpenTrade> {
  let m = managed.get(ownerUid);
  if (!m) {
    m = new Map();
    managed.set(ownerUid, m);
  }
  return m;
}

function toSetupId(setup: "A" | "B" | "C" | null): GhFastSetupId {
  if (setup === "B") return "B_FAST_BREAKOUT";
  if (setup === "C") return "C_PULLBACK_REACCEL";
  return "A_MOMENTUM_IGNITION";
}

/**
 * Rebuild in-memory exit state from proven open GH trades after restart.
 */
export async function restoreGoldHunterPositionManager(
  ownerUid: string
): Promise<{ restored: number }> {
  const open = await listGoldHunterDemoTrades(ownerUid, {
    limit: 50,
    openOnly: true
  });
  const map = ownerMap(ownerUid);
  map.clear();
  const cfg = frozenGhFastSoakConfig();
  for (const t of open) {
    if (t.strategy !== GH_ADMIN_STRATEGY_ID || t.environment !== "DEMO") continue;
    if (!t.brokerPositionId || t.entry == null) continue;
    const entryTs = Date.parse(t.fillTs ?? t.orderTs ?? "") || Date.now();
    const bid = t.side === "BUY" ? t.entry - (t.entrySpread ?? 0.05) : t.entry;
    const ask = t.side === "SELL" ? t.entry + (t.entrySpread ?? 0.05) : t.entry;
    map.set(
      t.goldHunterTradeId,
      openTrade({
        tradeId: t.goldHunterTradeId,
        side: t.side,
        setup: toSetupId(t.setup),
        entryTs,
        bid,
        ask,
        trailDistance: cfg.trailDistance
      })
    );
  }
  return { restored: map.size };
}

/**
 * Register a newly filled GH trade into the position manager.
 */
export function registerGoldHunterOpenPositionForOwner(args: {
  ownerUid: string;
  trade: GoldHunterDemoTrade;
  bid: number;
  ask: number;
}): void {
  if (
    args.trade.strategy !== GH_ADMIN_STRATEGY_ID ||
    args.trade.environment !== "DEMO"
  ) {
    return;
  }
  if (!args.trade.brokerPositionId || args.trade.entry == null) return;
  const cfg = frozenGhFastSoakConfig();
  const entryTs = Date.parse(args.trade.fillTs ?? "") || Date.now();
  ownerMap(args.ownerUid).set(
    args.trade.goldHunterTradeId,
    openTrade({
      tradeId: args.trade.goldHunterTradeId,
      side: args.trade.side,
      setup: toSetupId(args.trade.setup),
      entryTs,
      bid: args.bid,
      ask: args.ask,
      trailDistance: cfg.trailDistance
    })
  );
}

/**
 * Never widen: BUY stop may only rise; SELL stop may only fall.
 */
export function nextTightenedStop(args: {
  side: "BUY" | "SELL";
  currentStop: number | null;
  proposedLockFloor: number | null;
  hardStop: number;
  entry: number;
}): number | null {
  const hard =
    args.side === "BUY"
      ? args.entry - args.hardStop
      : args.entry + args.hardStop;
  let candidate = args.proposedLockFloor;
  if (candidate == null) {
    candidate = args.currentStop ?? hard;
  }
  // Floor must never be worse than hard stop protection.
  if (args.side === "BUY") {
    candidate = Math.max(candidate, hard);
    if (args.currentStop != null) candidate = Math.max(candidate, args.currentStop);
  } else {
    candidate = Math.min(candidate, hard);
    if (args.currentStop != null) candidate = Math.min(candidate, args.currentStop);
  }
  if (args.currentStop != null) {
    if (args.side === "BUY" && candidate <= args.currentStop) return null;
    if (args.side === "SELL" && candidate >= args.currentStop) return null;
  }
  return candidate;
}

export type PositionTickResult = {
  evaluated: number;
  exitsAttempted: number;
  exitsClosed: number;
  stopsTightened: number;
  lastExitReason: GhFastExitReason | null;
};

/**
 * Evaluate frozen exits against current selector feature snapshot.
 */
export async function tickGoldHunterPositionManager(args: {
  ownerUid: string;
}): Promise<PositionTickResult> {
  const result: PositionTickResult = {
    evaluated: 0,
    exitsAttempted: 0,
    exitsClosed: 0,
    stopsTightened: 0,
    lastExitReason: null
  };
  const sel = getGoldHunterStrategySelector(args.ownerUid);
  const snap = sel.getLastSnapshot();
  const feat = snap?.features;
  if (!feat) return result;

  const cfg = frozenGhFastSoakConfig();
  const openTrades = await listGoldHunterDemoTrades(args.ownerUid, {
    limit: 50,
    openOnly: true
  });
  const map = ownerMap(args.ownerUid);
  const dataOk =
    snap.depthValidity === "DEPTH_VALID" &&
    !snap.derivedDataContaminated;

  for (const trade of openTrades) {
    if (trade.strategy !== GH_ADMIN_STRATEGY_ID) continue;
    if (!trade.brokerPositionId || trade.entry == null) continue;
    result.evaluated += 1;

    let state = map.get(trade.goldHunterTradeId);
    if (!state) {
      state = openTrade({
        tradeId: trade.goldHunterTradeId,
        side: trade.side,
        setup: toSetupId(trade.setup),
        entryTs: Date.parse(trade.fillTs ?? "") || Date.now(),
        bid: feat.bid,
        ask: feat.ask,
        trailDistance: cfg.trailDistance
      });
      // Seed entry from broker fill
      state.entryPrice = trade.entry;
      state.entryBid = trade.side === "BUY" ? trade.entry : feat.bid;
      state.entryAsk = trade.side === "SELL" ? trade.entry : feat.ask;
      map.set(trade.goldHunterTradeId, state);
    }

    updateOpenTrade(state, feat.bid, feat.ask, cfg);

    // Persist MFE/MAE progress
    await upsertGoldHunterDemoTrade(args.ownerUid, {
      ...trade,
      mfe: state.mfe,
      mae: state.mae
    });

    // Tighten broker stop when lock floor advances — never widen / never remove.
    const tightened = nextTightenedStop({
      side: trade.side,
      currentStop: trade.stop,
      proposedLockFloor: state.lockFloor,
      hardStop: cfg.hardStop,
      entry: trade.entry
    });
    if (tightened != null && trade.brokerPositionId) {
      try {
        const amend =
          hooks.amendStop ??
          ((a: {
            ownerUid: string;
            positionId: string;
            stopLoss: number;
          }) =>
            amendDemoStopLoss({
              ownerUid: a.ownerUid,
              positionId: a.positionId,
              stopLoss: a.stopLoss
            }));
        const amendResult = await amend({
          ownerUid: args.ownerUid,
          positionId: trade.brokerPositionId,
          stopLoss: tightened
        });
        if (amendResult.accepted) {
          result.stopsTightened += 1;
          await upsertGoldHunterDemoTrade(args.ownerUid, {
            ...trade,
            stop: tightened,
            status: "PROTECTED"
          });
          trade.stop = tightened;
        }
      } catch {
        /* keep hard stop; do not remove protection */
      }
    }

    const exitReason = evaluateOpenExit({
      trade: state,
      f: feat,
      cfg,
      dataOk
    });
    if (!exitReason) continue;

    result.exitsAttempted += 1;
    result.lastExitReason = exitReason;
    const closed = await closeGoldHunterDemoPosition({
      ownerUid: args.ownerUid,
      trade,
      exitReason,
      bid: feat.bid,
      ask: feat.ask,
      state
    });
    if (closed) {
      result.exitsClosed += 1;
      map.delete(trade.goldHunterTradeId);
    }
  }

  return result;
}

export async function closeGoldHunterDemoPosition(args: {
  ownerUid: string;
  trade: GoldHunterDemoTrade;
  exitReason: GhFastExitReason;
  bid: number;
  ask: number;
  state: GhFastOpenTrade;
}): Promise<boolean> {
  const { trade } = args;
  if (!trade.brokerPositionId) return false;
  const lots = trade.filledVolumeLots ?? 0.01;
  const volumeUnits = lotsToOrderVolumeUnits(lots);
  const closeFn =
    hooks.closePosition ??
    ((a: { ownerUid: string; positionId: string; volumeUnits: number }) =>
      closeDemoBrokerPosition(a));

  const now = new Date().toISOString();
  const exitPrice = trade.side === "BUY" ? args.bid : args.ask;
  const entry = trade.entry ?? exitPrice;
  const move =
    trade.side === "BUY" ? exitPrice - entry : entry - exitPrice;
  // Conservative EUR estimate only when no broker P/L — mark null if unknown.
  const grossPnlEur = null;
  const netPnlEur = null;

  try {
    const broker = await closeFn({
      ownerUid: args.ownerUid,
      positionId: trade.brokerPositionId,
      volumeUnits
    });
    if (!broker.accepted) {
      await upsertGoldHunterDemoTrade(args.ownerUid, {
        ...trade,
        status: "PENDING_RECONCILIATION",
        exitReason: String(args.exitReason),
        errorCode: String(broker.errorCode ?? "CLOSE_REJECTED").slice(0, 120),
        mfe: args.state.mfe,
        mae: args.state.mae
      });
      return false;
    }

    // Mutation result has no fillPrice — use market exit; reconcile may refine.
    const closePx = exitPrice;
    const durationMs =
      trade.fillTs != null
        ? Date.now() - Date.parse(trade.fillTs)
        : Date.now() - args.state.entryTs;

    await upsertGoldHunterDemoTrade(args.ownerUid, {
      ...trade,
      status: "CLOSED",
      result:
        move > 0.01 ? "WIN" : move < -0.01 ? "LOSS" : "BREAKEVEN",
      exit: closePx,
      closeTs: now,
      exitReason: String(args.exitReason),
      durationMs: Number.isFinite(durationMs) ? durationMs : null,
      mfe: args.state.mfe,
      mae: args.state.mae,
      grossPnlEur,
      netPnlEur,
      errorCode: null
    });
    return true;
  } catch (e) {
    await upsertGoldHunterDemoTrade(args.ownerUid, {
      ...trade,
      status: "PENDING_RECONCILIATION",
      exitReason: String(args.exitReason),
      errorCode:
        e instanceof Error ? e.message.slice(0, 120) : "CLOSE_UNKNOWN",
      mfe: args.state.mfe,
      mae: args.state.mae
    });
    return false;
  }
}

/**
 * Enqueue position management off the quote hot path.
 */
export function enqueueGoldHunterPositionManagerTick(ownerUid: string): boolean {
  const q = getOwnerQueue("gh-demo-pos", ownerUid, 2);
  return q.enqueue(async () => {
    await tickGoldHunterPositionManager({ ownerUid });
  });
}

export async function drainGoldHunterPositionManagerForTests(
  ownerUid: string
): Promise<void> {
  await getOwnerQueue("gh-demo-pos", ownerUid, 2).drainForTests();
}

/**
 * Restart reconciliation: match broker positions, restore manager state.
 */
export async function reconcileAndRestoreGoldHunterPositions(args: {
  ownerUid: string;
  brokerPositions: BrokerDemoPositionLite[];
}): Promise<{
  restored: number;
  unmatched: number;
}> {
  const r = await reconcileGoldHunterDemoPositions(args);
  const mgr = await restoreGoldHunterPositionManager(args.ownerUid);
  return { restored: mgr.restored, unmatched: r.unmatched.length };
}
