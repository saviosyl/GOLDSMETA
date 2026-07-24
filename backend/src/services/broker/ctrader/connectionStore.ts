/**
 * Firestore persistence for cTrader OAuth state and encrypted connection.
 * Tokens never leave the server; responses only expose masked fields.
 */

import { getFirestore } from "firebase-admin/firestore";
import type { OAuthStateRecord } from "./oauth";

export type StoredOAuthState = OAuthStateRecord & {
  ownerUid: string;
  consumedAt?: string | null;
};

export type EncryptedTokenBlob = {
  /** encryptTokenPayload(JSON.stringify({ accessToken, refreshToken })) */
  ciphertext: string;
  accessExpiresAt: string;
  refreshedAt: string | null;
};

export type CTraderConnectionRecord = {
  ownerUid: string;
  environment: "DEMO";
  connectedAt: string;
  updatedAt: string;
  tokens: EncryptedTokenBlob;
  selectedAccountId: string | null;
  selectedAccountMasked: string | null;
  selectedAccountKeyHash: string | null;
  brokerName: string | null;
  brokerConfirmedPepperstone: boolean;
  currency: string | null;
  leverage: number | null;
  symbolId: string | null;
  symbolName: string | null;
  lastSyncAt: string | null;
  lastQuoteAt: string | null;
  lastErrorCode: string | null;
  disconnectedAt: string | null;
};

const STATE_COL = "ctraderOAuthStates";

function connectionDoc(ownerUid: string) {
  return getFirestore().doc(`users/${ownerUid}/ctraderConnection/current`);
}

export async function saveOAuthState(record: StoredOAuthState): Promise<void> {
  await getFirestore()
    .collection(STATE_COL)
    .doc(record.state)
    .set({
      ...record,
      consumedAt: record.consumedAt ?? null
    });
}

export async function getOAuthState(state: string): Promise<StoredOAuthState | null> {
  const snap = await getFirestore().collection(STATE_COL).doc(state).get();
  if (!snap.exists) return null;
  return snap.data() as StoredOAuthState;
}

/** Atomically mark consumed; returns false if missing/already consumed (replay). */
export async function consumeOAuthStateAtomic(
  state: string
): Promise<{ ok: true; record: StoredOAuthState } | { ok: false; code: string }> {
  const ref = getFirestore().collection(STATE_COL).doc(state);
  return getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false as const, code: "OAUTH_STATE_MISSING" };
    const record = snap.data() as StoredOAuthState;
    if (record.consumedAt) return { ok: false as const, code: "OAUTH_STATE_REPLAY" };
    if (Date.parse(record.expiresAt) < Date.now()) {
      return { ok: false as const, code: "OAUTH_STATE_EXPIRED" };
    }
    const consumedAt = new Date().toISOString();
    tx.update(ref, { consumedAt });
    return { ok: true as const, record: { ...record, consumedAt } };
  });
}

export async function saveConnection(
  record: CTraderConnectionRecord
): Promise<void> {
  await connectionDoc(record.ownerUid).set(record, { merge: true });
}

export async function getConnection(
  ownerUid: string
): Promise<CTraderConnectionRecord | null> {
  const snap = await connectionDoc(ownerUid).get();
  if (!snap.exists) return null;
  const data = snap.data() as CTraderConnectionRecord;
  if (data.disconnectedAt) return null;
  return data;
}

export async function disconnectConnection(ownerUid: string): Promise<void> {
  const ref = connectionDoc(ownerUid);
  const snap = await ref.get();
  if (!snap.exists) return;
  await ref.set(
    {
      disconnectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tokens: null,
      selectedAccountId: null,
      lastErrorCode: null
    },
    { merge: true }
  );
}

export function loadTokenEncryptionSecret(
  source: NodeJS.ProcessEnv = process.env
): string | null {
  const s = (
    source.CTRADER_TOKEN_ENCRYPTION_KEY ??
    source.CTRADER_TOKEN_ENCRYPTION_SECRET ??
    ""
  ).trim();
  return s.length >= 16 ? s : null;
}
