/**
 * Shadow hot-path engine — synchronous state updates (no Firestore on critical path).
 *
 * MARKET EVENT → in-memory evaluate (MFE/MAE/lock/trail/exit) → journal append
 * (formal trade path only) → async persist separately.
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
  simulateGhShadowCashPnl
} from "./economics";
import { GhShadowEventJournal } from "./journal";
import type {
  GhShadowActivityCounters,
  GhShadowCapturedEvent,
  GhShadowDecisionRecord,
  GhShadowEconomicExposure,
  GhShadowFrozenSizingSnapshot,
  GhShadowIntegrityCounters,
  GhShadowLatencySensitivity,
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

type PendingLatencyCapture = {
  tradeId: string;
  side: "BUY" | "SELL";
  entryPrice: number;
  economic: GhShadowEconomicExposure;
  signalExitPrice: number;
  signalTsMs: number;
  signalReceiveSeq: number;
  signalTickPnlQuote: number;
  nextEventPrice: number | null;
  nextEventReceiveSeq: number | null;
  priceAt100ms: number | null;
  priceAt250ms: number | null;
  priceAt500ms: number | null;
  saw100: boolean;
  saw250: boolean;
  saw500: boolean;
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
  frozenSizing: GhShadowFrozenSizingSnapshot;
  allowFormal: boolean;
};

const ACTIVE_MARKET_GAP_CLAMP_MS = 5 * 60 * 1000;
const LATENCY_WINDOW_MS = 500;

function setupIdFromLetter(letter: "A" | "B" | "C"): GhFastSetupId {
  if (letter === "A") return "A_MOMENTUM_IGNITION";
  if (letter === "B") return "B_FAST_BREAKOUT";
  return "C_PULLBACK_REACCEL";
}

function isFinitePositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function isDepthValid(depthValidity: string): boolean {
  return depthValidity === "DEPTH_VALID";
}

function emptyIntegrity(): GhShadowIntegrityCounters {
  return {
    eventsSeen: 0,
    eventsProcessed: 0,
    eventsPersisted: 0,
    eventsDropped: 0,
    receiveSeqGaps: 0,
    receiveSeqDuplicates: 0,
    receiveSeqOutOfOrder: 0,
    journalOverflowCount: 0,
    journalPending: 0,
    journalHighWaterMark: 0,
    persistAcknowledgedEvents: 0,
    persistFailures: 0,
    lastProcessedReceiveSeq: null,
    lastResyncGeneration: null
  };
}

function emptyActivity(): GhShadowActivityCounters {
  return {
    newOpportunitiesDetected: 0,
    formalTradesOpened: 0,
    formalTradesClosed: 0,
    opportunitiesWhileAlreadyOpen: 0,
    opportunitiesExcludedDataQuality: 0,
    opportunitiesRejectedSizing: 0,
    opportunitiesWarmupIgnored: 0,
    otherRejectionReasons: {},
    activeMarketMs: 0,
    entryTimestampsMs: [],
    openTradeDurationsMs: [],
    flatIdleSegmentsMs: [],
    lastActiveMarketAtMs: null,
    lastEntryAtMs: null,
    lastFlatStartMs: null,
    bySetupOpened: { A: 0, B: 0, C: 0 }
  };
}

export class GhShadowQualificationEngine {
  readonly ownerUid: string;
  private epoch: GhShadowQualificationEpoch | null = null;
  private open: OpenState | null = null;
  private readonly journal: GhShadowEventJournal;
  private readonly pendingTrades = new Map<string, GhShadowTrade>();
  private readonly pendingDecisions: GhShadowDecisionRecord[] = [];
  private readonly inFlightEventIds = new Set<string>();
  private runtimeGeneration: number;
  private pendingLatency: PendingLatencyCapture | null = null;
  /** Warmup counters before first formal-capable epoch exists. */
  private preEpochWarmupIgnored = 0;

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

  getJournal(): GhShadowEventJournal {
    return this.journal;
  }

  /** @deprecated Prefer getJournal().list() */
  getJournalEvents(): readonly GhShadowCapturedEvent[] {
    return this.journal.list();
  }

  getRuntimeGeneration(): number {
    return this.runtimeGeneration;
  }

  /**
   * Fail-safe restart recovery: exclude interrupted open using persisted trade when available.
   */
  recoverAfterRestart(args: {
    persistedEpoch: GhShadowQualificationEpoch | null;
    persistedOpenTrade: GhShadowTrade | null;
    reason?: string;
  }): { excludedTradeId: string | null } {
    if (!args.persistedEpoch) {
      this.epoch = null;
      this.open = null;
      this.pendingLatency = null;
      return { excludedTradeId: null };
    }

    this.epoch = { ...args.persistedEpoch };
    this.epoch.runtimeGeneration = this.runtimeGeneration;
    this.epoch.lastRestartReason =
      args.reason ?? "process_restart_state_lost";
    this.epoch.updatedAt = new Date().toISOString();
    this.syncJournalStats();

    const openId = this.epoch.openShadowTradeId;
    if (!openId) {
      this.open = null;
      return { excludedTradeId: null };
    }

    const persisted = args.persistedOpenTrade;
    if (!persisted || persisted.tradeId !== openId) {
      this.epoch.dataIntegrityFailure = "restart_trade_load_failed";
      this.epoch.status = "DATA_QUALITY_FAILED";
      this.epoch.openShadowTradeId = null;
      this.epoch.integrity = {
        ...this.epoch.integrity,
        lastProcessedReceiveSeq: null
      };
      this.open = null;
      this.pushDecision({
        kind: "INTEGRITY",
        tradeId: openId,
        receiveSeq: this.epoch.integrity.lastProcessedReceiveSeq ?? 0,
        bid: 0,
        ask: 0,
        detail: "restart_trade_load_failed",
        exitReason: null
      });
      return { excludedTradeId: null };
    }

    const now = new Date().toISOString();
    const excluded: GhShadowTrade = {
      ...persisted,
      status: "DIAGNOSTIC_EXCLUDED",
      dataQuality: "DIAGNOSTIC_EXCLUDED",
      exclusionReason: "runtime_restart_state_lost",
      exitTs: now
    };
    this.pendingTrades.set(excluded.tradeId, excluded);
    this.epoch.openShadowTradeId = null;
    this.epoch.diagnosticExcludedTrades += 1;
    this.epoch.integrity = {
      ...this.epoch.integrity,
      lastProcessedReceiveSeq: null
    };

    const onlyOpenIssue =
      this.epoch.dataIntegrityFailure === "open_trade_restart" ||
      this.epoch.dataIntegrityFailure === "restart_trade_load_failed" ||
      this.epoch.dataIntegrityFailure == null;
    if (onlyOpenIssue) {
      this.epoch.dataIntegrityFailure = null;
      if (this.epoch.status === "DATA_QUALITY_FAILED") {
        this.epoch.status = "ACTIVE";
      }
    }

    this.open = null;
    this.pendingLatency = null;
    this.pushDecision({
      kind: "EXCLUDE",
      tradeId: excluded.tradeId,
      opportunityId: excluded.opportunityId,
      setup: excluded.setup,
      side: excluded.side,
      receiveSeq: excluded.receiveSeqAtEntry ?? 0,
      bid: excluded.entryBid ?? 0,
      ask: excluded.entryAsk ?? 0,
      detail: "runtime_restart_state_lost",
      exitReason: "INVALID_MARKET"
    });
    this.epoch.updatedAt = now;
    return { excludedTradeId: excluded.tradeId };
  }

  ensureEpoch(
    receiveSeq: number,
    frozenSizing: GhShadowFrozenSizingSnapshot
  ): GhShadowQualificationEpoch {
    if (this.epoch && this.epoch.status !== "COMPLETED") {
      return this.epoch;
    }
    const identity = getFrozenGhFastIdentity();
    const now = new Date().toISOString();
    const activity = emptyActivity();
    if (this.preEpochWarmupIgnored > 0) {
      activity.opportunitiesWarmupIgnored = this.preEpochWarmupIgnored;
      this.preEpochWarmupIgnored = 0;
    }
    this.epoch = {
      qualificationId: `GH-SQ-${randomBytes(4).toString("hex")}`,
      qualificationStartTime: now,
      qualificationStartSequence: receiveSeq,
      strategySha: identity.configSha256,
      configSha: identity.configSha256,
      strategyVersion: identity.strategyVersion,
      engineVersion: identity.engineVersion,
      soakLabel: identity.soakLabel,
      frozenSizing,
      formalQualificationTrades: 0,
      diagnosticExcludedTrades: 0,
      openShadowTradeId: null,
      status: "ACTIVE",
      dataIntegrityFailure: null,
      persistFailureReason: null,
      runtimeGeneration: this.runtimeGeneration,
      lastRestartReason: null,
      integrity: emptyIntegrity(),
      activity,
      lastReplayStatus: "NOT_RUN",
      lastReplayDetail: null,
      updatedAt: now
    };
    this.journal.clear();
    this.syncJournalStats();
    return this.epoch;
  }

  /**
   * Synchronous market-event processing. Never awaits I/O.
   */
  processEvent(input: GhShadowEngineTickInput): void {
    if (!input.allowFormal) {
      this.processWarmupEvent(input);
      return;
    }

    const epoch = this.ensureEpoch(input.receiveSeq, input.frozenSizing);
    epoch.integrity.eventsSeen += 1;

    if (this.checkSequenceIntegrity(input)) {
      epoch.updatedAt = new Date().toISOString();
      return;
    }

    this.accumulateActiveMarketMs(input);
    this.advanceLatencyCapture(input);

    const identity = getFrozenGhFastIdentity();
    const spread = Math.max(0, input.ask - input.bid);
    const inFormalPath = this.open != null;

    let openMarker: GhShadowCapturedEvent["openMarker"] = null;
    let tradeIdForOpen: string | null = null;
    const willAttemptOpen =
      input.newOpportunity &&
      input.opportunity != null &&
      this.open == null &&
      epoch.status === "ACTIVE";

    if (willAttemptOpen && input.opportunity) {
      tradeIdForOpen = `GH-S-${randomBytes(4).toString("hex")}`;
      openMarker = {
        tradeId: tradeIdForOpen,
        opportunityId: input.opportunity.opportunityId,
        signalId: input.opportunity.signalId,
        setup: input.opportunity.setup,
        setupId: setupIdFromLetter(input.opportunity.setup),
        side: input.opportunity.side
      };
    }

    const shouldJournal = inFormalPath || openMarker != null;

    if (shouldJournal) {
      const captured = this.buildCapturedEvent({
        input,
        spread,
        identity,
        inFormalTradePath: true,
        openMarker
      });
      if (!this.journal.tryAppend(captured)) {
        this.onJournalAppendFailure(input, "journal_overflow");
        epoch.updatedAt = new Date().toISOString();
        return;
      }
      this.syncJournalStats();
    }

    epoch.integrity.eventsProcessed += 1;
    epoch.integrity.lastProcessedReceiveSeq = input.receiveSeq;
    epoch.integrity.lastResyncGeneration = input.resyncGeneration;

    if (this.open) {
      this.tickOpen(input);
    }

    if (input.newOpportunity) {
      epoch.activity.newOpportunitiesDetected += 1;
      if (this.open) {
        epoch.activity.opportunitiesWhileAlreadyOpen += 1;
      } else if (openMarker && tradeIdForOpen && input.opportunity) {
        this.tryOpen(input, tradeIdForOpen, input.opportunity);
      }
    }

    epoch.updatedAt = new Date().toISOString();
  }

  private processWarmupEvent(input: GhShadowEngineTickInput): void {
    if (input.newOpportunity) {
      this.preEpochWarmupIgnored += 1;
      if (this.epoch) {
        this.epoch.activity.opportunitiesWarmupIgnored += 1;
      }
      this.pushDecision({
        kind: "WARMUP",
        opportunityId: input.opportunity?.opportunityId ?? null,
        setup: input.opportunity?.setup ?? null,
        side: input.opportunity?.side ?? null,
        receiveSeq: input.receiveSeq,
        bid: input.bid,
        ask: input.ask,
        detail: "WARMUP_NOT_QUALIFICATION",
        exitReason: null
      });
    }
  }

  private checkSequenceIntegrity(input: GhShadowEngineTickInput): boolean {
    if (!this.epoch) return false;
    const formalContext = this.open != null || input.allowFormal;
    if (!formalContext) return false;

    const last = this.epoch.integrity.lastProcessedReceiveSeq;
    let failed = false;
    let reason: string | null = null;

    if (last != null) {
      if (input.receiveSeq === last) {
        this.epoch.integrity.receiveSeqDuplicates += 1;
        failed = true;
        reason = "receive_seq_duplicate";
      } else if (input.receiveSeq < last) {
        this.epoch.integrity.receiveSeqOutOfOrder += 1;
        failed = true;
        reason = "receive_seq_out_of_order";
      } else if (input.receiveSeq > last + 1) {
        this.epoch.integrity.receiveSeqGaps += 1;
        failed = true;
        reason = "receive_seq_gap";
      }
    }

    if (
      !failed &&
      this.open &&
      this.open.trade.dataQuality === "FORMAL_ELIGIBLE" &&
      this.epoch.integrity.lastResyncGeneration != null &&
      input.resyncGeneration !== this.epoch.integrity.lastResyncGeneration
    ) {
      failed = true;
      reason = "resync_generation_change";
    }

    if (!failed) return false;

    if (this.open) {
      this.excludeOpen(reason!, input);
    } else {
      this.epoch.dataIntegrityFailure = reason;
      this.epoch.status = "DATA_QUALITY_FAILED";
      this.epoch.activity.opportunitiesExcludedDataQuality += 1;
      this.pushDecision({
        kind: "INTEGRITY",
        receiveSeq: input.receiveSeq,
        bid: input.bid,
        ask: input.ask,
        detail: reason,
        exitReason: null
      });
    }
    return true;
  }

  private accumulateActiveMarketMs(input: GhShadowEngineTickInput): void {
    if (!this.epoch) return;
    const active =
      input.dataOk && isDepthValid(input.depthValidity);
    const act = this.epoch.activity;
    if (!active) {
      act.lastActiveMarketAtMs = null;
      return;
    }
    if (act.lastActiveMarketAtMs != null) {
      const delta = input.eventTsMs - act.lastActiveMarketAtMs;
      if (delta > 0 && delta <= ACTIVE_MARKET_GAP_CLAMP_MS) {
        act.activeMarketMs += delta;
      }
    }
    act.lastActiveMarketAtMs = input.eventTsMs;
  }

  private buildCapturedEvent(args: {
    input: GhShadowEngineTickInput;
    spread: number;
    identity: ReturnType<typeof getFrozenGhFastIdentity>;
    inFormalTradePath: boolean;
    openMarker: GhShadowCapturedEvent["openMarker"];
  }): GhShadowCapturedEvent {
    const { input, spread, identity, inFormalTradePath, openMarker } = args;
    return {
      eventId: `ev-${input.receiveSeq}-${randomBytes(3).toString("hex")}`,
      qualificationId: this.epoch!.qualificationId,
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
      inFormalTradePath,
      openMarker,
      strategySha: identity.configSha256,
      configSha: identity.configSha256
    };
  }

  private onJournalAppendFailure(
    input: GhShadowEngineTickInput,
    reason: string
  ): void {
    if (!this.epoch) return;
    this.epoch.integrity.journalOverflowCount += 1;
    this.epoch.integrity.eventsDropped += 1;
    this.syncJournalStats();
    if (this.open) {
      this.excludeOpen(reason, input);
    } else {
      this.epoch.dataIntegrityFailure = reason;
      this.epoch.status = "DATA_QUALITY_FAILED";
      this.epoch.activity.opportunitiesExcludedDataQuality += 1;
    }
  }

  private syncJournalStats(): void {
    if (!this.epoch) return;
    const s = this.journal.stats();
    this.epoch.integrity.journalPending = s.journalPending;
    this.epoch.integrity.journalHighWaterMark = s.journalHighWaterMark;
    this.epoch.integrity.journalOverflowCount = s.overflowCount;
    this.epoch.integrity.persistAcknowledgedEvents = s.persistAcknowledgedEvents;
    this.epoch.integrity.eventsPersisted = s.persistAcknowledgedEvents;
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
    this.finalizePendingLatencyIfAny("superseded_by_new_open");

    const identity = getFrozenGhFastIdentity();
    const cfg = frozenGhFastSoakConfig();
    const signalTs =
      opp.signalTimestamp || new Date(input.eventTsMs).toISOString();

    const marketOk =
      isFinitePositive(input.bid) &&
      isFinitePositive(input.ask) &&
      input.ask >= input.bid &&
      Number.isFinite(input.ask - input.bid) &&
      isDepthValid(input.depthValidity) &&
      input.dataOk;

    const entry = shadowEntryPrice(opp.side, input.bid, input.ask);
    const sizing = computeGhShadowEconomicExposure({
      config: input.config,
      entryPrice: entry,
      side: opp.side,
      frozenSizing: input.frozenSizing
    });

    if (!marketOk || !isFinitePositive(entry) || !sizing.ok) {
      if (!sizing.ok) {
        this.epoch.activity.opportunitiesRejectedSizing += 1;
        this.bumpOtherRejection(sizing.blocker);
      } else {
        this.epoch.activity.opportunitiesExcludedDataQuality += 1;
      }
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

    const act = this.epoch.activity;
    if (act.lastFlatStartMs != null) {
      const idle = Math.max(0, input.eventTsMs - act.lastFlatStartMs);
      act.flatIdleSegmentsMs.push(idle);
      act.lastFlatStartMs = null;
    }
    act.lastEntryAtMs = input.eventTsMs;
    act.entryTimestampsMs.push(input.eventTsMs);
    act.formalTradesOpened += 1;
    act.bySetupOpened[opp.setup] += 1;

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
      netR: null,
      simulatedGrossPnlEur: null,
      simulatedFrictionEur: null,
      simulatedNetPnlEur: null,
      eurPnlAvailable: economic.eurPnlAvailable,
      economic,
      latency: null,
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
    trade.netR = pnl.netR;
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
      this.epoch.activity.formalTradesClosed += 1;
      const duration = trade.durationMs ?? 0;
      this.epoch.activity.openTradeDurationsMs.push(duration);
      this.epoch.activity.lastFlatStartMs = input.eventTsMs;
    } else {
      this.epoch.diagnosticExcludedTrades += 1;
    }

    this.pendingTrades.set(trade.tradeId, { ...trade });
    this.startLatencyCapture(trade, input, exitPrice, pnl.netQuote);
    this.pushDecision({
      kind: "EXIT",
      tradeId: trade.tradeId,
      opportunityId: trade.opportunityId,
      setup: trade.setup,
      side: trade.side,
      receiveSeq: input.receiveSeq,
      bid: input.bid,
      ask: input.ask,
      detail: `netQuote_${pnl.netQuote.toFixed(4)}_netR_${pnl.netR ?? "NA"}_eur_${pnl.simulatedNetPnlEur ?? "NA"}`,
      exitReason: reason
    });
  }

  private startLatencyCapture(
    trade: GhShadowTrade,
    input: GhShadowEngineTickInput,
    signalExitPrice: number,
    signalTickPnlQuote: number
  ): void {
    this.pendingLatency = {
      tradeId: trade.tradeId,
      side: trade.side,
      entryPrice: trade.entryPrice!,
      economic: trade.economic!,
      signalExitPrice,
      signalTsMs: input.eventTsMs,
      signalReceiveSeq: input.receiveSeq,
      signalTickPnlQuote,
      nextEventPrice: null,
      nextEventReceiveSeq: null,
      priceAt100ms: null,
      priceAt250ms: null,
      priceAt500ms: null,
      saw100: false,
      saw250: false,
      saw500: false
    };
  }

  private advanceLatencyCapture(input: GhShadowEngineTickInput): void {
    const cap = this.pendingLatency;
    if (!cap) return;

    const exec = shadowExitPrice(cap.side, input.bid, input.ask);
    const elapsed = input.eventTsMs - cap.signalTsMs;

    if (cap.nextEventPrice == null && input.receiveSeq > cap.signalReceiveSeq) {
      cap.nextEventPrice = exec;
      cap.nextEventReceiveSeq = input.receiveSeq;
    }

    if (!cap.saw100 && elapsed >= 100) {
      cap.priceAt100ms = exec;
      cap.saw100 = true;
    }
    if (!cap.saw250 && elapsed >= 250) {
      cap.priceAt250ms = exec;
      cap.saw250 = true;
    }
    if (!cap.saw500 && elapsed >= 500) {
      cap.priceAt500ms = exec;
      cap.saw500 = true;
    }

    if (elapsed >= LATENCY_WINDOW_MS) {
      this.finalizePendingLatencyIfAny("window_complete");
    }
  }

  private finalizePendingLatencyIfAny(_reason: string): void {
    const cap = this.pendingLatency;
    if (!cap) return;

    const trade = this.pendingTrades.get(cap.tradeId);
    if (trade) {
      trade.latency = this.buildLatencySensitivity(cap);
      this.pendingTrades.set(cap.tradeId, { ...trade });
    }
    this.pendingLatency = null;
  }

  private buildLatencySensitivity(
    cap: PendingLatencyCapture
  ): GhShadowLatencySensitivity {
    const pnlAt = (price: number | null): number | null => {
      if (price == null) return null;
      return simulateGhShadowCashPnl({
        side: cap.side,
        entryPrice: cap.entryPrice,
        exitPrice: price,
        economic: cap.economic
      }).netQuote;
    };
    return {
      signalExitPrice: cap.signalExitPrice,
      nextEventPrice: cap.nextEventPrice,
      nextEventReceiveSeq: cap.nextEventReceiveSeq,
      priceAt100ms: cap.priceAt100ms,
      priceAt250ms: cap.priceAt250ms,
      priceAt500ms: cap.priceAt500ms,
      signalTickPnlQuote: cap.signalTickPnlQuote,
      nextEventPnlQuote: pnlAt(cap.nextEventPrice),
      pnl100msQuote: pnlAt(cap.priceAt100ms),
      pnl250msQuote: pnlAt(cap.priceAt250ms),
      pnl500msQuote: pnlAt(cap.priceAt500ms)
    };
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
    this.epoch.activity.opportunitiesExcludedDataQuality += 1;
    if (
      reason === "journal_overflow" ||
      reason === "receive_seq_gap" ||
      reason === "receive_seq_duplicate" ||
      reason === "receive_seq_out_of_order" ||
      reason === "resync_generation_change"
    ) {
      this.epoch.dataIntegrityFailure = reason;
      this.epoch.status = "DATA_QUALITY_FAILED";
    }
    this.pendingTrades.set(trade.tradeId, { ...trade });
    this.finalizePendingLatencyIfAny("open_excluded");
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
      netR: null,
      simulatedGrossPnlEur: null,
      simulatedFrictionEur: null,
      simulatedNetPnlEur: null,
      eurPnlAvailable: false,
      economic: args.economic,
      latency: null,
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

  private bumpOtherRejection(reason: string): void {
    if (!this.epoch) return;
    const map = this.epoch.activity.otherRejectionReasons;
    map[reason] = (map[reason] ?? 0) + 1;
  }

  private pushDecision(partial: {
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

  /** Drain pending persistence batch (caller writes async). Does not ACK journal. */
  drainPersistBatch(): GhShadowPersistBatch | null {
    if (!this.epoch) return null;
    const events = this.journal
      .snapshotPending()
      .filter((e) => !this.inFlightEventIds.has(e.eventId));
    for (const e of events) {
      this.inFlightEventIds.add(e.eventId);
    }
    const batch: GhShadowPersistBatch = {
      epoch: { ...this.epoch },
      trades: [...this.pendingTrades.values()].map((t) => ({ ...t })),
      events,
      decisions: this.pendingDecisions.splice(0, this.pendingDecisions.length)
    };
    this.pendingTrades.clear();
    this.syncJournalStats();
    batch.epoch = { ...this.epoch };
    return batch;
  }

  acknowledgePersist(eventIds: string[]): void {
    if (!this.epoch) return;
    this.journal.acknowledge(eventIds);
    for (const id of eventIds) {
      this.inFlightEventIds.delete(id);
    }
    this.syncJournalStats();
  }

  requeuePersistFailure(): void {
    if (!this.epoch) return;
    this.epoch.integrity.persistFailures += 1;
    this.inFlightEventIds.clear();
    this.syncJournalStats();
  }

  /** Test helper: seed epoch without recovery. */
  seedEpochForTests(epoch: GhShadowQualificationEpoch): void {
    this.epoch = epoch;
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
