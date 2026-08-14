/**
 * Completed 1-minute bars for FAST_AUTOTRADE_V1 evaluation.
 * Reuses the existing Open API trendbar pipeline (same pattern as
 * demoProfitLockCandles). Isolated from display-only candleService.
 */

import {
  assertBrokerUser,
  ensureFreshAccessToken
} from "../connectionService";
import { getConnection } from "../connectionStore";
import { createOpenApiClient, type TrendbarCandle } from "../openApiClient";
import { FAST_EXTENSION_M1_HISTORY } from "./types";

export const M1_PERIOD_SECONDS = 60;
export const DEFAULT_MAX_COMPLETED_M1_AGE_MS = 180_000;

export type CompletedM1Loader = (args: {
  ownerUid: string;
  count?: number;
  nowMs?: number;
}) => Promise<TrendbarCandle[]>;

let loaderOverride: CompletedM1Loader | null = null;

/** Test override — inject completed 1m bars without hitting the broker. */
export function useCompletedM1LoaderForTests(loader: CompletedM1Loader | null): void {
  loaderOverride = loader;
}

/**
 * Return completed (fully closed) M1 bars, oldest → newest.
 * The currently forming bar is excluded.
 */
export function filterCompletedM1Bars(
  bars: TrendbarCandle[],
  nowMs: number = Date.now()
): TrendbarCandle[] {
  const nowSec = Math.floor(nowMs / 1000);
  const sorted = [...bars].sort((a, b) => a.time - b.time);
  return sorted.filter((b) => b.time + M1_PERIOD_SECONDS <= nowSec);
}

export function classifyCompletedM1Freshness(args: {
  bars: TrendbarCandle[] | null | undefined;
  nowMs: number;
  maxAgeMs?: number;
  loaderFailed?: boolean;
}): {
  availability: import("./types").FastM1Availability;
  latest: TrendbarCandle | null;
  prior: TrendbarCandle | null;
  completedAtMs: number | null;
} {
  if (args.loaderFailed || !args.bars) {
    return { availability: "UNAVAILABLE", latest: null, prior: null, completedAtMs: null };
  }
  const completed = filterCompletedM1Bars(args.bars, args.nowMs);
  if (!completed.length) {
    return { availability: "UNAVAILABLE", latest: null, prior: null, completedAtMs: null };
  }
  const latest = completed[completed.length - 1]!;
  const prior = completed.length >= 2 ? completed[completed.length - 2]! : null;
  const completedAtMs = (latest.time + M1_PERIOD_SECONDS) * 1000;
  const maxAge = args.maxAgeMs ?? DEFAULT_MAX_COMPLETED_M1_AGE_MS;
  if (args.nowMs - completedAtMs > maxAge) {
    return { availability: "STALE", latest, prior, completedAtMs };
  }
  return { availability: "OK", latest, prior, completedAtMs };
}

export async function loadCompletedM1BarsForFastAutoTrade(args: {
  ownerUid: string;
  count?: number;
  nowMs?: number;
}): Promise<TrendbarCandle[]> {
  if (loaderOverride) {
    return loaderOverride(args);
  }
  assertBrokerUser(args.ownerUid);
  const connection = await getConnection(args.ownerUid);
  if (!connection?.selectedAccountId || !connection.symbolId) {
    return [];
  }
  const clientId = (process.env.CTRADER_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.CTRADER_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) return [];
  try {
    const { accessToken, connection: fresh } =
      await ensureFreshAccessToken(connection);
    const client = createOpenApiClient();
    if (!client.fetchTrendbars) return [];
    const bars = await client.fetchTrendbars({
      accessToken,
      clientId,
      clientSecret,
      ctidTraderAccountId: fresh.selectedAccountId!,
      symbolId: fresh.symbolId!,
      period: "M1",
      count: args.count ?? FAST_EXTENSION_M1_HISTORY,
      isLive: Boolean(fresh.selectedAccountIsLive)
    });
    return filterCompletedM1Bars(bars, args.nowMs ?? Date.now());
  } catch {
    return [];
  }
}
