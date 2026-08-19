/**
 * GoldHunterDemoPositionManager — manages ONLY proven GOLD_HUNTER DEMO positions
 * using frozen ABC exit helpers (updateOpenTrade / evaluateOpenExit).
 * Never Fast AutoTrade. Never widen broker protection.
 * Close → settlement pending until broker deal P/L confirmed.
 */
import {
  amendDemoStopLoss,
  closeDemoBrokerPosition
} from "../broker/ctrader/demoPositionMutations";
import { lotsToOrderVolumeUnits } from "../broker/ctrader/volumeUnits";
import type { DemoPositionMutationResult } from "../broker/ctrader/openApiClient";
import {
  isCorruptGoldHunterMfeMae,
  isValidGoldHunterEntryPrice
} from "./entryValidity";
import {
  evaluateOpenExit,
  openTrade,
  updateOpenTrade
} from "./abc/exits";
import {
  buildClosedTradeSmartDiagnostics,
  openTradeSmartDiagnostics
} from "./abc/smartPositionManager";
import { frozenGhFastSoakConfig } from "./abc";
import type {
  GhFastOpenTrade,
  GhFastExitReason,
  GhFastSetupId
} from "./abc";
import { getOwnerQueue } from "./boundedQueue";
import { settleGoldHunterCloseFromBroker } from "./closeSettlement";
import {
  reconcileGoldHunterDemoPositions,
  type BrokerDemoPositionLite
} from "./reconcilePositions";
import { maybeEnqueueStaleCloseRequestedWatchdog } from "./reconciliationRuntime";
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
  settleClose?: typeof settleGoldHunterCloseFromBroker;
};

let hooks: PositionManagerHooks = {};

const managed = new Map<string, Map<string, GhFastOpenTrade>>();

/** Coalesce MFE/MAE Firestore writes — not every tick. */
export const GH_MFE_MAE_PERSIST_MIN_MS = 2_000;
const lastMfeMaePersistAt = new Map<string, number>();
const mfeMaeWriteCounts = new Map<string, number>();

export function setGoldHunterPositionManagerHooksForTests(
  h: PositionManagerHooks
): void {
  hooks = h;
}

export function resetGoldHunterPositionManagerForTests(): void {
  hooks = {};
  managed.clear();
  lastMfeMaePersistAt.clear();
  mfeMaeWriteCounts.clear();
}

export function getGoldHunterMfeMaePersistWriteCount(ownerUid: string): number {
  return mfeMaeWriteCounts.get(ownerUid) ?? 0;
}

function ownerMap(ownerUid: string): Map<string, GhFastOpenTrade> {
  let m = managed.get(ownerUid);
  if (!m) {
    m = new Map();
    managed.set(ownerUid, m);
  }
  return m;
}

function tradeKey(ownerUid: string, tradeId: string): string {
  return `${ownerUid}:${tradeId}`;
}

function toSetupId(setup: "A" | "B" | "C" | null): GhFastSetupId {
  if (setup === "B") return "B_FAST_BREAKOUT";
  if (setup === "C") return "C_PULLBACK_REACCEL";
  return "A_MOMENTUM_IGNITION";
}

function seedOpenTradeFromPersisted(t: GoldHunterDemoTrade): GhFastOpenTrade | null {
  if (!isValidGoldHunterEntryPrice(t.entry)) {
    return null;
  }
  const cfg = frozenGhFastSoakConfig();
  const entryTs = Date.parse(t.fillTs ?? t.orderTs ?? "") || Date.now();
  const bid =
    t.side === "BUY"
      ? t.entry! - (t.entrySpread ?? 0.05)
      : t.entry!;
  const ask =
    t.side === "SELL"
      ? t.entry! + (t.entrySpread ?? 0.05)
      : t.entry!;
  const state = openTrade({
    tradeId: t.goldHunterTradeId,
    side: t.side,
    setup: toSetupId(t.setup),
    entryTs,
    bid,
    ask,
    trailDistance: cfg.trailDistance
  });
  state.entryPrice = t.entry!;
  // Restore only proven MFE/MAE; never invent trail/lock that could widen stops.
  // Skip corrupt MFE/MAE (entry contamination artifacts).
  if (
    !isCorruptGoldHunterMfeMae({
      mfe: t.mfe,
      mae: t.mae,
      hardStop: cfg.hardStop
    })
  ) {
    if (t.mfe != null && Number.isFinite(t.mfe)) state.mfe = t.mfe;
    if (t.mae != null && Number.isFinite(t.mae)) state.mae = t.mae;
  }
  return state;
}

/**
 * Rebuild in-memory exit state from proven open GH trades after restart.
 * Conservative: keep broker stop; do not invent trail floors.
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
  for (const t of open) {
    if (t.strategy !== GH_ADMIN_STRATEGY_ID || t.environment !== "DEMO") continue;
    if (!t.brokerPositionId || !isValidGoldHunterEntryPrice(t.entry)) {
      if (t.brokerPositionId && !isValidGoldHunterEntryPrice(t.entry)) {
        await upsertGoldHunterDemoTrade(ownerUid, {
          ...t,
          dataQuality: "ENTRY_INVALID",
          errorCode: t.errorCode ?? "ENTRY_PRICE_INVALID"
        });
      }
      continue;
    }
    if (
      t.status !== "FILLED" &&
      t.status !== "PROTECTED" &&
      t.result !== "OPEN"
    ) {
      continue;
    }
    const seeded = seedOpenTradeFromPersisted(t);
    if (seeded) map.set(t.goldHunterTradeId, seeded);
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
  if (
    !args.trade.brokerPositionId ||
    !isValidGoldHunterEntryPrice(args.trade.entry)
  ) {
    return;
  }
  const cfg = frozenGhFastSoakConfig();
  const entryTs = Date.parse(args.trade.fillTs ?? "") || Date.now();
  const state = openTrade({
    tradeId: args.trade.goldHunterTradeId,
    side: args.trade.side,
    setup: toSetupId(args.trade.setup),
    entryTs,
    bid: args.bid,
    ask: args.ask,
    trailDistance: cfg.trailDistance
  });
  state.entryPrice = args.trade.entry!;
  ownerMap(args.ownerUid).set(args.trade.goldHunterTradeId, state);
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
  if (args.side === "BUY") {
    candidate = Math.max(candidate, hard);
    if (args.currentStop != null) {
      candidate = Math.max(candidate, args.currentStop);
    }
  } else {
    candidate = Math.min(candidate, hard);
    if (args.currentStop != null) {
      candidate = Math.min(candidate, args.currentStop);
    }
  }
  if (args.currentStop != null) {
    if (args.side === "BUY" && candidate <= args.currentStop) return null;
    if (args.side === "SELL" && candidate >= args.currentStop) return null;
  }
  return candidate;
}

async function maybePersistMfeMae(
  ownerUid: string,
  trade: GoldHunterDemoTrade,
  state: GhFastOpenTrade,
  force: boolean
): Promise<void> {
  const key = tradeKey(ownerUid, trade.goldHunterTradeId);
  const now = Date.now();
  const last = lastMfeMaePersistAt.get(key) ?? 0;
  if (!force && now - last < GH_MFE_MAE_PERSIST_MIN_MS) return;
  if (
    !force &&
    trade.mfe === state.mfe &&
    trade.mae === state.mae &&
    trade.smartPmState === state.smartPmState &&
    trade.protectedProfitR === state.protectedProfitR
  ) {
    return;
  }
  lastMfeMaePersistAt.set(key, now);
  mfeMaeWriteCounts.set(ownerUid, (mfeMaeWriteCounts.get(ownerUid) ?? 0) + 1);
  const diag = openTradeSmartDiagnostics(state);
  await upsertGoldHunterDemoTrade(ownerUid, {
    ...trade,
    mfe: state.mfe,
    mae: state.mae,
    brainVersion: diag.brainVersion,
    positionManagerVersion: diag.positionManagerVersion,
    smartPmState: diag.profitManagementState,
    highestProtectionStage: state.highestProtectionStage ?? null,
    mfeR: diag.mfeR,
    maeR: diag.maeR,
    mfeEur: diag.mfeEur,
    maeEur: null,
    protectedProfitR: diag.protectedProfitR,
    executableProtectedProfitR: diag.executableProtectedProfitR,
    protectedStopPrice: diag.protectedStopPrice,
    lastStopAdjustReason: diag.lastStopAdjustReason
  });
  trade.mfe = state.mfe;
  trade.mae = state.mae;
  trade.smartPmState = diag.profitManagementState;
  trade.protectedProfitR = diag.protectedProfitR;
  trade.executableProtectedProfitR = diag.executableProtectedProfitR;
  trade.mfeR = diag.mfeR;
  trade.maeR = diag.maeR;
}

/**
 * In-memory open-trade SPM diagnostics for admin status (no secrets).
 */
export function getGoldHunterOpenPositionDiagnostics(
  ownerUid: string
): Array<ReturnType<typeof openTradeSmartDiagnostics> & { tradeId: string }> {
  const map = managed.get(ownerUid);
  if (!map) return [];
  const out: Array<
    ReturnType<typeof openTradeSmartDiagnostics> & { tradeId: string }
  > = [];
  for (const [tradeId, state] of map) {
    out.push({ tradeId, ...openTradeSmartDiagnostics(state) });
  }
  return out;
}

function notifySelectorTradeClosed(
  ownerUid: string,
  trade: GoldHunterDemoTrade
): void {
  try {
    const sel = getGoldHunterStrategySelector(ownerUid);
    const realisedR =
      trade.result === "LOSS"
        ? -(Math.max(trade.maeR ?? 0.7, 0.1))
        : trade.result === "WIN"
          ? Math.max(0.05, (trade.mfeR ?? 0.3) * 0.5)
          : 0;
    sel.notifyTradeClosed({
      side: trade.side,
      setup: trade.setup,
      entryPrice: trade.entry,
      result: trade.result === "OPEN" ? null : trade.result,
      opportunityId: trade.signalId ?? null,
      closedAtMs: Date.parse(trade.closeTs ?? "") || Date.now(),
      realisedR
    });
  } catch {
    /* selector notify is best-effort */
  }
}

function spmFieldsFromState(
  state: GhFastOpenTrade,
  finalPnlEur: number | null,
  exitReason: string | null
): Partial<GoldHunterDemoTrade> {
  const closed = buildClosedTradeSmartDiagnostics({
    trade: state,
    finalPnlEur,
    exitReason
  });
  return {
    brainVersion: closed.brainVersion,
    positionManagerVersion: closed.positionManagerVersion,
    lossControllerVersion:
      state.lossControllerVersion ?? "SMART_LOSS_CONTROLLER_V1",
    smartPmState: state.smartPmState ?? null,
    highestProtectionStage: closed.highestProtectionStage,
    mfeR: closed.mfeR,
    maeR: closed.maeR,
    mfeEur: closed.mfeEur,
    maeEur: closed.maeEur,
    protectedProfitR: closed.protectedProfitR,
    protectedStopPrice: state.protectedStopPrice ?? state.lockFloor ?? null,
    executableProtectedProfitR: state.executableProtectedProfitR ?? null,
    lastStopAdjustReason: state.lastStopAdjustReason ?? null,
    profitSurrenderEur: closed.profitSurrenderEur,
    profitRetentionRatio: closed.profitRetentionRatio
  };
}

export type PositionTickResult = {
  evaluated: number;
  exitsAttempted: number;
  exitsClosed: number;
  exitsSettlementPending: number;
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
    exitsSettlementPending: 0,
    stopsTightened: 0,
    lastExitReason: null
  };

  // Stale CLOSE_REQUESTED must recover even when no new entry is attempted and
  // normal tick management skips CLOSE_REQUESTED rows.
  await maybeEnqueueStaleCloseRequestedWatchdog(args.ownerUid).catch(
    () => undefined
  );

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
    snap.depthValidity === "DEPTH_VALID" && !snap.derivedDataContaminated;

  for (const trade of openTrades) {
    if (trade.strategy !== GH_ADMIN_STRATEGY_ID) continue;
    if (!trade.brokerPositionId) continue;
    if (
      trade.status === "CLOSE_REQUESTED" ||
      trade.status === "CLOSE_ACCEPTED_PENDING_SETTLEMENT" ||
      trade.status === "CLOSED"
    ) {
      continue;
    }

    // Never dynamically manage invalid entry — retain broker hard protection only.
    if (!isValidGoldHunterEntryPrice(trade.entry)) {
      if (trade.dataQuality !== "ENTRY_INVALID") {
        await upsertGoldHunterDemoTrade(args.ownerUid, {
          ...trade,
          dataQuality: "ENTRY_INVALID",
          errorCode: trade.errorCode ?? "ENTRY_PRICE_INVALID",
          mfe: null,
          mae: null
        });
      }
      continue;
    }

    result.evaluated += 1;

    let state = map.get(trade.goldHunterTradeId);
    if (!state) {
      const seeded = seedOpenTradeFromPersisted(trade);
      if (!seeded) continue;
      state = seeded;
      map.set(trade.goldHunterTradeId, state);
    }

    updateOpenTrade(state, feat.bid, feat.ask, cfg);
    await maybePersistMfeMae(args.ownerUid, trade, state, false);

    const tightened = nextTightenedStop({
      side: trade.side,
      currentStop: trade.stop,
      proposedLockFloor: state.lockFloor,
      hardStop: cfg.hardStop,
      entry: trade.entry!
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
            status: "PROTECTED",
            mfe: state.mfe,
            mae: state.mae,
            ...spmFieldsFromState(state, null, null)
          });
          trade.stop = tightened;
          trade.status = "PROTECTED";
          await maybePersistMfeMae(args.ownerUid, trade, state, true);
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
    if (closed === "SETTLED") {
      result.exitsClosed += 1;
      map.delete(trade.goldHunterTradeId);
    } else if (closed === "SETTLEMENT_PENDING") {
      result.exitsSettlementPending += 1;
      map.delete(trade.goldHunterTradeId);
    }
  }

  return result;
}

/**
 * Resolve lots to close from broker-confirmed size only.
 * Never invent a default 0.01 when volume is unknown.
 */
export function resolveGoldHunterCloseVolumeLots(args: {
  filledVolumeLots: number | null | undefined;
  brokerOpenVolumeLots?: number | null;
}): { ok: true; lots: number } | { ok: false; reason: "CLOSE_VOLUME_UNKNOWN" } {
  if (
    args.filledVolumeLots != null &&
    Number.isFinite(args.filledVolumeLots) &&
    args.filledVolumeLots > 0
  ) {
    return { ok: true, lots: args.filledVolumeLots };
  }
  if (
    args.brokerOpenVolumeLots != null &&
    Number.isFinite(args.brokerOpenVolumeLots) &&
    args.brokerOpenVolumeLots > 0
  ) {
    return { ok: true, lots: args.brokerOpenVolumeLots };
  }
  return { ok: false, reason: "CLOSE_VOLUME_UNKNOWN" };
}

export type CloseOutcome = "SETTLED" | "SETTLEMENT_PENDING" | false;

export async function closeGoldHunterDemoPosition(args: {
  ownerUid: string;
  trade: GoldHunterDemoTrade;
  exitReason: GhFastExitReason;
  bid: number;
  ask: number;
  state: GhFastOpenTrade;
  /** Optional live broker open volume when known from a successful reconcile. */
  brokerOpenVolumeLots?: number | null;
}): Promise<CloseOutcome> {
  const { trade } = args;
  if (!trade.brokerPositionId) return false;

  const volume = resolveGoldHunterCloseVolumeLots({
    filledVolumeLots: trade.filledVolumeLots,
    brokerOpenVolumeLots: args.brokerOpenVolumeLots
  });
  if (!volume.ok) {
    const exitSignalTs = new Date().toISOString();
    await upsertGoldHunterDemoTrade(args.ownerUid, {
      ...trade,
      status: "PENDING_RECONCILIATION",
      exitReason: String(args.exitReason),
      exitSignalTs,
      errorCode: "CLOSE_VOLUME_UNKNOWN",
      mfe: args.state.mfe,
      mae: args.state.mae,
      netPnlEur: null,
      grossPnlEur: null
    });
    return false;
  }
  const volumeUnits = lotsToOrderVolumeUnits(volume.lots);
  const closeFn =
    hooks.closePosition ??
    ((a: { ownerUid: string; positionId: string; volumeUnits: number }) =>
      closeDemoBrokerPosition(a));

  const exitSignalTs = trade.exitSignalTs ?? new Date().toISOString();
  const closeRequestTs = new Date().toISOString();
  await upsertGoldHunterDemoTrade(args.ownerUid, {
    ...trade,
    status: "CLOSE_REQUESTED",
    exitReason: String(args.exitReason),
    exitSignalTs,
    closeRequestTs,
    filledVolumeLots: volume.lots,
    mfe: args.state.mfe,
    mae: args.state.mae,
    netPnlEur: null,
    grossPnlEur: null,
    result: null,
    ...spmFieldsFromState(args.state, null, String(args.exitReason))
  });

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
        mae: args.state.mae,
        netPnlEur: null,
        grossPnlEur: null
      });
      return false;
    }

    const closeAcceptedTs = new Date().toISOString();
    const pending: GoldHunterDemoTrade = {
      ...trade,
      status: "CLOSE_ACCEPTED_PENDING_SETTLEMENT",
      exitReason: String(args.exitReason),
      exitSignalTs,
      closeRequestTs,
      closeAcceptedTs,
      exit: null,
      closeTs: null,
      result: null,
      netPnlEur: null,
      grossPnlEur: null,
      filledVolumeLots: volume.lots,
      mfe: args.state.mfe,
      mae: args.state.mae,
      errorCode: "CLOSE_SETTLEMENT_PENDING",
      ...spmFieldsFromState(args.state, null, String(args.exitReason))
    };
    await upsertGoldHunterDemoTrade(args.ownerUid, pending);

    const settle = hooks.settleClose ?? settleGoldHunterCloseFromBroker;
    const settled = await settle({
      ownerUid: args.ownerUid,
      trade: pending
    });
    if (settled.settled) {
      notifySelectorTradeClosed(args.ownerUid, settled.trade);
    }
    return settled.settled ? "SETTLED" : "SETTLEMENT_PENDING";
  } catch (e) {
    await upsertGoldHunterDemoTrade(args.ownerUid, {
      ...trade,
      status: "PENDING_RECONCILIATION",
      exitReason: String(args.exitReason),
      errorCode:
        e instanceof Error ? e.message.slice(0, 120) : "CLOSE_UNKNOWN",
      mfe: args.state.mfe,
      mae: args.state.mae,
      netPnlEur: null,
      grossPnlEur: null
    });
    return false;
  }
}

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
