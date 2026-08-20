/**
 * Immediate bounded broker-position entry recovery while a GH Demo trade is
 * still OPEN / PENDING_RECONCILIATION.
 * Settlement BROKER_DEAL_SETTLEMENT remains the fallback — this path must run
 * while the position is live so Smart Loss / Smart PM can manage it.
 */
import type { BrokerOpenPosition } from "../broker/ctrader/openApiClient";
import { reconcileDemoBrokerPositions } from "../broker/ctrader/demoPositionMutations";
import { registerGoldHunterOpenPositionForOwner } from "./demoPositionManager";
import {
  signalGoldHunterEntryIntegrityRecovered,
  tradeHasAuthoritativeEntryIntegrity
} from "./entryIntegrity";
import {
  repairGoldHunterTradeFromBrokerPosition
} from "./entryRepair";
import { isValidGoldHunterEntryPrice } from "./entryValidity";
import type { BrokerDemoPositionLite } from "./reconcilePositions";
import { upsertGoldHunterDemoTrade } from "./tradeStore";
import type { GoldHunterDemoTrade } from "./types";

export const GH_IMMEDIATE_ENTRY_RECOVERY_TIMEOUT_MS = 2_500;

export type ImmediateOpenEntryRecoveryResult = {
  recovered: boolean;
  trade: GoldHunterDemoTrade;
  reason:
    | "RECOVERED_OPEN"
    | "NO_POSITION_ID"
    | "POSITIONS_READ_FAILED"
    | "POSITION_NOT_FOUND"
    | "ENTRY_STILL_INVALID"
    | "ALREADY_VALID"
    | "TIMEOUT"
    | "SKIPPED_STATUS";
};

function toLite(p: BrokerOpenPosition): BrokerDemoPositionLite {
  return {
    positionId: String(p.positionId),
    comment: p.comment ?? null,
    label: p.label ?? null,
    side: p.side === "SELL" ? "SELL" : p.side === "BUY" ? "BUY" : null,
    volumeLots: p.volumeLots ?? null,
    entryPrice: p.entryPrice ?? null,
    stopLoss: p.stopLoss ?? null
  };
}

function withTimeout<T>(ms: number, work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(
        Object.assign(new Error("IMMEDIATE_ENTRY_RECOVERY_TIMEOUT"), {
          code: "TIMEOUT",
          timeoutMs: ms
        })
      );
    }, ms);
    work()
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch((e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
  });
}

/**
 * Bounded open-position read + entry backfill for a single pending GH trade.
 * Never places orders. Never invents prices.
 */
export async function recoverGoldHunterOpenEntryImmediate(args: {
  ownerUid: string;
  trade: GoldHunterDemoTrade;
  bid?: number | null;
  ask?: number | null;
  timeoutMs?: number;
  /** Test hook — inject open positions without broker I/O. */
  listPositions?: (ownerUid: string) => Promise<BrokerOpenPosition[]>;
}): Promise<ImmediateOpenEntryRecoveryResult> {
  const trade = args.trade;
  if (
    trade.status !== "PENDING_RECONCILIATION" &&
    trade.status !== "ACCEPTED_PENDING_FILL"
  ) {
    return { recovered: false, trade, reason: "SKIPPED_STATUS" };
  }

  if (!trade.brokerPositionId) {
    return { recovered: false, trade, reason: "NO_POSITION_ID" };
  }

  const timeoutMs = args.timeoutMs ?? GH_IMMEDIATE_ENTRY_RECOVERY_TIMEOUT_MS;
  let positions: BrokerOpenPosition[];
  try {
    const list =
      args.listPositions ??
      ((uid: string) => reconcileDemoBrokerPositions(uid));
    positions = await withTimeout(timeoutMs, () => list(args.ownerUid));
  } catch (e) {
    const code =
      e && typeof e === "object" && "code" in e
        ? String((e as { code?: string }).code)
        : "";
    if (code === "TIMEOUT") {
      return { recovered: false, trade, reason: "TIMEOUT" };
    }
    return { recovered: false, trade, reason: "POSITIONS_READ_FAILED" };
  }

  const match = positions
    .map(toLite)
    .find((p) => String(p.positionId) === String(trade.brokerPositionId));
  if (!match) {
    return { recovered: false, trade, reason: "POSITION_NOT_FOUND" };
  }
  if (!isValidGoldHunterEntryPrice(match.entryPrice)) {
    return { recovered: false, trade, reason: "ENTRY_STILL_INVALID" };
  }

  const repaired = repairGoldHunterTradeFromBrokerPosition({
    trade,
    position: match
  });
  if (!tradeHasAuthoritativeEntryIntegrity(repaired.trade)) {
    return { recovered: false, trade: repaired.trade, reason: "ENTRY_STILL_INVALID" };
  }

  const recoveredTrade: GoldHunterDemoTrade = {
    ...repaired.trade,
    status: "FILLED",
    result: "OPEN",
    fillTs: repaired.trade.fillTs ?? new Date().toISOString(),
    entryRecoverySource:
      repaired.trade.entryRecoverySource ?? "BROKER_POSITION_RECONCILIATION",
    dataQuality: null,
    errorCode: null
  };
  await upsertGoldHunterDemoTrade(args.ownerUid, recoveredTrade);

  const bid =
    args.bid != null && Number.isFinite(args.bid)
      ? args.bid
      : recoveredTrade.entry!;
  const ask =
    args.ask != null && Number.isFinite(args.ask)
      ? args.ask
      : recoveredTrade.entry!;
  registerGoldHunterOpenPositionForOwner({
    ownerUid: args.ownerUid,
    trade: recoveredTrade,
    bid,
    ask
  });
  signalGoldHunterEntryIntegrityRecovered({
    ownerUid: args.ownerUid,
    reason: "BROKER_POSITION_ENTRY_REPAIRED",
    tradeId: recoveredTrade.goldHunterTradeId
  });

  return {
    recovered: true,
    trade: recoveredTrade,
    reason: "RECOVERED_OPEN"
  };
}
