/**
 * Persisted weekly GoldMeta reports — one per uid / week / environment.
 */

import { getFirestore } from "firebase-admin/firestore";

export type StoredWeeklyReport = {
  id: string;
  uid: string;
  weekKey: string;
  weekStart: string;
  weekEnd: string;
  environment: "DEMO" | "LIVE";
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  netPnl: number;
  averageRr: number | null;
  largestDrawdown: number | null;
  buyWinRate: number | null;
  sellWinRate: number | null;
  londonTrades: number;
  newYorkTrades: number;
  qualificationLabel: string;
  safetyEvents: string[];
  whatWorked: string[];
  whatStruggled: string[];
  nextWeek: string[];
  generatedAt: string;
  notificationSent: boolean;
};

function weekBounds(now = new Date()): { weekKey: string; weekStart: string; weekEnd: string } {
  // Trading week Mon 00:00 UTC → Sun 23:59 UTC
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay(); // 0 Sun
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() + diffToMon);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const weekStart = mon.toISOString().slice(0, 10);
  const weekEnd = sun.toISOString().slice(0, 10);
  return { weekKey: weekStart, weekStart, weekEnd };
}

export function currentWeekBounds(now = new Date()) {
  return weekBounds(now);
}

/** Previous complete trading week (for weekend generation). */
export function previousWeekBounds(now = new Date()) {
  const cur = weekBounds(now);
  const start = new Date(cur.weekStart + "T00:00:00.000Z");
  start.setUTCDate(start.getUTCDate() - 7);
  return weekBounds(start);
}

function reportDoc(uid: string, weekKey: string, environment: "DEMO" | "LIVE") {
  return getFirestore().doc(
    `users/${uid}/autotradeWeeklyReports/${weekKey}_${environment}`
  );
}

export async function getWeeklyReport(
  uid: string,
  weekKey: string,
  environment: "DEMO" | "LIVE"
): Promise<StoredWeeklyReport | null> {
  const snap = await reportDoc(uid, weekKey, environment).get();
  if (!snap.exists) return null;
  return snap.data() as StoredWeeklyReport;
}

export async function saveWeeklyReport(
  report: StoredWeeklyReport
): Promise<{ created: boolean; report: StoredWeeklyReport }> {
  const ref = reportDoc(report.uid, report.weekKey, report.environment);
  const existing = await ref.get();
  if (existing.exists) {
    return { created: false, report: existing.data() as StoredWeeklyReport };
  }
  await ref.set(report);
  return { created: true, report };
}

export async function listWeeklyReports(
  uid: string,
  limit = 12
): Promise<StoredWeeklyReport[]> {
  const snap = await getFirestore()
    .collection(`users/${uid}/autotradeWeeklyReports`)
    .orderBy("generatedAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as StoredWeeklyReport);
}
