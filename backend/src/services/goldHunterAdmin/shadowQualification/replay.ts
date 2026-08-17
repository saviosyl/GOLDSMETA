/**
 * Deterministic replay for shadow qualification decisions.
 *
 * For a fixed captured event sequence, live-shadow decisions and replay
 * decisions must match → LIVE_REPLAY_OK, else LIVE_REPLAY_DIVERGENCE.
 */
import {
  evaluateOpenExit,
  openTrade,
  updateOpenTrade
} from "../abc/exits";
import { frozenGhFastSoakConfig } from "../abc/frozenConfig";
import type { GhFastFeatureSnapshot } from "../abc/features";
import type { GhFastExitReason, GhFastOpenTrade, GhFastSetupId } from "../abc/types";
import type { GhShadowDecisionRecord, GhShadowTrade } from "./types";

export type GhShadowReplayMarketEvent = {
  receiveSeq: number;
  bid: number;
  ask: number;
  features: GhFastFeatureSnapshot | null;
  dataOk: boolean;
  /** When set, attempt open (same as live newOpportunity). */
  open?: {
    tradeId: string;
    side: "BUY" | "SELL";
    setup: GhFastSetupId;
    entryTs: number;
  };
};

export type GhShadowReplayResult = {
  status: "LIVE_REPLAY_OK" | "LIVE_REPLAY_DIVERGENCE";
  liveDecisions: Array<{ kind: string; tradeId: string | null; exitReason: string | null; receiveSeq: number }>;
  replayDecisions: Array<{ kind: string; tradeId: string | null; exitReason: string | null; receiveSeq: number }>;
  divergenceDetail: string | null;
};

function setupId(letter: string): GhFastSetupId {
  if (letter === "A" || letter.startsWith("A_")) return "A_MOMENTUM_IGNITION";
  if (letter === "B" || letter.startsWith("B_")) return "B_FAST_BREAKOUT";
  return "C_PULLBACK_REACCEL";
}

/**
 * Replay market events through the same exit geometry; compare to live decisions.
 */
export function replayGhShadowEventSequence(args: {
  events: GhShadowReplayMarketEvent[];
  liveDecisions: GhShadowDecisionRecord[];
}): GhShadowReplayResult {
  const cfg = frozenGhFastSoakConfig();
  let fast: GhFastOpenTrade | null = null;
  const replayDecisions: GhShadowReplayResult["replayDecisions"] = [];

  for (const ev of args.events) {
    if (ev.open && !fast) {
      fast = openTrade({
        tradeId: ev.open.tradeId,
        side: ev.open.side,
        setup: ev.open.setup,
        entryTs: ev.open.entryTs,
        bid: ev.bid,
        ask: ev.ask,
        trailDistance: cfg.trailDistance
      });
      replayDecisions.push({
        kind: "OPEN",
        tradeId: ev.open.tradeId,
        exitReason: null,
        receiveSeq: ev.receiveSeq
      });
      continue;
    }
    if (!fast) continue;
    if (!Number.isFinite(ev.bid) || !Number.isFinite(ev.ask)) continue;
    updateOpenTrade(fast, ev.bid, ev.ask, cfg);
    if (!ev.features) continue;
    const reason = evaluateOpenExit({
      trade: fast,
      f: ev.features,
      cfg,
      dataOk: ev.dataOk
    }) as GhFastExitReason | null;
    if (reason) {
      replayDecisions.push({
        kind: "EXIT",
        tradeId: fast.tradeId,
        exitReason: reason,
        receiveSeq: ev.receiveSeq
      });
      fast = null;
    }
  }

  const live = args.liveDecisions
    .filter((d) => d.kind === "OPEN" || d.kind === "EXIT")
    .map((d) => ({
      kind: d.kind,
      tradeId: d.tradeId,
      exitReason: d.exitReason,
      receiveSeq: d.receiveSeq
    }));

  if (live.length !== replayDecisions.length) {
    return {
      status: "LIVE_REPLAY_DIVERGENCE",
      liveDecisions: live,
      replayDecisions,
      divergenceDetail: `count_mismatch live=${live.length} replay=${replayDecisions.length}`
    };
  }

  for (let i = 0; i < live.length; i++) {
    const a = live[i]!;
    const b = replayDecisions[i]!;
    if (
      a.kind !== b.kind ||
      a.exitReason !== b.exitReason ||
      a.receiveSeq !== b.receiveSeq
    ) {
      return {
        status: "LIVE_REPLAY_DIVERGENCE",
        liveDecisions: live,
        replayDecisions,
        divergenceDetail: `idx=${i} live=${JSON.stringify(a)} replay=${JSON.stringify(b)}`
      };
    }
  }

  return {
    status: "LIVE_REPLAY_OK",
    liveDecisions: live,
    replayDecisions,
    divergenceDetail: null
  };
}

/**
 * Build a minimal event stream from a completed formal trade forensics
 * (entry + synthetic exit tick) — useful for unit proof of determinism.
 */
export function buildMinimalReplayEventsFromTrade(
  trade: GhShadowTrade,
  featuresAtExit: GhFastFeatureSnapshot
): GhShadowReplayMarketEvent[] {
  if (
    trade.entryBid == null ||
    trade.entryAsk == null ||
    trade.exitBid == null ||
    trade.exitAsk == null ||
    trade.entryTs == null
  ) {
    return [];
  }
  return [
    {
      receiveSeq: trade.receiveSeqAtEntry ?? 1,
      bid: trade.entryBid,
      ask: trade.entryAsk,
      features: null,
      dataOk: true,
      open: {
        tradeId: trade.tradeId,
        side: trade.side,
        setup: setupId(String(trade.setupId || trade.setup)),
        entryTs: Date.parse(trade.entryTs)
      }
    },
    {
      receiveSeq: trade.receiveSeqAtExit ?? (trade.receiveSeqAtEntry ?? 1) + 1,
      bid: trade.exitBid,
      ask: trade.exitAsk,
      features: featuresAtExit,
      dataOk: trade.exitReason !== "DATA_STALE"
    }
  ];
}
