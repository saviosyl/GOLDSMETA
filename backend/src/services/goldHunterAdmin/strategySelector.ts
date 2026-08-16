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
  GOLD_HUNTER_FAST_STRATEGY_VERSION,
  type GhFastDepthEvent,
  type ResearchDepthValidity
} from "./abc";
import { GoldHunterFeaturePipeline } from "./abc/featurePipeline";
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
};

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
      this.lastOpportunityEndedAtMs = Date.now();
      this.activeOpportunity = null;
    }
    this.lastCandidateForDisplay = null;
    this.lastSnapshot = null;
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

  private endActiveOpportunity(atMs: number): void {
    if (this.activeOpportunity) {
      this.lastOpportunityEndedAtMs = atMs;
      this.activeOpportunity = null;
    }
  }

  private rearmSatisfied(atMs: number): boolean {
    const floor = this.pipeline.config().rearmFloorMs;
    if (this.lastOpportunityEndedAtMs == null) return true;
    return atMs - this.lastOpportunityEndedAtMs >= floor;
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
      opportunityStartedAtMs: args.opportunityStartedAtMs
    };
  }

  private afterSnapshot(
    snap: ReturnType<GoldHunterFeaturePipeline["onSpot"]>,
    receiveSeq: number,
    receivedAtMs: number
  ): GoldHunterSelectorTickResult {
    this.lastSnapshot = snap;
    this.lastObservationAt = new Date(receivedAtMs).toISOString();

    const hit = snap.selected;
    if (!hit) {
      this.endActiveOpportunity(receivedAtMs);
      return {
        selectedNow: false,
        newOpportunity: false,
        candidate: this.lastCandidateForDisplay,
        opportunity: null
      };
    }

    const letter = setupLetter(hit.setup);
    if (!letter) {
      this.endActiveOpportunity(receivedAtMs);
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

    const spread = ask - bid;
    const depthExecutable = isDepthExecutableForOrder(snap.depthValidity);
    const sameActive =
      this.activeOpportunity != null &&
      this.activeOpportunity.setup === letter &&
      this.activeOpportunity.side === hit.side &&
      this.activeOpportunity.resyncGeneration === this.resyncGeneration;

    if (sameActive && this.activeOpportunity) {
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
        consumed: this.activeOpportunity.consumed
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
      this.endActiveOpportunity(receivedAtMs);
    }

    if (!this.rearmSatisfied(receivedAtMs)) {
      // Selected for display, but rearm floor not yet met — no new opportunity.
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
        consumed: true // not executable
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
      consumed: false
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
      consumed: false
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
      distHigh1s: 0,
      distLow1s: 0,
      distHigh5s: 0,
      distLow5s: 0,
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
            reasons: ["test"]
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
