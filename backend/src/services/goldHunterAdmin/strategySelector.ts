/**
 * GoldHunterStrategySelector — production A/B/C selector.
 * Consumes real GH-normalized Spot + Depth events. Not Fast AutoTrade.
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
  signalId: string;
  signalTimestamp: string;
  receiveSeq: number;
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
};

export type GoldHunterSelectorReadiness = {
  /** Pipeline constructed and accepting events. */
  operational: boolean;
  spotSourceAttached: boolean;
  depthSourceAttached: boolean;
  normalizationReady: boolean;
  fatalBlocker: string | null;
  /** Truthful CONNECTED when wired; market closed is unrelated. */
  connected: boolean;
};

function setupLetter(setupId: string): GoldHunterSetupLetter | null {
  if (setupId.startsWith("A_")) return "A";
  if (setupId.startsWith("B_")) return "B";
  if (setupId.startsWith("C_")) return "C";
  return null;
}

/** Deterministic immutable signal id — stable across status polls for same opportunity. */
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
  const mid = ((args.bid + args.ask) / 2).toFixed(3);
  const q = args.quality.toFixed(4);
  const material = [
    GH_ADMIN_STRATEGY_ID,
    args.setup,
    args.side,
    `rs${args.resyncGeneration}`,
    `bg${args.bookGeneration}`,
    `seq${args.receiveSeq}`,
    mid,
    q
  ].join("|");
  const hash = createHash("sha256").update(material).digest("hex").slice(0, 20);
  return `GH-${args.setup}${args.side[0]}-${args.receiveSeq}-${hash}`;
}

export function isDepthExecutableForOrder(
  validity: ResearchDepthValidity
): boolean {
  return validity === "DEPTH_VALID";
}

export class GoldHunterStrategySelector {
  private readonly pipeline: GoldHunterFeaturePipeline;
  private receiveSeq = 0;
  private resyncGeneration = 0;
  private spotSourceAttached = false;
  private depthSourceAttached = false;
  private operational = false;
  private fatalBlocker: string | null = null;
  private lastSnapshot: ReturnType<GoldHunterFeaturePipeline["onSpot"]> | null =
    null;
  private lastCandidate: GoldHunterSelectedCandidate | null = null;
  private lastObservationAt: string | null = null;

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
    this.lastCandidate = null;
    this.lastSnapshot = null;
  }

  onSpot(args: {
    receivedAtMs: number;
    bid: number | null;
    ask: number | null;
    symbolId?: string | number;
    brokerTimestampMs?: number | null;
    receiveSeq?: number;
  }): GoldHunterSelectedCandidate | null {
    this.receiveSeq += 1;
    const seq = args.receiveSeq ?? this.receiveSeq;
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
  }): GoldHunterSelectedCandidate | null {
    this.receiveSeq += 1;
    const seq = args.receiveSeq ?? this.receiveSeq;
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

  private afterSnapshot(
    snap: ReturnType<GoldHunterFeaturePipeline["onSpot"]>,
    receiveSeq: number,
    receivedAtMs: number
  ): GoldHunterSelectedCandidate | null {
    this.lastSnapshot = snap;
    this.lastObservationAt = new Date(receivedAtMs).toISOString();

    const hit = snap.selected;
    if (!hit) {
      // Keep last candidate sticky until resync/consumed externally — polling stability.
      return this.lastCandidate;
    }
    const letter = setupLetter(hit.setup);
    if (!letter) return this.lastCandidate;

    const bid = snap.lastFeatureSpot?.bid ?? snap.bestBid;
    const ask = snap.lastFeatureSpot?.ask ?? snap.bestAsk;
    if (bid == null || ask == null || !(ask >= bid)) {
      return this.lastCandidate;
    }
    const spread = ask - bid;
    const depthExecutable = isDepthExecutableForOrder(snap.depthValidity);
    // Executable candidate requires valid depth; still record diagnostic candidate.
    const signalId = buildGoldHunterSignalId({
      setup: letter,
      side: hit.side,
      receiveSeq,
      bookGeneration: snap.bookGeneration,
      resyncGeneration: this.resyncGeneration,
      bid,
      ask,
      quality: hit.quality
    });

    // Same opportunity identity → keep prior object (incl. consumed flag).
    if (this.lastCandidate && this.lastCandidate.signalId === signalId) {
      return this.lastCandidate;
    }

    this.lastCandidate = {
      strategy: GH_ADMIN_STRATEGY_ID,
      setup: letter,
      setupId: hit.setup,
      side: hit.side,
      quality: hit.quality,
      signalId,
      signalTimestamp: new Date(receivedAtMs).toISOString(),
      receiveSeq,
      bookGeneration: snap.bookGeneration,
      resyncGeneration: this.resyncGeneration,
      bid,
      ask,
      spread,
      depthValidity: snap.depthValidity,
      depthExecutable,
      normalizationVersion: GH_FAST_MARKET_DATA_NORMALIZATION_VERSION,
      featureSchema: GOLD_HUNTER_FAST_STRATEGY_VERSION,
      mid: (bid + ask) / 2,
      consumed: false
    };
    return this.lastCandidate;
  }

  markConsumed(signalId: string): void {
    if (this.lastCandidate?.signalId === signalId) {
      this.lastCandidate = { ...this.lastCandidate, consumed: true };
    }
  }

  getLastCandidate(): GoldHunterSelectedCandidate | null {
    return this.lastCandidate;
  }

  /** Candidate eligible for Demo order path (depth-gated). */
  getExecutableCandidate(): GoldHunterSelectedCandidate | null {
    const c = this.lastCandidate;
    if (!c || c.consumed) return null;
    if (!c.depthExecutable) return null;
    return c;
  }

  getLastSnapshot() {
    return this.lastSnapshot;
  }

  getLastObservationAt(): string | null {
    return this.lastObservationAt;
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
