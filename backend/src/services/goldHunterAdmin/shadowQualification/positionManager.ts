/**
 * Shadow position manager — mirrors ABC openTrade/updateOpenTrade/evaluateOpenExit.
 * Never calls broker. Max one open shadow position.
 */
import { randomBytes } from "crypto";
import {
  evaluateOpenExit,
  openTrade,
  updateOpenTrade
} from "../abc/exits";
import {
  frozenGhFastSoakConfig,
  getFrozenGhFastIdentity
} from "../abc/frozenConfig";
import type { GhFastFeatureSnapshot } from "../abc/features";
import type { GhFastOpenTrade, GhFastSetupId } from "../abc/types";
import type { GoldHunterSelectedCandidate } from "../strategySelector";
import type { GoldHunterAdminConfig } from "../types";
import {
  computeGhShadowEconomicExposure,
  shadowEntryPrice,
  shadowExitPrice,
  shadowInitialStop,
  simulateGhShadowCashPnl
} from "./economics";
import {
  appendGhShadowDecision,
  loadGhShadowEpoch,
  saveGhShadowEpoch,
  upsertGhShadowTrade
} from "./store";
import type {
  GhShadowExitReason,
  GhShadowQualificationEpoch,
  GhShadowTrade
} from "./types";

type OpenState = {
  trade: GhShadowTrade;
  fast: GhFastOpenTrade;
};

const openByOwner = new Map<string, OpenState>();

export function resetGhShadowPositionManagerForTests(): void {
  openByOwner.clear();
}

export function getGhShadowOpenTradeId(ownerUid: string): string | null {
  return openByOwner.get(ownerUid)?.trade.tradeId ?? null;
}

function setupIdFromLetter(
  letter: "A" | "B" | "C"
): GhFastSetupId {
  if (letter === "A") return "A_MOMENTUM_IGNITION";
  if (letter === "B") return "B_FAST_BREAKOUT";
  return "C_PULLBACK_REACCEL";
}

function isFinitePositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function isCleanMarket(args: {
  bid: number;
  ask: number;
  spread: number;
  depthExecutable: boolean;
  depthValidity: string;
}): { ok: true } | { ok: false; reason: string } {
  if (!isFinitePositive(args.bid) || !isFinitePositive(args.ask)) {
    return { ok: false, reason: "bid_ask_invalid" };
  }
  if (!(args.ask >= args.bid)) {
    return { ok: false, reason: "crossed_or_inverted_book" };
  }
  if (!Number.isFinite(args.spread) || args.spread < 0) {
    return { ok: false, reason: "spread_invalid" };
  }
  if (args.depthValidity !== "DEPTH_VALID" || !args.depthExecutable) {
    return { ok: false, reason: "depth_invalid" };
  }
  return { ok: true };
}

async function ensureEpoch(
  ownerUid: string,
  receiveSeq: number
): Promise<GhShadowQualificationEpoch> {
  const identity = getFrozenGhFastIdentity();
  const existing = await loadGhShadowEpoch(ownerUid);
  if (existing && existing.status === "ACTIVE") return existing;
  const now = new Date().toISOString();
  const epoch: GhShadowQualificationEpoch = {
    qualificationId: `GH-SQ-${randomBytes(4).toString("hex")}`,
    qualificationStartTime: now,
    qualificationStartSequence: receiveSeq,
    strategySha: identity.configSha256,
    configSha: identity.configSha256,
    strategyVersion: identity.strategyVersion,
    engineVersion: identity.engineVersion,
    soakLabel: identity.soakLabel,
    formalQualificationTrades: 0,
    diagnosticExcludedTrades: 0,
    openShadowTradeId: null,
    status: "ACTIVE",
    brokerMutationCount: 0,
    lastReplayStatus: "NOT_RUN",
    updatedAt: now
  };
  await saveGhShadowEpoch(ownerUid, epoch);
  return epoch;
}

/**
 * Attempt to open a shadow trade from a new executable opportunity.
 * Returns null if max-open occupied or excluded.
 */
export async function tryOpenGhShadowFromOpportunity(args: {
  ownerUid: string;
  opportunity: GoldHunterSelectedCandidate;
  config: GoldHunterAdminConfig;
  marketFresh: boolean;
}): Promise<{ opened: boolean; trade: GhShadowTrade | null; reason: string }> {
  if (openByOwner.has(args.ownerUid)) {
    return { opened: false, trade: null, reason: "max_open_shadow_1" };
  }

  const epoch = await ensureEpoch(
    args.ownerUid,
    args.opportunity.receiveSeq
  );
  const identity = getFrozenGhFastIdentity();
  const cfg = frozenGhFastSoakConfig();
  const opp = args.opportunity;
  const tradeId = `GH-S-${randomBytes(4).toString("hex")}`;
  const signalTs = opp.signalTimestamp || new Date().toISOString();

  const market = isCleanMarket({
    bid: opp.bid,
    ask: opp.ask,
    spread: opp.spread,
    depthExecutable: opp.depthExecutable,
    depthValidity: opp.depthValidity
  });

  const entry = shadowEntryPrice(opp.side, opp.bid, opp.ask);
  const economic = computeGhShadowEconomicExposure({ config: args.config });

  if (
    !market.ok ||
    !args.marketFresh ||
    !isFinitePositive(entry) ||
    !(economic.economicXauOz > 0)
  ) {
    const excluded: GhShadowTrade = {
      tradeId,
      qualificationId: epoch.qualificationId,
      opportunityId: opp.opportunityId,
      signalId: opp.signalId,
      setup: opp.setup,
      setupId: setupIdFromLetter(opp.setup),
      side: opp.side,
      status: "DIAGNOSTIC_EXCLUDED",
      dataQuality: "DIAGNOSTIC_EXCLUDED",
      exclusionReason: !market.ok
        ? market.reason
        : !args.marketFresh
          ? "market_data_stale"
          : !isFinitePositive(entry)
            ? "entry_invalid"
            : "economic_exposure_invalid",
      signalTs,
      entryTs: null,
      entryBid: opp.bid,
      entryAsk: opp.ask,
      entryPrice: isFinitePositive(entry) ? entry : null,
      entrySpread: opp.spread,
      initialStop: null,
      exitTs: new Date().toISOString(),
      exitBid: null,
      exitAsk: null,
      exitPrice: null,
      exitReason: "INVALID_MARKET",
      mfe: 0,
      mae: 0,
      durationMs: 0,
      grossPriceMove: null,
      frictionPrice: null,
      netPriceMove: null,
      simulatedGrossPnlEur: null,
      simulatedFrictionEur: null,
      simulatedNetPnlEur: null,
      economic,
      profitLockActivatedAt: null,
      trailActivatedAt: null,
      trailUpdateCount: 0,
      maxFavorableBeforeExit: null,
      maxAdverseBeforeExit: null,
      strategySha: identity.configSha256,
      configSha: identity.configSha256,
      receiveSeqAtEntry: opp.receiveSeq,
      receiveSeqAtExit: opp.latestReceiveSeq,
      bookGeneration: opp.bookGeneration,
      resyncGeneration: opp.resyncGeneration,
      path: {
        profitLockActivateMfeAtActivation: null,
        lockFloorAtActivation: null,
        lockFloorAtExit: null,
        bestExitAtExit: null
      }
    };
    await upsertGhShadowTrade(args.ownerUid, excluded);
    epoch.diagnosticExcludedTrades += 1;
    epoch.updatedAt = new Date().toISOString();
    await saveGhShadowEpoch(args.ownerUid, epoch);
    await appendGhShadowDecision(args.ownerUid, {
      decisionId: `dec-${tradeId}-ex`,
      qualificationId: epoch.qualificationId,
      at: new Date().toISOString(),
      kind: "EXCLUDE",
      opportunityId: opp.opportunityId,
      tradeId,
      setup: opp.setup,
      side: opp.side,
      bid: opp.bid,
      ask: opp.ask,
      receiveSeq: opp.receiveSeq,
      exitReason: "INVALID_MARKET",
      detail: excluded.exclusionReason
    });
    return {
      opened: false,
      trade: excluded,
      reason: excluded.exclusionReason ?? "excluded"
    };
  }

  const entryTs = new Date().toISOString();
  const initialStop = shadowInitialStop(opp.side, entry, cfg.hardStop);
  const fast = openTrade({
    tradeId,
    side: opp.side,
    setup: setupIdFromLetter(opp.setup),
    entryTs: Date.parse(entryTs),
    bid: opp.bid,
    ask: opp.ask,
    trailDistance: cfg.trailDistance
  });

  const trade: GhShadowTrade = {
    tradeId,
    qualificationId: epoch.qualificationId,
    opportunityId: opp.opportunityId,
    signalId: opp.signalId,
    setup: opp.setup,
    setupId: setupIdFromLetter(opp.setup),
    side: opp.side,
    status: "OPEN",
    dataQuality: "FORMAL_ELIGIBLE",
    exclusionReason: null,
    signalTs,
    entryTs,
    entryBid: opp.bid,
    entryAsk: opp.ask,
    entryPrice: entry,
    entrySpread: opp.spread,
    initialStop,
    exitTs: null,
    exitBid: null,
    exitAsk: null,
    exitPrice: null,
    exitReason: null,
    mfe: 0,
    mae: 0,
    durationMs: null,
    grossPriceMove: null,
    frictionPrice: null,
    netPriceMove: null,
    simulatedGrossPnlEur: null,
    simulatedFrictionEur: null,
    simulatedNetPnlEur: null,
    economic,
    profitLockActivatedAt: null,
    trailActivatedAt: null,
    trailUpdateCount: 0,
    maxFavorableBeforeExit: null,
    maxAdverseBeforeExit: null,
    strategySha: identity.configSha256,
    configSha: identity.configSha256,
    receiveSeqAtEntry: opp.receiveSeq,
    receiveSeqAtExit: null,
    bookGeneration: opp.bookGeneration,
    resyncGeneration: opp.resyncGeneration,
    path: {
      profitLockActivateMfeAtActivation: null,
      lockFloorAtActivation: null,
      lockFloorAtExit: null,
      bestExitAtExit: null
    }
  };

  openByOwner.set(args.ownerUid, { trade, fast });
  epoch.openShadowTradeId = tradeId;
  epoch.updatedAt = new Date().toISOString();
  await saveGhShadowEpoch(args.ownerUid, epoch);
  await upsertGhShadowTrade(args.ownerUid, trade);
  await appendGhShadowDecision(args.ownerUid, {
    decisionId: `dec-${tradeId}-open`,
    qualificationId: epoch.qualificationId,
    at: entryTs,
    kind: "OPEN",
    opportunityId: opp.opportunityId,
    tradeId,
    setup: opp.setup,
    side: opp.side,
    bid: opp.bid,
    ask: opp.ask,
    receiveSeq: opp.receiveSeq,
    exitReason: null,
    detail: `entry_${entry}_oz_${economic.economicXauOz}`
  });

  return { opened: true, trade, reason: "opened" };
}

/**
 * Tick open shadow position with live features (same exit geometry as Demo).
 */
export async function tickGhShadowPosition(args: {
  ownerUid: string;
  bid: number;
  ask: number;
  features: GhFastFeatureSnapshot | null;
  dataOk: boolean;
  receiveSeq: number;
}): Promise<{ exited: boolean; trade: GhShadowTrade | null }> {
  const state = openByOwner.get(args.ownerUid);
  if (!state) return { exited: false, trade: null };

  const cfg = frozenGhFastSoakConfig();
  const { trade, fast } = state;

  if (
    !isFinitePositive(args.bid) ||
    !isFinitePositive(args.ask) ||
    args.ask < args.bid
  ) {
    // Do not invent; wait for valid book. Soft hold.
    return { exited: false, trade };
  }

  const wasLocked = fast.profitLockActive;
  const prevFloor = fast.lockFloor;
  updateOpenTrade(fast, args.bid, args.ask, cfg);
  trade.mfe = fast.mfe;
  trade.mae = fast.mae;
  trade.maxFavorableBeforeExit = fast.mfe;
  trade.maxAdverseBeforeExit = fast.mae;

  if (!wasLocked && fast.profitLockActive) {
    trade.profitLockActivatedAt = new Date().toISOString();
    trade.trailActivatedAt = trade.profitLockActivatedAt;
    trade.path.profitLockActivateMfeAtActivation = fast.mfe;
    trade.path.lockFloorAtActivation = fast.lockFloor;
  }
  if (
    fast.profitLockActive &&
    prevFloor != null &&
    fast.lockFloor != null &&
    fast.lockFloor !== prevFloor
  ) {
    trade.trailUpdateCount += 1;
  }

  if (!args.features) {
    await upsertGhShadowTrade(args.ownerUid, trade);
    return { exited: false, trade };
  }

  const reason = evaluateOpenExit({
    trade: fast,
    f: args.features,
    cfg,
    dataOk: args.dataOk
  }) as GhShadowExitReason | null;

  if (!reason) {
    await upsertGhShadowTrade(args.ownerUid, trade);
    return { exited: false, trade };
  }

  return closeGhShadowTrade({
    ownerUid: args.ownerUid,
    bid: args.bid,
    ask: args.ask,
    exitReason: reason,
    receiveSeq: args.receiveSeq
  });
}

export async function closeGhShadowTrade(args: {
  ownerUid: string;
  bid: number;
  ask: number;
  exitReason: GhShadowExitReason;
  receiveSeq: number;
}): Promise<{ exited: boolean; trade: GhShadowTrade | null }> {
  const state = openByOwner.get(args.ownerUid);
  if (!state) return { exited: false, trade: null };
  const { trade, fast } = state;
  const exitPrice = shadowExitPrice(trade.side, args.bid, args.ask);
  const exitTs = new Date().toISOString();
  const entryTsMs = trade.entryTs ? Date.parse(trade.entryTs) : Date.now();
  const pnl = simulateGhShadowCashPnl({
    side: trade.side,
    entryPrice: trade.entryPrice!,
    exitPrice,
    economic: trade.economic!
  });

  trade.status = "CLOSED";
  trade.exitTs = exitTs;
  trade.exitBid = args.bid;
  trade.exitAsk = args.ask;
  trade.exitPrice = exitPrice;
  trade.exitReason = args.exitReason;
  trade.durationMs = Math.max(0, Date.parse(exitTs) - entryTsMs);
  trade.grossPriceMove = pnl.grossPriceMove;
  trade.frictionPrice = pnl.frictionPrice;
  trade.netPriceMove = pnl.netPriceMove;
  trade.simulatedGrossPnlEur = pnl.simulatedGrossPnlEur;
  trade.simulatedFrictionEur = pnl.simulatedFrictionEur;
  trade.simulatedNetPnlEur = pnl.simulatedNetPnlEur;
  trade.mfe = fast.mfe;
  trade.mae = fast.mae;
  trade.maxFavorableBeforeExit = fast.mfe;
  trade.maxAdverseBeforeExit = fast.mae;
  trade.receiveSeqAtExit = args.receiveSeq;
  trade.path.lockFloorAtExit = fast.lockFloor;
  trade.path.bestExitAtExit = fast.bestExit;

  openByOwner.delete(args.ownerUid);
  await upsertGhShadowTrade(args.ownerUid, trade);

  const epoch = await loadGhShadowEpoch(args.ownerUid);
  if (epoch) {
    epoch.openShadowTradeId = null;
    if (trade.dataQuality === "FORMAL_ELIGIBLE") {
      epoch.formalQualificationTrades += 1;
    } else {
      epoch.diagnosticExcludedTrades += 1;
    }
    epoch.updatedAt = new Date().toISOString();
    await saveGhShadowEpoch(args.ownerUid, epoch);
  }

  await appendGhShadowDecision(args.ownerUid, {
    decisionId: `dec-${trade.tradeId}-exit`,
    qualificationId: trade.qualificationId,
    at: exitTs,
    kind: "EXIT",
    opportunityId: trade.opportunityId,
    tradeId: trade.tradeId,
    setup: trade.setup,
    side: trade.side,
    bid: args.bid,
    ask: args.ask,
    receiveSeq: args.receiveSeq,
    exitReason: args.exitReason,
    detail: `net_${pnl.simulatedNetPnlEur.toFixed(4)}`
  });

  return { exited: true, trade };
}
