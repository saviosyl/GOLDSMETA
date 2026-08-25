/**
 * Reconcile broker Demo positions with Gold Hunter ownership.
 */
import { GH_ADMIN_STRATEGY_ID, type GoldHunterDemoTrade } from "./types";
import { listGoldHunterDemoTrades, upsertGoldHunterDemoTrade } from "./tradeStore";
import {
  goldHunterFrozenInitialRiskPrice,
  repairGoldHunterTradeFromBrokerPosition
} from "./entryRepair";
import { isValidGoldHunterEntryPrice } from "./entryValidity";
import {
  maybeSignalEntryIntegrityFromReconcileCycle,
  signalGoldHunterEntryIntegrityRecovered,
  tradeHasAuthoritativeEntryIntegrity
} from "./entryIntegrity";

export type BrokerDemoPositionLite = {
  positionId: string;
  comment?: string | null;
  label?: string | null;
  side?: "BUY" | "SELL" | null;
  volumeLots?: number | null;
  entryPrice?: number | null;
  stopLoss?: number | null;
};

export type ReconcileResult = {
  restored: GoldHunterDemoTrade[];
  unmatched: Array<{
    label: "UNMATCHED DEMO POSITION";
    brokerPositionId: string;
    note: string;
  }>;
  /** Existing trades whose missing entry/volume/stop were backfilled. */
  entryRepaired: number;
};

function isGoldHunterOwned(pos: BrokerDemoPositionLite): boolean {
  const comment = String(pos.comment ?? "");
  const label = String(pos.label ?? "");
  return (
    comment.includes(GH_ADMIN_STRATEGY_ID) ||
    label.startsWith("GH-D-") ||
    /gh_/i.test(label)
  );
}

/**
 * Match broker open positions to GH trades. Unowned → UNMATCHED (no mutate).
 * Existing matches with missing entry are repaired from authoritative broker
 * position fields (never overwrites a valid stored entry).
 */
export async function reconcileGoldHunterDemoPositions(args: {
  ownerUid: string;
  brokerPositions: BrokerDemoPositionLite[];
}): Promise<ReconcileResult> {
  const trades = await listGoldHunterDemoTrades(args.ownerUid, { limit: 200 });
  const byPosition = new Map(
    trades
      .filter((t) => t.brokerPositionId)
      .map((t) => [String(t.brokerPositionId), t])
  );
  const restored: GoldHunterDemoTrade[] = [];
  const unmatched: ReconcileResult["unmatched"] = [];
  let entryRepaired = 0;

  for (const pos of args.brokerPositions) {
    const existing = byPosition.get(String(pos.positionId));
    if (existing) {
      if (existing.status === "CLOSED") continue;
      const repaired = repairGoldHunterTradeFromBrokerPosition({
        trade: existing,
        position: pos
      });
      if (repaired.repaired) {
        await upsertGoldHunterDemoTrade(args.ownerUid, repaired.trade);
        if (repaired.entryRepaired) {
          entryRepaired += 1;
          if (tradeHasAuthoritativeEntryIntegrity(repaired.trade)) {
            signalGoldHunterEntryIntegrityRecovered({
              ownerUid: args.ownerUid,
              reason: "BROKER_POSITION_ENTRY_REPAIRED",
              tradeId: repaired.trade.goldHunterTradeId
            });
          }
        }
        restored.push(repaired.trade);
      } else {
        restored.push(existing);
      }
      continue;
    }
    if (!isGoldHunterOwned(pos)) {
      unmatched.push({
        label: "UNMATCHED DEMO POSITION",
        brokerPositionId: String(pos.positionId),
        note: "No proven Gold Hunter ownership — left untouched"
      });
      continue;
    }
    // Restore GH-owned position missing from local store
    const now = new Date().toISOString();
    const trade: GoldHunterDemoTrade = {
      goldHunterTradeId: pos.label?.startsWith("GH-D-")
        ? pos.label
        : `GH-D-R-${pos.positionId}`.slice(0, 32),
      strategy: GH_ADMIN_STRATEGY_ID,
      environment: "DEMO",
      setup: null,
      side: pos.side ?? "BUY",
      signalTs: null,
      orderTs: now,
      fillTs: now,
      closeTs: null,
      entry: pos.entryPrice ?? null,
      exit: null,
      stop: pos.stopLoss ?? null,
      entrySpread: null,
      durationMs: null,
      mfe: null,
      mae: null,
      grossPnlEur: null,
      netPnlEur: null,
      result: "OPEN",
      exitReason: null,
      brokerOrderId: null,
      brokerPositionId: String(pos.positionId),
      status: "FILLED",
      filledVolumeLots: pos.volumeLots ?? null,
      initialRiskPrice: goldHunterFrozenInitialRiskPrice(),
      entryRecoverySource: isValidGoldHunterEntryPrice(pos.entryPrice)
        ? "BROKER_POSITION_RECONCILIATION"
        : null
    };
    await upsertGoldHunterDemoTrade(args.ownerUid, {
      ...trade,
      restoredAt: now,
      ownership: {
        strategy: GH_ADMIN_STRATEGY_ID,
        environment: "DEMO",
        ownerUid: args.ownerUid
      }
    });
    if (tradeHasAuthoritativeEntryIntegrity(trade)) {
      signalGoldHunterEntryIntegrityRecovered({
        ownerUid: args.ownerUid,
        reason: "BROKER_POSITION_OPEN_RECOVERED",
        tradeId: trade.goldHunterTradeId
      });
    }
    restored.push(trade);
  }

  const after = await listGoldHunterDemoTrades(args.ownerUid, { limit: 200 });
  maybeSignalEntryIntegrityFromReconcileCycle({
    ownerUid: args.ownerUid,
    trades: after,
    brokerPositions: args.brokerPositions,
    positionsReadOk: true
  });

  return { restored, unmatched, entryRepaired };
}
