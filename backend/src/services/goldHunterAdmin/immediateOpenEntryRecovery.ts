/**
 * Immediate bounded broker-position entry recovery while a GH Demo trade is
 * still OPEN / PENDING_RECONCILIATION.
 * Settlement BROKER_DEAL_SETTLEMENT remains the fallback — this path must run
 * while the position is live so Smart Loss / Smart PM can manage it.
 *
 * Polls within a fixed time budget for broker eventual visibility.
 * Each broker-position read is itself raced against the remaining budget so a
 * hung list/reconcile cannot hold the recovery past timeoutMs.
 * Never places orders. Never invents prices. Never extends indefinitely.
 */
import type { BrokerOpenPosition } from "../broker/ctrader/openApiClient";
import { reconcileDemoBrokerPositions } from "../broker/ctrader/demoPositionMutations";
import {
  registerGoldHunterOpenPositionForOwner,
  unregisterGoldHunterManagedPosition
} from "./demoPositionManager";
import {
  signalGoldHunterEntryIntegrityRecovered,
  tradeHasAuthoritativeEntryIntegrity
} from "./entryIntegrity";
import {
  repairGoldHunterTradeFromBrokerPosition
} from "./entryRepair";
import { isValidGoldHunterEntryPrice } from "./entryValidity";
import type { BrokerDemoPositionLite } from "./reconcilePositions";
import {
  isGoldHunterClosedTerminal,
  upsertGoldHunterDemoTrade
} from "./tradeStore";
import type { GoldHunterDemoTrade } from "./types";
import { signalGoldHunterOpenEntryIntegrityDefect } from "./entryIntegrity";

export const GH_IMMEDIATE_ENTRY_RECOVERY_TIMEOUT_MS = 2_500;
/** Poll interval while waiting for broker position visibility. */
export const GH_IMMEDIATE_ENTRY_RECOVERY_POLL_MS = 200;

export type ImmediateOpenEntryRecoveryResult = {
  recovered: boolean;
  trade: GoldHunterDemoTrade;
  reason:
    | "RECOVERED_OPEN"
    | "NO_POSITION_ID"
    | "POSITIONS_READ_FAILED"
    | "POSITION_NOT_FOUND_WITHIN_WINDOW"
    | "ENTRY_INVALID_WITHIN_WINDOW"
    | "ALREADY_VALID"
    | "TIMEOUT"
    | "SKIPPED_STATUS"
    | "POSITION_CLOSED_BEFORE_RECOVERY";
  /** Diagnostic: how many broker open-position reads were attempted. */
  attempts?: number;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ImmediateEntryRecoveryReadTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super("IMMEDIATE_ENTRY_RECOVERY_READ_TIMEOUT");
    this.name = "ImmediateEntryRecoveryReadTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

function isImmediateEntryRecoveryReadTimeout(
  error: unknown
): error is ImmediateEntryRecoveryReadTimeoutError {
  return error instanceof ImmediateEntryRecoveryReadTimeoutError;
}

/**
 * Race one broker-position read against the remaining recovery budget.
 * The underlying Promise is not cancelled; callers must not start another
 * read after this times out.
 */
async function withRemainingRecoveryReadTimeout<T>(
  remainingMs: number,
  work: () => Promise<T>
): Promise<T> {
  const ms = Number.isFinite(remainingMs) && remainingMs > 0 ? remainingMs : 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new ImmediateEntryRecoveryReadTimeoutError(ms)),
          ms
        );
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Bounded open-position poll + entry backfill for a single pending GH trade.
 * Total wall time ≤ timeoutMs. Each listPositions call is bounded by remaining
 * time. Stops immediately on valid match. Never starts a read with no budget.
 */
function stampImmediateForensics(
  trade: GoldHunterDemoTrade,
  reason: ImmediateOpenEntryRecoveryResult["reason"],
  attempts: number,
  startedAt: string
): GoldHunterDemoTrade {
  const now = new Date().toISOString();
  return {
    ...trade,
    openEntryRecoveryStartedAt: trade.openEntryRecoveryStartedAt ?? startedAt,
    openEntryRecoveryLastAt: now,
    openEntryRecoveryAttempts:
      (trade.openEntryRecoveryAttempts ?? 0) + Math.max(0, attempts),
    openEntryRecoveryLastReason: reason
  };
}

export async function recoverGoldHunterOpenEntryImmediate(args: {
  ownerUid: string;
  trade: GoldHunterDemoTrade;
  bid?: number | null;
  ask?: number | null;
  timeoutMs?: number;
  pollMs?: number;
  /** Test hook — inject open positions without broker I/O. */
  listPositions?: (ownerUid: string) => Promise<BrokerOpenPosition[]>;
}): Promise<ImmediateOpenEntryRecoveryResult> {
  let trade = args.trade;
  if (
    trade.status !== "PENDING_RECONCILIATION" &&
    trade.status !== "ACCEPTED_PENDING_FILL"
  ) {
    return { recovered: false, trade, reason: "SKIPPED_STATUS" };
  }

  if (!trade.brokerPositionId) {
    return { recovered: false, trade, reason: "NO_POSITION_ID" };
  }

  const startedAt =
    trade.openEntryRecoveryStartedAt ?? new Date().toISOString();
  const startPersist = await upsertGoldHunterDemoTrade(args.ownerUid, {
    ...trade,
    openEntryRecoveryStartedAt: startedAt,
    openEntryRecoveryLastAt: startedAt
  }).catch(() => null);
  if (startPersist && isGoldHunterClosedTerminal(startPersist.trade)) {
    return {
      recovered: false,
      trade: startPersist.trade,
      reason: "POSITION_CLOSED_BEFORE_RECOVERY"
    };
  }
  if (startPersist) trade = startPersist.trade;

  const timeoutMs = args.timeoutMs ?? GH_IMMEDIATE_ENTRY_RECOVERY_TIMEOUT_MS;
  const pollMs = args.pollMs ?? GH_IMMEDIATE_ENTRY_RECOVERY_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  const list =
    args.listPositions ??
    ((uid: string) => reconcileDemoBrokerPositions(uid));

  let attempts = 0;
  let successfulReads = 0;
  let sawMatchWithInvalidEntry = false;
  let lastFailReason:
    | "POSITION_NOT_FOUND_WITHIN_WINDOW"
    | "ENTRY_INVALID_WITHIN_WINDOW"
    | "POSITIONS_READ_FAILED"
    | "TIMEOUT" = "POSITION_NOT_FOUND_WITHIN_WINDOW";

  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      if (successfulReads === 0 && lastFailReason !== "POSITIONS_READ_FAILED") {
        lastFailReason = "TIMEOUT";
      }
      break;
    }
    attempts += 1;
    let positions: BrokerOpenPosition[];
    try {
      positions = await withRemainingRecoveryReadTimeout(remainingMs, () =>
        list(args.ownerUid)
      );
      if (!Array.isArray(positions)) {
        lastFailReason = "POSITIONS_READ_FAILED";
        const remain = deadline - Date.now();
        if (remain <= 0) break;
        await sleep(Math.min(pollMs, remain));
        continue;
      }
      successfulReads += 1;
    } catch (error) {
      if (isImmediateEntryRecoveryReadTimeout(error)) {
        lastFailReason = "TIMEOUT";
        const stamped = stampImmediateForensics(
          trade,
          "TIMEOUT",
          attempts,
          startedAt
        );
        await upsertGoldHunterDemoTrade(args.ownerUid, stamped).catch(
          () => undefined
        );
        signalGoldHunterOpenEntryIntegrityDefect({
          ownerUid: args.ownerUid,
          tradeId: trade.goldHunterTradeId
        });
        return { recovered: false, trade: stamped, reason: "TIMEOUT", attempts };
      }
      lastFailReason = "POSITIONS_READ_FAILED";
      const remain = deadline - Date.now();
      if (remain <= 0) break;
      await sleep(Math.min(pollMs, remain));
      continue;
    }

    const match = positions
      .map(toLite)
      .find((p) => String(p.positionId) === String(trade.brokerPositionId));

    if (!match) {
      lastFailReason = "POSITION_NOT_FOUND_WITHIN_WINDOW";
      const remain = deadline - Date.now();
      if (remain <= 0) break;
      await sleep(Math.min(pollMs, remain));
      continue;
    }

    if (!isValidGoldHunterEntryPrice(match.entryPrice)) {
      sawMatchWithInvalidEntry = true;
      lastFailReason = "ENTRY_INVALID_WITHIN_WINDOW";
      const remain = deadline - Date.now();
      if (remain <= 0) break;
      await sleep(Math.min(pollMs, remain));
      continue;
    }

    const repaired = repairGoldHunterTradeFromBrokerPosition({
      trade,
      position: match
    });
    if (!tradeHasAuthoritativeEntryIntegrity(repaired.trade)) {
      sawMatchWithInvalidEntry = true;
      lastFailReason = "ENTRY_INVALID_WITHIN_WINDOW";
      const remain = deadline - Date.now();
      if (remain <= 0) break;
      await sleep(Math.min(pollMs, remain));
      continue;
    }

    const recoveredCandidate: GoldHunterDemoTrade = stampImmediateForensics(
      {
        ...repaired.trade,
        status: "FILLED",
        result: "OPEN",
        fillTs: repaired.trade.fillTs ?? new Date().toISOString(),
        entryRecoverySource:
          repaired.trade.entryRecoverySource ?? "BROKER_POSITION_RECONCILIATION",
        openEntryRecoverySource: "BROKER_POSITION_RECONCILIATION",
        openEntryRecoveredAt: new Date().toISOString(),
        dataQuality: null,
        errorCode: null
      },
      "RECOVERED_OPEN",
      attempts,
      startedAt
    );
    const persisted = await upsertGoldHunterDemoTrade(
      args.ownerUid,
      recoveredCandidate
    );
    if (isGoldHunterClosedTerminal(persisted.trade)) {
      unregisterGoldHunterManagedPosition(
        args.ownerUid,
        persisted.trade.goldHunterTradeId
      );
      return {
        recovered: false,
        trade: persisted.trade,
        reason: "POSITION_CLOSED_BEFORE_RECOVERY",
        attempts
      };
    }
    if (
      persisted.trade.status !== "FILLED" &&
      persisted.trade.status !== "PROTECTED" &&
      persisted.trade.result !== "OPEN"
    ) {
      return {
        recovered: false,
        trade: persisted.trade,
        reason: "POSITION_CLOSED_BEFORE_RECOVERY",
        attempts
      };
    }

    const bid =
      args.bid != null && Number.isFinite(args.bid)
        ? args.bid
        : persisted.trade.entry!;
    const ask =
      args.ask != null && Number.isFinite(args.ask)
        ? args.ask
        : persisted.trade.entry!;
    registerGoldHunterOpenPositionForOwner({
      ownerUid: args.ownerUid,
      trade: persisted.trade,
      bid,
      ask
    });
    const withPm = await upsertGoldHunterDemoTrade(args.ownerUid, {
      ...persisted.trade,
      openEntryPmRegisteredAt: new Date().toISOString()
    });
    if (isGoldHunterClosedTerminal(withPm.trade)) {
      unregisterGoldHunterManagedPosition(
        args.ownerUid,
        withPm.trade.goldHunterTradeId
      );
      return {
        recovered: false,
        trade: withPm.trade,
        reason: "POSITION_CLOSED_BEFORE_RECOVERY",
        attempts
      };
    }
    signalGoldHunterEntryIntegrityRecovered({
      ownerUid: args.ownerUid,
      reason: "BROKER_POSITION_ENTRY_REPAIRED",
      tradeId: withPm.trade.goldHunterTradeId
    });

    return {
      recovered: true,
      trade: withPm.trade,
      reason: "RECOVERED_OPEN",
      attempts
    };
  }

  const reason: ImmediateOpenEntryRecoveryResult["reason"] =
    successfulReads === 0
      ? Date.now() >= deadline && lastFailReason === "POSITIONS_READ_FAILED"
        ? "POSITIONS_READ_FAILED"
        : lastFailReason === "POSITIONS_READ_FAILED"
          ? "POSITIONS_READ_FAILED"
          : "TIMEOUT"
      : sawMatchWithInvalidEntry
        ? "ENTRY_INVALID_WITHIN_WINDOW"
        : "POSITION_NOT_FOUND_WITHIN_WINDOW";
  const stamped = stampImmediateForensics(trade, reason, attempts, startedAt);
  await upsertGoldHunterDemoTrade(args.ownerUid, stamped).catch(() => undefined);
  signalGoldHunterOpenEntryIntegrityDefect({
    ownerUid: args.ownerUid,
    tradeId: trade.goldHunterTradeId
  });
  return { recovered: false, trade: stamped, reason, attempts };
}
