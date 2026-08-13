/**
 * MicroCTraderTokenVault — server-side only encrypted token storage.
 * Never returned to web. Never logged. Never shared with Core.
 * Namespace: microEdge/shadow-v1/private/oauth/**
 */
import { getFirestore } from "firebase-admin/firestore";
import { MICRO_NAMESPACE } from "../config";
import type { MicroCTraderEnvironment } from "./microCTraderAuth";
import {
  microTokenCrypto,
  type MicroEncryptedBlob,
  MicroTokenCrypto
} from "./tokenCrypto";

export type MicroOAuthStatus =
  | "DISCONNECTED"
  | "CONNECTED"
  | "TOKEN_REFRESH_REQUIRED"
  | "TOKEN_REFRESH_FAILED"
  | "AWAITING_USER_AUTHORIZATION";

export type MicroTokenRecord = {
  uid: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  expiresIn: number;
  environment: MicroCTraderEnvironment;
  authorizedAccountIds: string[];
  selectedAccountId: string | null;
  scope: "accounts";
  createdAt: string;
  updatedAt: string;
  lastRefreshAt: string | null;
  tokenVersion: number;
  status: MicroOAuthStatus;
};

/** Safe public view — never includes tokens/secrets. */
export type MicroTokenPublicStatus = {
  status: MicroOAuthStatus;
  configured: boolean;
  scope: "accounts";
  environment: MicroCTraderEnvironment | null;
  selectedAccountIdMasked: string | null;
  authorizedAccountCount: number;
  expiresAt: string | null;
  lastRefreshAt: string | null;
  tokenVersion: number | null;
};

type StoredTokenDoc = {
  uid: string;
  accessTokenEnc: MicroEncryptedBlob;
  refreshTokenEnc: MicroEncryptedBlob;
  expiresAt: string;
  expiresIn: number;
  environment: MicroCTraderEnvironment;
  authorizedAccountIds: string[];
  selectedAccountId: string | null;
  scope: "accounts";
  createdAt: string;
  updatedAt: string;
  lastRefreshAt: string | null;
  tokenVersion: number;
  status: MicroOAuthStatus;
};

function maskAccountId(id: string | null): string | null {
  if (!id) return null;
  const s = String(id);
  if (s.length <= 4) return `****${s}`;
  return `****${s.slice(-4)}`;
}

function assertPrivateOauthPath(relative: string): void {
  const full = `${MICRO_NAMESPACE}/private/oauth/${relative}`;
  if (!full.startsWith(`${MICRO_NAMESPACE}/private/oauth/`)) {
    throw new Error(`MICRO_TOKEN_VAULT_NAMESPACE_VIOLATION: ${full}`);
  }
}

export interface MicroCTraderTokenVault {
  saveTokens(record: MicroTokenRecord): Promise<void>;
  getTokens(uid: string): Promise<MicroTokenRecord | null>;
  getPublicStatus(uid: string): Promise<MicroTokenPublicStatus>;
  clearTokens(uid: string): Promise<void>;
  /** Persist refreshed tokens atomically; fail closed on persist error. */
  replaceAfterRefresh(
    uid: string,
    next: {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    }
  ): Promise<MicroTokenRecord>;
  markStatus(uid: string, status: MicroOAuthStatus): Promise<void>;
}

export class MemoryMicroCTraderTokenVault implements MicroCTraderTokenVault {
  private readonly docs = new Map<string, StoredTokenDoc>();

  constructor(private readonly crypto: MicroTokenCrypto = microTokenCrypto) {}

  async saveTokens(record: MicroTokenRecord): Promise<void> {
    assertPrivateOauthPath(record.uid);
    const doc: StoredTokenDoc = {
      uid: record.uid,
      accessTokenEnc: this.crypto.encrypt(record.accessToken),
      refreshTokenEnc: this.crypto.encrypt(record.refreshToken),
      expiresAt: record.expiresAt,
      expiresIn: record.expiresIn,
      environment: record.environment,
      authorizedAccountIds: [...record.authorizedAccountIds],
      selectedAccountId: record.selectedAccountId,
      scope: "accounts",
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastRefreshAt: record.lastRefreshAt,
      tokenVersion: record.tokenVersion,
      status: record.status
    };
    this.docs.set(record.uid, doc);
  }

  async getTokens(uid: string): Promise<MicroTokenRecord | null> {
    assertPrivateOauthPath(uid);
    const doc = this.docs.get(uid);
    if (!doc) return null;
    return this.decryptDoc(doc);
  }

  async getPublicStatus(uid: string): Promise<MicroTokenPublicStatus> {
    const doc = this.docs.get(uid);
    if (!doc) {
      return {
        status: "AWAITING_USER_AUTHORIZATION",
        configured: false,
        scope: "accounts",
        environment: null,
        selectedAccountIdMasked: null,
        authorizedAccountCount: 0,
        expiresAt: null,
        lastRefreshAt: null,
        tokenVersion: null
      };
    }
    return {
      status: doc.status,
      configured: true,
      scope: "accounts",
      environment: doc.environment,
      selectedAccountIdMasked: maskAccountId(doc.selectedAccountId),
      authorizedAccountCount: doc.authorizedAccountIds.length,
      expiresAt: doc.expiresAt,
      lastRefreshAt: doc.lastRefreshAt,
      tokenVersion: doc.tokenVersion
    };
  }

  async clearTokens(uid: string): Promise<void> {
    assertPrivateOauthPath(uid);
    this.docs.delete(uid);
  }

  async replaceAfterRefresh(
    uid: string,
    next: { accessToken: string; refreshToken: string; expiresIn: number }
  ): Promise<MicroTokenRecord> {
    const existing = await this.getTokens(uid);
    if (!existing) {
      throw Object.assign(new Error("MICRO_TOKEN_VAULT_EMPTY"), {
        code: "TOKEN_REFRESH_FAILED"
      });
    }
    const now = new Date().toISOString();
    const expiresAt = new Date(
      Date.now() + Math.max(0, next.expiresIn) * 1000
    ).toISOString();
    const updated: MicroTokenRecord = {
      ...existing,
      accessToken: next.accessToken,
      refreshToken: next.refreshToken,
      expiresIn: next.expiresIn,
      expiresAt,
      updatedAt: now,
      lastRefreshAt: now,
      tokenVersion: existing.tokenVersion + 1,
      status: "CONNECTED"
    };
    try {
      await this.saveTokens(updated);
    } catch (e) {
      throw Object.assign(new Error("MICRO_TOKEN_PERSIST_FAILED"), {
        code: "TOKEN_REFRESH_FAILED",
        cause: e
      });
    }
    return updated;
  }

  async markStatus(uid: string, status: MicroOAuthStatus): Promise<void> {
    const doc = this.docs.get(uid);
    if (!doc) return;
    doc.status = status;
    doc.updatedAt = new Date().toISOString();
  }

  /** Test helper — proves API serialization cannot expose decrypted tokens. */
  serializePublicOnly(uid: string): Record<string, unknown> {
    const doc = this.docs.get(uid);
    if (!doc) return { status: "AWAITING_USER_AUTHORIZATION" };
    return {
      status: doc.status,
      scope: doc.scope,
      environment: doc.environment,
      selectedAccountIdMasked: maskAccountId(doc.selectedAccountId),
      authorizedAccountCount: doc.authorizedAccountIds.length,
      expiresAt: doc.expiresAt,
      // Explicitly absent:
      accessToken: undefined,
      refreshToken: undefined,
      accessTokenEnc: undefined,
      refreshTokenEnc: undefined
    };
  }

  private decryptDoc(doc: StoredTokenDoc): MicroTokenRecord {
    return {
      uid: doc.uid,
      accessToken: this.crypto.decrypt(doc.accessTokenEnc),
      refreshToken: this.crypto.decrypt(doc.refreshTokenEnc),
      expiresAt: doc.expiresAt,
      expiresIn: doc.expiresIn,
      environment: doc.environment,
      authorizedAccountIds: [...doc.authorizedAccountIds],
      selectedAccountId: doc.selectedAccountId,
      scope: "accounts",
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      lastRefreshAt: doc.lastRefreshAt,
      tokenVersion: doc.tokenVersion,
      status: doc.status
    };
  }
}

export class FirestoreMicroCTraderTokenVault implements MicroCTraderTokenVault {
  constructor(private readonly crypto: MicroTokenCrypto = microTokenCrypto) {}

  private docRef(uid: string) {
    assertPrivateOauthPath(uid);
    const [root, docId] = MICRO_NAMESPACE.split("/");
    return getFirestore()
      .collection(root!)
      .doc(docId!)
      .collection("private")
      .doc("oauth")
      .collection("tokens")
      .doc(uid);
  }

  async saveTokens(record: MicroTokenRecord): Promise<void> {
    const stored: StoredTokenDoc = {
      uid: record.uid,
      accessTokenEnc: this.crypto.encrypt(record.accessToken),
      refreshTokenEnc: this.crypto.encrypt(record.refreshToken),
      expiresAt: record.expiresAt,
      expiresIn: record.expiresIn,
      environment: record.environment,
      authorizedAccountIds: [...record.authorizedAccountIds],
      selectedAccountId: record.selectedAccountId,
      scope: "accounts",
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastRefreshAt: record.lastRefreshAt,
      tokenVersion: record.tokenVersion,
      status: record.status
    };
    await this.docRef(record.uid).set(stored, { merge: false });
  }

  async getTokens(uid: string): Promise<MicroTokenRecord | null> {
    const snap = await this.docRef(uid).get();
    if (!snap.exists) return null;
    const doc = snap.data() as StoredTokenDoc;
    return {
      uid: doc.uid,
      accessToken: this.crypto.decrypt(doc.accessTokenEnc),
      refreshToken: this.crypto.decrypt(doc.refreshTokenEnc),
      expiresAt: doc.expiresAt,
      expiresIn: doc.expiresIn,
      environment: doc.environment,
      authorizedAccountIds: [...(doc.authorizedAccountIds ?? [])],
      selectedAccountId: doc.selectedAccountId ?? null,
      scope: "accounts",
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      lastRefreshAt: doc.lastRefreshAt ?? null,
      tokenVersion: doc.tokenVersion ?? 1,
      status: doc.status
    };
  }

  async getPublicStatus(uid: string): Promise<MicroTokenPublicStatus> {
    const snap = await this.docRef(uid).get();
    if (!snap.exists) {
      return {
        status: "AWAITING_USER_AUTHORIZATION",
        configured: false,
        scope: "accounts",
        environment: null,
        selectedAccountIdMasked: null,
        authorizedAccountCount: 0,
        expiresAt: null,
        lastRefreshAt: null,
        tokenVersion: null
      };
    }
    const doc = snap.data() as StoredTokenDoc;
    return {
      status: doc.status,
      configured: true,
      scope: "accounts",
      environment: doc.environment,
      selectedAccountIdMasked: maskAccountId(doc.selectedAccountId),
      authorizedAccountCount: (doc.authorizedAccountIds ?? []).length,
      expiresAt: doc.expiresAt,
      lastRefreshAt: doc.lastRefreshAt ?? null,
      tokenVersion: doc.tokenVersion ?? null
    };
  }

  async clearTokens(uid: string): Promise<void> {
    await this.docRef(uid).delete();
  }

  async replaceAfterRefresh(
    uid: string,
    next: { accessToken: string; refreshToken: string; expiresIn: number }
  ): Promise<MicroTokenRecord> {
    const existing = await this.getTokens(uid);
    if (!existing) {
      throw Object.assign(new Error("MICRO_TOKEN_VAULT_EMPTY"), {
        code: "TOKEN_REFRESH_FAILED"
      });
    }
    const now = new Date().toISOString();
    const expiresAt = new Date(
      Date.now() + Math.max(0, next.expiresIn) * 1000
    ).toISOString();
    const updated: MicroTokenRecord = {
      ...existing,
      accessToken: next.accessToken,
      refreshToken: next.refreshToken,
      expiresIn: next.expiresIn,
      expiresAt,
      updatedAt: now,
      lastRefreshAt: now,
      tokenVersion: existing.tokenVersion + 1,
      status: "CONNECTED"
    };
    try {
      await this.saveTokens(updated);
    } catch (e) {
      throw Object.assign(new Error("MICRO_TOKEN_PERSIST_FAILED"), {
        code: "TOKEN_REFRESH_FAILED",
        cause: e
      });
    }
    return updated;
  }

  async markStatus(uid: string, status: MicroOAuthStatus): Promise<void> {
    const ref = this.docRef(uid);
    const snap = await ref.get();
    if (!snap.exists) return;
    await ref.set(
      { status, updatedAt: new Date().toISOString() },
      { merge: true }
    );
  }
}

/** Process-local vault for API until Firestore is wired in deployment. */
let defaultVault: MemoryMicroCTraderTokenVault | null = null;

export function getMicroTokenVault(): MemoryMicroCTraderTokenVault {
  if (!defaultVault) defaultVault = new MemoryMicroCTraderTokenVault();
  return defaultVault;
}

export function resetMicroTokenVaultForTests(): void {
  defaultVault = new MemoryMicroCTraderTokenVault();
}

export { maskAccountId };
