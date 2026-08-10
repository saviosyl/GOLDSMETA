/**
 * Persistent authoritative XAUUSD quote store.
 * Backend workers keep writing here while the browser is closed.
 * Never stores tokens or account secrets — only verified market fields.
 */

import { getFirestore } from "firebase-admin/firestore";
import type { AuthoritativeQuote } from "./liveQuote";

const QUOTE_DOC = "ctraderLiveQuote";

function quoteDoc(ownerUid: string) {
  return getFirestore().doc(`users/${ownerUid}/${QUOTE_DOC}/current`);
}

export type StoredAuthoritativeQuote = AuthoritativeQuote & {
  ownerUid: string;
  updatedAt: string;
};

export async function saveAuthoritativeQuote(
  ownerUid: string,
  quote: AuthoritativeQuote
): Promise<StoredAuthoritativeQuote> {
  const updatedAt = new Date().toISOString();
  const record: StoredAuthoritativeQuote = {
    ...quote,
    ownerUid,
    updatedAt
  };
  await quoteDoc(ownerUid).set(record, { merge: true });
  // Also bump connection lastQuoteAt for existing diagnostics.
  await getFirestore()
    .doc(`users/${ownerUid}/ctraderConnection/current`)
    .set(
      {
        lastQuoteAt: quote.brokerTimestamp,
        lastSyncAt: updatedAt,
        updatedAt
      },
      { merge: true }
    );
  return record;
}

export async function getStoredAuthoritativeQuote(
  ownerUid: string
): Promise<StoredAuthoritativeQuote | null> {
  const snap = await quoteDoc(ownerUid).get();
  if (!snap.exists) return null;
  const data = snap.data() as StoredAuthoritativeQuote;
  if (
    data?.bid == null ||
    data?.ask == null ||
    !data.brokerTimestamp ||
    !data.symbolId
  ) {
    return null;
  }
  return data;
}

/** Allocate a monotonic quote sequence per owner. */
export async function nextQuoteSequence(ownerUid: string): Promise<number> {
  const ref = getFirestore().doc(`users/${ownerUid}/${QUOTE_DOC}/meta`);
  return getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = Number(snap.exists ? (snap.data()?.sequence ?? 0) : 0);
    const next = (Number.isFinite(prev) ? prev : 0) + 1;
    tx.set(ref, { sequence: next, updatedAt: new Date().toISOString() }, { merge: true });
    return next;
  });
}

/**
 * List owner UIDs with an active cTrader connection (account + symbol selected).
 * Used by the background quote keepalive scheduler.
 */
export async function listOwnersNeedingQuoteRefresh(
  limit = 50
): Promise<string[]> {
  try {
    // Ungated collection-group scan + in-memory filter.
    // Avoids requiring a COLLECTION_GROUP inequality index on selectedAccountId
    // (missing index previously caused keepalive to silently refresh 0 owners).
    const snap = await getFirestore()
      .collectionGroup("ctraderConnection")
      .limit(Math.max(limit * 4, 50))
      .get();

    const owners: string[] = [];
    for (const doc of snap.docs) {
      const data = doc.data() as {
        ownerUid?: string;
        selectedAccountId?: string | null;
        symbolId?: string | null;
        disconnectedAt?: string | null;
      };
      if (data.disconnectedAt) continue;
      if (!data.selectedAccountId || !data.symbolId) continue;
      const uid =
        data.ownerUid ??
        (doc.ref.path.match(/^users\/([^/]+)\/ctraderConnection\//)?.[1] ?? null);
      if (uid) owners.push(uid);
      if (owners.length >= limit) break;
    }
    return [...new Set(owners)].slice(0, limit);
  } catch {
    // Keepalive is best-effort.
    return [];
  }
}
