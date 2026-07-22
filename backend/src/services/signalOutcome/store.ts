/* eslint-disable @typescript-eslint/require-await -- sync in-memory impl of async port */
/**
 * Signal outcome persistence — in-memory + Firestore.
 * Collection: users/{uid}/signalOutcomes/{signalId}
 */

import type { Firestore } from "firebase-admin/firestore";
import type { SignalOutcomeRecord } from "./types";

export interface SignalOutcomeStore {
  save(record: SignalOutcomeRecord): Promise<SignalOutcomeRecord>;
  get(userId: string, signalId: string): Promise<SignalOutcomeRecord | null>;
  getByDecisionId(userId: string, decisionId: string): Promise<SignalOutcomeRecord | null>;
  list(userId: string, limit?: number): Promise<SignalOutcomeRecord[]>;
  listActive(userId: string): Promise<SignalOutcomeRecord[]>;
  /**
   * Transactional lease: only one worker may monitor a signal at a time.
   * Returns the record if lease acquired or already owned by ownerId.
   */
  tryAcquireLease(
    userId: string,
    signalId: string,
    ownerId: string,
    leaseMs: number
  ): Promise<SignalOutcomeRecord | null>;
}

export class InMemorySignalOutcomeStore implements SignalOutcomeStore {
  private readonly byUser = new Map<string, Map<string, SignalOutcomeRecord>>();

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

  async listActive(userId: string): Promise<SignalOutcomeRecord[]> {
    const active = new Set([
      "PENDING_ENTRY",
      "OPEN",
      "TP1_HIT",
      "TP2_HIT",
      "BREAKEVEN"
    ]);
    return (await this.list(userId, 500)).filter((r) => active.has(r.monitoring.lifecycle));
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
}

export class FirestoreSignalOutcomeStore implements SignalOutcomeStore {
  constructor(private readonly db: Firestore) {}

  private col(userId: string) {
    return this.db.collection("users").doc(userId).collection("signalOutcomes");
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

  async listActive(userId: string): Promise<SignalOutcomeRecord[]> {
    const all = await this.list(userId, 500);
    const active = new Set(["PENDING_ENTRY", "OPEN", "TP1_HIT", "TP2_HIT", "BREAKEVEN"]);
    return all.filter((r) => active.has(r.monitoring.lifecycle));
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
}
