/**
 * Captured-event journal replay for shadow qualification.
 * Reads actual journal events in receiveSeq order — NOT synthetic entry+exit.
 */
import {
  evaluateOpenExit,
  openTrade,
  updateOpenTrade
} from "../abc/exits";
import { frozenGhFastShadowExitConfig } from "../abc/frozenConfig";
import type { GhFastOpenTrade } from "../abc/types";
import type {
  GhShadowCapturedEvent,
  GhShadowDecisionRecord,
  GhShadowTrade
} from "./types";

export type GhShadowReplayComparePoint = {
  kind: "OPEN" | "EXIT";
  receiveSeq: number;
  tradeId: string | null;
  side: "BUY" | "SELL" | null;
  setup: string | null;
  exitReason: string | null;
  mfe: number | null;
  mae: number | null;
  profitLockActive: boolean | null;
  trailActivated: boolean | null;
  lockFloor: number | null;
  netPriceMove: number | null;
};

export type GhShadowReplayResult = {
  status: "LIVE_REPLAY_OK" | "LIVE_REPLAY_DIVERGENCE";
  capturedEvents: number;
  replayedEvents: number;
  firstDivergenceSeq: number | null;
  divergenceDetail: string | null;
  livePoints: GhShadowReplayComparePoint[];
  replayPoints: GhShadowReplayComparePoint[];
};

function pointsEqual(
  a: GhShadowReplayComparePoint,
  b: GhShadowReplayComparePoint
): boolean {
  const near = (x: number | null, y: number | null) => {
    if (x == null && y == null) return true;
    if (x == null || y == null) return false;
    return Math.abs(x - y) < 1e-9;
  };
  return (
    a.kind === b.kind &&
    a.receiveSeq === b.receiveSeq &&
    a.tradeId === b.tradeId &&
    a.side === b.side &&
    a.setup === b.setup &&
    a.exitReason === b.exitReason &&
    near(a.mfe, b.mfe) &&
    near(a.mae, b.mae) &&
    a.profitLockActive === b.profitLockActive &&
    a.trailActivated === b.trailActivated &&
    near(a.lockFloor, b.lockFloor) &&
    near(a.netPriceMove, b.netPriceMove)
  );
}

/**
 * Replay captured journal through the same exit geometry.
 */
export function replayGhShadowCapturedEvents(args: {
  events: GhShadowCapturedEvent[];
  liveDecisions: GhShadowDecisionRecord[];
  liveTrades: GhShadowTrade[];
}): GhShadowReplayResult {
  const cfg = frozenGhFastShadowExitConfig();
  const sorted = [...args.events].sort((a, b) => a.receiveSeq - b.receiveSeq);
  let fast: GhFastOpenTrade | null = null;
  let openSide: "BUY" | "SELL" | null = null;
  let openSetup: string | null = null;
  let profitLockSeen = false;
  let trailSeen = false;
  const replayPoints: GhShadowReplayComparePoint[] = [];
  let replayed = 0;

  for (const ev of sorted) {
    replayed += 1;
    if (ev.openMarker && !fast) {
      const m = ev.openMarker;
      fast = openTrade({
        tradeId: m.tradeId,
        side: m.side,
        setup: m.setupId,
        entryTs: ev.eventTsMs,
        bid: ev.bid,
        ask: ev.ask,
        trailDistance: cfg.trailDistance
      });
      openSide = m.side;
      openSetup = m.setup;
      profitLockSeen = false;
      trailSeen = false;
      replayPoints.push({
        kind: "OPEN",
        receiveSeq: ev.receiveSeq,
        tradeId: m.tradeId,
        side: m.side,
        setup: m.setup,
        exitReason: null,
        mfe: 0,
        mae: 0,
        profitLockActive: false,
        trailActivated: false,
        lockFloor: null,
        netPriceMove: null
      });
      continue;
    }

    if (!fast) continue;
    // Mirror live Demo/shadow open management: featureless ticks are NO-OPS.
    // Depth / generic bid/ask must NEVER update MFE/MAE/lock/trail/exit state.
    if (!ev.features) continue;
    const featBid = ev.features.bid;
    const featAsk = ev.features.ask;
    if (!Number.isFinite(featBid) || !Number.isFinite(featAsk)) continue;
    updateOpenTrade(fast, featBid, featAsk, cfg);
    if (fast.profitLockActive) {
      profitLockSeen = true;
      trailSeen = true;
    }
    const reason = evaluateOpenExit({
      trade: fast,
      f: ev.features,
      cfg,
      dataOk: ev.dataOk
    });
    if (!reason) continue;

    const entry = fast.entryPrice;
    const exitPx = fast.side === "BUY" ? featBid : featAsk;
    const netMove =
      fast.side === "BUY" ? exitPx - entry - cfg.friction : entry - exitPx - cfg.friction;

    replayPoints.push({
      kind: "EXIT",
      receiveSeq: ev.receiveSeq,
      tradeId: fast.tradeId,
      side: openSide,
      setup: openSetup,
      exitReason: reason,
      mfe: fast.mfe,
      mae: fast.mae,
      profitLockActive: profitLockSeen,
      trailActivated: trailSeen,
      lockFloor: fast.lockFloor,
      netPriceMove: netMove
    });
    fast = null;
  }

  // Build live compare points from decisions + closed trades
  const tradeById = new Map(args.liveTrades.map((t) => [t.tradeId, t]));
  const livePoints: GhShadowReplayComparePoint[] = [];
  for (const d of args.liveDecisions) {
    if (d.kind !== "OPEN" && d.kind !== "EXIT") continue;
    const t = d.tradeId ? tradeById.get(d.tradeId) : undefined;
    if (d.kind === "OPEN") {
      livePoints.push({
        kind: "OPEN",
        receiveSeq: d.receiveSeq,
        tradeId: d.tradeId,
        side: d.side,
        setup: d.setup,
        exitReason: null,
        mfe: 0,
        mae: 0,
        profitLockActive: false,
        trailActivated: false,
        lockFloor: null,
        netPriceMove: null
      });
    } else {
      livePoints.push({
        kind: "EXIT",
        receiveSeq: d.receiveSeq,
        tradeId: d.tradeId,
        side: d.side,
        setup: d.setup,
        exitReason: d.exitReason,
        mfe: t?.mfe ?? null,
        mae: t?.mae ?? null,
        profitLockActive: t?.profitLockActivatedAt != null,
        trailActivated: t?.trailActivatedAt != null || t?.profitLockActivatedAt != null,
        lockFloor: t?.path.lockFloorAtExit ?? t?.lockFloorLatest ?? null,
        netPriceMove: t?.netPriceMove ?? null
      });
    }
  }

  if (livePoints.length !== replayPoints.length) {
    return {
      status: "LIVE_REPLAY_DIVERGENCE",
      capturedEvents: sorted.length,
      replayedEvents: replayed,
      firstDivergenceSeq: replayPoints[0]?.receiveSeq ?? livePoints[0]?.receiveSeq ?? null,
      divergenceDetail: `count_mismatch live=${livePoints.length} replay=${replayPoints.length}`,
      livePoints,
      replayPoints
    };
  }

  for (let i = 0; i < livePoints.length; i++) {
    const a = livePoints[i]!;
    const b = replayPoints[i]!;
    if (!pointsEqual(a, b)) {
      return {
        status: "LIVE_REPLAY_DIVERGENCE",
        capturedEvents: sorted.length,
        replayedEvents: replayed,
        firstDivergenceSeq: a.receiveSeq,
        divergenceDetail: `idx=${i} live=${JSON.stringify(a)} replay=${JSON.stringify(b)}`,
        livePoints,
        replayPoints
      };
    }
  }

  return {
    status: "LIVE_REPLAY_OK",
    capturedEvents: sorted.length,
    replayedEvents: replayed,
    firstDivergenceSeq: null,
    divergenceDetail: null,
    livePoints,
    replayPoints
  };
}

/**
 * Unit-only helper — NOT valid as LIVE_REPLAY qualification proof.
 * @deprecated Do not use for formal LIVE_REPLAY_OK.
 */
export function buildMinimalReplayEventsFromTrade(): never {
  throw new Error(
    "buildMinimalReplayEventsFromTrade is not valid for LIVE_REPLAY qualification proof — use captured event journal"
  );
}
