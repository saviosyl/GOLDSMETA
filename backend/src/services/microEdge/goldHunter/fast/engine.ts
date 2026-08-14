/**
 * GOLD_HUNTER FAST event-driven engine.
 * Spot + Depth events → features → setups → shadow enter/exit.
 * One position max. No martingale/grid/averaging. Hot path is in-memory only.
 */
import { InMemoryDepthBook } from "./depthBook";
import { defaultGhFastConfig } from "./defaults";
import {
  ForbiddenLiveExecutionAdapter,
  ShadowExecutionAdapter,
  type GhFastExecutionAdapter
} from "./executionAdapter";
import { evaluateOpenExit, openTrade, updateOpenTrade } from "./exits";
import { FastFeatureEngine } from "./features";
import { buildLatencySample, LatencyTracker, LatencyTracker as LT } from "./latency";
import { evaluateSetups } from "./setups";
import {
  diagnoseSetupNearMisses,
  GhFastRejectionCounter,
  mapDecisionReasonsToRejections
} from "./rejectionDiagnostics";
import type {
  GhFastClosedTrade,
  GhFastConfig,
  GhFastDecision,
  GhFastHuntState,
  GhFastMarketEvent,
  GhFastOpenTrade,
  GhFastShadowOrder,
  GhFastSetupId
} from "./types";
import {
  GH_FAST_BROKER_EXECUTION_ENABLED,
  GH_FAST_MAX_OPEN_POSITIONS,
  GH_FAST_MUTATION_SURFACE,
  GH_FAST_SHADOW_ONLY
} from "./versions";
import { getFrozenGhFastIdentity } from "./frozenConfig";

// Ensure forbidden adapter cannot be silently imported for wiring mistakes in tests.
void ForbiddenLiveExecutionAdapter;

export type GhFastEngineStatus = {
  state: GhFastHuntState;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  eventRate1s: number;
  depthImbalance: number;
  velocity: number;
  acceleration: number;
  setup: string | null;
  setupQuality: number;
  openTrade: GhFastOpenTrade | null;
  shadowOrders: number;
  brokerRequests: 0;
  brokerOrders: 0;
  shadowOnly: true;
  brokerExecutionEnabled: false;
  mutationSurface: "NONE";
  latency: ReturnType<LatencyTracker["percentiles"]>;
};

export class GoldHunterFastEngine {
  readonly depth = new InMemoryDepthBook();
  readonly features = new FastFeatureEngine();
  readonly latency = new LatencyTracker();
  readonly adapter: GhFastExecutionAdapter;
  readonly closed: GhFastClosedTrade[] = [];
  readonly decisions: GhFastDecision[] = [];
  readonly rejections = new GhFastRejectionCounter();
  readonly setupDetections: Record<GhFastSetupId, number> = {
    A_MOMENTUM_IGNITION: 0,
    B_FAST_BREAKOUT: 0,
    C_PULLBACK_REACCEL: 0
  };
  readonly entryTimestampsMs: number[] = [];

  private cfg: GhFastConfig;
  private frozenIdentity = getFrozenGhFastIdentity();
  private state: GhFastHuntState = "HUNTING";
  private open: GhFastOpenTrade | null = null;
  private lastBid: number | null = null;
  private lastAsk: number | null = null;
  private lastBidTs = 0;
  private lastAskTs = 0;
  private lastDepthTs = 0;
  private lastFeatEventRate = 0;
  private lastVel = 0;
  private lastAccel = 0;
  private lastSetup: string | null = null;
  private lastQuality = 0;
  private rearmUntil = 0;
  private lastEventKey = "";
  private tradeSeq = 0;
  private brokerRequests = 0;
  /** After market-data reset — block entries until book + features warm. */
  private warmingUp = false;
  private sampleTagMode: "PRE_FIX_DIAGNOSTIC" | "QUALIFICATION" =
    "PRE_FIX_DIAGNOSTIC";
  private qualificationStartSequence: number | null = null;
  private qualificationStartTimeMs: number | null = null;

  constructor(opts?: {
    config?: Partial<GhFastConfig>;
    adapter?: GhFastExecutionAdapter;
    /** When true (soak), force frozen config and ignore overrides. */
    useFrozenSoakConfig?: boolean;
  }) {
    if (opts?.useFrozenSoakConfig) {
      this.cfg = { ...this.frozenIdentity.config };
    } else {
      this.cfg = defaultGhFastConfig(opts?.config);
    }
    this.adapter = opts?.adapter ?? new ShadowExecutionAdapter();
    if (GH_FAST_BROKER_EXECUTION_ENABLED !== false) {
      throw new Error("REFUSING: GH_FAST_BROKER_EXECUTION_ENABLED must be false");
    }
    if (this.adapter.mutationSurface !== GH_FAST_MUTATION_SURFACE) {
      throw new Error("REFUSING: adapter mutationSurface must be NONE");
    }
    if (this.adapter.shadowOnly !== GH_FAST_SHADOW_ONLY) {
      throw new Error("REFUSING: adapter must be shadowOnly");
    }
  }

  frozen(): ReturnType<typeof getFrozenGhFastIdentity> {
    return this.frozenIdentity;
  }

  getConfig(): GhFastConfig {
    return { ...this.cfg };
  }

  status(): GhFastEngineStatus {
    return {
      state: this.state,
      bid: this.lastBid,
      ask: this.lastAsk,
      spread:
        this.lastBid != null && this.lastAsk != null
          ? this.lastAsk - this.lastBid
          : null,
      eventRate1s: this.lastFeatEventRate,
      depthImbalance: this.depth.stats(this.cfg.depthTopN).depthImbalance,
      velocity: this.lastVel,
      acceleration: this.lastAccel,
      setup: this.lastSetup,
      setupQuality: this.lastQuality,
      openTrade: this.open,
      shadowOrders:
        this.adapter instanceof ShadowExecutionAdapter
          ? this.adapter.orders.length
          : 0,
      brokerRequests: 0,
      brokerOrders: 0,
      shadowOnly: true,
      brokerExecutionEnabled: false,
      mutationSurface: "NONE",
      latency: this.latency.percentiles()
    };
  }

  shadowOrders(): GhFastShadowOrder[] {
    return this.adapter instanceof ShadowExecutionAdapter
      ? [...this.adapter.orders]
      : [];
  }

  isWarmingUp(): boolean {
    return this.warmingUp;
  }

  qualificationMarker(): {
    startSequence: number | null;
    startTimeMs: number | null;
  } {
    return {
      startSequence: this.qualificationStartSequence,
      startTimeMs: this.qualificationStartTimeMs
    };
  }

  /**
   * Begin formal qualification sample. Prior closed trades are tagged
   * PRE_FIX_DIAGNOSTIC and excluded from the formal count.
   */
  beginQualificationSample(args: {
    receiveSeq: number;
    atMs: number;
  }): void {
    for (const t of this.closed) {
      if (!t.sampleTag || t.sampleTag === "QUALIFICATION") {
        t.sampleTag = "PRE_FIX_DIAGNOSTIC";
      }
    }
    this.qualificationStartSequence = args.receiveSeq;
    this.qualificationStartTimeMs = args.atMs;
    this.sampleTagMode = "QUALIFICATION";
  }

  formalQualificationTrades(): GhFastClosedTrade[] {
    return this.closed.filter((t) => t.sampleTag !== "PRE_FIX_DIAGNOSTIC");
  }

  preFixDiagnosticTrades(): GhFastClosedTrade[] {
    return this.closed.filter((t) => t.sampleTag === "PRE_FIX_DIAGNOSTIC");
  }

  /**
   * Explicit MARKET DATA RESET / RESYNC.
   * Clears Level-II + rolling features + side timestamps.
   * Preserves closed shadow history, soak counters, and frozen config.
   * Safely exits any open shadow trade under DATA_STALE policy.
   */
  async resetMarketDataForResync(args?: {
    reason?: string;
    nowMs?: number;
  }): Promise<{ closedOpen: boolean }> {
    const now = args?.nowMs ?? LT.nowMs();
    let closedOpen = false;
    if (this.open) {
      const bid = this.lastBid ?? this.open.entryBid;
      const ask = this.lastAsk ?? this.open.entryAsk;
      const exitPrice = this.open.side === "BUY" ? bid : ask;
      await this.adapter.submit({
        kind: "EXIT",
        side: this.open.side,
        price: exitPrice,
        timestampMs: now,
        setup: this.open.setup,
        exitReason: "DATA_STALE"
      });
      const gross =
        this.open.side === "BUY"
          ? exitPrice - this.open.entryPrice
          : this.open.entryPrice - exitPrice;
      const net = gross - this.cfg.friction;
      this.closed.push({
        ...this.open,
        exitTs: now,
        exitBid: bid,
        exitAsk: ask,
        exitPrice,
        grossMove: gross,
        additionalFriction: this.cfg.friction,
        netMove: net,
        durationMs: now - this.open.entryTs,
        exitReason: "DATA_STALE",
        result: net > 0 ? "WIN" : net < 0 ? "LOSS" : "BREAKEVEN",
        sampleTag:
          this.sampleTagMode === "QUALIFICATION"
            ? "QUALIFICATION"
            : "PRE_FIX_DIAGNOSTIC"
      });
      this.open = null;
      closedOpen = true;
    }
    this.depth.clearForResync();
    this.features.clear();
    this.lastBid = null;
    this.lastAsk = null;
    this.lastBidTs = 0;
    this.lastAskTs = 0;
    this.lastDepthTs = 0;
    this.lastSetup = null;
    this.lastQuality = 0;
    this.lastVel = 0;
    this.lastAccel = 0;
    this.lastFeatEventRate = 0;
    this.rearmUntil = 0;
    this.lastEventKey = "";
    this.warmingUp = true;
    this.state = "BOOK_REBUILDING";
    return { closedOpen };
  }

  /** Hot path: process one market event. No DB/Firestore. */
  async onMarketEvent(ev: GhFastMarketEvent): Promise<GhFastDecision> {
    const t0 = LT.nowMs();
    // Prefer monotonic receiveSeq / explicit eventId — never collapse same-ms distinct events.
    const eventKey =
      ev.eventId ||
      `${ev.kind}:seq=${ev.receiveSeq ?? "na"}`;
    if (ev.receiveSeq != null && eventKey === this.lastEventKey) {
      this.rejections.record("duplicate_event");
      return this.waitDecision(t0, t0, "duplicate_event");
    }
    if (ev.receiveSeq != null) this.lastEventKey = eventKey;

    if (ev.kind === "SPOT") {
      if (ev.bid != null && ev.bid > 0) {
        this.lastBid = ev.bid;
        this.lastBidTs = ev.receivedAtMs;
      }
      if (ev.ask != null && ev.ask > 0) {
        this.lastAsk = ev.ask;
        this.lastAskTs = ev.receivedAtMs;
      }
      if (this.lastBid != null && this.lastAsk != null) {
        this.features.onSpot(ev.receivedAtMs, this.lastBid, this.lastAsk);
      }
    } else {
      this.depth.applyDepthEvent(ev);
      this.lastDepthTs = ev.receivedAtMs;
    }

    const now = ev.receivedAtMs;
    const depthStats = this.depth.stats(this.cfg.depthTopN);
    const feat = this.features.snapshot(now, depthStats);
    const t1 = LT.nowMs();

    if (!feat || this.lastBid == null || this.lastAsk == null) {
      this.state = this.warmingUp ? "BOOK_REBUILDING" : "DATA_STALE";
      return this.finishDecision({
        t0,
        t1,
        state: this.state,
        action: "WAIT",
        setup: null,
        quality: 0,
        side: null,
        exitReason: null,
        reasons: this.warmingUp
          ? ["book_warming_up", "insufficient_features"]
          : ["insufficient_features"]
      });
    }

    this.lastFeatEventRate = feat.updateRate1s;
    this.lastVel = feat.midVel1s;
    this.lastAccel = feat.acceleration;

    const bidFresh = now - this.lastBidTs <= this.cfg.sideFreshnessMs;
    const askFresh = now - this.lastAskTs <= this.cfg.sideFreshnessMs;
    const depthPresent = this.lastDepthTs > 0 && depthStats.available;
    const depthFresh =
      depthPresent && now - this.lastDepthTs <= this.cfg.depthFreshnessMs;
    const dataOk = bidFresh && askFresh && depthFresh && feat.spread > 0;

    if (feat.spread > this.cfg.maxSpread) {
      this.state = "SPREAD_BLOCKED";
      if (this.open) {
        // Still manage open trade on spread block
      } else {
        this.rejections.record("spread_too_high");
        return this.finishDecision({
          t0,
          t1,
          state: "SPREAD_BLOCKED",
          action: "WAIT",
          setup: null,
          quality: 0,
          side: null,
          exitReason: null,
          reasons: ["spread_blocked", "spread_too_high"]
        });
      }
    }

    // ---- Manage open trade on EVERY event ----
    if (this.open) {
      updateOpenTrade(this.open, feat.bid, feat.ask, this.cfg);
      const exitReason = evaluateOpenExit({
        trade: this.open,
        f: feat,
        cfg: this.cfg,
        dataOk
      });
      if (this.open.harvestRunner && !exitReason) {
        this.state = "RUNNER";
      }
      if (exitReason) {
        const exitPrice =
          this.open.side === "BUY" ? feat.bid : feat.ask;
        const order = await this.adapter.submit({
          kind: "EXIT",
          side: this.open.side,
          price: exitPrice,
          timestampMs: now,
          setup: this.open.setup,
          exitReason
        });
        const tShadow = LT.nowMs();
        const gross =
          this.open.side === "BUY"
            ? exitPrice - this.open.entryPrice
            : this.open.entryPrice - exitPrice;
        const net = gross - this.cfg.friction;
        this.closed.push({
          ...this.open,
          exitTs: now,
          exitBid: feat.bid,
          exitAsk: feat.ask,
          exitPrice,
          grossMove: gross,
          additionalFriction: this.cfg.friction,
          netMove: net,
          durationMs: now - this.open.entryTs,
          exitReason,
          result: net > 0 ? "WIN" : net < 0 ? "LOSS" : "BREAKEVEN",
          sampleTag:
            this.sampleTagMode === "QUALIFICATION"
              ? "QUALIFICATION"
              : "PRE_FIX_DIAGNOSTIC"
        });
        this.open = null;
        this.state =
          exitReason === "RAPID_ABORT" || exitReason === "HARD_PROTECTION"
            ? "ABORT"
            : exitReason === "HARVEST_FADE" || exitReason === "TRAIL_HIT"
              ? "HARVEST"
              : "REHUNT";
        this.rearmUntil = now + this.cfg.rearmFloorMs;
        const dec = this.finishDecision({
          t0,
          t1,
          state: this.state,
          action: "EXIT",
          setup: order?.setup ?? null,
          quality: this.lastQuality,
          side: order?.side ?? null,
          exitReason,
          reasons: [exitReason],
          tShadow
        });
        this.state = "REHUNT";
        return dec;
      }
      const holdState: GhFastHuntState =
        this.state === "RUNNER"
          ? "RUNNER"
          : this.open.side === "BUY"
            ? "STRIKE_BUY"
            : "STRIKE_SELL";
      this.state = holdState;
      this.rejections.record("existing_open_position");
      return this.finishDecision({
        t0,
        t1,
        state: holdState,
        action: "HOLD",
        setup: this.open.setup,
        quality: this.lastQuality,
        side: this.open.side,
        exitReason: null,
        reasons: ["holding", "existing_open_position"]
      });
    }

    if (!dataOk) {
      const crossed = depthStats.crossed;
      if (this.warmingUp) {
        this.state = "BOOK_REBUILDING";
        this.rejections.record("book_warming_up");
        return this.finishDecision({
          t0,
          t1,
          state: "BOOK_REBUILDING",
          action: "WAIT",
          setup: null,
          quality: 0,
          side: null,
          exitReason: null,
          reasons: ["book_warming_up", ...(crossed ? ["crossed_book"] : [])]
        });
      }
      this.state = "DATA_STALE";
      const staleReasons: string[] = [];
      if (!bidFresh || !askFresh) {
        staleReasons.push("spot_stale");
        this.rejections.record("spot_stale");
      }
      if (!depthPresent) {
        if (crossed) {
          staleReasons.push("crossed_book");
          this.rejections.record("crossed_book");
        } else {
          staleReasons.push("depth_unavailable");
          this.rejections.record("depth_unavailable");
        }
      } else if (!depthFresh) {
        staleReasons.push("depth_stale");
        this.rejections.record("depth_stale");
      }
      if (!staleReasons.length) {
        staleReasons.push("data_stale");
        this.rejections.record("data_stale");
      }
      return this.finishDecision({
        t0,
        t1,
        state: "DATA_STALE",
        action: "WAIT",
        setup: null,
        quality: 0,
        side: null,
        exitReason: null,
        reasons: staleReasons
      });
    }

    // Warm-up complete only with sane book + enough feature history.
    if (this.warmingUp) {
      const warmOk =
        depthStats.available &&
        depthStats.bidLevels > 0 &&
        depthStats.askLevels > 0 &&
        !depthStats.crossed &&
        this.features.hasWarmHistory(now, 3000);
      if (!warmOk) {
        this.state = "BOOK_REBUILDING";
        this.rejections.record("book_warming_up");
        return this.finishDecision({
          t0,
          t1,
          state: "BOOK_REBUILDING",
          action: "WAIT",
          setup: null,
          quality: 0,
          side: null,
          exitReason: null,
          reasons: ["book_warming_up", "insufficient_feature_history"]
        });
      }
      this.warmingUp = false;
      this.state = "HUNTING";
    }

    if (now < this.rearmUntil) {
      this.state = "REHUNT";
      this.rejections.record("rearm_floor");
      return this.finishDecision({
        t0,
        t1,
        state: "REHUNT",
        action: "WAIT",
        setup: null,
        quality: 0,
        side: null,
        exitReason: null,
        reasons: ["rearm_floor"]
      });
    }

    // Pressure / arm / strike
    const hit = evaluateSetups(feat, this.cfg);
    if (!hit) {
      const near = diagnoseSetupNearMisses(feat, this.cfg);
      this.rejections.recordMany(near);
      const pressure =
        Math.abs(feat.signedImbalance1s) > 0.25 ||
        Math.abs(feat.depth.depthImbalance) > 0.3;
      this.state = pressure ? "PRESSURE_DETECTED" : "HUNTING";
      this.lastSetup = null;
      this.lastQuality = 0;
      return this.finishDecision({
        t0,
        t1,
        state: this.state,
        action: "WAIT",
        setup: null,
        quality: 0,
        side: null,
        exitReason: null,
        reasons: pressure
          ? ["pressure_detected", ...near]
          : ["hunting", ...near]
      });
    }

    this.setupDetections[hit.setup] += 1;
    this.lastSetup = hit.setup;
    this.lastQuality = hit.quality;
    this.state = "ARMED";

    const expectedMove = Math.abs(feat.midVel1s) * feat.mid;
    const need = this.cfg.friction + this.cfg.safetyBuffer;
    if (expectedMove < need && hit.quality < this.cfg.minSetupQuality + 0.15) {
      this.rejections.record("expected_move_below_friction");
      return this.finishDecision({
        t0,
        t1,
        state: "ARMED",
        action: "WAIT",
        setup: hit.setup,
        quality: hit.quality,
        side: hit.side,
        exitReason: null,
        reasons: ["edge_below_friction_buffer", "expected_move_below_friction", ...hit.reasons]
      });
    }

    if (GH_FAST_MAX_OPEN_POSITIONS !== 1) {
      throw new Error("REFUSING: max open positions must be 1");
    }

    const entryPrice = hit.side === "BUY" ? feat.ask : feat.bid;
    const order = await this.adapter.submit({
      kind: "ENTER",
      side: hit.side,
      price: entryPrice,
      timestampMs: now,
      setup: hit.setup,
      exitReason: null
    });
    const tShadow = LT.nowMs();
    this.tradeSeq += 1;
    this.entryTimestampsMs.push(now);
    this.open = openTrade({
      tradeId: `gh_fast_${this.tradeSeq}_${now}`,
      side: hit.side,
      setup: hit.setup,
      entryTs: now,
      bid: feat.bid,
      ask: feat.ask,
      trailDistance: this.cfg.trailDistance
    });
    this.state = hit.side === "BUY" ? "STRIKE_BUY" : "STRIKE_SELL";
    void order;
    void this.brokerRequests; // always 0 — hot path never hits broker
    void mapDecisionReasonsToRejections;
    return this.finishDecision({
      t0,
      t1,
      state: this.state,
      action: hit.side === "BUY" ? "ENTER_BUY" : "ENTER_SELL",
      setup: hit.setup,
      quality: hit.quality,
      side: hit.side,
      exitReason: null,
      reasons: hit.reasons,
      tShadow
    });
  }

  private waitDecision(
    t0: number,
    t1: number,
    reason: string
  ): GhFastDecision {
    return this.finishDecision({
      t0,
      t1,
      state: this.state,
      action: "WAIT",
      setup: null,
      quality: 0,
      side: null,
      exitReason: null,
      reasons: [reason]
    });
  }

  private finishDecision(args: {
    t0: number;
    t1: number;
    state: GhFastHuntState;
    action: GhFastDecision["action"];
    setup: GhFastDecision["setup"];
    quality: number;
    side: GhFastDecision["side"];
    exitReason: GhFastDecision["exitReason"];
    reasons: string[];
    tShadow?: number;
  }): GhFastDecision {
    const t2 = LT.nowMs();
    const latency = buildLatencySample({
      marketEventReceivedMs: args.t0,
      featuresCalculatedMs: args.t1,
      decisionProducedMs: t2,
      shadowOrderProducedMs: args.tShadow ?? null
    });
    this.latency.record(latency);
    const dec: GhFastDecision = {
      state: args.state,
      action: args.action,
      setup: args.setup,
      setupQuality: args.quality,
      side: args.side,
      exitReason: args.exitReason,
      latency,
      reasons: args.reasons
    };
    this.decisions.push(dec);
    if (this.decisions.length > 20_000) this.decisions.splice(0, 10_000);
    return dec;
  }
}
