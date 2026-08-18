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

function historyRef(uid: string, environment: AutoTradeEnvironment, day: string) {
  return getFirestore().doc(
    `users/${uid}/autotradeDailySafetyHistory/${environment}_${day}`
  );
}

export async function getDailySafetyDoc(
  uid: string,
  environment: AutoTradeEnvironment
): Promise<DailySafetyDocument> {
  const day = tradingDayKey();
  const ref = docRef(uid, environment);
  const snap = await ref.get();
  if (!snap.exists) {
    const fresh = emptyDailySafety(uid, environment, day);
    await ref.set(fresh);
    return fresh;
  }
  const data = snap.data() as DailySafetyDocument;
  if (data.tradingDay !== day) {
    // Persist yesterday as history; replace the active document (no merge).
    const archived = {
      ...data,
      uid,
      environment
    };
    try {
      await historyRef(uid, environment, data.tradingDay || "unknown").set(archived, {
        merge: true
      });
    } catch {
      /* history is best-effort — active day must still roll */
    }
    const fresh = emptyDailySafety(uid, environment, day);
    await ref.set(fresh);
    return fresh;
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
  const today = tradingDayKey();
  if (doc.tradingDay && doc.tradingDay !== today) {
    try {
      await historyRef(doc.uid, doc.environment, doc.tradingDay).set(
        { ...doc, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    } catch {
      /* keep going — never write yesterday onto today's active doc */
    }
    return;
  }
  const next = { ...doc, tradingDay: today, updatedAt: new Date().toISOString() };
  await docRef(doc.uid, doc.environment).set(next);
}
