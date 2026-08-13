/**
 * Offline replay — SAME engine core as LIVE (no separate magical backtester).
 */
import { GoldHunterFastEngine } from "./engine";
import type { GhFastConfig, GhFastMarketEvent } from "./types";
import { ShadowExecutionAdapter } from "./executionAdapter";

export type ReplayResult = {
  decisions: number;
  shadowOrders: number;
  closedTrades: number;
  brokerRequests: 0;
  brokerOrders: 0;
  latency: ReturnType<GoldHunterFastEngine["latency"]["percentiles"]>;
  netPnl: number;
};

export async function replayGhFastEvents(args: {
  events: GhFastMarketEvent[];
  config?: Partial<GhFastConfig>;
}): Promise<{ engine: GoldHunterFastEngine; result: ReplayResult }> {
  const adapter = new ShadowExecutionAdapter();
  const engine = new GoldHunterFastEngine({
    config: args.config,
    adapter
  });
  for (const ev of args.events) {
    await engine.onMarketEvent(ev);
  }
  const netPnl = engine.closed.reduce((s, t) => s + t.netMove, 0);
  return {
    engine,
    result: {
      decisions: engine.decisions.length,
      shadowOrders: adapter.orders.length,
      closedTrades: engine.closed.length,
      brokerRequests: 0,
      brokerOrders: 0,
      latency: engine.latency.percentiles(),
      netPnl
    }
  };
}

/**
 * Equivalence helper: run the same event list twice; decisions/actions must match.
 */
export async function assertReplayDeterministic(
  events: GhFastMarketEvent[],
  config?: Partial<GhFastConfig>
): Promise<boolean> {
  const a = await replayGhFastEvents({ events, config });
  const b = await replayGhFastEvents({ events, config });
  if (a.result.decisions !== b.result.decisions) return false;
  if (a.result.shadowOrders !== b.result.shadowOrders) return false;
  for (let i = 0; i < a.engine.decisions.length; i++) {
    const da = a.engine.decisions[i]!;
    const db = b.engine.decisions[i]!;
    if (da.action !== db.action || da.state !== db.state) return false;
  }
  return true;
}
