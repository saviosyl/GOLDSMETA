/**
 * Durable max-open reservation so concurrent workers cannot both pass
 * openCount===0 and submit two NewOrders when maxOpenTrades=1.
 *
 * Demo phase: maxOpenTrades MUST equal 1. Orphan leases are released only with
 * authoritative broker + local proof — never by time-only expiry.
 */
import { getFirestoreDb } from "../firebaseAdmin";
import { GH_DEMO_MAX_OPEN_TRADES_REQUIRED } from "./configValidation";
import type { GoldHunterDemoTrade } from "./types";
import type { GoldHunterSignalClaim } from "./signalClaimStore";
import { countsTowardGoldHunterMaxOpen } from "./tradeStore";

export type MaxOpenReserveResult =
  | { ok: true; holders: string[] }
  | { ok: false; reason: string; holders: string[] };

export type LeaseOrphanReconcileResult = {
  released: string[];
  retained: Array<{ reservationId: string; reason: string }>;
  brokerReadOk: boolean;
};

type LeaseDoc = {
  holders: Array<{ reservationId: string; at: string }>;
  updatedAt: string;
};

const memoryLeases = new Map<string, LeaseDoc>();

export function resetGoldHunterMaxOpenLeaseForTests(): void {
  memoryLeases.clear();
}

function leaseRef(ownerUid: string) {
  const db = getFirestoreDb();
  if (!db) return null;
  return db
    .collection("users")
    .doc(ownerUid)
    .collection("goldHunterRiskLease")
    .doc("maxOpen");
}

async function readLease(ownerUid: string): Promise<LeaseDoc> {
  const ref = leaseRef(ownerUid);
  if (!ref) {
    return (
      memoryLeases.get(ownerUid) ?? {
        holders: [],
        updatedAt: new Date().toISOString()
      }
    );
  }
  const snap = await ref.get();
  const data = snap.data() as LeaseDoc | undefined;
  return data ?? { holders: [], updatedAt: new Date().toISOString() };
}

async function writeLease(ownerUid: string, doc: LeaseDoc): Promise<void> {
  const ref = leaseRef(ownerUid);
  if (!ref) {
    memoryLeases.set(ownerUid, doc);
    return;
  }
  await ref.set(doc, { merge: true });
}

export async function reserveGoldHunterMaxOpenSlot(args: {
  ownerUid: string;
  maxOpenTrades: number;
  reservationId: string;
  /** Additional occupancy already known (local open + broker open). */
  knownOccupancy?: number;
}): Promise<MaxOpenReserveResult> {
  // Demo phase: refuse multi-open until atomic cash-risk reservation exists.
  if (
    !Number.isFinite(args.maxOpenTrades) ||
    !Number.isInteger(args.maxOpenTrades) ||
    args.maxOpenTrades !== GH_DEMO_MAX_OPEN_TRADES_REQUIRED
  ) {
    return {
      ok: false,
      reason: `max_open_must_equal_${GH_DEMO_MAX_OPEN_TRADES_REQUIRED}`,
      holders: []
    };
  }
  const max = GH_DEMO_MAX_OPEN_TRADES_REQUIRED;
  const known = Math.max(0, args.knownOccupancy ?? 0);
  if (known >= max) {
    return {
      ok: false,
      reason: `known_occupancy_${known}_max_${max}`,
      holders: []
    };
  }

  const ref = leaseRef(args.ownerUid);
  if (!ref) {
    const cur = memoryLeases.get(args.ownerUid) ?? {
      holders: [],
      updatedAt: new Date().toISOString()
    };
    const holders = cur.holders.filter(
      (h) => h.reservationId !== args.reservationId
    );
    if (holders.length + known >= max) {
      return {
        ok: false,
        reason: `lease_holders_${holders.length}_known_${known}_max_${max}`,
        holders: holders.map((h) => h.reservationId)
      };
    }
    holders.push({
      reservationId: args.reservationId,
      at: new Date().toISOString()
    });
    memoryLeases.set(args.ownerUid, {
      holders,
      updatedAt: new Date().toISOString()
    });
    return { ok: true, holders: holders.map((h) => h.reservationId) };
  }

  return getFirestoreDb()!.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = (snap.data() as LeaseDoc | undefined) ?? {
      holders: [],
      updatedAt: new Date().toISOString()
    };
    const holders = (data.holders ?? []).filter(
      (h) => h.reservationId !== args.reservationId
    );
    if (holders.length + known >= max) {
      return {
        ok: false as const,
        reason: `lease_holders_${holders.length}_known_${known}_max_${max}`,
        holders: holders.map((h) => h.reservationId)
      };
    }
    holders.push({
      reservationId: args.reservationId,
      at: new Date().toISOString()
    });
    tx.set(
      ref,
      { holders, updatedAt: new Date().toISOString() },
      { merge: true }
    );
    return {
      ok: true as const,
      holders: holders.map((h) => h.reservationId)
    };
  });
}

export async function releaseGoldHunterMaxOpenSlot(args: {
  ownerUid: string;
  reservationId: string;
}): Promise<void> {
  const ref = leaseRef(args.ownerUid);
  if (!ref) {
    const cur = memoryLeases.get(args.ownerUid);
    if (!cur) return;
    memoryLeases.set(args.ownerUid, {
      holders: cur.holders.filter(
        (h) => h.reservationId !== args.reservationId
      ),
      updatedAt: new Date().toISOString()
    });
    return;
  }
  await getFirestoreDb()!.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as LeaseDoc | undefined;
    if (!data?.holders) return;
    tx.set(
      ref,
      {
        holders: data.holders.filter(
          (h) => h.reservationId !== args.reservationId
        ),
        updatedAt: new Date().toISOString()
      },
      { merge: true }
    );
  });
}

export async function listGoldHunterMaxOpenLeaseHolders(
  ownerUid: string
): Promise<string[]> {
  const doc = await readLease(ownerUid);
  return (doc.holders ?? []).map((h) => h.reservationId);
}

function claimIndicatesPossibleBrokerTransmission(
  claim: GoldHunterSignalClaim
): boolean {
  return (
    claim.state === "CLAIMED" ||
    claim.state === "SUBMITTING" ||
    claim.state === "ACCEPTED" ||
    claim.state === "OPEN" ||
    claim.state === "PENDING_RECONCILIATION" ||
    claim.state === "BROKER_SUBMIT_ERROR"
  );
}

function tradeIndicatesLeaseUncertainty(trade: GoldHunterDemoTrade): boolean {
  if (countsTowardGoldHunterMaxOpen(trade)) return true;
  if (trade.status === "CLOSE_REQUESTED") return true;
  if (trade.status === "ACCEPTED_PENDING_FILL") return true;
  if (trade.status === "PENDING_RECONCILIATION") return true;
  if (trade.status === "ORDER_CREATED" || trade.status === "SENT") return true;
  return false;
}

/**
 * Decide whether a single lease holder may be released.
 * Fail closed unless every required proof is present.
 */
export function evaluateGoldHunterLeaseOrphanRelease(args: {
  reservationId: string;
  positionsReadOk: boolean;
  brokerGhPositionIds: string[];
  trades: GoldHunterDemoTrade[];
  claims: GoldHunterSignalClaim[];
}): { mayRelease: boolean; reason: string } {
  if (!args.positionsReadOk) {
    return { mayRelease: false, reason: "broker_positions_read_failed" };
  }

  const relatedTrades = args.trades.filter(
    (t) => t.goldHunterTradeId === args.reservationId
  );
  for (const t of relatedTrades) {
    if (tradeIndicatesLeaseUncertainty(t)) {
      return { mayRelease: false, reason: `trade_uncertain_${t.status}` };
    }
    if (
      t.brokerPositionId &&
      args.brokerGhPositionIds.includes(String(t.brokerPositionId))
    ) {
      return { mayRelease: false, reason: "broker_position_linked_to_trade" };
    }
  }

  const relatedClaims = args.claims.filter(
    (c) => c.goldHunterTradeId === args.reservationId
  );
  for (const c of relatedClaims) {
    if (claimIndicatesPossibleBrokerTransmission(c)) {
      return { mayRelease: false, reason: `claim_uncertain_${c.state}` };
    }
    if (
      c.brokerPositionId &&
      args.brokerGhPositionIds.includes(String(c.brokerPositionId))
    ) {
      return { mayRelease: false, reason: "broker_position_linked_to_claim" };
    }
  }

  // Label / comment ownership: any open GH broker position blocks all orphan cleanup
  // when we cannot prove the lease is unrelated — with maxOpen=1 any GH open keeps leases.
  if (args.brokerGhPositionIds.length > 0) {
    return { mayRelease: false, reason: "broker_gh_position_exists" };
  }

  return { mayRelease: true, reason: "authoritative_zero_exposure" };
}

/**
 * Reconciliation-based orphan cleanup. Never time-only expiry.
 */
export async function reconcileGoldHunterMaxOpenLeaseOrphans(args: {
  ownerUid: string;
  positionsReadOk: boolean;
  brokerGhPositionIds: string[];
  trades: GoldHunterDemoTrade[];
  claims: GoldHunterSignalClaim[];
}): Promise<LeaseOrphanReconcileResult> {
  const released: string[] = [];
  const retained: Array<{ reservationId: string; reason: string }> = [];

  if (!args.positionsReadOk) {
    const holders = await listGoldHunterMaxOpenLeaseHolders(args.ownerUid);
    for (const id of holders) {
      retained.push({
        reservationId: id,
        reason: "broker_positions_read_failed"
      });
    }
    return { released, retained, brokerReadOk: false };
  }

  const doc = await readLease(args.ownerUid);
  const keep: LeaseDoc["holders"] = [];
  for (const h of doc.holders ?? []) {
    const decision = evaluateGoldHunterLeaseOrphanRelease({
      reservationId: h.reservationId,
      positionsReadOk: args.positionsReadOk,
      brokerGhPositionIds: args.brokerGhPositionIds,
      trades: args.trades,
      claims: args.claims
    });
    if (decision.mayRelease) {
      released.push(h.reservationId);
    } else {
      keep.push(h);
      retained.push({
        reservationId: h.reservationId,
        reason: decision.reason
      });
    }
  }

  if (released.length > 0) {
    await writeLease(args.ownerUid, {
      holders: keep,
      updatedAt: new Date().toISOString()
    });
  }

  return { released, retained, brokerReadOk: true };
}
