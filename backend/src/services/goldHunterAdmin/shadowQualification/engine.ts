/**
 * Shadow hot-path engine — synchronous state updates (no Firestore on critical path).
 *
 * MARKET EVENT → in-memory evaluate (MFE/MAE/lock/trail/exit) → journal append
 * → async persist separately.
 *
 * Event loss / seq gap / journal overflow on formal open → DIAGNOSTIC_EXCLUDED
 * or epoch DATA_QUALITY_FAILED. Never silent FORMAL_ELIGIBLE.
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
  simulateGhShadowCashPnl,
  type GhShadowSizingInput
} from "./economics";
import { GhShadowEventJournal } from "./journal";
import type {
  GhShadowCapturedEvent,
  GhShadowDecisionRecord,
  GhShadowEconomicExposure,
  GhShadowQualificationEpoch,
  GhShadowTrade
} from "./types";

export type GhShadowPersistBatch = {
  epoch: GhShadowQualificationEpoch;
  trades: GhShadowTrade[];
  events: GhShadowCapturedEvent[];
  decisions: GhShadowDecisionRecord[];
};

type OpenState = {
  trade: GhShadowTrade;
  fast: GhFastOpenTrade;
};

export type GhShadowEngineTickInput = {
  receiveSeq: number;
  eventTsMs: number;
  bid: number;
  ask: number;
  features: GhFastFeatureSnapshot | null;
  dataOk: boolean;
  depthValidity: string;
  bookGeneration: number;
  resyncGeneration: number;
  newOpportunity: boolean;
  opportunity: GoldHunterSelectedCandidate | null;
  config: GoldHunterAdminConfig;
  sizingOverrides?: Partial<GhShadowSizingInput>;
};

function setupIdFromLetter(letter: "A" | "B" | "C"): GhFastSetupId {
  if (letter === "A") return "A_MOMENTUM_IGNITION";
  if (letter === "B") return "B_FAST_BREAKOUT";
  return "C_PULLBACK_REACCEL";
}

function isFinitePositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function emptyIntegrity() {
  return {
    eventsSeen: 0,
    eventsProcessed: 0,
    eventsPersisted: 0,
    eventsDropped: 0,
    receiveSeqGaps: 0,
    journalOverflowCount: 0,
    lastProcessedReceiveSeq: null as number | null
  };
}

export class GhShadowQualificationEngine {
  readonly ownerUid: string;
  private epoch: GhShadowQualificationEpoch | null = null;
  private open: OpenState | null = null;
  private readonly journal: GhShadowEventJournal;
  private pendingTrades = new Map<string, GhShadowTrade>();
  private pendingEvents: GhShadowCapturedEvent[] = [];
  private pendingDecisions: GhShadowDecisionRecord[] = [];
  private runtimeGeneration: number;
  private recovered = false;

  constructor(args: {
    ownerUid: string;
    journalCapacity?: number;
    runtimeGeneration?: number;
  }) {
    this.ownerUid = args.ownerUid;
    this.journal = new GhShadowEventJournal(args.journalCapacity);
    this.runtimeGeneration = args.runtimeGeneration ?? 1;
  }

  getEpoch(): GhShadowQualificationEpoch | null {
    return this.epoch;
  }

  getOpenTradeId(): string | null {
    return this.open?.trade.tradeId ?? null;
  }

  getJournalEvents(): readonly GhShadowCapturedEvent[] {
    return this.journal.list();
  }

  getRuntimeGeneration(): number {
    return this.runtimeGeneration;
  }

  /**
   * Fail-safe restart recovery: if persisted open exists without memory state,
   * exclude it — never invent trail/lock state.
   */
  recoverAfterRestart(args: {
    persistedEpoch: GhShadowQualificationEpoch | null;
    reason?: string;
  }): { excludedTradeId: string | null } {
    this.recovered = true;
    if (!args.persistedEpoch) {
      this.epoch = null;
      this.open = null;
      return { excludedTradeId: null };
    }
    this.epoch = { ...args.persistedEpoch };
    this.epoch.runtimeGeneration = this.runtimeGeneration;
    this.epoch.lastRestartReason =
      args.reason ?? "process_restart_state_lost";
    this.epoch.updatedAt = new Date().toISOString();

    const openId = this.epoch.openShadowTradeId;
    if (!openId) {
      this.open = null;
      return { excludedTradeId: null };
    }

    // Cannot restore exact engine state — exclude interrupted open.
    const excluded: GhShadowTrade = {
      tradeId: openId,
      qualificationId: this.epoch.qualificationId,
      opportunityId: "restart-orphan",
      signalId: "restart-orphan",
      setup: "A",
      setupId: "A_MOMENTUM_IGNITION",
      side: "BUY",
      status: "DIAGNOSTIC_EXCLUDED",
      dataQuality: "DIAGNOSTIC_EXCLUDED",
      exclusionReason: "runtime_restart_state_lost",
      signalTs: new Date().toISOString(),
      entryTs: null,
      entryBid: null,
      entryAsk: null,
      entryPrice: null,
      entrySpread: null,
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
      simulatedGrossPnlQuote: null,
      simulatedFrictionPnlQuote: null,
      simulatedNetPnlQuote: null,
      quoteCurrency: null,
      simulatedGrossPnlEur: null,
      simulatedFrictionEur: null,
      simulatedNetPnlEur: null,
      eurPnlAvailable: false,
      economic: null,
      profitLockActivatedAt: null,
      trailActivatedAt: null,
      trailUpdateCount: 0,
      lockFloorAtActivation: null,
      lockFloorLatest: null,
      maxFavorableBeforeExit: null,
      maxAdverseBeforeExit: null,
      strategySha: this.epoch.strategySha,
      configSha: this.epoch.configSha,
      receiveSeqAtEntry: null,
      receiveSeqAtExit: null,
      bookGeneration: null,
      resyncGeneration: null,
      runtimeGeneration: this.runtimeGeneration,
      path: {
        profitLockActivateMfeAtActivation: null,
        lockFloorAtActivation: null,
        lockFloorAtExit: null,
        bestExitAtExit: null
      }
    };
    this.pendingTrades.set(excluded.tradeId, excluded);
    this.epoch.openShadowTradeId = null;
    this.epoch.diagnosticExcludedTrades += 1;
    // After restart exclusion, resume sequencing from next live event (no false gap).
    this.epoch.integrity = {
      ...this.epoch.integrity,
      lastProcessedReceiveSeq: null
    };
    this.epoch.dataIntegrityFailure = null;
    if (this.epoch.status === "DATA_QUALITY_FAILED") {
      this.epoch.status = "ACTIVE";
    }
    this.open = null;
    this.pushDecision({
      kind: "EXCLUDE",
      tradeId: openId,
      receiveSeq: this.epoch.integrity.lastProcessedReceiveSeq ?? 0,
      bid: 0,
      ask: 0,
      detail: "runtime_restart_state_lost",
      exitReason: "INVALID_MARKET"
    });
    return { excludedTradeId: openId };
  }

  ensureEpoch(receiveSeq: number): GhShadowQualificationEpoch {
    if (this.epoch && this.epoch.status !== "COMPLETED") return this.epoch;
    const identity = getFrozenGhFastIdentity();
    const now = new Date().toISOString();
    this.epoch = {
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
      dataIntegrityFailure: null,
      runtimeGeneration: this.runtimeGeneration,
      lastRestartReason: null,
      integrity: emptyIntegrity(),
      lastReplayStatus: "NOT_RUN",
      lastReplayDetail: null,
      updatedAt: now
    };
    this.journal.clear();
    return this.epoch;
  }

  /**
   * Synchronous market-event processing. Never awaits I/O.
   */
  processEvent(input: GhShadowEngineTickInput): void {
    const epoch = this.ensureEpoch(input.receiveSeq);
    epoch.integrity.eventsSeen += 1;

    // Sequence gap detection
    const last = epoch.integrity.lastProcessedReceiveSeq;
    if (last != null && input.receiveSeq > last + 1) {
      epoch.integrity.receiveSeqGaps += 1;
      if (this.open && this.open.trade.dataQuality === "FORMAL_ELIGIBLE") {
        this.excludeOpen("receive_seq_gap", input);
        return;
      }
      if (this.open) {
        this.excludeOpen("receive_seq_gap", input);
        return;
      }
      // No open trade: mark epoch integrity failure for formal gating
      epoch.dataIntegrityFailure = "receive_seq_gap";
      epoch.status = "DATA_QUALITY_FAILED";
    }

    const identity = getFrozenGhFastIdentity();
    const spread = Math.max(0, input.ask - input.bid);
    const eventId = `ev-${input.receiveSeq}-${randomBytes(3).toString("hex")}`;

    let openMarker: GhShadowCapturedEvent["openMarker"] = null;
    // Pre-compute open marker id if we will open (after journal append checks)
    const willAttemptOpen =
      input.newOpportunity &&
      input.opportunity != null &&
      this.open == null &&
      epoch.status === "ACTIVE";

    const tradeIdForOpen = willAttemptOpen
      ? `GH-S-${randomBytes(4).toString("hex")}`
      : null;

    if (willAttemptOpen && tradeIdForOpen && input.opportunity) {
      openMarker = {
        tradeId: tradeIdForOpen,
        opportunityId: input.opportunity.opportunityId,
        signalId: input.opportunity.signalId,
        setup: input.opportunity.setup,
        setupId: setupIdFromLetter(input.opportunity.setup),
        side: input.opportunity.side
      };
    }

    const captured: GhShadowCapturedEvent = {
      eventId,
      qualificationId: epoch.qualificationId,
      receiveSeq: input.receiveSeq,
      eventTs: new Date(input.eventTsMs).toISOString(),
      eventTsMs: input.eventTsMs,
      bid: input.bid,
      ask: input.ask,
      spread,
      features: input.features,
      dataOk: input.dataOk,
      depthValidity: input.depthValidity,
      bookGeneration: input.bookGeneration,
      resyncGeneration: input.resyncGeneration,
      newOpportunity: input.newOpportunity,
      openMarker,
      strategySha: identity.configSha256,
      configSha: identity.configSha256
    };

    if (!this.journal.tryAppend(captured)) {
      epoch.integrity.journalOverflowCount += 1;
      epoch.integrity.eventsDropped += 1;
      if (this.open) {
        this.excludeOpen("journal_overflow", input);
      } else {
        epoch.dataIntegrityFailure = "journal_overflow";
        epoch.status = "DATA_QUALITY_FAILED";
      }
      epoch.updatedAt = new Date().toISOString();
      return;
    }

    this.pendingEvents.push(captured);
    epoch.integrity.eventsProcessed += 1;
    epoch.integrity.lastProcessedReceiveSeq = input.receiveSeq;

    // Tick open position first
    if (this.open) {
      this.tickOpen(input);
    }

    // Open new shadow if marked
    if (openMarker && input.opportunity && this.open == null) {
      this.tryOpen(input, openMarker.tradeId, input.opportunity);
    }

    epoch.updatedAt = new Date().toISOString();
  }

  private tickOpen(input: GhShadowEngineTickInput): void {
    if (!this.open || !this.epoch) return;
    const cfg = frozenGhFastSoakConfig();
    const { trade, fast } = this.open;

    if (
      !isFinitePositive(input.bid) ||
      !isFinitePositive(input.ask) ||
      input.ask < input.bid
    ) {
      return;
    }

    const wasLocked = fast.profitLockActive;
    const prevFloor = fast.lockFloor;
    updateOpenTrade(fast, input.bid, input.ask, cfg);
    trade.mfe = fast.mfe;
    trade.mae = fast.mae;
    trade.maxFavorableBeforeExit = fast.mfe;
    trade.maxAdverseBeforeExit = fast.mae;
    trade.lockFloorLatest = fast.lockFloor;

    if (!wasLocked && fast.profitLockActive) {
      trade.profitLockActivatedAt = new Date(input.eventTsMs).toISOString();
      trade.trailActivatedAt = trade.profitLockActivatedAt;
      trade.lockFloorAtActivation = fast.lockFloor;
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

    this.pendingTrades.set(trade.tradeId, { ...trade });

    if (!input.features) return;

    const reason = evaluateOpenExit({
      trade: fast,
      f: input.features,
      cfg,
      dataOk: input.dataOk
    });
    if (!reason) return;

    this.closeOpen(input, reason);
  }

  private tryOpen(
    input: GhShadowEngineTickInput,
    tradeId: string,
    opp: GoldHunterSelectedCandidate
  ): void {
    if (!this.epoch || this.open) return;
    const identity = getFrozenGhFastIdentity();
    const cfg = frozenGhFastSoakConfig();
    const signalTs = opp.signalTimestamp || new Date(input.eventTsMs).toISOString();

    const marketOk =
      isFinitePositive(input.bid) &&
      isFinitePositive(input.ask) &&
      input.ask >= input.bid &&
      Number.isFinite(input.ask - input.bid) &&
      input.depthValidity === "DEPTH_VALID" &&
      input.dataOk;

    const entry = shadowEntryPrice(opp.side, input.bid, input.ask);
    const sizing = computeGhShadowEconomicExposure({
      config: input.config,
      entryPrice: entry,
      side: opp.side,
      ...input.sizingOverrides
    });

    if (!marketOk || !isFinitePositive(entry) || !sizing.ok) {
      const excluded = this.buildExcludedTrade({
        tradeId,
        opp,
        signalTs,
        entry,
        input,
        economic: sizing.ok ? sizing.economic : null,
        reason: !marketOk
          ? "invalid_market"
          : !isFinitePositive(entry)
            ? "entry_invalid"
            : sizing.ok
              ? "unknown"
              : sizing.blocker
      });
      this.pendingTrades.set(tradeId, excluded);
      this.epoch.diagnosticExcludedTrades += 1;
      this.pushDecision({
        kind: "EXCLUDE",
        tradeId,
        opportunityId: opp.opportunityId,
        setup: opp.setup,
        side: opp.side,
        receiveSeq: input.receiveSeq,
        bid: input.bid,
        ask: input.ask,
        detail: excluded.exclusionReason,
        exitReason: "INVALID_MARKET"
      });
      return;
    }

    const economic = sizing.economic;
    const entryTs = new Date(input.eventTsMs).toISOString();
    const initialStop = shadowInitialStop(opp.side, entry, cfg.hardStop);
    const fast = openTrade({
      tradeId,
      side: opp.side,
      setup: setupIdFromLetter(opp.setup),
      entryTs: input.eventTsMs,
      bid: input.bid,
      ask: input.ask,
      trailDistance: cfg.trailDistance
    });

    const trade: GhShadowTrade = {
      tradeId,
      qualificationId: this.epoch.qualificationId,
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
      entryBid: input.bid,
      entryAsk: input.ask,
      entryPrice: entry,
      entrySpread: Math.max(0, input.ask - input.bid),
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
      simulatedGrossPnlQuote: null,
      simulatedFrictionPnlQuote: null,
      simulatedNetPnlQuote: null,
      quoteCurrency: economic.quoteCurrency,
      simulatedGrossPnlEur: null,
      simulatedFrictionEur: null,
      simulatedNetPnlEur: null,
      eurPnlAvailable: economic.eurPnlAvailable,
      economic,
      profitLockActivatedAt: null,
      trailActivatedAt: null,
      trailUpdateCount: 0,
      lockFloorAtActivation: null,
      lockFloorLatest: null,
      maxFavorableBeforeExit: 0,
      maxAdverseBeforeExit: 0,
      strategySha: identity.configSha256,
      configSha: identity.configSha256,
      receiveSeqAtEntry: input.receiveSeq,
      receiveSeqAtExit: null,
      bookGeneration: input.bookGeneration,
      resyncGeneration: input.resyncGeneration,
      runtimeGeneration: this.runtimeGeneration,
      path: {
        profitLockActivateMfeAtActivation: null,
        lockFloorAtActivation: null,
        lockFloorAtExit: null,
        bestExitAtExit: null
      }
    };

    this.open = { trade, fast };
    this.epoch.openShadowTradeId = tradeId;
    this.pendingTrades.set(tradeId, trade);
    this.pushDecision({
      kind: "OPEN",
      tradeId,
      opportunityId: opp.opportunityId,
      setup: opp.setup,
      side: opp.side,
      receiveSeq: input.receiveSeq,
      bid: input.bid,
      ask: input.ask,
      detail: `lots_${economic.displayedLots}_oz_${economic.economicXauOz}`,
      exitReason: null
    });
  }

  private closeOpen(
    input: GhShadowEngineTickInput,
    reason: NonNullable<ReturnType<typeof evaluateOpenExit>>
  ): void {
    if (!this.open || !this.epoch) return;
    const { trade, fast } = this.open;
    const exitPrice = shadowExitPrice(trade.side, input.bid, input.ask);
    const exitTs = new Date(input.eventTsMs).toISOString();
    const entryTsMs = trade.entryTs ? Date.parse(trade.entryTs) : input.eventTsMs;
    const pnl = simulateGhShadowCashPnl({
      side: trade.side,
      entryPrice: trade.entryPrice!,
      exitPrice,
      economic: trade.economic!
    });

    trade.status = "CLOSED";
    trade.exitTs = exitTs;
    trade.exitBid = input.bid;
    trade.exitAsk = input.ask;
    trade.exitPrice = exitPrice;
    trade.exitReason = reason;
    trade.durationMs = Math.max(0, input.eventTsMs - entryTsMs);
    trade.grossPriceMove = pnl.signedPriceMove;
    trade.frictionPrice = pnl.frictionPrice;
    trade.netPriceMove = pnl.netPriceMove;
    trade.simulatedGrossPnlQuote = pnl.grossQuote;
    trade.simulatedFrictionPnlQuote = pnl.frictionQuote;
    trade.simulatedNetPnlQuote = pnl.netQuote;
    trade.quoteCurrency = pnl.quoteCurrency;
    trade.simulatedGrossPnlEur = pnl.simulatedGrossPnlEur;
    trade.simulatedFrictionEur = pnl.simulatedFrictionEur;
    trade.simulatedNetPnlEur = pnl.simulatedNetPnlEur;
    trade.eurPnlAvailable = pnl.eurPnlAvailable;
    trade.mfe = fast.mfe;
    trade.mae = fast.mae;
    trade.maxFavorableBeforeExit = fast.mfe;
    trade.maxAdverseBeforeExit = fast.mae;
    trade.receiveSeqAtExit = input.receiveSeq;
    trade.path.lockFloorAtExit = fast.lockFloor;
    trade.path.bestExitAtExit = fast.bestExit;
    trade.lockFloorLatest = fast.lockFloor;

    this.open = null;
    this.epoch.openShadowTradeId = null;
    if (trade.dataQuality === "FORMAL_ELIGIBLE") {
      this.epoch.formalQualificationTrades += 1;
    } else {
      this.epoch.diagnosticExcludedTrades += 1;
    }
    this.pendingTrades.set(trade.tradeId, { ...trade });
    this.pushDecision({
      kind: "EXIT",
      tradeId: trade.tradeId,
      opportunityId: trade.opportunityId,
      setup: trade.setup,
      side: trade.side,
      receiveSeq: input.receiveSeq,
      bid: input.bid,
      ask: input.ask,
      detail: `netQuote_${pnl.netQuote.toFixed(4)}_eur_${pnl.simulatedNetPnlEur ?? "NA"}`,
      exitReason: reason
    });
  }

  private excludeOpen(reason: string, input: GhShadowEngineTickInput): void {
    if (!this.open || !this.epoch) return;
    const trade = this.open.trade;
    trade.status = "DIAGNOSTIC_EXCLUDED";
    trade.dataQuality = "DIAGNOSTIC_EXCLUDED";
    trade.exclusionReason = reason;
    trade.exitTs = new Date(input.eventTsMs).toISOString();
    trade.exitBid = input.bid;
    trade.exitAsk = input.ask;
    trade.exitReason = "INVALID_MARKET";
    this.open = null;
    this.epoch.openShadowTradeId = null;
    this.epoch.diagnosticExcludedTrades += 1;
    if (reason === "journal_overflow" || reason === "receive_seq_gap") {
      this.epoch.dataIntegrityFailure = reason;
      this.epoch.status = "DATA_QUALITY_FAILED";
    }
    this.pendingTrades.set(trade.tradeId, { ...trade });
    this.pushDecision({
      kind: "EXCLUDE",
      tradeId: trade.tradeId,
      receiveSeq: input.receiveSeq,
      bid: input.bid,
      ask: input.ask,
      detail: reason,
      exitReason: "INVALID_MARKET"
    });
  }

  private buildExcludedTrade(args: {
    tradeId: string;
    opp: GoldHunterSelectedCandidate;
    signalTs: string;
    entry: number;
    input: GhShadowEngineTickInput;
    economic: GhShadowEconomicExposure | null;
    reason: string;
  }): GhShadowTrade {
    const identity = getFrozenGhFastIdentity();
    return {
      tradeId: args.tradeId,
      qualificationId: this.epoch!.qualificationId,
      opportunityId: args.opp.opportunityId,
      signalId: args.opp.signalId,
      setup: args.opp.setup,
      setupId: setupIdFromLetter(args.opp.setup),
      side: args.opp.side,
      status: "DIAGNOSTIC_EXCLUDED",
      dataQuality: "DIAGNOSTIC_EXCLUDED",
      exclusionReason: args.reason,
      signalTs: args.signalTs,
      entryTs: null,
      entryBid: args.input.bid,
      entryAsk: args.input.ask,
      entryPrice: isFinitePositive(args.entry) ? args.entry : null,
      entrySpread: Math.max(0, args.input.ask - args.input.bid),
      initialStop: null,
      exitTs: new Date(args.input.eventTsMs).toISOString(),
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
      simulatedGrossPnlQuote: null,
      simulatedFrictionPnlQuote: null,
      simulatedNetPnlQuote: null,
      quoteCurrency: args.economic?.quoteCurrency ?? null,
      simulatedGrossPnlEur: null,
      simulatedFrictionEur: null,
      simulatedNetPnlEur: null,
      eurPnlAvailable: false,
      economic: args.economic,
      profitLockActivatedAt: null,
      trailActivatedAt: null,
      trailUpdateCount: 0,
      lockFloorAtActivation: null,
      lockFloorLatest: null,
      maxFavorableBeforeExit: null,
      maxAdverseBeforeExit: null,
      strategySha: identity.configSha256,
      configSha: identity.configSha256,
      receiveSeqAtEntry: args.input.receiveSeq,
      receiveSeqAtExit: args.input.receiveSeq,
      bookGeneration: args.input.bookGeneration,
      resyncGeneration: args.input.resyncGeneration,
      runtimeGeneration: this.runtimeGeneration,
      path: {
        profitLockActivateMfeAtActivation: null,
        lockFloorAtActivation: null,
        lockFloorAtExit: null,
        bestExitAtExit: null
      }
    };
  }

  private pushDecision( partial: {
    kind: GhShadowDecisionRecord["kind"];
    tradeId?: string | null;
    opportunityId?: string | null;
    setup?: GhShadowTrade["setup"] | null;
    side?: "BUY" | "SELL" | null;
    receiveSeq: number;
    bid: number;
    ask: number;
    detail: string | null;
    exitReason: GhShadowDecisionRecord["exitReason"];
  }): void {
    if (!this.epoch) return;
    this.pendingDecisions.push({
      decisionId: `dec-${randomBytes(4).toString("hex")}`,
      qualificationId: this.epoch.qualificationId,
      at: new Date().toISOString(),
      kind: partial.kind,
      opportunityId: partial.opportunityId ?? null,
      tradeId: partial.tradeId ?? null,
      setup: partial.setup ?? null,
      side: partial.side ?? null,
      bid: partial.bid,
      ask: partial.ask,
      receiveSeq: partial.receiveSeq,
      exitReason: partial.exitReason,
      detail: partial.detail
    });
  }

  /** Drain pending persistence batch (caller writes async). */
  drainPersistBatch(): GhShadowPersistBatch | null {
    if (!this.epoch) return null;
    const batch: GhShadowPersistBatch = {
      epoch: { ...this.epoch },
      trades: [...this.pendingTrades.values()].map((t) => ({ ...t })),
      events: this.pendingEvents.splice(0, this.pendingEvents.length),
      decisions: this.pendingDecisions.splice(0, this.pendingDecisions.length)
    };
    this.pendingTrades.clear();
    // Count events as persisted when drained (actual write may be mocked in tests)
    this.epoch.integrity.eventsPersisted += batch.events.length;
    batch.epoch = { ...this.epoch };
    return batch;
  }

  /** Test helper: seed epoch without recovery. */
  seedEpochForTests(epoch: GhShadowQualificationEpoch): void {
    this.epoch = epoch;
    this.recovered = true;
  }
}

const engines = new Map<string, GhShadowQualificationEngine>();

export function getGhShadowEngine(
  ownerUid: string,
  opts?: { journalCapacity?: number; runtimeGeneration?: number; forceNew?: boolean }
): GhShadowQualificationEngine {
  if (opts?.forceNew) {
    const eng = new GhShadowQualificationEngine({
      ownerUid,
      journalCapacity: opts.journalCapacity,
      runtimeGeneration: opts.runtimeGeneration
    });
    engines.set(ownerUid, eng);
    return eng;
  }
  let eng = engines.get(ownerUid);
  if (!eng) {
    eng = new GhShadowQualificationEngine({
      ownerUid,
      journalCapacity: opts?.journalCapacity,
      runtimeGeneration: opts?.runtimeGeneration
    });
    engines.set(ownerUid, eng);
  }
  return eng;
}

export function resetGhShadowEnginesForTests(): void {
  engines.clear();
}
