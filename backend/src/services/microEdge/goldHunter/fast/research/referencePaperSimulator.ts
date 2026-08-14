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
 *
 * Position rule: one paper position max; selected events ignored while open;
 * rearmFloorMs after close. Not a proven unique-opportunity episode layer.
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
    trigger:
      "selectedCandidate=true with candidateSide, one position max, dataOk===true, two-sided non-crossed quote",
    positionRule:
      "ONE POSITION MAX · EVENT DEDUPE WHILE OPEN · rearmFloorMs after close. Not proven unique-opportunity episodes.",
    invalidData:
      "When flat, dataOk!==true / crossed / incomplete Spot quote blocks entry (parity with GoldHunterFastEngine entry gate)."
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
    units: "XAUUSD price movement (points), not account currency",
    summary: "Cumulative since simulator start; UI history capped separately"
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
  /** totalClosed + current open */
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
  /** PAPER TRADES / HOUR — CURRENT RUNTIME (cumulative closed / elapsed) */
  tradesPerHour: number | null;
  tradesPerHourLabel: "PAPER TRADES / HOUR — CURRENT RUNTIME";
  historyLimit: number;
  historyRows: number;
  totalClosedTrades: number;
  paperEntriesBlockedDataNotOk: number;
  paperDataStaleExits: number;
  paperResyncExits: number;
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
  /** Newest-first, capped at historyLimit */
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

function hasSelected(specialists: ResearchSpecialistObservation[] | null): boolean {
  return (specialists ?? []).some((s) => s.selectedCandidate && s.candidateSide);
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
 * Summary metrics are cumulative; UI history is bounded.
 */
export class ReferencePaperSimulator {
  private readonly cfg = frozenGhFastSoakConfig();
  private open: OpenRef | null = null;
  /** Bounded UI history only (newest retained by shifting oldest). */
  private readonly history: ReferencePaperClosedTrade[] = [];
  private tradeSeq = 0;
  private lastExitTs = 0;
  private lastBid: number | null = null;
  private lastAsk: number | null = null;
  private startedAtMs: number | null = null;
  private lastTickTs = 0;
  private readonly historyLimit: number;

  // Cumulative run statistics (never rolled by historyLimit)
  private totalClosedTrades = 0;
  private totalWins = 0;
  private totalLosses = 0;
  private totalBreakeven = 0;
  private cumulativeWinNet = 0;
  private cumulativeLossAbsNet = 0;
  private cumulativeGrossMove = 0;
  private cumulativeFriction = 0;
  private cumulativeNetMove = 0;
  private lastClosedResult: "WIN" | "LOSS" | "BREAKEVEN" | null = null;
  private currentStreak = 0;
  private streakKind: "WIN" | "LOSS" | "NONE" = "NONE";

  // Reference-only diagnostics
  private paperEntriesBlockedDataNotOk = 0;
  private paperDataStaleExits = 0;
  private paperResyncExits = 0;

  constructor(opts?: { historyLimit?: number }) {
    this.historyLimit = opts?.historyLimit ?? 80;
  }

  /**
   * Drive from research market tick AFTER research pipeline (derived only).
   * Selected specialists may open when flat AND dataOk===true with a valid quote.
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
    const quoteComplete = bid != null && ask != null && bid > 0 && ask > 0;
    const crossed = quoteComplete && ask! < bid!;
    const quoteOk = quoteComplete && !crossed;
    const dataOk = args.dataOk === true && quoteOk;

    if (this.open) {
      if (!quoteOk) {
        // Incomplete/crossed while open → deterministic DATA_STALE close
        const b = bid ?? this.open.core.entryBid;
        const a = ask ?? this.open.core.entryAsk;
        this.closeOpen(b, a, args.tsMs, "DATA_STALE");
        return;
      }
      updateOpenTrade(this.open.core, bid!, ask!, this.cfg);
      // Mirror exits.ts: !dataOk → DATA_STALE even without a feature snapshot
      if (args.dataOk !== true) {
        this.closeOpen(bid!, ask!, args.tsMs, "DATA_STALE");
        return;
      }
      const feat = featureForExit(args.features, bid!, ask!);
      if (feat) {
        const reason = evaluateOpenExit({
          trade: this.open.core,
          f: feat,
          cfg: this.cfg,
          dataOk: true
        });
        if (reason) this.closeOpen(bid!, ask!, args.tsMs, reason);
      }
      return;
    }

    // Flat — entry gate (parity with GoldHunterFastEngine: block when !dataOk)
    if (!dataOk) {
      if (hasSelected(args.specialists)) {
        this.paperEntriesBlockedDataNotOk += 1;
      }
      return;
    }

    if (args.tsMs - this.lastExitTs < this.cfg.rearmFloorMs) return;
    for (const s of args.specialists ?? []) {
      if (!s.selectedCandidate || !s.candidateSide) continue;
      this.openPosition({
        setup: s.setup,
        side: s.candidateSide,
        bid: bid!,
        ask: ask!,
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
    this.paperResyncExits += 1;
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
      history: [...this.history].reverse()
    };
  }

  summary(): ReferencePaperSummary {
    const closedN = this.totalClosedTrades;
    let profitFactor: number | null = null;
    if (this.cumulativeLossAbsNet > 0) {
      profitFactor = this.cumulativeWinNet / this.cumulativeLossAbsNet;
    } else if (this.cumulativeWinNet > 0) {
      profitFactor = Number.POSITIVE_INFINITY;
    }

    let tradesPerHour: number | null = null;
    if (this.startedAtMs != null && closedN > 0 && this.lastTickTs > 0) {
      const hours = Math.max(
        1 / 3600,
        (this.lastTickTs - this.startedAtMs) / 3_600_000
      );
      tradesPerHour = closedN / hours;
    }

    return {
      mode: REFERENCE_PAPER_MODE,
      label: REFERENCE_PAPER_LABEL,
      paperTrades: closedN + (this.open ? 1 : 0),
      open: this.open ? 1 : 0,
      wins: this.totalWins,
      losses: this.totalLosses,
      breakeven: this.totalBreakeven,
      winRate: closedN > 0 ? this.totalWins / closedN : null,
      profitFactor,
      grossMoveSum: this.cumulativeGrossMove,
      frictionSum: this.cumulativeFriction,
      netMoveSum: this.cumulativeNetMove,
      currentStreak: this.currentStreak,
      streakKind: this.streakKind,
      tradesPerHour,
      tradesPerHourLabel: "PAPER TRADES / HOUR — CURRENT RUNTIME",
      historyLimit: this.historyLimit,
      historyRows: this.history.length,
      totalClosedTrades: this.totalClosedTrades,
      paperEntriesBlockedDataNotOk: this.paperEntriesBlockedDataNotOk,
      paperDataStaleExits: this.paperDataStaleExits,
      paperResyncExits: this.paperResyncExits,
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
    const result = resultFromNet(net);
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
      result,
      exitReason: reason,
      sourceReceiveSeq: this.open.sourceReceiveSeq,
      sourceSignalEvent: this.open.sourceSignalEvent
    };

    // Cumulative (never capped)
    this.totalClosedTrades += 1;
    this.cumulativeGrossMove += gross;
    this.cumulativeFriction += friction;
    this.cumulativeNetMove += net;
    if (result === "WIN") {
      this.totalWins += 1;
      this.cumulativeWinNet += net;
    } else if (result === "LOSS") {
      this.totalLosses += 1;
      this.cumulativeLossAbsNet += Math.abs(net);
    } else {
      this.totalBreakeven += 1;
    }
    if (reason === "DATA_STALE") this.paperDataStaleExits += 1;

    if (result === "BREAKEVEN") {
      this.currentStreak = 0;
      this.streakKind = "NONE";
    } else if (this.streakKind === result) {
      this.currentStreak += 1;
    } else {
      this.streakKind = result;
      this.currentStreak = 1;
    }
    this.lastClosedResult = result;

    // Bounded UI history
    this.history.push(closed);
    while (this.history.length > this.historyLimit) this.history.shift();

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
