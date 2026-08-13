/**
 * Persistent Micro collector status — authoritative across API/worker processes.
 * Path: microEdge/shadow-v1/marketData/_/collectorStatus/runtime
 */
import { getFirestore } from "firebase-admin/firestore";
import { MICRO_NAMESPACE } from "../config";
import {
  assertMicroStorageModeAllowed,
  resolveMicroStorageMode,
  type MicroStorageMode
} from "./storageMode";

export type MicroPersistentCollectorStatus = {
  connectionState: "LIVE_CONNECTED" | "LIVE_NOT_CONNECTED";
  oauthStatus: string;
  accountAuthorized: boolean | null;
  environment: "DEMO" | "LIVE" | null;
  broker: string | null;
  brokerVerified: boolean | null;
  symbolId: string | null;
  symbolName: string | null;
  spotSubscribed: boolean;
  lastSpotEventAt: string | null;
  lastValidQuoteAt: string | null;
  /** Broker quote timestamp ISO — API computes age from now. */
  lastQuoteBrokerTimestamp: string | null;
  lastQuoteBid: number | null;
  lastQuoteAsk: number | null;
  lastCompletedM1: string | null;
  lastCompletedM5: string | null;
  lastCompletedM15: string | null;
  heartbeatAt: string | null;
  reconnectAttempts: number;
  collectorVersion: string;
  permissionScope: "SCOPE_VIEW" | null;
  mutationSurface: "NONE";
  updatedAt: string;
};

export const MICRO_COLLECTOR_VERSION = "micro-collector-v1";
export const MICRO_HEARTBEAT_MAX_AGE_MS = 60_000;

export interface MicroCollectorStatusStore {
  readonly storageMode: MicroStorageMode;
  save(status: MicroPersistentCollectorStatus): Promise<void>;
  get(): Promise<MicroPersistentCollectorStatus | null>;
}

export class MemoryMicroCollectorStatusStore implements MicroCollectorStatusStore {
  readonly storageMode = "memory" as const;
  private status: MicroPersistentCollectorStatus | null = null;
  constructor(private readonly shared?: { current: MicroPersistentCollectorStatus | null }) {}

  async save(status: MicroPersistentCollectorStatus): Promise<void> {
    if (this.shared) this.shared.current = status;
    else this.status = status;
  }

  async get(): Promise<MicroPersistentCollectorStatus | null> {
    return this.shared ? this.shared.current : this.status;
  }
}

export class FirestoreMicroCollectorStatusStore implements MicroCollectorStatusStore {
  readonly storageMode = "firestore" as const;

  private ref() {
    const [root, docId] = MICRO_NAMESPACE.split("/");
    return getFirestore()
      .collection(root!)
      .doc(docId!)
      .collection("marketData")
      .doc("_")
      .collection("collectorStatus")
      .doc("runtime");
  }

  async save(status: MicroPersistentCollectorStatus): Promise<void> {
    await this.ref().set(status, { merge: true });
  }

  async get(): Promise<MicroPersistentCollectorStatus | null> {
    const snap = await this.ref().get();
    return snap.exists ? (snap.data() as MicroPersistentCollectorStatus) : null;
  }
}

let defaultStatusStore: MicroCollectorStatusStore | null = null;
let sharedMemoryStatus: { current: MicroPersistentCollectorStatus | null } | null =
  null;

export function createMicroCollectorStatusStore(args?: {
  mode?: MicroStorageMode;
  shared?: { current: MicroPersistentCollectorStatus | null };
}): MicroCollectorStatusStore {
  const mode = args?.mode ?? resolveMicroStorageMode();
  assertMicroStorageModeAllowed(mode);
  if (mode === "firestore") return new FirestoreMicroCollectorStatusStore();
  const shared = args?.shared ?? sharedMemoryStatus ?? { current: null };
  if (!args?.shared && !sharedMemoryStatus) sharedMemoryStatus = shared;
  return new MemoryMicroCollectorStatusStore(shared);
}

export function getMicroCollectorStatusStore(): MicroCollectorStatusStore {
  if (!defaultStatusStore) defaultStatusStore = createMicroCollectorStatusStore();
  return defaultStatusStore;
}

export function resetMicroCollectorStatusStoreForTests(
  shared?: { current: MicroPersistentCollectorStatus | null }
): MemoryMicroCollectorStatusStore {
  sharedMemoryStatus = shared ?? { current: null };
  const store = new MemoryMicroCollectorStatusStore(sharedMemoryStatus);
  defaultStatusStore = store;
  return store;
}

export function evaluatePersistentCollectorHealth(
  status: MicroPersistentCollectorStatus | null,
  nowMs = Date.now(),
  heartbeatMaxAgeMs = MICRO_HEARTBEAT_MAX_AGE_MS
): {
  liveConnected: boolean;
  collectorHealthy: boolean;
  heartbeatAgeMs: number | null;
  quoteAgeMs: number | null;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (!status) {
    return {
      liveConnected: false,
      collectorHealthy: false,
      heartbeatAgeMs: null,
      quoteAgeMs: null,
      reasons: ["collector_offline"]
    };
  }
  const hb = status.heartbeatAt ? Date.parse(status.heartbeatAt) : NaN;
  const heartbeatAgeMs = Number.isFinite(hb) ? nowMs - hb : null;
  if (heartbeatAgeMs == null || heartbeatAgeMs > heartbeatMaxAgeMs) {
    reasons.push("collector_heartbeat_stale");
  }
  if (status.connectionState !== "LIVE_CONNECTED") {
    reasons.push("market_feed_not_connected");
  }
  if (status.permissionScope !== "SCOPE_VIEW") {
    reasons.push("permission_scope_invalid");
  }
  if (!status.accountAuthorized) reasons.push("account_not_authorized");
  if (status.environment !== "DEMO") reasons.push("environment_not_demo");
  if (!status.symbolId) reasons.push("xauusd_not_found");
  if (!status.spotSubscribed) reasons.push("spot_not_subscribed");
  if (!status.lastQuoteBrokerTimestamp) reasons.push("quote_missing");
  const qTs = status.lastQuoteBrokerTimestamp
    ? Date.parse(status.lastQuoteBrokerTimestamp)
    : NaN;
  const quoteAgeMs = Number.isFinite(qTs) ? nowMs - qTs : null;
  if (quoteAgeMs != null && quoteAgeMs > 30_000) reasons.push("quote_stale");
  if (!status.lastCompletedM1) reasons.push("m1_missing");

  const unique = [...new Set(reasons)];
  const healthy = unique.length === 0;
  return {
    liveConnected: healthy,
    collectorHealthy: healthy,
    heartbeatAgeMs,
    quoteAgeMs,
    reasons: unique
  };
}
