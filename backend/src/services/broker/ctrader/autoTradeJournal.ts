/**
 * Automatic Journal records for controlled Demo / Demo Auto trades.
 * Uses existing journal store path when available; never blocks trade flow.
 */

import { getFirestore } from "firebase-admin/firestore";
import { randomBytes } from "crypto";

export type AutoTradeJournalInput = {
  uid: string;
  environment: "DEMO" | "LIVE";
  source: "qualification_controlled" | "demo_auto" | "manual";
  direction: "BUY" | "SELL";
  symbol?: string;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  lots: number | null;
  cashRisk: number | null;
  confidence: number | null;
  riskReward: number | null;
  session: string | null;
  spread: number | null;
  pnl: number | null;
  reasonForTrade: string;
  reasonForExit: string | null;
  qualificationStage: string | null;
  accountMasked: string | null;
  broker: string;
  correlationId: string;
  openedAt: string;
  closedAt: string | null;
};

function journalCol(uid: string) {
  return getFirestore().collection(`users/${uid}/journalEntries`);
}

export async function createAutoTradeJournalEntry(
  input: AutoTradeJournalInput
): Promise<{ id: string; created: boolean }> {
  const id = `atj_${input.correlationId}`;
  const ref = journalCol(input.uid).doc(id);
  const existing = await ref.get();
  if (existing.exists) return { id, created: false };

  const risk =
    input.entry != null && input.stopLoss != null
      ? Math.abs(input.entry - input.stopLoss)
      : null;
  const reward =
    input.entry != null && input.takeProfit != null
      ? Math.abs(input.takeProfit - input.entry)
      : null;
  const rr =
    risk && reward && risk > 0 ? Number((reward / risk).toFixed(2)) : input.riskReward;

  await ref.set({
    id,
    uid: input.uid,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: "autotrade",
    autoTrade: true,
    environment: input.environment,
    tradeSource: input.source,
    symbol: input.symbol ?? "XAUUSD",
    side: input.direction,
    entry: input.entry,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
    lots: input.lots,
    cashRisk: input.cashRisk,
    confidence: input.confidence,
    riskReward: rr,
    session: input.session,
    spread: input.spread,
    pnl: input.pnl,
    outcome:
      input.pnl == null ? "OPEN" : input.pnl > 0 ? "WIN" : input.pnl < 0 ? "LOSS" : "BREAKEVEN",
    reasonForTrade: input.reasonForTrade,
    reasonForExit: input.reasonForExit,
    qualificationStage: input.qualificationStage,
    accountMasked: input.accountMasked,
    broker: input.broker,
    correlationId: input.correlationId,
    openedAt: input.openedAt,
    closedAt: input.closedAt,
    tags: ["autotrade", input.environment.toLowerCase(), input.source]
  });
  return { id, created: true };
}

export async function listAutoTradeJournal(
  uid: string,
  opts?: { environment?: "DEMO" | "LIVE"; limit?: number }
): Promise<Array<Record<string, unknown>>> {
  let q = journalCol(uid).where("autoTrade", "==", true).orderBy("createdAt", "desc");
  const snap = await q.limit(opts?.limit ?? 100).get();
  let rows = snap.docs.map((d) => d.data() as Record<string, unknown>);
  if (opts?.environment) {
    rows = rows.filter((r) => r.environment === opts.environment);
  }
  return rows;
}

export function newCorrelationHint(): string {
  return randomBytes(4).toString("hex");
}
