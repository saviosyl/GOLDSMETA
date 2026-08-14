/**
 * REFERENCE PAPER — hypothetical P/L overlay for GOLD HUNTER FAST research monitor.
 *
 * mode = REFERENCE_PAPER_ONLY
 *
 * SAFETY:
 * - No broker adapter, no cTrader orders, no Demo/Live execution
 * - Does NOT mutate ResearchFeaturePipeline, research capture records, or GCS
 * - Uses frozen FAST exit helpers (exits.ts) in isolation
 *
 * HYPOTHETICAL REFERENCE ONLY — not research edge proof, not validated V2 trading.
 */
import { frozenGhFastSoakConfig } from "../frozenConfig";
import {
  evaluateOpenExit,
  openTrade,
  updateOpenTrade
} from "../exits";
import type { GhFastFeatureSnapshot } from "../features";
import type { DepthBookStats } from "../depthBook";
import type {
  GhFastExitReason,
  GhFastOpenTrade,
  GhFastSetupId,
  GhFastSide
} from "../types";
import type { ResearchFeatureTelemetry } from "./researchTypes";
import type { ResearchSpecialistObservation } from "./researchTypes";

export const REFERENCE_PAPER_MODE = "REFERENCE_PAPER_ONLY" as const;
export const REFERENCE_PAPER_LABEL =
  "REFERENCE PAPER P/L — HYPOTHETICAL, NOT A BROKER TRADE" as const;

/** Frozen before observing results — do not tune for lookback profitability. */
export const REFERENCE_PAPER_POLICY = {
  mode: REFERENCE_PAPER_MODE,
  label: REFERENCE_PAPER_LABEL,
  entry: {
    BUY: "ASK (executable)",
    SELL: "BID (executable)",
    trigger: "selectedCandidate=true with candidateSide, one position max",
    dedupe:
      "While a reference position is open, additional selected signal events are ignored (same or opposite side). After exit + rearmFloorMs, a new selected event may open a new episode."
  },
  exit: {
    BUY: "BID (executable)",
    SELL: "ASK (executable)",
    source: "frozenGhFastSoakConfig + evaluateOpenExit / updateOpenTrade (exits.ts)",
    reasons: [
      "RAPID_ABORT",
      "TRAIL_HIT",
      "HARVEST_FADE",
      "HARD_PROTECTION",
      "SPREAD_UNSAFE",
      "DATA_STALE"
    ] as const,
    note: "No TARGET/TIMEOUT exit reasons in frozen FAST exits. RESYNC/force → DATA_STALE."
  },
  friction: {
    field: "frozenGhFastSoakConfig().friction",
    value: frozenGhFastSoakConfig().friction,
    formula: "netMove = grossMove - friction"
  },
  pnl: {
    BUY_gross: "exitBid - entryAsk",
    SELL_gross: "entryBid - exitAsk",
    result: "WIN if netMove>0; LOSS if netMove<0; else BREAKEVEN",
    units: "XAUUSD price movement (points), not account currency"
  },
  mfeMae: {
    BUY: "unrealized = execBid - entryAsk; MFE=max, MAE=min",
    SELL: "unrealized = entryBid - execAsk; MFE=max, MAE=min"
  },
  safety: {
    brokerRequests: 0,
    brokerOrders: 0,
    shadowOrders: 0,
    executionAdapter: "NONE",
    mutationSurface: "NONE"
  }
} as const;

export type ReferencePaperResult = "WIN" | "LOSS" | "BREAKEVEN" | "OPEN";

export type ReferencePaperClosedTrade = {
  referenceTradeId: string;
  setup: GhFastSetupId;
  setupName: string;
  side: GhFastSide;
  entryTs: number;
  entryTsIso: string;
  entryBid: number;
  entryAsk: number;
  entryPrice: number;
  exitTs: number;
  exitTsIso: string;
  exitBid: number;
  exitAsk: number;
  exitPrice: number;
  durationMs: number;
  mfe: number;
  mae: number;
  grossMove: number;
  referenceFriction: number;
  netMove: number;
  result: "WIN" | "LOSS" | "BREAKEVEN";
  exitReason: GhFastExitReason;
  sourceReceiveSeq: number;
  sourceSignalEvent: string;
};

export type ReferencePaperOpenTrade = {
  referenceTradeId: string;
  setup: GhFastSetupId;
  setupName: string;
  side: GhFastSide;
  entryTs: number;
  entryTsIso: string;
  entryBid: number;
  entryAsk: number;
  entryPrice: number;
  currentBid: number;
  currentAsk: number;
  executableExitPrice: number;
  grossMove: number;
  referenceFriction: number;
  netMove: number;
  mfe: number;
  mae: number;
  durationMs: number;
  sourceReceiveSeq: number;
  sourceSignalEvent: string;
  result: "OPEN";
};

export type ReferencePaperSummary = {
  mode: typeof REFERENCE_PAPER_MODE;
  label: typeof REFERENCE_PAPER_LABEL;
  paperTrades: number;
  open: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number | null;
  profitFactor: number | null;
  grossMoveSum: number;
  frictionSum: number;
  netMoveSum: number;
  currentStreak: number;
  streakKind: "WIN" | "LOSS" | "NONE";
  tradesPerHour: number | null;
  brokerRequests: 0;
  brokerOrders: 0;
  shadowOrders: 0;
  executionAdapter: "NONE";
  mutationSurface: "NONE";
  friction: number;
  rearmFloorMs: number;
};

export type ReferencePaperSnapshot = {
  mode: typeof REFERENCE_PAPER_MODE;
  label: typeof REFERENCE_PAPER_LABEL;
  policy: typeof REFERENCE_PAPER_POLICY;
  summary: ReferencePaperSummary;
  openTrade: ReferencePaperOpenTrade | null;
  history: ReferencePaperClosedTrade[];
};

const SETUP_NAME: Record<GhFastSetupId, string> = {
  A_MOMENTUM_IGNITION: "A MOMENTUM IGNITION",
  B_FAST_BREAKOUT: "B FAST BREAKOUT",
  C_PULLBACK_REACCEL: "C PULLBACK REACCEL"
};

const EMPTY_DEPTH: DepthBookStats = {
  available: false,
  topBidDepth: 0,
  topAskDepth: 0,
  bidDepthN: 0,
  askDepthN: 0,
  bidLevels: 0,
  askLevels: 0,
  depthRatio: 1,
  depthImbalance: 0,
  weightedImbalance: 0,
  liquidityAddedBid: 0,
  liquidityAddedAsk: 0,
  liquidityRemovedBid: 0,
  liquidityRemovedAsk: 0,
  addRateBid: 0,
  addRateAsk: 0,
  removeRateBid: 0,
  removeRateAsk: 0,
  bestBid: null,
  bestAsk: null,
  spread: null,
  crossed: false,
  lastUpdateMs: null,
  lastValidBookMs: null,
  consecutiveInvalidSnapshots: 0,
  bookGeneration: 0,
  resyncCount: 0,
  deleteHits: 0,
  deleteMisses: 0,
  deleteHitRate: 0
};

function iso(ts: number): string {
  return new Date(ts).toISOString();
}

function resultFromNet(net: number): "WIN" | "LOSS" | "BREAKEVEN" {
  if (net > 0) return "WIN";
  if (net < 0) return "LOSS";
  return "BREAKEVEN";
}

function featureForExit(
  feat: ResearchFeatureTelemetry | null,
  bid: number,
  ask: number
): GhFastFeatureSnapshot | null {
  if (!feat) return null;
  const mid = (bid + ask) / 2;
  const spread = ask - bid;
  return {
    bid,
    ask,
    mid,
    spread,
    bidVel250: 0,
    bidVel500: 0,
    bidVel1s: 0,
    bidVel2s: 0,
    bidVel3s: 0,
    askVel1s: 0,
    midVel250: feat.midVel250,
    midVel500: feat.midVel500,
    midVel1s: feat.midVel1s,
    midVel2s: feat.midVel2s,
    midVel3s: feat.midVel3s,
    acceleration: feat.acceleration,
    updateRate1s: feat.updateRate1s,
    signedImbalance1s: feat.signedImbalance1s,
    efficiency1s: feat.efficiency1s,
    efficiency3s: feat.efficiency3s,
    high1s: mid,
    low1s: mid,
    high2s: mid,
    low2s: mid,
    high5s: mid,
    low5s: mid,
    high10s: mid,
    low10s: mid,
    high15s: mid,
    low15s: mid,
    high30s: mid,
    low30s: mid,
    distHigh1s: feat.distHigh5s,
    distLow1s: feat.distLow5s,
    distHigh5s: feat.distHigh5s,
    distLow5s: feat.distLow5s,
    upTouches5s: feat.upTouches5s,
    downTouches5s: feat.downTouches5s,
    depth: {
      ...EMPTY_DEPTH,
      depthImbalance: feat.depthImbalance,
      weightedImbalance: feat.weightedImbalance,
      bestBid: bid,
      bestAsk: ask,
      spread,
      available: true
    }
  };
}

type OpenRef = {
  core: GhFastOpenTrade;
  sourceReceiveSeq: number;
  sourceSignalEvent: string;
};

/**
 * In-memory reference paper book. One position maximum. No broker I/O.
 */
export class ReferencePaperSimulator {
  private readonly cfg = frozenGhFastSoakConfig();
  private open: OpenRef | null = null;
  private readonly closed: ReferencePaperClosedTrade[] = [];
  private tradeSeq = 0;
  private lastExitTs = 0;
  private lastBid: number | null = null;
  private lastAsk: number | null = null;
  private startedAtMs: number | null = null;
  private lastTickTs = 0;
  private readonly historyLimit: number;

  constructor(opts?: { historyLimit?: number }) {
    this.historyLimit = opts?.historyLimit ?? 80;
  }

  /**
   * Drive from research market tick AFTER research pipeline (derived only).
   * selected specialists may open a new episode when flat.
   */
  onMarketTick(args: {
    bid: number | null;
    ask: number | null;
    tsMs: number;
    receiveSeq: number;
    specialists: ResearchSpecialistObservation[] | null;
    features: ResearchFeatureTelemetry | null;
    dataOk?: boolean;
  }): void {
    if (this.startedAtMs == null) this.startedAtMs = args.tsMs;
    this.lastTickTs = args.tsMs;
    if (args.bid != null && args.bid > 0) this.lastBid = args.bid;
    if (args.ask != null && args.ask > 0) this.lastAsk = args.ask;
    const bid = this.lastBid;
    const ask = this.lastAsk;
    if (bid == null || ask == null || ask < bid) return;

    if (this.open) {
      updateOpenTrade(this.open.core, bid, ask, this.cfg);
      const feat = featureForExit(args.features, bid, ask);
      if (feat) {
        const reason = evaluateOpenExit({
          trade: this.open.core,
          f: feat,
          cfg: this.cfg,
          dataOk: args.dataOk !== false
        });
        if (reason) this.closeOpen(bid, ask, args.tsMs, reason);
      }
      return;
    }

    // Flat — consider one new episode from the first selected specialist with a side.
    if (args.tsMs - this.lastExitTs < this.cfg.rearmFloorMs) return;
    for (const s of args.specialists ?? []) {
      if (!s.selectedCandidate || !s.candidateSide) continue;
      this.openPosition({
        setup: s.setup,
        side: s.candidateSide,
        bid,
        ask,
        tsMs: args.tsMs,
        receiveSeq: args.receiveSeq,
        sourceSignalEvent: `${s.setup}:${s.candidateSide}:seq=${args.receiveSeq}`
      });
      break;
    }
  }

  /** Ordered RESYNC / data-stale boundary — force-close open reference trade. */
  onResync(args: { tsMs: number; receiveSeq: number; reason?: string }): void {
    if (!this.open) {
      this.lastBid = null;
      this.lastAsk = null;
      return;
    }
    const bid = this.lastBid ?? this.open.core.entryBid;
    const ask = this.lastAsk ?? this.open.core.entryAsk;
    this.closeOpen(bid, ask, args.tsMs, "DATA_STALE");
    this.lastBid = null;
    this.lastAsk = null;
  }

  snapshot(): ReferencePaperSnapshot {
    return {
      mode: REFERENCE_PAPER_MODE,
      label: REFERENCE_PAPER_LABEL,
      policy: REFERENCE_PAPER_POLICY,
      summary: this.summary(),
      openTrade: this.openView(),
      history: [...this.closed].reverse()
    };
  }

  summary(): ReferencePaperSummary {
    const wins = this.closed.filter((t) => t.result === "WIN").length;
    const losses = this.closed.filter((t) => t.result === "LOSS").length;
    const breakeven = this.closed.filter((t) => t.result === "BREAKEVEN").length;
    const closedN = this.closed.length;
    const grossMoveSum = this.closed.reduce((a, t) => a + t.grossMove, 0);
    const frictionSum = this.closed.reduce((a, t) => a + t.referenceFriction, 0);
    const netMoveSum = this.closed.reduce((a, t) => a + t.netMove, 0);
    const winGross = this.closed
      .filter((t) => t.netMove > 0)
      .reduce((a, t) => a + t.netMove, 0);
    const lossGross = this.closed
      .filter((t) => t.netMove < 0)
      .reduce((a, t) => a + Math.abs(t.netMove), 0);
    let profitFactor: number | null = null;
    if (lossGross > 0) profitFactor = winGross / lossGross;
    else if (winGross > 0) profitFactor = Number.POSITIVE_INFINITY;

    let currentStreak = 0;
    let streakKind: "WIN" | "LOSS" | "NONE" = "NONE";
    for (let i = this.closed.length - 1; i >= 0; i--) {
      const r = this.closed[i]!.result;
      if (r === "BREAKEVEN") break;
      if (streakKind === "NONE") {
        streakKind = r;
        currentStreak = 1;
      } else if (r === streakKind) currentStreak += 1;
      else break;
    }

    let tradesPerHour: number | null = null;
    if (this.startedAtMs != null && closedN > 0) {
      const lastTs = this.closed[this.closed.length - 1]!.exitTs;
      const hours = Math.max(1 / 3600, (lastTs - this.startedAtMs) / 3_600_000);
      tradesPerHour = closedN / hours;
    }

    return {
      mode: REFERENCE_PAPER_MODE,
      label: REFERENCE_PAPER_LABEL,
      paperTrades: closedN + (this.open ? 1 : 0),
      open: this.open ? 1 : 0,
      wins,
      losses,
      breakeven,
      winRate: closedN > 0 ? wins / closedN : null,
      profitFactor,
      grossMoveSum,
      frictionSum,
      netMoveSum,
      currentStreak,
      streakKind,
      tradesPerHour,
      brokerRequests: 0,
      brokerOrders: 0,
      shadowOrders: 0,
      executionAdapter: "NONE",
      mutationSurface: "NONE",
      friction: this.cfg.friction,
      rearmFloorMs: this.cfg.rearmFloorMs
    };
  }

  private openPosition(args: {
    setup: GhFastSetupId;
    side: GhFastSide;
    bid: number;
    ask: number;
    tsMs: number;
    receiveSeq: number;
    sourceSignalEvent: string;
  }): void {
    if (this.open) return;
    this.tradeSeq += 1;
    const id = `REF-${String(this.tradeSeq).padStart(3, "0")}`;
    const core = openTrade({
      tradeId: id,
      side: args.side,
      setup: args.setup,
      entryTs: args.tsMs,
      bid: args.bid,
      ask: args.ask,
      trailDistance: this.cfg.trailDistance
    });
    this.open = {
      core,
      sourceReceiveSeq: args.receiveSeq,
      sourceSignalEvent: args.sourceSignalEvent
    };
  }

  private closeOpen(
    bid: number,
    ask: number,
    tsMs: number,
    reason: GhFastExitReason
  ): void {
    if (!this.open) return;
    const o = this.open.core;
    updateOpenTrade(o, bid, ask, this.cfg);
    const exitPrice = o.side === "BUY" ? bid : ask;
    const gross =
      o.side === "BUY" ? exitPrice - o.entryPrice : o.entryPrice - exitPrice;
    const friction = this.cfg.friction;
    const net = gross - friction;
    const closed: ReferencePaperClosedTrade = {
      referenceTradeId: o.tradeId,
      setup: o.setup,
      setupName: SETUP_NAME[o.setup],
      side: o.side,
      entryTs: o.entryTs,
      entryTsIso: iso(o.entryTs),
      entryBid: o.entryBid,
      entryAsk: o.entryAsk,
      entryPrice: o.entryPrice,
      exitTs: tsMs,
      exitTsIso: iso(tsMs),
      exitBid: bid,
      exitAsk: ask,
      exitPrice,
      durationMs: Math.max(0, tsMs - o.entryTs),
      mfe: o.mfe,
      mae: o.mae,
      grossMove: gross,
      referenceFriction: friction,
      netMove: net,
      result: resultFromNet(net),
      exitReason: reason,
      sourceReceiveSeq: this.open.sourceReceiveSeq,
      sourceSignalEvent: this.open.sourceSignalEvent
    };
    this.closed.push(closed);
    while (this.closed.length > this.historyLimit) this.closed.shift();
    this.open = null;
    this.lastExitTs = tsMs;
  }

  private openView(): ReferencePaperOpenTrade | null {
    if (!this.open) return null;
    const o = this.open.core;
    const bid = this.lastBid ?? o.entryBid;
    const ask = this.lastAsk ?? o.entryAsk;
    const exec = o.side === "BUY" ? bid : ask;
    const gross =
      o.side === "BUY" ? exec - o.entryPrice : o.entryPrice - exec;
    const friction = this.cfg.friction;
    const now = this.lastTickTs || o.entryTs;
    return {
      referenceTradeId: o.tradeId,
      setup: o.setup,
      setupName: SETUP_NAME[o.setup],
      side: o.side,
      entryTs: o.entryTs,
      entryTsIso: iso(o.entryTs),
      entryBid: o.entryBid,
      entryAsk: o.entryAsk,
      entryPrice: o.entryPrice,
      currentBid: bid,
      currentAsk: ask,
      executableExitPrice: exec,
      grossMove: gross,
      referenceFriction: friction,
      netMove: gross - friction,
      mfe: o.mfe,
      mae: o.mae,
      durationMs: Math.max(0, now - o.entryTs),
      sourceReceiveSeq: this.open.sourceReceiveSeq,
      sourceSignalEvent: this.open.sourceSignalEvent,
      result: "OPEN"
    };
  }
}
