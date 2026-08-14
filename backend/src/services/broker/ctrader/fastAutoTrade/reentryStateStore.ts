/**
 * Persisted FAST_AUTOTRADE_V1 re-entry / duplicate-signal state.
 * Path: users/{uid}/autotradeFastReentry/current
 *
 * Analysis/execution engine only — not exposed as UI state.
 */

import { getFirestore } from "firebase-admin/firestore";
import type { FastAction, FastReentryContext, FastSetupIdentity } from "./types";

function emptyReentry(): FastReentryContext {
  return {
    lastSetup: null,
    lastExitAtMs: null,
    lastSignalKey: null,
    currentCandleKey: null,
    lastAction: null,
    lastActionAtMs: null
  };
}

function docRef(uid: string) {
  return getFirestore().doc(`users/${uid}/autotradeFastReentry/current`);
}

/** Test/in-process override — avoids Firestore in unit tests. */
const memory = new Map<string, FastReentryContext>();
let useMemory = false;

export function useFastReentryMemoryStore(enabled = true): void {
  useMemory = enabled;
  if (!enabled) memory.clear();
}

export function resetFastReentryMemoryStore(): void {
  memory.clear();
}

function asSetup(value: unknown): FastSetupIdentity | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const direction = rec.direction === "BUY" || rec.direction === "SELL" ? rec.direction : null;
  const setupType =
    typeof rec.setupType === "string" && rec.setupType.length > 0
      ? (rec.setupType as FastSetupIdentity["setupType"])
      : null;
  if (!direction || !setupType) return null;
  return {
    direction,
    setupType,
    structureAnchor: typeof rec.structureAnchor === "string" ? rec.structureAnchor : "",
    triggerCandle: typeof rec.triggerCandle === "string" ? rec.triggerCandle : "",
    timestamp: typeof rec.timestamp === "string" ? rec.timestamp : ""
  };
}

function asAction(value: unknown): FastAction | null {
  if (value === "BUY" || value === "SELL" || value === "WAIT") return value;
  return null;
}

function asMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function normalize(raw: unknown): FastReentryContext {
  if (!raw || typeof raw !== "object") return emptyReentry();
  const rec = raw as Record<string, unknown>;
  return {
    lastSetup: asSetup(rec.lastSetup),
    lastExitAtMs: asMs(rec.lastExitAtMs),
    lastSignalKey: typeof rec.lastSignalKey === "string" ? rec.lastSignalKey : null,
    currentCandleKey: typeof rec.currentCandleKey === "string" ? rec.currentCandleKey : null,
    lastAction: asAction(rec.lastAction),
    lastActionAtMs: asMs(rec.lastActionAtMs)
  };
}

export async function loadFastReentryState(uid: string): Promise<FastReentryContext> {
  if (useMemory) {
    return memory.get(uid) ?? emptyReentry();
  }
  const snap = await docRef(uid).get();
  if (!snap.exists) return emptyReentry();
  return normalize(snap.data());
}

export async function saveFastReentryState(
  uid: string,
  state: FastReentryContext
): Promise<FastReentryContext> {
  const next = normalize(state);
  if (useMemory) {
    memory.set(uid, next);
    return next;
  }
  await docRef(uid).set({ ...next, updatedAt: new Date().toISOString() });
  return next;
}

export async function persistFastReentryEntry(
  uid: string,
  patch: {
    lastSetup: FastSetupIdentity | null;
    lastSignalKey: string | null;
    currentCandleKey: string | null;
    lastAction: FastAction | null;
    lastActionAtMs: number;
  }
): Promise<FastReentryContext> {
  const prev = await loadFastReentryState(uid);
  return saveFastReentryState(uid, {
    ...prev,
    lastSetup: patch.lastSetup,
    lastSignalKey: patch.lastSignalKey,
    currentCandleKey: patch.currentCandleKey,
    lastAction: patch.lastAction,
    lastActionAtMs: patch.lastActionAtMs
  });
}

export async function persistFastReentryExit(
  uid: string,
  patch: {
    lastExitAtMs: number;
    lastAction?: FastAction | null;
    lastActionAtMs?: number;
  }
): Promise<FastReentryContext> {
  const prev = await loadFastReentryState(uid);
  return saveFastReentryState(uid, {
    ...prev,
    lastExitAtMs: patch.lastExitAtMs,
    lastAction: patch.lastAction ?? prev.lastAction,
    lastActionAtMs: patch.lastActionAtMs ?? patch.lastExitAtMs
  });
}
