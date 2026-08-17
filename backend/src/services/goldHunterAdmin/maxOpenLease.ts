/**
 * Durable max-open reservation so concurrent workers cannot both pass
 * openCount===0 and submit two NewOrders when maxOpenTrades=1.
 */
import { getFirestoreDb } from "../firebaseAdmin";

export type MaxOpenReserveResult =
  | { ok: true; holders: string[] }
  | { ok: false; reason: string; holders: string[] };

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

export async function reserveGoldHunterMaxOpenSlot(args: {
  ownerUid: string;
  maxOpenTrades: number;
  reservationId: string;
  /** Additional occupancy already known (local open + broker open). */
  knownOccupancy?: number;
}): Promise<MaxOpenReserveResult> {
  const max = Math.max(1, Math.floor(args.maxOpenTrades));
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
