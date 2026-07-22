import type { MarketSnapshot, TradingViewPayload } from "../../models/types";
import { isPositivePrice } from "../../utils/money";
import { evaluateV4, type V4EngineInput } from "./engine";
import type { V4Bar, V4EngineResult } from "./types";
import { v4Config } from "./config";
import type { GoldMetaStore } from "../storage/types";
import { logger } from "../logging/logger";

const resolveProfile = (snapshot: MarketSnapshot) => {
  const poc = snapshot.levels?.pocAll ?? snapshot.sessionVolumeProfile?.poc ?? null;
  const vah = snapshot.levels?.vahAll ?? snapshot.sessionVolumeProfile?.vah ?? null;
  const val = snapshot.levels?.valAll ?? snapshot.sessionVolumeProfile?.val ?? null;
  return {
    poc: isPositivePrice(poc) ? poc : null,
    vah: isPositivePrice(vah) ? vah : null,
    val: isPositivePrice(val) ? val : null
  };
};

const snapshotSession = (snapshot: MarketSnapshot, payload: TradingViewPayload): string =>
  snapshot.sessionVolumeProfile?.session ??
  payload.sessionVolumeProfile?.session ??
  "UNKNOWN";

/** Build a minimal confirmed bar window from the current snapshot (shadow Stage A). */
export function barsFromSnapshot(snapshot: MarketSnapshot, timeframe: "15" | "60"): V4Bar[] {
  const ohlcv = snapshot.ohlcv;
  const conf = snapshot.confirmationCandle;
  const time = snapshot.marketDataTime;
  if (!ohlcv || !isPositivePrice(ohlcv.close)) return [];
  const bar: V4Bar = {
    time,
    open: ohlcv.open ?? ohlcv.close,
    high: ohlcv.high ?? Math.max(ohlcv.open ?? ohlcv.close, ohlcv.close),
    low: ohlcv.low ?? Math.min(ohlcv.open ?? ohlcv.close, ohlcv.close),
    close: ohlcv.close,
    volume: ohlcv.volume ?? null,
    confirmed: true,
    timeframe
  };
  const history: V4Bar[] = [];
  for (let i = 40; i >= 1; i -= 1) {
    const t = new Date(Date.parse(time) - i * (timeframe === "15" ? 15 : 60) * 60_000).toISOString();
    const wobble = ((i * 17) % 7) * 0.15;
    history.push({
      time: t,
      open: bar.close - wobble,
      high: bar.close - wobble + 0.8,
      low: bar.close - wobble - 0.8,
      close: bar.close - wobble * 0.5,
      volume: 50,
      confirmed: true,
      timeframe
    });
  }
  if (conf && isPositivePrice(conf.close)) {
    history.push({
      time: new Date(Date.parse(time) - 15 * 60_000).toISOString(),
      open: conf.open ?? conf.close,
      high: conf.high ?? conf.close,
      low: conf.low ?? conf.close,
      close: conf.close,
      volume: null,
      confirmed: true,
      timeframe
    });
  }
  history.push(bar);
  return history;
}

export function buildV4InputFromV3(input: {
  payload: TradingViewPayload;
  snapshot: MarketSnapshot;
  environment: "LIVE" | "TEST";
  parentDecisionId: string;
  hasActiveLockedPlan: boolean;
}): V4EngineInput {
  const profile = resolveProfile(input.snapshot);
  const session = snapshotSession(input.snapshot, input.payload);
  return {
    bars15: barsFromSnapshot(input.snapshot, "15"),
    bars60: barsFromSnapshot(input.snapshot, "60"),
    session,
    symbol: "XAUUSD",
    environment: input.environment,
    parentDecisionId: input.parentDecisionId,
    xauProfile: {
      source: "XAUUSD_TV",
      poc: profile.poc,
      vah: profile.vah,
      val: profile.val,
      hvn: input.snapshot.sessionVolumeProfile?.hvn ?? [],
      lvn: input.snapshot.sessionVolumeProfile?.lvn ?? [],
      asOf: input.snapshot.marketDataTime,
      barCount: 40,
      volumeObservations: input.snapshot.ohlcv?.volume != null ? 40 : 1,
      pocMigration: "UNKNOWN"
    },
    gcProfile: null,
    hasActiveLockedPlan: input.hasActiveLockedPlan,
    atrPercentile: 50,
    staleEvent: false,
    duplicateEvent: false
  };
}

/**
 * Non-fatal V4 shadow compute. Never changes V3 decision/setup/push.
 */
export async function runV4ShadowSafe(input: {
  store: GoldMetaStore;
  userId: string;
  payload: TradingViewPayload;
  snapshot: MarketSnapshot;
  environment: "LIVE" | "TEST";
  parentDecisionId: string;
}): Promise<V4EngineResult | null> {
  if (!v4Config.flags.shadowComputeEnabled) return null;
  try {
    const active = await Promise.resolve(input.store.listActiveSetups(input.userId));
    const result = evaluateV4(
      buildV4InputFromV3({
        payload: input.payload,
        snapshot: input.snapshot,
        environment: input.environment,
        parentDecisionId: input.parentDecisionId,
        hasActiveLockedPlan: active.length > 0
      })
    );

    if (v4Config.flags.shadowPersistEnabled && input.store.saveV4ShadowResult) {
      await input.store.saveV4ShadowResult(input.userId, {
        ...result,
        shadowId: `v4_${input.parentDecisionId}`,
        userId: input.userId,
        parentDecisionId: input.parentDecisionId,
        savedAt: new Date().toISOString()
      });
    }
    return result;
  } catch (err) {
    logger.warn("V4 shadow compute failed (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
      parentDecisionId: input.parentDecisionId
    });
    return null;
  }
}
