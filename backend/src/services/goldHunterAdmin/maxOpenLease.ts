/**
 * Durable max-open reservation so concurrent workers cannot both pass
 * openCount===0 and submit two NewOrders when maxOpenTrades=1.
 *
 * Demo phase: maxOpenTrades MUST equal 1. Orphan leases are released only with
 * authoritative broker + local + exact claim proof — never by time-only expiry
 * and never by capped claim-list absence.
 */
import { getFirestoreDb } from "../firebaseAdmin";
import { GH_DEMO_MAX_OPEN_TRADES_REQUIRED } from "./configValidation";
import type { GoldHunterDemoTrade } from "./types";
import type { GoldHunterSignalClaim } from "./signalClaimStore";
import { getGoldHunterSignalClaim } from "./signalClaimStore";
import { countsTowardGoldHunterMaxOpen } from "./tradeStore";

export type MaxOpenReserveResult =
  | { ok: true; holders: string[] }
  | { ok: false; reason: string; holders: string[] };

export type LeaseOrphanReconcileResult = {
  released: string[];
  retained: Array<{ reservationId: string; reason: string }>;
  brokerReadOk: boolean;
};

/** Durable max-open lease holder identity. */
export type GoldHunterMaxOpenLeaseHolder = {
  /** goldHunterTradeId */
  reservationId: string;
  /** Exact claim doc id (opportunity / signalId). Required for new reservations. */
  signalId?: string | null;
  clientOrderId?: string | null;
  at: string;
};

type LeaseDoc = {
  holders: GoldHunterMaxOpenLeaseHolder[];
  updatedAt: string;
};

export type ExactClaimLookupResult =
  | { ok: true; claim: GoldHunterSignalClaim | null; via: "signalId" | "tradeId" }
  | {
      ok: false;
      reason: "claim_authority_unknown" | "claim_lookup_timeout" | "legacy_lease_missing_signal_id";
    };

export type LeaseClaimLookupHooks = {
  getBySignalId?: (
    ownerUid: string,
    signalId: string
  ) => Promise<GoldHunterSignalClaim | null>;
  getByTradeId?: (
    ownerUid: string,
    goldHunterTradeId: string
  ) => Promise<GoldHunterSignalClaim | null>;
};

const memoryLeases = new Map<string, LeaseDoc>();
let claimLookupHooks: LeaseClaimLookupHooks = {};

export function resetGoldHunterMaxOpenLeaseForTests(): void {
  memoryLeases.clear();
  claimLookupHooks = {};
}

export function setGoldHunterLeaseClaimLookupHooksForTests(
  h: LeaseClaimLookupHooks
): void {
  claimLookupHooks = h;
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

function isClaimLookupTimeout(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const any = e as { code?: string; name?: string; message?: string };
  const msg = String(any.message ?? any.code ?? any.name ?? "").toLowerCase();
  return (
    any.code === "claim_lookup_timeout" ||
    msg.includes("timeout") ||
    msg.includes("timed out")
  );
}

/**
 * Exact claim authority for one lease holder.
 * Never uses capped recent claim lists as absence proof.
 */
export async function lookupExactClaimForLeaseHolder(args: {
  ownerUid: string;
  holder: GoldHunterMaxOpenLeaseHolder;
}): Promise<ExactClaimLookupResult> {
  const signalId =
    typeof args.holder.signalId === "string" && args.holder.signalId.trim()
      ? args.holder.signalId.trim()
      : null;

  if (signalId) {
    try {
      const getBySignal =
        claimLookupHooks.getBySignalId ?? getGoldHunterSignalClaim;
      const claim = await getBySignal(args.ownerUid, signalId);
      return { ok: true, claim, via: "signalId" };
    } catch (e) {
      if (isClaimLookupTimeout(e)) {
        return { ok: false, reason: "claim_lookup_timeout" };
      }
      return { ok: false, reason: "claim_authority_unknown" };
    }
  }

  // Legacy holder without signalId: never treat list absence as proof.
  // Fail closed until signalId is present on the lease row.
  return { ok: false, reason: "legacy_lease_missing_signal_id" };
}

export async function reserveGoldHunterMaxOpenSlot(args: {
  ownerUid: string;
  maxOpenTrades: number;
  reservationId: string;
  /** Opportunity / signal identity for exact claim lookup. */
  signalId: string;
  clientOrderId?: string | null;
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
  if (!args.signalId || !String(args.signalId).trim()) {
    return {
      ok: false,
      reason: "lease_signal_id_required",
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

  const holder: GoldHunterMaxOpenLeaseHolder = {
    reservationId: args.reservationId,
    signalId: String(args.signalId).trim(),
    clientOrderId: args.clientOrderId ?? null,
    at: new Date().toISOString()
  };

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
    holders.push(holder);
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
    holders.push(holder);
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

/**
 * Test / recovery helper: insert a legacy holder without signalId.
 * Production orchestrator always persists signalId.
 */
export async function seedGoldHunterLegacyMaxOpenLeaseForTests(args: {
  ownerUid: string;
  reservationId: string;
}): Promise<void> {
  const cur = await readLease(args.ownerUid);
  const holders = cur.holders.filter(
    (h) => h.reservationId !== args.reservationId
  );
  holders.push({
    reservationId: args.reservationId,
    signalId: null,
    clientOrderId: null,
    at: new Date().toISOString()
  });
  await writeLease(args.ownerUid, {
    holders,
    updatedAt: new Date().toISOString()
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

export async function listGoldHunterMaxOpenLeaseHolderRecords(
  ownerUid: string
): Promise<GoldHunterMaxOpenLeaseHolder[]> {
  const doc = await readLease(ownerUid);
  return [...(doc.holders ?? [])];
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

function claimIsTerminalSafeForNoExposure(
  claim: GoldHunterSignalClaim
): boolean {
  return claim.state === "CLOSED" || claim.state === "BROKER_REJECTED";
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
 * Pure decision given an already-resolved exact claim lookup.
 * Fail closed unless every required proof is present.
 */
export function evaluateGoldHunterLeaseOrphanRelease(args: {
  reservationId: string;
  positionsReadOk: boolean;
  brokerGhPositionIds: string[];
  trades: GoldHunterDemoTrade[];
  claimLookup: ExactClaimLookupResult;
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

  if (args.brokerGhPositionIds.length > 0) {
    return { mayRelease: false, reason: "broker_gh_position_exists" };
  }

  if (!args.claimLookup.ok) {
    return { mayRelease: false, reason: args.claimLookup.reason };
  }

  const claim = args.claimLookup.claim;
  if (claim) {
    if (claimIndicatesPossibleBrokerTransmission(claim)) {
      return { mayRelease: false, reason: `claim_uncertain_${claim.state}` };
    }
    if (
      claim.brokerPositionId &&
      args.brokerGhPositionIds.includes(String(claim.brokerPositionId))
    ) {
      return { mayRelease: false, reason: "broker_position_linked_to_claim" };
    }
    if (!claimIsTerminalSafeForNoExposure(claim)) {
      return { mayRelease: false, reason: `claim_state_not_terminal_${claim.state}` };
    }
  }

  return { mayRelease: true, reason: "authoritative_zero_exposure" };
}

/**
 * Reconciliation-based orphan cleanup. Never time-only expiry.
 * Uses exact claim lookup per holder — never capped claim-list absence.
 */
export async function reconcileGoldHunterMaxOpenLeaseOrphans(args: {
  ownerUid: string;
  positionsReadOk: boolean;
  brokerGhPositionIds: string[];
  trades: GoldHunterDemoTrade[];
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
  const keep: GoldHunterMaxOpenLeaseHolder[] = [];
  for (const h of doc.holders ?? []) {
    const claimLookup = await lookupExactClaimForLeaseHolder({
      ownerUid: args.ownerUid,
      holder: h
    });
    const decision = evaluateGoldHunterLeaseOrphanRelease({
      reservationId: h.reservationId,
      positionsReadOk: args.positionsReadOk,
      brokerGhPositionIds: args.brokerGhPositionIds,
      trades: args.trades,
      claimLookup
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
