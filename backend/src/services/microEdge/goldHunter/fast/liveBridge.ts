/**
 * Optional bridge: Micro live session spot/depth → GOLD_HUNTER FAST engine.
 * Shadow-only. Persistence is off the hot path via collector.
 */
import { spotPriceFromRelative } from "../../marketData/microCTraderProtocol";
import type { MicroLiveMarketSession } from "../../marketData/liveSession";
import { GoldHunterFastEngine } from "./engine";
import { GhFastEventCollector } from "./collector";
import { ShadowExecutionAdapter } from "./executionAdapter";
import type { GhFastConfig, GhFastDepthQuote, GhFastMarketEvent } from "./types";

export type GhFastLiveUi = {
  state: string;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  eventRate1s: number;
  bidDepth: number;
  askDepth: number;
  depthImbalance: number;
  velocity: number;
  acceleration: number;
  setup: string | null;
  setupQuality: number;
  action: string | null;
  decisionLatencyMs: number | null;
  open: {
    side: string;
    entry: number;
    executableExit: number;
    openPnl: number;
    mfe: number;
    mae: number;
    durationMs: number;
    profitLock: boolean;
    trail: number | null;
    exitPressure: string | null;
  } | null;
  shadowOrders: number;
  brokerRequests: 0;
  brokerOrders: 0;
  mutationSurface: "NONE";
  shadowOnly: true;
};

function parseDepthQuotes(raw: unknown): GhFastDepthQuote[] {
  if (!Array.isArray(raw)) return [];
  const out: GhFastDepthQuote[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const q = item as Record<string, unknown>;
    const typeRaw = q.type ?? q.quoteType;
    const type: GhFastDepthQuote["type"] =
      typeRaw === 1 || typeRaw === "BID" || typeRaw === "buy"
        ? "BID"
        : typeRaw === 2 || typeRaw === "ASK" || typeRaw === "sell"
          ? "ASK"
          : typeof typeRaw === "number"
            ? (typeRaw as 1 | 2)
            : "BID";
    const price =
      typeof q.price === "number" && q.price > 100
        ? spotPriceFromRelative(q.price) ?? Number(q.price)
        : Number(q.price);
    const size = Number(q.size ?? q.volume ?? 0);
    if (!(price > 0)) continue;
    out.push({
      id: (q.id as string | number | undefined) ?? undefined,
      type,
      price,
      size: Number.isFinite(size) ? size : 0
    });
  }
  return out;
}

export class GoldHunterFastLiveBridge {
  readonly engine: GoldHunterFastEngine;
  readonly collector: GhFastEventCollector | null;
  private unsubs: Array<() => void> = [];
  private lastAction: string | null = null;

  constructor(opts?: {
    config?: Partial<GhFastConfig>;
    collectDir?: string;
    enableCollector?: boolean;
  }) {
    const adapter = new ShadowExecutionAdapter();
    this.engine = new GoldHunterFastEngine({
      config: opts?.config,
      adapter
    });
    this.collector =
      opts?.enableCollector === false
        ? null
        : new GhFastEventCollector({ dir: opts?.collectDir });
  }

  attach(session: MicroLiveMarketSession): void {
    this.detach();
    this.unsubs.push(
      session.onSpotForFast((payload) => {
        void this.onSpotPayload(payload);
      })
    );
    this.unsubs.push(
      session.onDepthForFast((payload) => {
        void this.onDepthPayload(payload);
      })
    );
  }

  detach(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  private async onSpotPayload(payload: Record<string, unknown>): Promise<void> {
    const now = Date.now();
    const bid =
      payload.bid != null ? spotPriceFromRelative(payload.bid) : null;
    const ask =
      payload.ask != null ? spotPriceFromRelative(payload.ask) : null;
    const ev: GhFastMarketEvent = {
      kind: "SPOT",
      receivedAtMs: now,
      brokerTimestampMs:
        typeof payload.timestamp === "number" ? payload.timestamp : null,
      bid,
      ask,
      symbolId: payload.symbolId as string | number | undefined
    };
    await this.handle(ev);
  }

  private async onDepthPayload(payload: Record<string, unknown>): Promise<void> {
    const now = Date.now();
    const ev: GhFastMarketEvent = {
      kind: "DEPTH",
      receivedAtMs: now,
      brokerTimestampMs:
        typeof payload.timestamp === "number" ? payload.timestamp : null,
      symbolId: payload.symbolId as string | number | undefined,
      newQuotes: parseDepthQuotes(payload.newQuotes),
      deletedQuotes: Array.isArray(payload.deletedQuotes)
        ? (payload.deletedQuotes as Array<{ id: string | number }>)
        : []
    };
    await this.handle(ev);
  }

  private async handle(ev: GhFastMarketEvent): Promise<void> {
    const decision = await this.engine.onMarketEvent(ev);
    this.lastAction = decision.action;
    if (this.collector) {
      const st = this.engine.status();
      // Off hot-path style: enqueue after decision (sync buffer; flush chunked).
      this.collector.record({
        t: ev.receivedAtMs,
        event: ev,
        decision,
        status: {
          state: st.state,
          bid: st.bid,
          ask: st.ask,
          spread: st.spread,
          depthImbalance: st.depthImbalance,
          velocity: st.velocity,
          acceleration: st.acceleration,
          setup: st.setup,
          setupQuality: st.setupQuality
        },
        depthTop: this.engine.depth.snapshot(5)
      });
    }
  }

  uiStatus(): GhFastLiveUi {
    const st = this.engine.status();
    const depth = this.engine.depth.stats(5);
    const open = st.openTrade;
    const now = Date.now();
    let openUi: GhFastLiveUi["open"] = null;
    if (open && st.bid != null && st.ask != null) {
      const exec = open.side === "BUY" ? st.bid : st.ask;
      const pnl =
        open.side === "BUY" ? exec - open.entryPrice : open.entryPrice - exec;
      openUi = {
        side: open.side,
        entry: open.entryPrice,
        executableExit: exec,
        openPnl: pnl,
        mfe: open.mfe,
        mae: open.mae,
        durationMs: now - open.entryTs,
        profitLock: open.profitLockActive,
        trail: open.lockFloor,
        exitPressure: open.harvestRunner ? "RUNNER" : null
      };
    }
    return {
      state: st.state,
      bid: st.bid,
      ask: st.ask,
      spread: st.spread,
      eventRate1s: st.eventRate1s,
      bidDepth: depth.bidDepthN,
      askDepth: depth.askDepthN,
      depthImbalance: st.depthImbalance,
      velocity: st.velocity,
      acceleration: st.acceleration,
      setup: st.setup,
      setupQuality: st.setupQuality,
      action: this.lastAction,
      decisionLatencyMs: st.latency.p50,
      open: openUi,
      shadowOrders: st.shadowOrders,
      brokerRequests: 0,
      brokerOrders: 0,
      mutationSurface: "NONE",
      shadowOnly: true
    };
  }
}

let bridgeSingleton: GoldHunterFastLiveBridge | null = null;

export function getGoldHunterFastLiveBridge(): GoldHunterFastLiveBridge {
  if (!bridgeSingleton) bridgeSingleton = new GoldHunterFastLiveBridge();
  return bridgeSingleton;
}

export function resetGoldHunterFastLiveBridgeForTests(): void {
  bridgeSingleton?.detach();
  bridgeSingleton = null;
}
