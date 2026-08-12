/**
 * Completed M5 bars for Demo profit-lock continuation confirmation.
 * Isolated from display-only candleService; injectable in tests.
 */

import {
  assertBrokerUser,
  ensureFreshAccessToken
} from "./connectionService";
import { getConnection } from "./connectionStore";
import { createOpenApiClient, type TrendbarCandle } from "./openApiClient";

const M5_SECONDS = 5 * 60;

/**
 * Return completed (fully closed) M5 bars, oldest → newest.
 * The currently forming bar is excluded.
 */
export function filterCompletedM5Bars(
  bars: TrendbarCandle[],
  nowMs: number = Date.now()
): TrendbarCandle[] {
  const nowSec = Math.floor(nowMs / 1000);
  const sorted = [...bars].sort((a, b) => a.time - b.time);
  return sorted.filter((b) => b.time + M5_SECONDS <= nowSec);
}

export async function loadCompletedM5BarsForProfitLock(args: {
  ownerUid: string;
  count?: number;
  nowMs?: number;
}): Promise<TrendbarCandle[]> {
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
      period: "M5",
      count: args.count ?? 6,
      isLive: Boolean(fresh.selectedAccountIsLive)
    });
    return filterCompletedM5Bars(bars, args.nowMs ?? Date.now());
  } catch {
    return [];
  }
}
