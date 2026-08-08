import { getFirestore } from "firebase-admin/firestore";
import type { AutoTradeEnvironment } from "./userAutoTradeSettings";
import type { DailySafetyDocument } from "./dailySafetyTypes";

const TZ = "Europe/Dublin";

export function tradingDayKey(now = new Date()): string {
  // en-CA yields YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function docRef(uid: string, environment: AutoTradeEnvironment) {
  return getFirestore().doc(`users/${uid}/autotradeDailySafety/${environment}`);
}

export function emptyDailySafety(
  uid: string,
  environment: AutoTradeEnvironment,
  day = tradingDayKey()
): DailySafetyDocument {
  return {
    uid,
    environment,
    tradingDay: day,
    tradesUsed: 0,
    realisedPnl: 0,
    peakDailyPnl: 0,
    consecutiveLosses: 0,
    openPositions: 0,
    cooldownUntil: null,
    pausedReason: null,
    pausedAt: null,
    dailyLossLocked: false,
    dailyProfitTargetHit: false,
    profitProtectionPaused: false,
    lastTradeClosedAt: null,
    lastTradeWasLoss: null,
    updatedAt: new Date().toISOString(),
    countedTradeIds: []
  };
}

export async function getDailySafetyDoc(
  uid: string,
  environment: AutoTradeEnvironment
): Promise<DailySafetyDocument> {
  const day = tradingDayKey();
  const snap = await docRef(uid, environment).get();
  if (!snap.exists) return emptyDailySafety(uid, environment, day);
  const data = snap.data() as DailySafetyDocument;
  if (data.tradingDay !== day) {
    // New trading day — reset counters, keep uid/env.
    return emptyDailySafety(uid, environment, day);
  }
  return {
    ...emptyDailySafety(uid, environment, day),
    ...data,
    uid,
    environment,
    tradingDay: day,
    countedTradeIds: Array.isArray(data.countedTradeIds)
      ? data.countedTradeIds.map(String).slice(-200)
      : []
  };
}

export async function saveDailySafetyDoc(doc: DailySafetyDocument): Promise<void> {
  const next = { ...doc, updatedAt: new Date().toISOString() };
  await docRef(doc.uid, doc.environment).set(next, { merge: true });
}
