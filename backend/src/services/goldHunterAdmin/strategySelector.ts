/**
 * GoldHunterStrategySelector — production A/B/C selector.
 * Consumes real GH-normalized Spot + Depth events. Not Fast AutoTrade.
 *
 * Separates sticky display candidates from NEW executable opportunities.
 * Opportunity identity is stable across a continuous selected setup;
 * receiveSeq remains forensic event identity only.
 */
import { createHash } from "node:crypto";
import {
  GH_FAST_MARKET_DATA_NORMALIZATION_VERSION,
  GOLD_HUNTER_BRAIN_VERSION,
  GOLD_HUNTER_FAST_STRATEGY_VERSION,
  GOLD_HUNTER_SMART_LOSS_CONTROLLER_VERSION,
  GOLD_HUNTER_SMART_POSITION_MANAGER_VERSION,
  type GhFastDepthEvent,
  type ResearchDepthValidity
} from "./abc";
import { GoldHunterFeaturePipeline } from "./abc/featurePipeline";
import type { GhBreakoutDiagnostics } from "./abc/setups";
import { GH_ADMIN_STRATEGY_ID } from "./types";

export type GoldHunterSetupLetter = "A" | "B" | "C";

export type GoldHunterSelectedCandidate = {
  strategy: typeof GH_ADMIN_STRATEGY_ID;
  setup: GoldHunterSetupLetter;
  setupId: string;
  side: "BUY" | "SELL";
  quality: number;
  /** Durable execution opportunity id — claim key. Stable across Depth bursts. */
  signalId: string;
  opportunityId: string;
  signalTimestamp: string;
  /** Forensic event identity at opportunity start (not a new opp per tick). */
  receiveSeq: number;
  /** Latest market event sequence observed while this opportunity is active. */
  latestReceiveSeq: number;
  bookGeneration: number;
  resyncGeneration: number;
  bid: number;
  ask: number;
  spread: number;
  depthValidity: ResearchDepthValidity;
  depthExecutable: boolean;
  normalizationVersion: typeof GH_FAST_MARKET_DATA_NORMALIZATION_VERSION;
  featureSchema: typeof GOLD_HUNTER_FAST_STRATEGY_VERSION;
  mid: number;
  consumed: boolean;
  /** Wall-clock ms when opportunity opened (for freshness). */
  opportunityStartedAtMs: number;
  /** Brain V2 identity — distinguishable from V1. */
  brainVersion?: typeof GOLD_HUNTER_BRAIN_VERSION;
  /** Additive B diagnostics when selected setup is B (never invents fills). */
  breakoutDiagnostics?: GhBreakoutDiagnostics | null;
  /** B re-entry / regime-reset state for telemetry. */
  bReentryState?: {
    structuralResetOk: boolean;
    timeFloorOk: boolean;
    lastBSide: "BUY" | "SELL" | null;
    rejectionReason: string | null;
  };
  /** Loss / anti-churn re-entry state (A/B/C) for telemetry. */
  antiChurnState?: {
    structuralResetOk: boolean;
    timeFloorOk: boolean;
    lastSide: "BUY" | "SELL" | null;
    lastResult: "WIN" | "LOSS" | "BREAKEVEN" | null;
    oppositeFlip: boolean;
    rejectionReason: string | null;
  };
  positionManagerVersion?: string;
  lossControllerVersion?: string;
  /** SMART_LOSS_CONTROLLER_V1 entry-gate telemetry. */
  lossControllerState?: {
    consecutiveLosses: number;
    rollingRealisedR: number;
    lossStreakGuardActive: boolean;
    lossCircuitBreakerActive: boolean;
    circuitBreakerReason: string | null;
  };
};

/** Explicit selector tick result — execution only when newOpportunity. */
export type GoldHunterSelectorTickResult = {
  selectedNow: boolean;
  newOpportunity: boolean;
  /** Sticky last candidate for UI/monitor (may outlive selection). */
  candidate: GoldHunterSelectedCandidate | null;
  /** Only set when newOpportunity === true and depth-executable. */
  opportunity: GoldHunterSelectedCandidate | null;
};

export type GoldHunterSelectorReadiness = {
  operational: boolean;
  spotSourceAttached: boolean;
  depthSourceAttached: boolean;
  normalizationReady: boolean;
  fatalBlocker: string | null;
  connected: boolean;
};

function setupLetter(setupId: string): GoldHunterSetupLetter | null {
  if (setupId.startsWith("A_")) return "A";
  if (setupId.startsWith("B_")) return "B";
  if (setupId.startsWith("C_")) return "C";
  return null;
}

/**
 * Forensic per-event material (tests / diagnostics).
 * Not used for durable broker claims.
 */
export function buildGoldHunterEventSignalId(args: {
  setup: GoldHunterSetupLetter;
  side: "BUY" | "SELL";
  receiveSeq: number;
  bookGeneration: number;
  resyncGeneration: number;
  bid: number;
  ask: number;
  quality: number;
}): string {
  const mid = ((args.bid + args.ask) / 2).toFixed(3);
  const q = args.quality.toFixed(4);
  const material = [
    GH_ADMIN_STRATEGY_ID,
    "EVENT",
    args.setup,
    args.side,
    `rs${args.resyncGeneration}`,
    `bg${args.bookGeneration}`,
    `seq${args.receiveSeq}`,
    mid,
    q
  ].join("|");
  const hash = createHash("sha256").update(material).digest("hex").slice(0, 20);
  return `GH-EVT-${args.setup}${args.side[0]}-${args.receiveSeq}-${hash}`;
}

/** @deprecated Use buildGoldHunterOpportunityId for execution claims. */
export function buildGoldHunterSignalId(args: {
  setup: GoldHunterSetupLetter;
  side: "BUY" | "SELL";
  receiveSeq: number;
  bookGeneration: number;
  resyncGeneration: number;
  bid: number;
  ask: number;
  quality: number;
}): string {
  return buildGoldHunterEventSignalId(args);
}

/**
 * Durable opportunity identity — independent of receiveSeq / mid jitter.
 */
export function buildGoldHunterOpportunityId(args: {
  setup: GoldHunterSetupLetter;
  side: "BUY" | "SELL";
  resyncGeneration: number;
  opportunityEpoch: number;
}): string {
  const material = [
    GH_ADMIN_STRATEGY_ID,
    "OPP",
    args.setup,
    args.side,
    `rs${args.resyncGeneration}`,
    `e${args.opportunityEpoch}`
  ].join("|");
  const hash = createHash("sha256").update(material).digest("hex").slice(0, 16);
  return `GH-OPP-${args.setup}${args.side[0]}-e${args.opportunityEpoch}-${hash}`;
}

export function isDepthExecutableForOrder(
  validity: ResearchDepthValidity
): boolean {
  return validity === "DEPTH_VALID";
}

type ActiveOpportunity = {
  opportunityId: string;
  setup: GoldHunterSetupLetter;
  setupId: string;
  side: "BUY" | "SELL";
  startedAtMs: number;
  startReceiveSeq: number;
  bookGeneration: number;
  resyncGeneration: number;
  consumed: boolean;
  breakoutReference: number | null;
};

/** B-specific anti-churn / regime state (does not gate A or C alone). */
type BRegimeState = {
  lastSide: "BUY" | "SELL" | null;
  /** Prior extreme that was cleared (high for BUY, low for SELL). */
  lastBreakoutReference: number | null;
  endedAtMs: number | null;
  /** True once mid returned inside the prior breakout reference. */
  structuralResetComplete: boolean;
};

/**
 * After a closed LOSS: structure-aware re-entry memory for A/B/C.
 * Prevents BUY→SELL→BUY churn from instantaneous opposite signals.
 */
type LossReentryState = {
  lastSide: "BUY" | "SELL" | null;
  lastSetup: GoldHunterSetupLetter | null;
  lastEntryPrice: number | null;
  lastResult: "WIN" | "LOSS" | "BREAKEVEN" | null;
  lastOpportunityId: string | null;
  closedAtMs: number | null;
  structuralResetComplete: boolean;
};

/** SMART_LOSS_CONTROLLER_V1 entry guards (streak + rolling realised R). */
type LossControllerEntryState = {
  consecutiveLosses: number;
  rollingRealisedRs: number[];
  lossStreakGuardActive: boolean;
  lossStreakActivatedAtMs: number | null;
  lossCircuitBreakerActive: boolean;
  circuitBreakerReason: string | null;
  circuitBreakerActivatedAtMs: number | null;
  /** goldHunterTradeId values already applied to streak / rolling R. */
  notifiedClosedTradeIds: Set<string>;
};

function emptyLossControllerEntryState(): LossControllerEntryState {
  return {
    consecutiveLosses: 0,
    rollingRealisedRs: [],
    lossStreakGuardActive: false,
    lossStreakActivatedAtMs: null,
    lossCircuitBreakerActive: false,
    circuitBreakerReason: null,
    circuitBreakerActivatedAtMs: null,
    notifiedClosedTradeIds: new Set()
  };
}

export class GoldHunterStrategySelector {
  private readonly pipeline: GoldHunterFeaturePipeline;
  private receiveSeq = 0;
  private resyncGeneration = 0;
  private opportunityEpoch = 0;
  private spotSourceAttached = false;
  private depthSourceAttached = false;
  private operational = false;
  private fatalBlocker: string | null = null;
  private lastSnapshot: ReturnType<GoldHunterFeaturePipeline["onSpot"]> | null =
    null;
  /** Sticky display candidate (UI). */
  private lastCandidateForDisplay: GoldHunterSelectedCandidate | null = null;
  private lastObservationAt: string | null = null;
  private activeOpportunity: ActiveOpportunity | null = null;
  private lastOpportunityEndedAtMs: number | null = null;
  private lastSpotAtMs: number | null = null;
  private lastDepthAtMs: number | null = null;
  private bRegime: BRegimeState = {
    lastSide: null,
    lastBreakoutReference: null,
    endedAtMs: null,
    structuralResetComplete: true
  };
  private lossReentry: LossReentryState = {
    lastSide: null,
    lastSetup: null,
    lastEntryPrice: null,
    lastResult: null,
    lastOpportunityId: null,
    closedAtMs: null,
    structuralResetComplete: true
  };
  private lossControllerEntry: LossControllerEntryState =
    emptyLossControllerEntryState();

  constructor(opts?: { depthFreshnessMs?: number }) {
    try {
      this.pipeline = new GoldHunterFeaturePipeline(opts);
      this.operational = true;
    } catch (e) {
      this.pipeline = new GoldHunterFeaturePipeline(opts);
      this.operational = false;
      this.fatalBlocker =
        e instanceof Error ? e.message : "SELECTOR_INIT_FAILED";
    }
  }

  markSpotSourceAttached(attached: boolean): void {
    this.spotSourceAttached = attached;
  }

  markDepthSourceAttached(attached: boolean): void {
    this.depthSourceAttached = attached;
  }

  setFatalBlocker(code: string | null): void {
    this.fatalBlocker = code;
  }

  readiness(): GoldHunterSelectorReadiness {
    const connected =
      this.operational &&
      this.spotSourceAttached &&
      this.depthSourceAttached &&
      this.fatalBlocker == null;
    return {
      operational: this.operational,
      spotSourceAttached: this.spotSourceAttached,
      depthSourceAttached: this.depthSourceAttached,
      normalizationReady: true,
      fatalBlocker: this.fatalBlocker,
      connected
    };
  }

  clearForResync(): void {
    this.resyncGeneration += 1;
    this.pipeline.clearForResync();
    if (this.activeOpportunity) {
      this.endActiveOpportunity(Date.now(), null);
    }
    this.lastCandidateForDisplay = null;
    this.lastSnapshot = null;
    this.bRegime = {
      lastSide: null,
      lastBreakoutReference: null,
      endedAtMs: null,
      structuralResetComplete: true
    };
    this.lossReentry = {
      lastSide: null,
      lastSetup: null,
      lastEntryPrice: null,
      lastResult: null,
      lastOpportunityId: null,
      closedAtMs: null,
      structuralResetComplete: true
    };
  }

  onSpot(args: {
    receivedAtMs: number;
    bid: number | null;
    ask: number | null;
    symbolId?: string | number;
    brokerTimestampMs?: number | null;
    receiveSeq?: number;
  }): GoldHunterSelectorTickResult {
    this.receiveSeq += 1;
    const seq = args.receiveSeq ?? this.receiveSeq;
    this.lastSpotAtMs = args.receivedAtMs;
    const snap = this.pipeline.onSpot(
      GoldHunterFeaturePipeline.spotEvent({
        receiveSeq: seq,
        receivedAtMs: args.receivedAtMs,
        bid: args.bid,
        ask: args.ask,
        symbolId: args.symbolId,
        brokerTimestampMs: args.brokerTimestampMs
      })
    );
    return this.afterSnapshot(snap, seq, args.receivedAtMs);
  }

  onDepth(args: {
    receivedAtMs: number;
    symbolId?: string | number;
    brokerTimestampMs?: number | null;
    newQuotes?: GhFastDepthEvent["newQuotes"];
    deletedQuotes?: GhFastDepthEvent["deletedQuotes"];
    receiveSeq?: number;
  }): GoldHunterSelectorTickResult {
    this.receiveSeq += 1;
    const seq = args.receiveSeq ?? this.receiveSeq;
    this.lastDepthAtMs = args.receivedAtMs;
    const snap = this.pipeline.onDepth({
      kind: "DEPTH",
      receiveSeq: seq,
      eventId: `depth-${seq}`,
      receivedAtMs: args.receivedAtMs,
      brokerTimestampMs: args.brokerTimestampMs ?? null,
      symbolId: args.symbolId,
      newQuotes: args.newQuotes,
      deletedQuotes: args.deletedQuotes
    });
    return this.afterSnapshot(snap, seq, args.receivedAtMs);
  }

  private endActiveOpportunity(
    atMs: number,
    mid: number | null
  ): void {
    if (!this.activeOpportunity) return;
    const ending = this.activeOpportunity;
    this.lastOpportunityEndedAtMs = atMs;
    if (ending.setup === "B") {
      const ref =
        ending.breakoutReference ??
        this.lastCandidateForDisplay?.breakoutDiagnostics?.breakoutReference ??
        null;
      this.bRegime = {
        lastSide: ending.side,
        lastBreakoutReference: ref,
        endedAtMs: atMs,
        // Opposite-side flip or same-side re-entry requires a structural unwind.
        structuralResetComplete: false
      };
      // If mid already back inside at end (rare), mark reset immediately.
      if (mid != null && ref != null) {
        this.updateBStructuralReset(mid);
      }
    }
    this.activeOpportunity = null;
  }

  /**
   * Structural reset: after a B BUY, mid must return to/below the cleared prior
   * high before another B BUY is fresh. After B SELL, mid must return to/above
   * the cleared prior low. Also enables opposite-direction regime change.
   */
  private updateBStructuralReset(mid: number): void {
    if (this.bRegime.structuralResetComplete) return;
    const ref = this.bRegime.lastBreakoutReference;
    const side = this.bRegime.lastSide;
    if (ref == null || side == null) {
      this.bRegime.structuralResetComplete = true;
      return;
    }
    if (side === "BUY" && mid <= ref) {
      this.bRegime.structuralResetComplete = true;
    } else if (side === "SELL" && mid >= ref) {
      this.bRegime.structuralResetComplete = true;
    }
  }

  private rearmSatisfied(atMs: number): boolean {
    const floor = this.pipeline.config().rearmFloorMs;
    if (this.lastOpportunityEndedAtMs == null) return true;
    return atMs - this.lastOpportunityEndedAtMs >= floor;
  }

  /**
   * B-only arming gate. A/C ignore this. Structural reset is primary;
   * breakoutBRearmFloorMs is a secondary time backstop.
   */
  /**
   * Structural reset after LOSS: mid must unwind through the losing entry
   * before another entry is considered a genuine new opportunity.
   * BUY loss → mid <= entry; SELL loss → mid >= entry.
   */
  private updateLossStructuralReset(mid: number): void {
    if (this.lossReentry.structuralResetComplete) return;
    if (this.lossReentry.lastResult !== "LOSS") {
      this.lossReentry.structuralResetComplete = true;
      return;
    }
    const entry = this.lossReentry.lastEntryPrice;
    const side = this.lossReentry.lastSide;
    if (entry == null || side == null) {
      this.lossReentry.structuralResetComplete = true;
      return;
    }
    if (side === "BUY" && mid <= entry) {
      this.lossReentry.structuralResetComplete = true;
    } else if (side === "SELL" && mid >= entry) {
      this.lossReentry.structuralResetComplete = true;
    }
  }

  /**
   * Notify selector that a Demo GH trade closed — arms anti-churn memory on LOSS.
   * WIN/BREAKEVEN clear the single-loss gate (generic rearm floor still applies).
   * Also updates SMART_LOSS_CONTROLLER_V1 streak / rolling circuit-breaker state.
   *
   * Exactly-once for streak / rolling R when `tradeId` (goldHunterTradeId) is set:
   * settlement retry / delayed settlement / reconcile must not double-count.
   * Does not invent realisedR — callers must pass true settled R or omit/null.
   */
  notifyTradeClosed(args: {
    side: "BUY" | "SELL";
    setup: GoldHunterSetupLetter | null;
    entryPrice: number | null;
    result: "WIN" | "LOSS" | "BREAKEVEN" | null;
    opportunityId?: string | null;
    closedAtMs?: number;
    /**
     * Realised R for rolling circuit breaker (negative = loss).
     * Pass null/omit when entry/exit/risk cannot safely determine R — never invent.
     */
    realisedR?: number | null;
    /** Stable goldHunterTradeId — required for exactly-once LC accounting. */
    tradeId?: string | null;
  }): void {
    const atMs = args.closedAtMs ?? Date.now();
    const cfg = this.pipeline.config();
    const tradeKey =
      args.tradeId != null && String(args.tradeId).trim().length > 0
        ? String(args.tradeId).trim()
        : null;

    // Exactly-once: same settled trade must not mutate streak / rolling twice.
    if (
      tradeKey &&
      this.lossControllerEntry.notifiedClosedTradeIds.has(tradeKey)
    ) {
      // Still refresh anti-churn identity on duplicate LOSS without re-counting R.
      if (args.result === "LOSS") {
        this.lossReentry = {
          ...this.lossReentry,
          lastSide: args.side,
          lastSetup: args.setup,
          lastEntryPrice:
            args.entryPrice != null && Number.isFinite(args.entryPrice)
              ? args.entryPrice
              : this.lossReentry.lastEntryPrice,
          lastResult: "LOSS",
          lastOpportunityId:
            args.opportunityId ?? this.lossReentry.lastOpportunityId,
          closedAtMs: this.lossReentry.closedAtMs ?? atMs
        };
        if (
          args.opportunityId &&
          this.activeOpportunity?.opportunityId === args.opportunityId
        ) {
          this.activeOpportunity.consumed = true;
        }
      }
      return;
    }

    if (tradeKey) {
      this.lossControllerEntry.notifiedClosedTradeIds.add(tradeKey);
      // Bound memory — keep recent ids only.
      if (this.lossControllerEntry.notifiedClosedTradeIds.size > 500) {
        const oldest = this.lossControllerEntry.notifiedClosedTradeIds
          .values()
          .next().value;
        if (oldest != null) {
          this.lossControllerEntry.notifiedClosedTradeIds.delete(oldest);
        }
      }
    }

    const realisedR =
      args.realisedR != null && Number.isFinite(args.realisedR)
        ? args.realisedR
        : null;

    if (
      (args.result === "LOSS" ||
        args.result === "WIN" ||
        args.result === "BREAKEVEN") &&
      realisedR != null
    ) {
      this.recordRealisedR(realisedR, cfg, atMs);
    }

    if (args.result === "LOSS") {
      this.lossControllerEntry.consecutiveLosses += 1;
      if (
        cfg.smartLossControllerEnabled &&
        this.lossControllerEntry.consecutiveLosses >= cfg.slcLossStreakCount
      ) {
        this.lossControllerEntry.lossStreakGuardActive = true;
        this.lossControllerEntry.lossStreakActivatedAtMs =
          this.lossControllerEntry.lossStreakActivatedAtMs ?? atMs;
      }
      this.lossReentry = {
        lastSide: args.side,
        lastSetup: args.setup,
        lastEntryPrice:
          args.entryPrice != null && Number.isFinite(args.entryPrice)
            ? args.entryPrice
            : null,
        lastResult: "LOSS",
        lastOpportunityId: args.opportunityId ?? null,
        closedAtMs: atMs,
        structuralResetComplete: false
      };
      // Canonical opportunity must not stay executable after a LOSS close.
      if (
        args.opportunityId &&
        this.activeOpportunity?.opportunityId === args.opportunityId
      ) {
        this.activeOpportunity.consumed = true;
      }
      if (
        args.opportunityId &&
        this.lastCandidateForDisplay?.opportunityId === args.opportunityId
      ) {
        this.lastCandidateForDisplay = {
          ...this.lastCandidateForDisplay,
          consumed: true
        };
      }
      return;
    }
    // Non-loss: clear consecutive streak; keep rolling window / CB until recovered.
    this.lossControllerEntry.consecutiveLosses = 0;
    this.lossControllerEntry.lossStreakGuardActive = false;
    this.lossControllerEntry.lossStreakActivatedAtMs = null;
    this.lossReentry = {
      lastSide: args.side,
      lastSetup: args.setup,
      lastEntryPrice:
        args.entryPrice != null && Number.isFinite(args.entryPrice)
          ? args.entryPrice
          : this.lossReentry.lastEntryPrice,
      lastResult: args.result,
      lastOpportunityId: args.opportunityId ?? this.lossReentry.lastOpportunityId,
      closedAtMs: atMs,
      structuralResetComplete: true
    };
  }

  private recordRealisedR(
    realisedR: number,
    cfg: ReturnType<GoldHunterFeaturePipeline["config"]>,
    atMs: number
  ): void {
    if (!cfg.smartLossControllerEnabled) return;
    const next = [...this.lossControllerEntry.rollingRealisedRs, realisedR];
    while (next.length > cfg.slcRollingWindowTrades) next.shift();
    this.lossControllerEntry.rollingRealisedRs = next;
    const sum = next.reduce((a, b) => a + b, 0);
    if (sum <= -cfg.slcRollingCircuitBreakerR) {
      this.lossControllerEntry.lossCircuitBreakerActive = true;
      this.lossControllerEntry.circuitBreakerReason = "ROLLING_REALISED_R";
      this.lossControllerEntry.circuitBreakerActivatedAtMs =
        this.lossControllerEntry.circuitBreakerActivatedAtMs ?? atMs;
    }
  }

  getAntiChurnStateForTests(): LossReentryState {
    return { ...this.lossReentry };
  }

  getLossControllerEntryState(): {
    consecutiveLosses: number;
    rollingRealisedR: number;
    rollingSampleCount: number;
    lossStreakGuardActive: boolean;
    lossCircuitBreakerActive: boolean;
    circuitBreakerReason: string | null;
  } {
    const rollingRealisedR = this.lossControllerEntry.rollingRealisedRs.reduce(
      (a, b) => a + b,
      0
    );
    return {
      consecutiveLosses: this.lossControllerEntry.consecutiveLosses,
      rollingRealisedR,
      rollingSampleCount: this.lossControllerEntry.rollingRealisedRs.length,
      lossStreakGuardActive: this.lossControllerEntry.lossStreakGuardActive,
      lossCircuitBreakerActive: this.lossControllerEntry.lossCircuitBreakerActive,
      circuitBreakerReason: this.lossControllerEntry.circuitBreakerReason
    };
  }

  /** Test helper — exposes loss anti-churn gate. */
  evaluateAntiChurnGateForTests(args: {
    side: "BUY" | "SELL";
    atMs: number;
    mid: number;
    opportunityId?: string | null;
    signedImbalance1s?: number;
    midVel250?: number;
  }) {
    return this.lossArmingGate(args);
  }

  /**
   * A/B/C anti-churn after LOSS. Stronger requirements for immediate opposite flip.
   * Does not replace B structural gate — both must pass when applicable.
   * SMART_LOSS_CONTROLLER_V1 adds streak guard + rolling circuit breaker.
   */
  private lossArmingGate(args: {
    side: "BUY" | "SELL";
    atMs: number;
    mid: number;
    opportunityId?: string | null;
    signedImbalance1s?: number;
    midVel250?: number;
  }): {
    ok: boolean;
    structuralResetOk: boolean;
    timeFloorOk: boolean;
    oppositeFlip: boolean;
    rejectionReason: string | null;
  } {
    this.updateLossStructuralReset(args.mid);
    const cfg = this.pipeline.config();
    const lc = this.lossControllerEntry;
    const directionalOk = (side: "BUY" | "SELL"): boolean => {
      const imb = args.signedImbalance1s ?? 0;
      const vel = args.midVel250 ?? 0;
      return side === "BUY" ? imb > 0.1 && vel > 0 : imb < -0.1 && vel < 0;
    };

    // Rolling realised-R circuit breaker — gates NEW entries only.
    if (cfg.smartLossControllerEnabled && lc.lossCircuitBreakerActive) {
      const activatedAt = lc.circuitBreakerActivatedAtMs ?? args.atMs;
      const timeOk = args.atMs - activatedAt >= cfg.slcCircuitBreakerResetMs;
      const structuralOk = this.lossReentry.structuralResetComplete;
      if (!timeOk || !structuralOk || !directionalOk(args.side)) {
        return {
          ok: false,
          structuralResetOk: structuralOk,
          timeFloorOk: timeOk,
          oppositeFlip:
            this.lossReentry.lastSide != null &&
            args.side !== this.lossReentry.lastSide,
          rejectionReason: "WAIT_LOSS_CIRCUIT_BREAKER"
        };
      }
      // Recovery: clear CB and rolling window so we do not immediately re-trip.
      lc.lossCircuitBreakerActive = false;
      lc.circuitBreakerReason = null;
      lc.circuitBreakerActivatedAtMs = null;
      lc.rollingRealisedRs = [];
    }

    // Loss streak guard after N consecutive realised losses.
    if (cfg.smartLossControllerEnabled && lc.lossStreakGuardActive) {
      const activatedAt = lc.lossStreakActivatedAtMs ?? args.atMs;
      const timeOk = args.atMs - activatedAt >= cfg.slcLossStreakResetMs;
      const structuralOk = this.lossReentry.structuralResetComplete;
      if (!timeOk || !structuralOk || !directionalOk(args.side)) {
        return {
          ok: false,
          structuralResetOk: structuralOk,
          timeFloorOk: timeOk,
          oppositeFlip:
            this.lossReentry.lastSide != null &&
            args.side !== this.lossReentry.lastSide,
          rejectionReason: "WAIT_LOSS_STREAK_GUARD"
        };
      }
      lc.lossStreakGuardActive = false;
      lc.lossStreakActivatedAtMs = null;
      lc.consecutiveLosses = 0;
    }

    if (
      this.lossReentry.closedAtMs == null ||
      this.lossReentry.lastResult !== "LOSS" ||
      this.lossReentry.lastSide == null
    ) {
      return {
        ok: true,
        structuralResetOk: true,
        timeFloorOk: true,
        oppositeFlip: false,
        rejectionReason: null
      };
    }

    // Fresh opportunity identity required when we still remember the loser.
    if (
      args.opportunityId &&
      this.lossReentry.lastOpportunityId &&
      args.opportunityId === this.lossReentry.lastOpportunityId
    ) {
      return {
        ok: false,
        structuralResetOk: this.lossReentry.structuralResetComplete,
        timeFloorOk: true,
        oppositeFlip: args.side !== this.lossReentry.lastSide,
        rejectionReason: "WAIT_DUPLICATE_OPPORTUNITY"
      };
    }

    const oppositeFlip = args.side !== this.lossReentry.lastSide;
    const minMs = oppositeFlip
      ? Math.max(cfg.antiChurnLossMinMs, cfg.antiChurnOppositeFlipMinMs)
      : cfg.antiChurnLossMinMs;
    const elapsed = args.atMs - this.lossReentry.closedAtMs;
    const timeFloorOk = elapsed >= minMs;
    const structuralResetOk = this.lossReentry.structuralResetComplete;

    if (!timeFloorOk) {
      return {
        ok: false,
        structuralResetOk,
        timeFloorOk: false,
        oppositeFlip,
        rejectionReason: "WAIT_REENTRY_TIME_RESET"
      };
    }
    if (!structuralResetOk) {
      return {
        ok: false,
        structuralResetOk: false,
        timeFloorOk: true,
        oppositeFlip,
        rejectionReason: "WAIT_REENTRY_STRUCTURE_RESET"
      };
    }

    if (oppositeFlip) {
      // Require directional confirmation that structure actually flipped.
      if (!directionalOk(args.side)) {
        return {
          ok: false,
          structuralResetOk: true,
          timeFloorOk: true,
          oppositeFlip: true,
          rejectionReason: "WAIT_REVERSAL_NOT_CONFIRMED"
        };
      }
    }

    return {
      ok: true,
      structuralResetOk: true,
      timeFloorOk: true,
      oppositeFlip,
      rejectionReason: null
    };
  }

  private bArmingGate(args: {
    side: "BUY" | "SELL";
    atMs: number;
    mid: number;
  }): {
    ok: boolean;
    structuralResetOk: boolean;
    timeFloorOk: boolean;
    rejectionReason: string | null;
  } {
    this.updateBStructuralReset(args.mid);
    if (this.bRegime.endedAtMs == null || this.bRegime.lastSide == null) {
      return {
        ok: true,
        structuralResetOk: true,
        timeFloorOk: true,
        rejectionReason: null
      };
    }
    const cfg = this.pipeline.config();
    const elapsed = args.atMs - this.bRegime.endedAtMs;
    const timeFloorOk = elapsed >= cfg.breakoutBRearmFloorMs;
    const structuralResetOk = this.bRegime.structuralResetComplete;

    if (!structuralResetOk) {
      return {
        ok: false,
        structuralResetOk: false,
        timeFloorOk,
        rejectionReason:
          args.side === this.bRegime.lastSide
            ? "b_no_structural_reset"
            : "b_no_regime_reset"
      };
    }
    if (!timeFloorOk) {
      return {
        ok: false,
        structuralResetOk: true,
        timeFloorOk: false,
        rejectionReason: "b_rearm_time_floor"
      };
    }
    return {
      ok: true,
      structuralResetOk: true,
      timeFloorOk: true,
      rejectionReason: null
    };
  }

  private buildCandidate(args: {
    letter: GoldHunterSetupLetter;
    setupId: string;
    side: "BUY" | "SELL";
    quality: number;
    opportunityId: string;
    receiveSeq: number;
    latestReceiveSeq: number;
    bookGeneration: number;
    bid: number;
    ask: number;
    spread: number;
    depthValidity: ResearchDepthValidity;
    depthExecutable: boolean;
    receivedAtMs: number;
    opportunityStartedAtMs: number;
    consumed: boolean;
    breakoutDiagnostics?: GhBreakoutDiagnostics | null;
    bReentryState?: GoldHunterSelectedCandidate["bReentryState"];
    antiChurnState?: GoldHunterSelectedCandidate["antiChurnState"];
  }): GoldHunterSelectedCandidate {
    return {
      strategy: GH_ADMIN_STRATEGY_ID,
      setup: args.letter,
      setupId: args.setupId,
      side: args.side,
      quality: args.quality,
      signalId: args.opportunityId,
      opportunityId: args.opportunityId,
      signalTimestamp: new Date(args.opportunityStartedAtMs).toISOString(),
      receiveSeq: args.receiveSeq,
      latestReceiveSeq: args.latestReceiveSeq,
      bookGeneration: args.bookGeneration,
      resyncGeneration: this.resyncGeneration,
      bid: args.bid,
      ask: args.ask,
      spread: args.spread,
      depthValidity: args.depthValidity,
      depthExecutable: args.depthExecutable,
      normalizationVersion: GH_FAST_MARKET_DATA_NORMALIZATION_VERSION,
      featureSchema: GOLD_HUNTER_FAST_STRATEGY_VERSION,
      mid: (args.bid + args.ask) / 2,
      consumed: args.consumed,
      opportunityStartedAtMs: args.opportunityStartedAtMs,
      brainVersion: GOLD_HUNTER_BRAIN_VERSION,
      positionManagerVersion: GOLD_HUNTER_SMART_POSITION_MANAGER_VERSION,
      lossControllerVersion: GOLD_HUNTER_SMART_LOSS_CONTROLLER_VERSION,
      lossControllerState: this.getLossControllerEntryState(),
      breakoutDiagnostics: args.breakoutDiagnostics ?? null,
      bReentryState: args.bReentryState,
      antiChurnState: args.antiChurnState
    };
  }

  private afterSnapshot(
    snap: ReturnType<GoldHunterFeaturePipeline["onSpot"]>,
    receiveSeq: number,
    receivedAtMs: number
  ): GoldHunterSelectorTickResult {
    this.lastSnapshot = snap;
    this.lastObservationAt = new Date(receivedAtMs).toISOString();

    const midHint =
      snap.lastFeatureSpot != null
        ? (snap.lastFeatureSpot.bid + snap.lastFeatureSpot.ask) / 2
        : snap.bestBid != null && snap.bestAsk != null
          ? (snap.bestBid + snap.bestAsk) / 2
          : null;
    if (midHint != null) {
      this.updateBStructuralReset(midHint);
      this.updateLossStructuralReset(midHint);
    }

    const hit = snap.selected;
    if (!hit) {
      this.endActiveOpportunity(receivedAtMs, midHint);
      return {
        selectedNow: false,
        newOpportunity: false,
        candidate: this.lastCandidateForDisplay,
        opportunity: null
      };
    }

    const letter = setupLetter(hit.setup);
    if (!letter) {
      this.endActiveOpportunity(receivedAtMs, midHint);
      return {
        selectedNow: false,
        newOpportunity: false,
        candidate: this.lastCandidateForDisplay,
        opportunity: null
      };
    }

    const bid = snap.lastFeatureSpot?.bid ?? snap.bestBid;
    const ask = snap.lastFeatureSpot?.ask ?? snap.bestAsk;
    if (bid == null || ask == null || !(ask >= bid)) {
      return {
        selectedNow: false,
        newOpportunity: false,
        candidate: this.lastCandidateForDisplay,
        opportunity: null
      };
    }

    const mid = (bid + ask) / 2;
    this.updateBStructuralReset(mid);
    this.updateLossStructuralReset(mid);
    const spread = ask - bid;
    const depthExecutable = isDepthExecutableForOrder(snap.depthValidity);
    const breakoutDiagnostics =
      letter === "B" ? hit.diagnostics ?? null : null;
    const sameActive =
      this.activeOpportunity != null &&
      this.activeOpportunity.setup === letter &&
      this.activeOpportunity.side === hit.side &&
      this.activeOpportunity.resyncGeneration === this.resyncGeneration;

    if (sameActive && this.activeOpportunity) {
      const feat = snap.features;
      const lossGateActive = this.lossArmingGate({
        side: hit.side,
        atMs: receivedAtMs,
        mid,
        opportunityId: this.activeOpportunity.opportunityId,
        signedImbalance1s: feat?.signedImbalance1s,
        midVel250: feat?.midVel250
      });
      if (!lossGateActive.ok) {
        // Losing opportunity must not remain executable (e.g. WAIT_DUPLICATE_OPPORTUNITY).
        this.activeOpportunity.consumed = true;
        const blocked = this.buildCandidate({
          letter,
          setupId: hit.setup,
          side: hit.side,
          quality: hit.quality,
          opportunityId: this.activeOpportunity.opportunityId,
          receiveSeq: this.activeOpportunity.startReceiveSeq,
          latestReceiveSeq: receiveSeq,
          bookGeneration: snap.bookGeneration,
          bid,
          ask,
          spread,
          depthValidity: snap.depthValidity,
          depthExecutable,
          receivedAtMs,
          opportunityStartedAtMs: this.activeOpportunity.startedAtMs,
          consumed: true,
          breakoutDiagnostics,
          antiChurnState: {
            structuralResetOk: lossGateActive.structuralResetOk,
            timeFloorOk: lossGateActive.timeFloorOk,
            lastSide: this.lossReentry.lastSide,
            lastResult: this.lossReentry.lastResult,
            oppositeFlip: lossGateActive.oppositeFlip,
            rejectionReason: lossGateActive.rejectionReason
          }
        });
        this.lastCandidateForDisplay = blocked;
        return {
          selectedNow: true,
          newOpportunity: false,
          candidate: blocked,
          opportunity: null
        };
      }

      // Continuing selected setup — ONE opportunity across Depth bursts.
      const updated = this.buildCandidate({
        letter,
        setupId: hit.setup,
        side: hit.side,
        quality: hit.quality,
        opportunityId: this.activeOpportunity.opportunityId,
        receiveSeq: this.activeOpportunity.startReceiveSeq,
        latestReceiveSeq: receiveSeq,
        bookGeneration: snap.bookGeneration,
        bid,
        ask,
        spread,
        depthValidity: snap.depthValidity,
        depthExecutable,
        receivedAtMs,
        opportunityStartedAtMs: this.activeOpportunity.startedAtMs,
        consumed: this.activeOpportunity.consumed,
        breakoutDiagnostics
      });
      this.lastCandidateForDisplay = updated;
      return {
        selectedNow: true,
        newOpportunity: false,
        candidate: updated,
        opportunity: null
      };
    }

    // Setup/side/resync changed → end prior opportunity before considering rearm.
    if (this.activeOpportunity) {
      this.endActiveOpportunity(receivedAtMs, mid);
    }

    const bGate =
      letter === "B"
        ? this.bArmingGate({ side: hit.side, atMs: receivedAtMs, mid })
        : {
            ok: true,
            structuralResetOk: true,
            timeFloorOk: true,
            rejectionReason: null as string | null
          };

    const feat = snap.features;
    const lossGateLive = this.lossArmingGate({
      side: hit.side,
      atMs: receivedAtMs,
      mid,
      signedImbalance1s: feat?.signedImbalance1s,
      midVel250: feat?.midVel250
    });

    const antiChurnBlocked = !lossGateLive.ok;
    const bBlocked = letter === "B" && !bGate.ok;
    const rearmBlocked = !this.rearmSatisfied(receivedAtMs);

    if (rearmBlocked || bBlocked || antiChurnBlocked) {
      // Selected for display, but rearm / B structural / anti-churn gate not met.
      const displayOnly = this.buildCandidate({
        letter,
        setupId: hit.setup,
        side: hit.side,
        quality: hit.quality,
        opportunityId: `GH-DISPLAY-${letter}${hit.side[0]}-${receiveSeq}`,
        receiveSeq,
        latestReceiveSeq: receiveSeq,
        bookGeneration: snap.bookGeneration,
        bid,
        ask,
        spread,
        depthValidity: snap.depthValidity,
        depthExecutable,
        receivedAtMs,
        opportunityStartedAtMs: receivedAtMs,
        consumed: true, // not executable
        breakoutDiagnostics,
        bReentryState:
          letter === "B"
            ? {
                structuralResetOk: bGate.structuralResetOk,
                timeFloorOk: bGate.timeFloorOk,
                lastBSide: this.bRegime.lastSide,
                rejectionReason:
                  bGate.rejectionReason ??
                  (rearmBlocked ? "generic_rearm_floor" : null)
              }
            : undefined,
        antiChurnState: {
          structuralResetOk: lossGateLive.structuralResetOk,
          timeFloorOk: lossGateLive.timeFloorOk,
          lastSide: this.lossReentry.lastSide,
          lastResult: this.lossReentry.lastResult,
          oppositeFlip: lossGateLive.oppositeFlip,
          rejectionReason: antiChurnBlocked
            ? lossGateLive.rejectionReason
            : null
        }
      });
      this.lastCandidateForDisplay = displayOnly;
      return {
        selectedNow: true,
        newOpportunity: false,
        candidate: displayOnly,
        opportunity: null
      };
    }

    // Start a new opportunity lifecycle.
    this.opportunityEpoch += 1;
    const opportunityId = buildGoldHunterOpportunityId({
      setup: letter,
      side: hit.side,
      resyncGeneration: this.resyncGeneration,
      opportunityEpoch: this.opportunityEpoch
    });
    this.activeOpportunity = {
      opportunityId,
      setup: letter,
      setupId: hit.setup,
      side: hit.side,
      startedAtMs: receivedAtMs,
      startReceiveSeq: receiveSeq,
      bookGeneration: snap.bookGeneration,
      resyncGeneration: this.resyncGeneration,
      consumed: false,
      breakoutReference: breakoutDiagnostics?.breakoutReference ?? null
    };

    const candidate = this.buildCandidate({
      letter,
      setupId: hit.setup,
      side: hit.side,
      quality: hit.quality,
      opportunityId,
      receiveSeq,
      latestReceiveSeq: receiveSeq,
      bookGeneration: snap.bookGeneration,
      bid,
      ask,
      spread,
      depthValidity: snap.depthValidity,
      depthExecutable,
      receivedAtMs,
      opportunityStartedAtMs: receivedAtMs,
      consumed: false,
      breakoutDiagnostics,
      bReentryState:
        letter === "B"
          ? {
              structuralResetOk: true,
              timeFloorOk: true,
              lastBSide: this.bRegime.lastSide,
              rejectionReason: null
            }
          : undefined,
      antiChurnState: {
        structuralResetOk: true,
        timeFloorOk: true,
        lastSide: this.lossReentry.lastSide,
        lastResult: this.lossReentry.lastResult,
        oppositeFlip: lossGateLive.oppositeFlip,
        rejectionReason: null
      }
    });
    this.lastCandidateForDisplay = candidate;

    const newOpportunity = depthExecutable;
    return {
      selectedNow: true,
      newOpportunity,
      candidate,
      opportunity: newOpportunity ? candidate : null
    };
  }

  markConsumed(signalId: string): void {
    if (this.activeOpportunity?.opportunityId === signalId) {
      this.activeOpportunity.consumed = true;
    }
    if (this.lastCandidateForDisplay?.opportunityId === signalId) {
      this.lastCandidateForDisplay = {
        ...this.lastCandidateForDisplay,
        consumed: true
      };
    }
  }

  /** Alias — opportunity id is the durable claim key. */
  markOpportunityConsumed(opportunityId: string): void {
    this.markConsumed(opportunityId);
  }

  getLastCandidate(): GoldHunterSelectedCandidate | null {
    return this.lastCandidateForDisplay;
  }

  /** Candidate eligible for Demo order path (depth-gated, unconsumed active). */
  getExecutableCandidate(): GoldHunterSelectedCandidate | null {
    const c = this.lastCandidateForDisplay;
    if (!c || c.consumed) return null;
    if (!c.depthExecutable) return null;
    if (!this.activeOpportunity) return null;
    if (this.activeOpportunity.opportunityId !== c.opportunityId) return null;
    if (this.activeOpportunity.consumed) return null;
    return c;
  }

  getActiveOpportunityId(): string | null {
    return this.activeOpportunity?.opportunityId ?? null;
  }

  getLastSnapshot() {
    return this.lastSnapshot;
  }

  getLastObservationAt(): string | null {
    return this.lastObservationAt;
  }

  getLastSpotAtMs(): number | null {
    return this.lastSpotAtMs;
  }

  getLastDepthAtMs(): number | null {
    return this.lastDepthAtMs;
  }

  getReceiveSeq(): number {
    return this.receiveSeq;
  }

  getResyncGeneration(): number {
    return this.resyncGeneration;
  }

  getFrozenConfig() {
    return this.pipeline.config();
  }

  getOpportunityEpoch(): number {
    return this.opportunityEpoch;
  }

  /**
   * Test-only: drive opportunity lifecycle without inventing market microstructure.
   * Does not change A/B/C thresholds — injects an already-selected hit.
   */
  processInjectedSelectionForTests(args: {
    selected: {
      setup: string;
      side: "BUY" | "SELL";
      quality: number;
      diagnostics?: GhBreakoutDiagnostics;
    } | null;
    receivedAtMs: number;
    receiveSeq?: number;
    bid?: number;
    ask?: number;
    depthValidity?: ResearchDepthValidity;
    bookGeneration?: number;
  }): GoldHunterSelectorTickResult {
    this.receiveSeq += 1;
    const seq = args.receiveSeq ?? this.receiveSeq;
    this.lastSpotAtMs = args.receivedAtMs;
    this.lastDepthAtMs = args.receivedAtMs;
    const bid = args.bid ?? 2600;
    const ask = args.ask ?? 2600.12;
    const bookGeneration = args.bookGeneration ?? 1;
    const depthValidity = args.depthValidity ?? "DEPTH_VALID";
    const depthStats = {
      available: true,
      topBidDepth: 10,
      topAskDepth: 10,
      bidDepthN: 10,
      askDepthN: 10,
      bidLevels: 1,
      askLevels: 1,
      depthRatio: 1,
      depthImbalance: 0.1,
      weightedImbalance: 0.1,
      liquidityAddedBid: 0,
      liquidityAddedAsk: 0,
      liquidityRemovedBid: 0,
      liquidityRemovedAsk: 0,
      addRateBid: 0,
      addRateAsk: 0,
      removeRateBid: 1,
      removeRateAsk: 2,
      bestBid: bid,
      bestAsk: ask,
      spread: ask - bid,
      crossed: depthValidity === "DEPTH_CROSSED",
      lastUpdateMs: args.receivedAtMs,
      lastValidBookMs: args.receivedAtMs,
      consecutiveInvalidSnapshots: 0,
      bookGeneration,
      resyncCount: 0,
      deleteHits: 0
    };
    const features = {
      bid,
      ask,
      mid: (bid + ask) / 2,
      spread: ask - bid,
      bidVel250: 0,
      bidVel500: 0,
      bidVel1s: 0,
      bidVel2s: 0,
      bidVel3s: 0,
      askVel1s: 0,
      midVel250: 0.001,
      midVel500: 0.001,
      midVel1s: 0.001,
      midVel2s: 0,
      midVel3s: 0,
      acceleration: 0.0001,
      updateRate1s: 10,
      signedImbalance1s: 0.3,
      efficiency1s: 0.5,
      efficiency3s: 0.5,
      high1s: ask,
      low1s: bid,
      high2s: ask,
      low2s: bid,
      high5s: ask,
      low5s: bid,
      high10s: ask,
      low10s: bid,
      high15s: ask,
      low15s: bid,
      high30s: ask,
      low30s: bid,
      priorHigh5s: bid,
      priorLow5s: bid,
      priorHigh10s: bid,
      priorLow10s: bid,
      distHigh1s: 0,
      distLow1s: 0,
      distHigh5s: 0,
      distLow5s: 0,
      distPriorHigh5s: 0,
      distPriorLow5s: 0,
      upTouches5s: 0,
      downTouches5s: 0,
      depth: depthStats
    };
    const synthetic = {
      features,
      specialists: null,
      selected: args.selected
        ? {
            setup: args.selected.setup as
              | "A_MOMENTUM_IGNITION"
              | "B_FAST_BREAKOUT"
              | "C_PULLBACK_REACCEL",
            side: args.selected.side,
            quality: args.selected.quality,
            reasons: ["test"],
            diagnostics: args.selected.diagnostics
          }
        : null,
      bestBid: bid,
      bestAsk: ask,
      spread: ask - bid,
      depthAvailable: depthValidity === "DEPTH_VALID",
      crossed: depthValidity === "DEPTH_CROSSED",
      bookGeneration,
      depthValidity,
      derivedDataContaminated: depthValidity !== "DEPTH_VALID",
      depthStats,
      lastSpotBid: bid,
      lastSpotAsk: ask,
      lastFeatureSpot: { bid, ask }
    } as ReturnType<GoldHunterFeaturePipeline["onSpot"]>;
    return this.afterSnapshot(synthetic, seq, args.receivedAtMs);
  }
}

/** Process-local selector registry (one per owner). */
const selectors = new Map<string, GoldHunterStrategySelector>();

export function getGoldHunterStrategySelector(
  ownerUid: string
): GoldHunterStrategySelector {
  let s = selectors.get(ownerUid);
  if (!s) {
    s = new GoldHunterStrategySelector();
    selectors.set(ownerUid, s);
  }
  return s;
}

export function resetGoldHunterStrategySelectorsForTests(): void {
  selectors.clear();
}
