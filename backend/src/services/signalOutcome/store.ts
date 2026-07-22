/* eslint-disable @typescript-eslint/require-await -- sync in-memory impl of async port */
/**
 * Signal outcome persistence — in-memory + Firestore.
 * Collection: users/{uid}/signalOutcomes/{signalId}
 *
 * Atomic bar application runs inside one transaction:
 * read → lifecycle → idempotency → chronology → lease → apply → persist → release lease.
 */

import type { Firestore, Query, QueryDocumentSnapshot, Transaction } from "firebase-admin/firestore";
import { applyBarToSignalOutcome, validateBarForSignal } from "./engine";
import {
  ACTIVE_MONITOR_LIFECYCLES,
  type ApplyBarResult,
  type SignalBarApplyStatus,
  type SignalBarInput,
  type SignalOutcomeRecord,
  type SignalPerformanceDailyAggregate
} from "./types";
import { nowIso } from "../../utils/time";

export type { ApplyBarResult, SignalBarApplyStatus };

export interface ActiveMatchFilter {
  symbol: string;
  timeframe: string | null;
  environment: "LIVE" | "TEST";
}

export interface SignalOutcomeStore {
  save(record: SignalOutcomeRecord): Promise<SignalOutcomeRecord>;
  get(userId: string, signalId: string): Promise<SignalOutcomeRecord | null>;
  getByDecisionId(userId: string, decisionId: string): Promise<SignalOutcomeRecord | null>;
  list(userId: string, limit?: number): Promise<SignalOutcomeRecord[]>;
  /** Paginated complete history — does not truncate at 500 permanently. */
  listAllPaginated(
    userId: string,
    pageSize?: number
  ): Promise<SignalOutcomeRecord[]>;
  listActive(userId: string): Promise<SignalOutcomeRecord[]>;
  listActiveMatching(userId: string, match: ActiveMatchFilter): Promise<SignalOutcomeRecord[]>;
  /**
   * @deprecated Prefer applyBarAtomic — lease+apply+persist in one transaction.
   */
  tryAcquireLease(
    userId: string,
    signalId: string,
    ownerId: string,
    leaseMs: number
  ): Promise<SignalOutcomeRecord | null>;
  /**
   * Single transactional bar application for one signal.
   * Always returns an explicit status — never treats LEASE_BUSY as success.
   */
  applyBarAtomic(
    userId: string,
    signalId: string,
    bar: SignalBarInput,
    ownerId: string,
    leaseMs?: number
  ): Promise<ApplyBarResult>;
  upsertDailyAggregateDelta(
    userId: string,
    day: string,
    environment: "LIVE" | "TEST",
    delta: Partial<SignalPerformanceDailyAggregate>
  ): Promise<void>;
  listDailyAggregates(userId: string): Promise<SignalPerformanceDailyAggregate[]>;
}

const isActiveLife = (life: string): boolean =>
  (ACTIVE_MONITOR_LIFECYCLES as string[]).includes(life);

const matchesFilter = (r: SignalOutcomeRecord, match: ActiveMatchFilter): boolean =>
  r.snapshot.symbol === match.symbol &&
  String(r.snapshot.timeframe ?? "") === String(match.timeframe ?? "") &&
  r.snapshot.environment === match.environment;

function classifyPreApply(
  record: SignalOutcomeRecord,
  bar: SignalBarInput
): SignalBarApplyStatus | null {
  if (
    !matchesFilter(record, {
      symbol: bar.symbol,
      timeframe: bar.timeframe,
      environment: bar.environment
    })
  ) {
    return "IDENTITY_MISMATCH";
  }
  const reject = validateBarForSignal(record, bar);
  if (reject === "DUPLICATE_EVENT") return "DUPLICATE";
  if (
    reject === "WRONG_SYMBOL" ||
    reject === "WRONG_TIMEFRAME" ||
    reject === "WRONG_ENVIRONMENT" ||
    reject === "UNCONFIRMED"
  ) {
    return "IDENTITY_MISMATCH";
  }
  if (reject === "OUT_OF_ORDER_WAIT") return "OUT_OF_ORDER_WAIT";
  if (reject === "SAME_CANDLE_SKIP") return "SAME_CANDLE_SKIP";
  return null;
}

function releaseLease(record: SignalOutcomeRecord): void {
  record.leaseOwnerId = null;
  record.leaseUntil = null;
}

function dayFromIso(iso: string): string {
  return iso.slice(0, 10);
}

export class InMemorySignalOutcomeStore implements SignalOutcomeStore {
  private readonly byUser = new Map<string, Map<string, SignalOutcomeRecord>>();
  private readonly aggregates = new Map<string, SignalPerformanceDailyAggregate>();

  private bucket(userId: string): Map<string, SignalOutcomeRecord> {
    let m = this.byUser.get(userId);
    if (!m) {
      m = new Map();
      this.byUser.set(userId, m);
    }
    return m;
  }

  async save(record: SignalOutcomeRecord): Promise<SignalOutcomeRecord> {
    this.bucket(record.snapshot.userId).set(record.snapshot.signalId, structuredClone(record));
    return structuredClone(record);
  }

  async get(userId: string, signalId: string): Promise<SignalOutcomeRecord | null> {
    const r = this.bucket(userId).get(signalId);
    return r ? structuredClone(r) : null;
  }

  async getByDecisionId(userId: string, decisionId: string): Promise<SignalOutcomeRecord | null> {
    for (const r of this.bucket(userId).values()) {
      if (r.snapshot.decisionId === decisionId) return structuredClone(r);
    }
    return null;
  }

  async list(userId: string, limit = 100): Promise<SignalOutcomeRecord[]> {
    return [...this.bucket(userId).values()]
      .sort((a, b) => b.snapshot.createdAt.localeCompare(a.snapshot.createdAt))
      .slice(0, limit)
      .map((r) => structuredClone(r));
  }

  async listAllPaginated(userId: string, pageSize = 200): Promise<SignalOutcomeRecord[]> {
    const all = [...this.bucket(userId).values()].sort((a, b) =>
      b.snapshot.createdAt.localeCompare(a.snapshot.createdAt)
    );
    const out: SignalOutcomeRecord[] = [];
    for (let i = 0; i < all.length; i += pageSize) {
      out.push(...all.slice(i, i + pageSize).map((r) => structuredClone(r)));
    }
    return out;
  }

  async listActive(userId: string): Promise<SignalOutcomeRecord[]> {
    return (await this.listAllPaginated(userId)).filter((r) =>
      isActiveLife(r.monitoring.lifecycle)
    );
  }

  async listActiveMatching(
    userId: string,
    match: ActiveMatchFilter
  ): Promise<SignalOutcomeRecord[]> {
    return (await this.listActive(userId)).filter((r) => matchesFilter(r, match));
  }

  async tryAcquireLease(
    userId: string,
    signalId: string,
    ownerId: string,
    leaseMs: number
  ): Promise<SignalOutcomeRecord | null> {
    const current = await this.get(userId, signalId);
    if (!current) return null;
    const now = Date.now();
    const until = current.leaseUntil ? Date.parse(current.leaseUntil) : 0;
    if (current.leaseOwnerId && current.leaseOwnerId !== ownerId && until > now) {
      return null;
    }
    current.leaseOwnerId = ownerId;
    current.leaseUntil = new Date(now + leaseMs).toISOString();
    return this.save(current);
  }

  async applyBarAtomic(
    userId: string,
    signalId: string,
    bar: SignalBarInput,
    ownerId: string,
    leaseMs = 60_000
  ): Promise<ApplyBarResult> {
    const current = await this.get(userId, signalId);
    if (!current) return { record: null, status: "NOT_FOUND", signalId };

    const now = Date.now();
    const until = current.leaseUntil ? Date.parse(current.leaseUntil) : 0;
    if (current.leaseOwnerId && current.leaseOwnerId !== ownerId && until > now) {
      return { record: structuredClone(current), status: "LEASE_BUSY", signalId };
    }

    if (!isActiveLife(current.monitoring.lifecycle)) {
      const pre = classifyPreApply(current, bar);
      if (pre === "DUPLICATE") return { record: current, status: "DUPLICATE", signalId };
      return { record: current, status: "TERMINAL", signalId };
    }

    const preStatus = classifyPreApply(current, bar);
    if (preStatus === "DUPLICATE") return { record: current, status: "DUPLICATE", signalId };
    if (preStatus === "IDENTITY_MISMATCH") {
      return { record: current, status: "IDENTITY_MISMATCH", signalId };
    }
    if (preStatus === "OUT_OF_ORDER_WAIT") {
      return { record: current, status: "OUT_OF_ORDER_WAIT", signalId };
    }

    current.leaseOwnerId = ownerId;
    current.leaseUntil = new Date(now + leaseMs).toISOString();
    const beforeFinal = current.finalResult?.outcome ?? null;
    const next = applyBarToSignalOutcome(current, bar);
    releaseLease(next);
    const saved = await this.save(next);

    if (
      saved.finalResult &&
      saved.finalResult.outcome &&
      beforeFinal == null &&
      ["WIN", "LOSS", "BREAKEVEN", "EXPIRED", "CANCELLED", "AMBIGUOUS", "DATA_UNAVAILABLE"].includes(
        saved.finalResult.outcome
      )
    ) {
      const day = dayFromIso(saved.finalResult.exitTimestamp ?? saved.updatedAt);
      await this.upsertDailyAggregateDelta(userId, day, saved.snapshot.environment, {
        wins: saved.finalResult.outcome === "WIN" ? 1 : 0,
        losses: saved.finalResult.outcome === "LOSS" ? 1 : 0,
        breakeven: saved.finalResult.outcome === "BREAKEVEN" ? 1 : 0,
        expired: saved.finalResult.outcome === "EXPIRED" ? 1 : 0,
        cancelled: saved.finalResult.outcome === "CANCELLED" ? 1 : 0,
        ambiguousIntrabar: saved.finalResult.outcome === "AMBIGUOUS" ? 1 : 0,
        dataUnavailable: saved.finalResult.outcome === "DATA_UNAVAILABLE" ? 1 : 0,
        netPoints: saved.finalResult.netPoints ?? 0,
        netR: saved.finalResult.netR ?? 0,
        closedTradeCount: ["WIN", "LOSS", "BREAKEVEN"].includes(saved.finalResult.outcome) ? 1 : 0
      });
    }

    return {
      record: saved,
      status: preStatus === "SAME_CANDLE_SKIP" ? "SAME_CANDLE_SKIP" : "APPLIED",
      signalId
    };
  }

  async upsertDailyAggregateDelta(
    userId: string,
    day: string,
    environment: "LIVE" | "TEST",
    delta: Partial<SignalPerformanceDailyAggregate>
  ): Promise<void> {
    const key = `${userId}|${day}|${environment}`;
    const existing = this.aggregates.get(key) ?? {
      day,
      userId,
      environment,
      wins: 0,
      losses: 0,
      breakeven: 0,
      expired: 0,
      cancelled: 0,
      ambiguousIntrabar: 0,
      dataUnavailable: 0,
      waitOnly: 0,
      netPoints: 0,
      netR: 0,
      closedTradeCount: 0,
      updatedAt: nowIso()
    };
    const next: SignalPerformanceDailyAggregate = {
      ...existing,
      wins: existing.wins + (delta.wins ?? 0),
      losses: existing.losses + (delta.losses ?? 0),
      breakeven: existing.breakeven + (delta.breakeven ?? 0),
      expired: existing.expired + (delta.expired ?? 0),
      cancelled: existing.cancelled + (delta.cancelled ?? 0),
      ambiguousIntrabar: existing.ambiguousIntrabar + (delta.ambiguousIntrabar ?? 0),
      dataUnavailable: existing.dataUnavailable + (delta.dataUnavailable ?? 0),
      waitOnly: existing.waitOnly + (delta.waitOnly ?? 0),
      netPoints: Math.round((existing.netPoints + (delta.netPoints ?? 0)) * 100) / 100,
      netR: Math.round((existing.netR + (delta.netR ?? 0)) * 100) / 100,
      closedTradeCount: existing.closedTradeCount + (delta.closedTradeCount ?? 0),
      updatedAt: nowIso()
    };
    this.aggregates.set(key, next);
  }

  async listDailyAggregates(userId: string): Promise<SignalPerformanceDailyAggregate[]> {
    return [...this.aggregates.values()].filter((a) => a.userId === userId);
  }
}

export class FirestoreSignalOutcomeStore implements SignalOutcomeStore {
  constructor(private readonly db: Firestore) {}

  private col(userId: string) {
    return this.db.collection("users").doc(userId).collection("signalOutcomes");
  }

  private aggCol(userId: string) {
    return this.db.collection("users").doc(userId).collection("signalPerformanceDaily");
  }

  async save(record: SignalOutcomeRecord): Promise<SignalOutcomeRecord> {
    await this.col(record.snapshot.userId).doc(record.snapshot.signalId).set(record);
    return record;
  }

  async get(userId: string, signalId: string): Promise<SignalOutcomeRecord | null> {
    const snap = await this.col(userId).doc(signalId).get();
    return snap.exists ? (snap.data() as SignalOutcomeRecord) : null;
  }

  async getByDecisionId(userId: string, decisionId: string): Promise<SignalOutcomeRecord | null> {
    const q = await this.col(userId).where("snapshot.decisionId", "==", decisionId).limit(1).get();
    if (q.empty) return null;
    return q.docs[0]!.data() as SignalOutcomeRecord;
  }

  async list(userId: string, limit = 100): Promise<SignalOutcomeRecord[]> {
    const q = await this.col(userId).orderBy("snapshot.createdAt", "desc").limit(limit).get();
    return q.docs.map((d) => d.data() as SignalOutcomeRecord);
  }

  async listAllPaginated(userId: string, pageSize = 200): Promise<SignalOutcomeRecord[]> {
    const out: SignalOutcomeRecord[] = [];
    let cursor: QueryDocumentSnapshot | null = null;
    // Paginate until exhausted — complete history, not newest-500 only.
    for (;;) {
      let q: Query = this.col(userId)
        .orderBy("snapshot.createdAt", "desc")
        .limit(pageSize);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      if (snap.empty) break;
      out.push(...snap.docs.map((d) => d.data() as SignalOutcomeRecord));
      cursor = snap.docs[snap.docs.length - 1] ?? null;
      if (snap.size < pageSize) break;
    }
    return out;
  }

  async listActive(userId: string): Promise<SignalOutcomeRecord[]> {
    // Prefer lifecycle field query; fall back to paginated filter.
    try {
      const q = await this.col(userId)
        .where("monitoring.lifecycle", "in", ACTIVE_MONITOR_LIFECYCLES)
        .get();
      return q.docs.map((d) => d.data() as SignalOutcomeRecord);
    } catch {
      return (await this.listAllPaginated(userId)).filter((r) =>
        isActiveLife(r.monitoring.lifecycle)
      );
    }
  }

  async listActiveMatching(
    userId: string,
    match: ActiveMatchFilter
  ): Promise<SignalOutcomeRecord[]> {
    // Include timeframe in the query (indexed) — do not fetch broader then filter.
    const timeframeKey = match.timeframe ?? "";
    const q = await this.col(userId)
      .where("monitoring.lifecycle", "in", ACTIVE_MONITOR_LIFECYCLES)
      .where("snapshot.symbol", "==", match.symbol)
      .where("snapshot.environment", "==", match.environment)
      .where("snapshot.timeframe", "==", timeframeKey)
      .get();
    return q.docs.map((d) => d.data() as SignalOutcomeRecord);
  }

  async tryAcquireLease(
    userId: string,
    signalId: string,
    ownerId: string,
    leaseMs: number
  ): Promise<SignalOutcomeRecord | null> {
    const ref = this.col(userId).doc(signalId);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const current = snap.data() as SignalOutcomeRecord;
      const now = Date.now();
      const until = current.leaseUntil ? Date.parse(current.leaseUntil) : 0;
      if (current.leaseOwnerId && current.leaseOwnerId !== ownerId && until > now) {
        return null;
      }
      current.leaseOwnerId = ownerId;
      current.leaseUntil = new Date(now + leaseMs).toISOString();
      tx.set(ref, current);
      return current;
    });
  }

  async applyBarAtomic(
    userId: string,
    signalId: string,
    bar: SignalBarInput,
    ownerId: string,
    leaseMs = 60_000
  ): Promise<ApplyBarResult> {
    const ref = this.col(userId).doc(signalId);
    return this.db.runTransaction(async (tx: Transaction) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { record: null, status: "NOT_FOUND" as const, signalId };
      const current = snap.data() as SignalOutcomeRecord;
      const now = Date.now();
      const until = current.leaseUntil ? Date.parse(current.leaseUntil) : 0;
      if (current.leaseOwnerId && current.leaseOwnerId !== ownerId && until > now) {
        return { record: current, status: "LEASE_BUSY" as const, signalId };
      }

      if (!isActiveLife(current.monitoring.lifecycle)) {
        const pre = classifyPreApply(current, bar);
        if (pre === "DUPLICATE") return { record: current, status: "DUPLICATE" as const, signalId };
        return { record: current, status: "TERMINAL" as const, signalId };
      }

      const preStatus = classifyPreApply(current, bar);
      if (preStatus === "DUPLICATE") return { record: current, status: "DUPLICATE" as const, signalId };
      if (preStatus === "IDENTITY_MISMATCH") {
        return { record: current, status: "IDENTITY_MISMATCH" as const, signalId };
      }
      if (preStatus === "OUT_OF_ORDER_WAIT") {
        return { record: current, status: "OUT_OF_ORDER_WAIT" as const, signalId };
      }

      // All reads before writes (Firestore transaction rule).
      const day = dayFromIso(bar.barTime);
      const aggRef = this.aggCol(userId).doc(`${day}_${current.snapshot.environment}`);
      const aggSnap = await tx.get(aggRef);

      current.leaseOwnerId = ownerId;
      current.leaseUntil = new Date(now + leaseMs).toISOString();
      const beforeFinal = current.finalResult?.outcome ?? null;
      const next = applyBarToSignalOutcome(current, bar);
      releaseLease(next);
      tx.set(ref, next);

      if (
        next.finalResult?.outcome &&
        beforeFinal == null &&
        ["WIN", "LOSS", "BREAKEVEN", "EXPIRED", "CANCELLED", "AMBIGUOUS", "DATA_UNAVAILABLE"].includes(
          next.finalResult.outcome
        )
      ) {
        const existing = (aggSnap.exists
          ? (aggSnap.data() as SignalPerformanceDailyAggregate)
          : null) ?? {
          day,
          userId,
          environment: next.snapshot.environment,
          wins: 0,
          losses: 0,
          breakeven: 0,
          expired: 0,
          cancelled: 0,
          ambiguousIntrabar: 0,
          dataUnavailable: 0,
          waitOnly: 0,
          netPoints: 0,
          netR: 0,
          closedTradeCount: 0,
          updatedAt: nowIso()
        };
        const o = next.finalResult.outcome;
        const updated: SignalPerformanceDailyAggregate = {
          ...existing,
          wins: existing.wins + (o === "WIN" ? 1 : 0),
          losses: existing.losses + (o === "LOSS" ? 1 : 0),
          breakeven: existing.breakeven + (o === "BREAKEVEN" ? 1 : 0),
          expired: existing.expired + (o === "EXPIRED" ? 1 : 0),
          cancelled: existing.cancelled + (o === "CANCELLED" ? 1 : 0),
          ambiguousIntrabar: existing.ambiguousIntrabar + (o === "AMBIGUOUS" ? 1 : 0),
          dataUnavailable: existing.dataUnavailable + (o === "DATA_UNAVAILABLE" ? 1 : 0),
          netPoints: Math.round((existing.netPoints + (next.finalResult.netPoints ?? 0)) * 100) / 100,
          netR: Math.round((existing.netR + (next.finalResult.netR ?? 0)) * 100) / 100,
          closedTradeCount:
            existing.closedTradeCount + (["WIN", "LOSS", "BREAKEVEN"].includes(o) ? 1 : 0),
          updatedAt: nowIso()
        };
        tx.set(aggRef, updated);
      }

      return {
        record: next,
        status: (preStatus === "SAME_CANDLE_SKIP" ? "SAME_CANDLE_SKIP" : "APPLIED") as SignalBarApplyStatus,
        signalId
      };
    });
  }

  async upsertDailyAggregateDelta(
    userId: string,
    day: string,
    environment: "LIVE" | "TEST",
    delta: Partial<SignalPerformanceDailyAggregate>
  ): Promise<void> {
    const ref = this.aggCol(userId).doc(`${day}_${environment}`);
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = (snap.exists ? (snap.data() as SignalPerformanceDailyAggregate) : null) ?? {
        day,
        userId,
        environment,
        wins: 0,
        losses: 0,
        breakeven: 0,
        expired: 0,
        cancelled: 0,
        ambiguousIntrabar: 0,
        dataUnavailable: 0,
        waitOnly: 0,
        netPoints: 0,
        netR: 0,
        closedTradeCount: 0,
        updatedAt: nowIso()
      };
      tx.set(ref, {
        ...existing,
        wins: existing.wins + (delta.wins ?? 0),
        losses: existing.losses + (delta.losses ?? 0),
        breakeven: existing.breakeven + (delta.breakeven ?? 0),
        expired: existing.expired + (delta.expired ?? 0),
        cancelled: existing.cancelled + (delta.cancelled ?? 0),
        ambiguousIntrabar: existing.ambiguousIntrabar + (delta.ambiguousIntrabar ?? 0),
        dataUnavailable: existing.dataUnavailable + (delta.dataUnavailable ?? 0),
        waitOnly: existing.waitOnly + (delta.waitOnly ?? 0),
        netPoints: Math.round((existing.netPoints + (delta.netPoints ?? 0)) * 100) / 100,
        netR: Math.round((existing.netR + (delta.netR ?? 0)) * 100) / 100,
        closedTradeCount: existing.closedTradeCount + (delta.closedTradeCount ?? 0),
        updatedAt: nowIso()
      });
    });
  }

  async listDailyAggregates(userId: string): Promise<SignalPerformanceDailyAggregate[]> {
    const snap = await this.aggCol(userId).get();
    return snap.docs.map((d) => d.data() as SignalPerformanceDailyAggregate);
  }
}
