/**
 * Firestore store restricted to microEdge/shadow-v1/** namespace.
 */
import { getFirestore } from "firebase-admin/firestore";
import { MICRO_NAMESPACE } from "../config";
import type {
  MicroFeatureSnapshot,
  MicroOutcome,
  MicroPendingOutcome,
  MicroPerformanceSlice,
  MicroPrediction
} from "../types";
import type { MicroEdgeStore } from "./microEdgeStore";

function assertMicroPath(path: string): void {
  if (!path.startsWith(`${MICRO_NAMESPACE}/`)) {
    throw new Error(`MICRO_STORE_NAMESPACE_VIOLATION: ${path}`);
  }
}

export class FirestoreMicroEdgeStore implements MicroEdgeStore {
  private col(name: string) {
    const path = `${MICRO_NAMESPACE}/${name}`;
    assertMicroPath(path + "/x");
    // Use collection under document microEdge/shadow-v1
    // Structure: microEdge (col) / shadow-v1 (doc) / {name} (col)
    const [root, docId] = MICRO_NAMESPACE.split("/");
    return getFirestore().collection(root!).doc(docId!).collection(name);
  }

  async savePrediction(p: MicroPrediction): Promise<"created" | "exists"> {
    const ref = this.col("predictions").doc(p.predictionId);
    return getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return "exists";
      tx.create(ref, p);
      return "created";
    });
  }

  async saveFeatures(f: MicroFeatureSnapshot): Promise<"created" | "exists"> {
    const ref = this.col("features").doc(f.featureRef);
    return getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return "exists";
      tx.create(ref, f);
      return "created";
    });
  }

  async getPrediction(id: string): Promise<MicroPrediction | null> {
    const snap = await this.col("predictions").doc(id).get();
    return snap.exists ? (snap.data() as MicroPrediction) : null;
  }

  async listPredictions(limit: number): Promise<MicroPrediction[]> {
    const snap = await this.col("predictions")
      .orderBy("candleCloseEpochMs", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as MicroPrediction);
  }

  async savePending(p: MicroPendingOutcome): Promise<"created" | "exists"> {
    const id = `${p.predictionId}_${p.horizon}`;
    const ref = this.col("pendingOutcomes").doc(id);
    return getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return "exists";
      tx.create(ref, p);
      return "created";
    });
  }

  async listPendingDue(now: string, limit: number): Promise<MicroPendingOutcome[]> {
    const snap = await this.col("pendingOutcomes")
      .where("status", "==", "PENDING")
      .where("dueAt", "<=", now)
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as MicroPendingOutcome);
  }

  async saveOutcome(o: MicroOutcome): Promise<"created" | "exists"> {
    const id = `${o.predictionId}_${o.horizon}`;
    const ref = this.col("outcomes").doc(id);
    return getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return "exists";
      tx.create(ref, o);
      return "created";
    });
  }

  async listOutcomes(limit: number): Promise<MicroOutcome[]> {
    const snap = await this.col("outcomes").orderBy("scoredAt", "desc").limit(limit).get();
    return snap.docs.map((d) => d.data() as MicroOutcome);
  }

  async savePerformance(slice: MicroPerformanceSlice): Promise<void> {
    await this.col("performance").doc(slice.key).set(slice, { merge: true });
  }

  async getLatestPrediction(): Promise<MicroPrediction | null> {
    const list = await this.listPredictions(1);
    return list[0] ?? null;
  }
}

/** In-memory store for unit tests — still enforces namespace constant usage. */
export class MemoryMicroEdgeStore implements MicroEdgeStore {
  predictions = new Map<string, MicroPrediction>();
  features = new Map<string, MicroFeatureSnapshot>();
  pending = new Map<string, MicroPendingOutcome>();
  outcomes = new Map<string, MicroOutcome>();
  performance = new Map<string, MicroPerformanceSlice>();

  async savePrediction(p: MicroPrediction): Promise<"created" | "exists"> {
    if (this.predictions.has(p.predictionId)) return "exists";
    this.predictions.set(p.predictionId, p);
    return "created";
  }
  async saveFeatures(f: MicroFeatureSnapshot): Promise<"created" | "exists"> {
    if (this.features.has(f.featureRef)) return "exists";
    this.features.set(f.featureRef, f);
    return "created";
  }
  async getPrediction(id: string) {
    return this.predictions.get(id) ?? null;
  }
  async listPredictions(limit: number) {
    return [...this.predictions.values()]
      .sort((a, b) => b.candleCloseEpochMs - a.candleCloseEpochMs)
      .slice(0, limit);
  }
  async savePending(p: MicroPendingOutcome): Promise<"created" | "exists"> {
    const id = `${p.predictionId}_${p.horizon}`;
    if (this.pending.has(id)) return "exists";
    this.pending.set(id, p);
    return "created";
  }
  async listPendingDue(now: string, limit: number) {
    return [...this.pending.values()]
      .filter((p) => p.status === "PENDING" && p.dueAt <= now)
      .slice(0, limit);
  }
  async saveOutcome(o: MicroOutcome): Promise<"created" | "exists"> {
    const id = `${o.predictionId}_${o.horizon}`;
    if (this.outcomes.has(id)) return "exists";
    this.outcomes.set(id, o);
    return "created";
  }
  async listOutcomes(limit: number) {
    return [...this.outcomes.values()].slice(0, limit);
  }
  async savePerformance(slice: MicroPerformanceSlice) {
    this.performance.set(slice.key, slice);
  }
  async getLatestPrediction() {
    const list = await this.listPredictions(1);
    return list[0] ?? null;
  }
}
