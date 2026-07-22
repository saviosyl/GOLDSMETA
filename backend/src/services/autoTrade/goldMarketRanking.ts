/**
 * Rank IG Gold search hits. Never auto-selects when more than one primary remains.
 */

import type { IgGoldMarketCandidate } from "./igDemoTypes";

export function rankGoldCandidates(
  raw: Array<{
    epic: string;
    instrumentName: string;
    instrumentType?: string | null;
    expiry?: string | null;
    marketStatus?: string | null;
    currencyCode?: string | null;
    bid?: number | null;
    offer?: number | null;
  }>
): IgGoldMarketCandidate[] {
  const mapped: IgGoldMarketCandidate[] = raw.map((row) => {
    const name = row.instrumentName || row.epic;
    const epic = row.epic;
    const status = mapStatus(row.marketStatus);
    let score = 0;
    const reasons: string[] = [];
    if (/spot\s*gold/i.test(name)) {
      score += 50;
      reasons.push("Name contains Spot Gold");
    }
    if (/xauusd|xau\/usd/i.test(name) || /XAUUSD/i.test(epic)) {
      score += 40;
      reasons.push("XAUUSD identifier");
    }
    if (/gold/i.test(name)) {
      score += 10;
      reasons.push("Gold instrument");
    }
    if (/USCGC|CFEGOLD|GOLD/i.test(epic)) {
      score += 15;
      reasons.push("Gold-like EPIC");
    }
    if (row.expiry === "-" || row.expiry == null || row.expiry === "") {
      score += 8;
      reasons.push("No dated expiry (spot/cash style)");
    }
    if (/future|mini|micro|option/i.test(name)) {
      score -= 25;
      reasons.push("Likely futures/mini/option — deprioritised");
    }
    return {
      epic,
      instrumentName: name,
      instrumentType: row.instrumentType ?? null,
      expiry: row.expiry ?? null,
      marketStatus: status,
      currencyCode: row.currencyCode ?? null,
      bid: row.bid ?? null,
      offer: row.offer ?? null,
      proposedPrimary: false,
      reason: reasons.join("; ") || "Gold search hit"
    };
  });

  mapped.sort((a, b) => scoreOf(b) - scoreOf(a));
  if (mapped.length === 1) {
    mapped[0]!.proposedPrimary = true;
    return mapped;
  }
  if (mapped.length > 1) {
    const top = scoreOf(mapped[0]!);
    const second = scoreOf(mapped[1]!);
    // Only mark primary when clearly dominant
    if (top >= second + 20) {
      mapped[0]!.proposedPrimary = true;
    }
  }
  return mapped;
}

function scoreOf(c: IgGoldMarketCandidate): number {
  let s = 0;
  if (/Spot Gold/i.test(c.reason)) s += 50;
  if (/XAUUSD/i.test(c.reason)) s += 40;
  if (/Gold instrument/i.test(c.reason)) s += 10;
  if (/Gold-like EPIC/i.test(c.reason)) s += 15;
  if (/No dated expiry/i.test(c.reason)) s += 8;
  if (/deprioritised/i.test(c.reason)) s -= 25;
  return s;
}

function mapStatus(status: string | null | undefined): IgGoldMarketCandidate["marketStatus"] {
  const s = String(status ?? "UNKNOWN").toUpperCase();
  if (s === "OPEN" || s === "TRADEABLE") return s as "OPEN" | "TRADEABLE";
  if (s === "CLOSED") return "CLOSED";
  return "UNKNOWN";
}
