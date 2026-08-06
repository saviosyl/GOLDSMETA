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
  /**
   * Monotonic token-record version for compare-and-set refresh writes.
   * Rejects stale refresh persistence after a concurrent rotation.
   */
  tokenVersion?: number;
};

export type CTraderAccountEnvironment = "DEMO" | "LIVE";

export type CTraderConnectionRecord = {
  ownerUid: string;
  /** Resolved from the selected authorised broker account — not a global app constant. */
  environment: CTraderAccountEnvironment;
  connectedAt: string;
  updatedAt: string;
  tokens: EncryptedTokenBlob;
  selectedAccountId: string | null;
  selectedAccountMasked: string | null;
  selectedAccountKeyHash: string | null;
  selectedAccountIsLive: boolean;
  brokerName: string | null;
  brokerConfirmedPepperstone: boolean;
  currency: string | null;
  leverage: number | null;
  balance: number | null;
  symbolId: string | null;
  symbolName: string | null;
  /** Official cTrader catalogue digits for the verified XAUUSD symbol. */
  symbolDigits: number | null;
  /** Official cTrader catalogue pip position for the verified XAUUSD symbol. */
  symbolPipPosition: number | null;
  lastSyncAt: string | null;
  lastQuoteAt: string | null;
  lastErrorCode: string | null;
  disconnectedAt: string | null;
  /** Live selection requires explicit user confirmation (not Demo inheritance). */
  liveSelectionConfirmedAt: string | null;
  /** Last OAuth consent scope (accounts | trading). */
  oauthScope?: "accounts" | "trading" | null;
  /** ISO time when trading scope was granted. */
  tradingScopeGrantedAt?: string | null;
  /** Opaque scope/version marker for audits (not a secret). */
  oauthScopeVersion?: string | null;
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

export type PersistRotatedTokensResult =
  | { ok: true; record: CTraderConnectionRecord }
  | {
      ok: false;
      code: "CTRADER_NOT_CONNECTED" | "CTRADER_TOKEN_VERSION_CONFLICT";
      record?: CTraderConnectionRecord;
    };

/**
 * Atomically replace encrypted tokens only when the caller's expected
 * ciphertext/version still matches the stored record.
 *
 * Guarantees:
 * - previous encrypted token remains until the new record is committed
 * - concurrent refresh losers get VERSION_CONFLICT (no partial overwrite)
 * - never writes a tokens blob missing ciphertext / accessExpiresAt
 */
export async function persistRotatedTokensAtomic(args: {
  ownerUid: string;
  expectedCiphertext: string;
  expectedTokenVersion: number;
  newTokens: EncryptedTokenBlob;
}): Promise<PersistRotatedTokensResult> {
  if (
    !args.newTokens?.ciphertext ||
    !args.newTokens.accessExpiresAt ||
    typeof args.newTokens.ciphertext !== "string" ||
    !args.newTokens.ciphertext.startsWith("v1:")
  ) {
    throw Object.assign(new Error("CTRADER_TOKEN_PERSIST_PARTIAL"), {
      code: "CTRADER_TOKEN_PERSIST_PARTIAL"
    });
  }

  const ref = connectionDoc(args.ownerUid);
  return getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      return { ok: false as const, code: "CTRADER_NOT_CONNECTED" as const };
    }
    const data = snap.data() as CTraderConnectionRecord;
    if (data.disconnectedAt || !data.tokens?.ciphertext) {
      return { ok: false as const, code: "CTRADER_NOT_CONNECTED" as const };
    }

    const storedVersion = data.tokens.tokenVersion ?? 0;
    if (
      data.tokens.ciphertext !== args.expectedCiphertext ||
      storedVersion !== args.expectedTokenVersion
    ) {
      return {
        ok: false as const,
        code: "CTRADER_TOKEN_VERSION_CONFLICT" as const,
        record: data
      };
    }

    const now = new Date().toISOString();
    const nextVersion = storedVersion + 1;
    const updated: CTraderConnectionRecord = {
      ...data,
      updatedAt: now,
      lastSyncAt: now,
      lastErrorCode: null,
      disconnectedAt: null,
      tokens: {
        ciphertext: args.newTokens.ciphertext,
        accessExpiresAt: args.newTokens.accessExpiresAt,
        refreshedAt: args.newTokens.refreshedAt ?? now,
        tokenVersion: nextVersion
      }
    };
    tx.set(ref, updated, { merge: true });
    return { ok: true as const, record: updated };
  });
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
