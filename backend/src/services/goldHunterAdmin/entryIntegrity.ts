/**
 * Authoritative entry-integrity recovery signals for Gold Hunter Demo.
 * Used to latch WAIT_REALISED_R_INCOMPLETE until reconciliation proves repair.
 * Never invents prices or realised R.
 *
 * entryIntegrityHealthy must be false while any proven broker-open GH trade
 * has unresolved invalid entry / invalid original risk. It must not claim
 * healthy during that defect. Unknown-R accounting is NOT triggered by an
 * unresolved OPEN entry.
 */
import { getGoldHunterStrategySelector } from "./strategySelector";
import { isValidGoldHunterEntryPrice } from "./entryValidity";
import { GH_ADMIN_STRATEGY_ID, type GoldHunterDemoTrade } from "./types";
import type { BrokerDemoPositionLite } from "./reconcilePositions";
import { listGoldHunterDemoTrades } from "./tradeStore";
import { persistGoldHunterLossControllerTelemetry } from "./lossControllerTelemetryPersist";

export type EntryIntegrityRecoveryReason =
  | "BROKER_POSITION_ENTRY_REPAIRED"
  | "BROKER_POSITION_OPEN_RECOVERED"
  | "RECONCILE_CYCLE_ALL_OPEN_ENTRIES_VALID";

/** Trade has authoritative entry + frozen original risk for true R accounting. */
export function tradeHasAuthoritativeEntryIntegrity(
  trade: GoldHunterDemoTrade
): boolean {
  return (
    isValidGoldHunterEntryPrice(trade.entry) &&
    trade.initialRiskPrice != null &&
    Number.isFinite(trade.initialRiskPrice) &&
    trade.initialRiskPrice > 0
  );
}

/**
 * Proven broker-open GH trade whose entry or original risk is unresolved.
 * Does not include submit-error / rejected / already-CLOSED rows.
 */
export function isProvenBrokerOpenEntryIntegrityDefect(
  trade: GoldHunterDemoTrade
): boolean {
  if (trade.strategy !== GH_ADMIN_STRATEGY_ID || trade.environment !== "DEMO") {
    return false;
  }
  if (
    trade.status === "CLOSED" ||
    trade.status === "BROKER_REJECTED" ||
    trade.status === "BROKER_SUBMIT_ERROR"
  ) {
    return false;
  }
  if (!trade.brokerPositionId) return false;
  const openish =
    trade.status === "PENDING_RECONCILIATION" ||
    trade.status === "ACCEPTED_PENDING_FILL" ||
    trade.status === "FILLED" ||
    trade.status === "PROTECTED" ||
    trade.result === "OPEN";
  if (!openish) return false;
  if (trade.exitReason && String(trade.errorCode ?? "").startsWith("CLOSE_")) {
    return false;
  }
  return !tradeHasAuthoritativeEntryIntegrity(trade);
}

export function signalGoldHunterOpenEntryIntegrityDefect(args: {
  ownerUid: string;
  tradeId?: string | null;
  reason?: string;
}): void {
  getGoldHunterStrategySelector(args.ownerUid).notifyOpenEntryIntegrityDefect({
    tradeId: args.tradeId ?? null,
    reason: args.reason ?? "PROVEN_OPEN_ENTRY_INVALID"
  });
  void persistGoldHunterLossControllerTelemetry(args.ownerUid).catch(
    () => undefined
  );
}

/**
 * Recompute health from durable trades:
 * - any proven-open invalid entry → unhealthy (no unknown-R)
 * - no remaining defects → healthy (authoritative recovery or closure)
 */
export async function syncGoldHunterOpenEntryIntegrityHealth(
  ownerUid: string
): Promise<{ healthy: boolean; defectCount: number }> {
  const trades = await listGoldHunterDemoTrades(ownerUid, { limit: 200 });
  const defects = trades.filter(isProvenBrokerOpenEntryIntegrityDefect);
  if (defects.length > 0) {
    signalGoldHunterOpenEntryIntegrityDefect({
      ownerUid,
      tradeId: defects[0]?.goldHunterTradeId ?? null,
      reason: "PROVEN_OPEN_ENTRY_INVALID"
    });
    return { healthy: false, defectCount: defects.length };
  }
  const sel = getGoldHunterStrategySelector(ownerUid);
  if (sel.clearOpenEntryIntegrityDefectIfIdle()) {
    signalGoldHunterEntryIntegrityRecovered({
      ownerUid,
      reason: "RECONCILE_CYCLE_ALL_OPEN_ENTRIES_VALID"
    });
  }
  return {
    healthy: sel.getLossControllerEntryState().entryIntegrityHealthy,
    defectCount: 0
  };
}

function isOpenOrPendingIntegritySubject(trade: GoldHunterDemoTrade): boolean {
  if (trade.strategy !== GH_ADMIN_STRATEGY_ID || trade.environment !== "DEMO") {
    return false;
  }
  if (trade.status === "CLOSED" || trade.status === "BROKER_REJECTED") {
    return false;
  }
  if (trade.status === "BROKER_SUBMIT_ERROR") return false;
  return (
    trade.status === "PENDING_RECONCILIATION" ||
    trade.status === "ACCEPTED_PENDING_FILL" ||
    trade.status === "FILLED" ||
    trade.status === "PROTECTED" ||
    trade.status === "ORDER_CREATED" ||
    trade.status === "SENT" ||
    trade.status === "CLOSE_REQUESTED" ||
    trade.status === "CLOSE_ACCEPTED_PENDING_SETTLEMENT" ||
    trade.result === "OPEN"
  );
}

/**
 * Positive integrity recovery from an authoritative reconciliation path.
 * Does not clear the unknown-R guard by itself — lossArmingGate still requires
 * time + structural + directional confirmation.
 */
export function signalGoldHunterEntryIntegrityRecovered(args: {
  ownerUid: string;
  atMs?: number;
  reason: EntryIntegrityRecoveryReason;
  tradeId?: string | null;
}): void {
  getGoldHunterStrategySelector(args.ownerUid).notifyEntryIntegrityRecovered({
    atMs: args.atMs ?? Date.now(),
    reason: args.reason,
    tradeId: args.tradeId ?? null
  });
}

/**
 * After a successful broker open-position read: if every currently open/pending
 * GH trade has valid entry + initialRiskPrice, and every broker GH-owned position
 * is matched to such a trade, signal integrity recovery.
 * Vacuous empty books do NOT signal (not positive proof).
 */
export function maybeSignalEntryIntegrityFromReconcileCycle(args: {
  ownerUid: string;
  trades: GoldHunterDemoTrade[];
  brokerPositions: BrokerDemoPositionLite[];
  positionsReadOk: boolean;
  atMs?: number;
}): boolean {
  if (!args.positionsReadOk) return false;

  const subjects = args.trades.filter(isOpenOrPendingIntegritySubject);
  const ghBroker = args.brokerPositions.filter((p) => {
    const comment = String(p.comment ?? "");
    const label = String(p.label ?? "");
    return (
      comment.includes(GH_ADMIN_STRATEGY_ID) ||
      label.startsWith("GH-D-") ||
      /gh_/i.test(label)
    );
  });

  // Vacuous empty — not positive recovery evidence.
  if (subjects.length === 0 && ghBroker.length === 0) {
    return false;
  }

  if (!subjects.every(tradeHasAuthoritativeEntryIntegrity)) {
    return false;
  }

  const byPos = new Map(
    subjects
      .filter((t) => t.brokerPositionId)
      .map((t) => [String(t.brokerPositionId), t])
  );
  for (const pos of ghBroker) {
    const match = byPos.get(String(pos.positionId));
    if (!match || !tradeHasAuthoritativeEntryIntegrity(match)) {
      return false;
    }
    if (!isValidGoldHunterEntryPrice(pos.entryPrice)) {
      return false;
    }
  }

  signalGoldHunterEntryIntegrityRecovered({
    ownerUid: args.ownerUid,
    atMs: args.atMs,
    reason: "RECONCILE_CYCLE_ALL_OPEN_ENTRIES_VALID"
  });
  return true;
}
