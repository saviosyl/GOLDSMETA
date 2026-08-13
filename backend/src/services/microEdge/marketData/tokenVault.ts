/**
 * MicroCTraderTokenVault — server-side only encrypted token storage.
 * Never returned to web. Never logged. Never shared with Core.
 * Paths: microEdge/shadow-v1/private/oauth/tokens/{uid}
 */
import { getFirestore } from "firebase-admin/firestore";
import { MICRO_NAMESPACE } from "../config";
import type { MicroCTraderEnvironment } from "./microCTraderAuth";
import type { MicroStoredAccountMeta } from "./accountSelection";
import {
  microTokenCrypto,
  type MicroEncryptedBlob,
  MicroTokenCrypto
} from "./tokenCrypto";
import {
  assertMicroStorageModeAllowed,
  isDeployedMicroRuntime,
  resolveMicroStorageMode,
  type MicroStorageMode
} from "./storageMode";

export type MicroOAuthStatus =
  | "DISCONNECTED"
  | "CONNECTED"
  | "TOKEN_REFRESH_REQUIRED"
  | "TOKEN_REFRESH_FAILED"
  | "TOKEN_REFRESH_PERSIST_FAILED"
  | "AWAITING_USER_AUTHORIZATION";

export type MicroTokenRecord = {
  uid: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  expiresIn: number;
  environment: MicroCTraderEnvironment;
  /** Legacy id list — audit only; selection must revalidate via cTrader. */
  authorizedAccountIds: string[];
  /** Safe account metadata cache (not authorization authority). */
  authorizedAccounts: MicroStoredAccountMeta[];
  selectedAccountId: string | null;
  selectedAccountMeta: MicroStoredAccountMeta | null;
  permissionScope: "SCOPE_VIEW";
  brokerVerified: boolean | null;
  scope: "accounts";
  createdAt: string;
  updatedAt: string;
  lastRefreshAt: string | null;
  tokenVersion: number;
  status: MicroOAuthStatus;
};

export type MicroTokenPublicStatus = {
  status: MicroOAuthStatus;
  configured: boolean;
  scope: "accounts";
  permissionScope: "SCOPE_VIEW" | null;
  environment: MicroCTraderEnvironment | null;
  selectedAccountIdMasked: string | null;
  authorizedAccountCount: number;
  expiresAt: string | null;
  lastRefreshAt: string | null;
  tokenVersion: number | null;
  brokerVerified: boolean | null;
};

type StoredTokenDoc = {
  uid: string;
  accessTokenEnc: MicroEncryptedBlob;
  refreshTokenEnc: MicroEncryptedBlob;
  expiresAt: string;
  expiresIn: number;
  environment: MicroCTraderEnvironment;
  authorizedAccountIds: string[];
  authorizedAccounts: MicroStoredAccountMeta[];
  selectedAccountId: string | null;
  selectedAccountMeta: MicroStoredAccountMeta | null;
  permissionScope: "SCOPE_VIEW";
  brokerVerified: boolean | null;
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

function toStored(record: MicroTokenRecord, crypto: MicroTokenCrypto): StoredTokenDoc {
  return {
    uid: record.uid,
    accessTokenEnc: crypto.encrypt(record.accessToken),
    refreshTokenEnc: crypto.encrypt(record.refreshToken),
    expiresAt: record.expiresAt,
    expiresIn: record.expiresIn,
    environment: record.environment,
    authorizedAccountIds: [...record.authorizedAccountIds],
    authorizedAccounts: [...(record.authorizedAccounts ?? [])],
    selectedAccountId: record.selectedAccountId,
    selectedAccountMeta: record.selectedAccountMeta,
    permissionScope: "SCOPE_VIEW",
    brokerVerified: record.brokerVerified ?? null,
    scope: "accounts",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastRefreshAt: record.lastRefreshAt,
    tokenVersion: record.tokenVersion,
    status: record.status
  };
}

function fromStored(doc: StoredTokenDoc, crypto: MicroTokenCrypto): MicroTokenRecord {
  return {
    uid: doc.uid,
    accessToken: crypto.decrypt(doc.accessTokenEnc),
    refreshToken: crypto.decrypt(doc.refreshTokenEnc),
    expiresAt: doc.expiresAt,
    expiresIn: doc.expiresIn,
    environment: doc.environment,
    authorizedAccountIds: [...(doc.authorizedAccountIds ?? [])],
    authorizedAccounts: [...(doc.authorizedAccounts ?? [])],
    selectedAccountId: doc.selectedAccountId ?? null,
    selectedAccountMeta: doc.selectedAccountMeta ?? null,
    permissionScope: "SCOPE_VIEW",
    brokerVerified: doc.brokerVerified ?? null,
    scope: "accounts",
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    lastRefreshAt: doc.lastRefreshAt ?? null,
    tokenVersion: doc.tokenVersion ?? 1,
    status: doc.status
  };
}

export interface MicroCTraderTokenVault {
  readonly storageMode: MicroStorageMode;
  saveTokens(record: MicroTokenRecord): Promise<void>;
  getTokens(uid: string): Promise<MicroTokenRecord | null>;
  getPublicStatus(uid: string): Promise<MicroTokenPublicStatus>;
  clearTokens(uid: string): Promise<void>;
  replaceAfterRefresh(
    uid: string,
    next: { accessToken: string; refreshToken: string; expiresIn: number }
  ): Promise<MicroTokenRecord>;
  markStatus(uid: string, status: MicroOAuthStatus): Promise<void>;
}

export class MemoryMicroCTraderTokenVault implements MicroCTraderTokenVault {
  readonly storageMode = "memory" as const;
  private readonly docs: Map<string, StoredTokenDoc>;

  constructor(
    private readonly crypto: MicroTokenCrypto = microTokenCrypto,
    sharedDocs?: Map<string, StoredTokenDoc>
  ) {
    this.docs = sharedDocs ?? new Map<string, StoredTokenDoc>();
  }

  /** Expose shared map for cross-instance tests. */
  getSharedDocsForTests(): Map<string, StoredTokenDoc> {
    return this.docs;
  }

  async saveTokens(record: MicroTokenRecord): Promise<void> {
    assertPrivateOauthPath(record.uid);
    this.docs.set(record.uid, toStored(record, this.crypto));
  }

  async getTokens(uid: string): Promise<MicroTokenRecord | null> {
    assertPrivateOauthPath(uid);
    const doc = this.docs.get(uid);
    if (!doc) return null;
    return fromStored(doc, this.crypto);
  }

  async getPublicStatus(uid: string): Promise<MicroTokenPublicStatus> {
    const doc = this.docs.get(uid);
    if (!doc) {
      return {
        status: "AWAITING_USER_AUTHORIZATION",
        configured: false,
        scope: "accounts",
        permissionScope: null,
        environment: null,
        selectedAccountIdMasked: null,
        authorizedAccountCount: 0,
        expiresAt: null,
        lastRefreshAt: null,
        tokenVersion: null,
        brokerVerified: null
      };
    }
    return {
      status: doc.status,
      configured: true,
      scope: "accounts",
      permissionScope: "SCOPE_VIEW",
      environment: doc.environment,
      selectedAccountIdMasked: maskAccountId(doc.selectedAccountId),
      authorizedAccountCount: (doc.authorizedAccounts?.length ||
        doc.authorizedAccountIds.length) as number,
      expiresAt: doc.expiresAt,
      lastRefreshAt: doc.lastRefreshAt,
      tokenVersion: doc.tokenVersion,
      brokerVerified: doc.brokerVerified ?? null
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
      await this.markStatus(uid, "TOKEN_REFRESH_PERSIST_FAILED");
      throw Object.assign(new Error("MICRO_TOKEN_PERSIST_FAILED"), {
        code: "TOKEN_REFRESH_PERSIST_FAILED",
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

  serializePublicOnly(uid: string): Record<string, unknown> {
    const doc = this.docs.get(uid);
    if (!doc) return { status: "AWAITING_USER_AUTHORIZATION" };
    return {
      status: doc.status,
      scope: doc.scope,
      permissionScope: doc.permissionScope,
      environment: doc.environment,
      selectedAccountIdMasked: maskAccountId(doc.selectedAccountId),
      authorizedAccountCount: doc.authorizedAccountIds.length,
      expiresAt: doc.expiresAt,
      accessToken: undefined,
      refreshToken: undefined,
      accessTokenEnc: undefined,
      refreshTokenEnc: undefined
    };
  }
}

export class FirestoreMicroCTraderTokenVault implements MicroCTraderTokenVault {
  readonly storageMode = "firestore" as const;

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
    await this.docRef(record.uid).set(toStored(record, this.crypto), {
      merge: false
    });
  }

  async getTokens(uid: string): Promise<MicroTokenRecord | null> {
    const snap = await this.docRef(uid).get();
    if (!snap.exists) return null;
    return fromStored(snap.data() as StoredTokenDoc, this.crypto);
  }

  async getPublicStatus(uid: string): Promise<MicroTokenPublicStatus> {
    const snap = await this.docRef(uid).get();
    if (!snap.exists) {
      return {
        status: "AWAITING_USER_AUTHORIZATION",
        configured: false,
        scope: "accounts",
        permissionScope: null,
        environment: null,
        selectedAccountIdMasked: null,
        authorizedAccountCount: 0,
        expiresAt: null,
        lastRefreshAt: null,
        tokenVersion: null,
        brokerVerified: null
      };
    }
    const doc = snap.data() as StoredTokenDoc;
    return {
      status: doc.status,
      configured: true,
      scope: "accounts",
      permissionScope: "SCOPE_VIEW",
      environment: doc.environment,
      selectedAccountIdMasked: maskAccountId(doc.selectedAccountId),
      authorizedAccountCount: (doc.authorizedAccounts?.length ||
        doc.authorizedAccountIds?.length ||
        0) as number,
      expiresAt: doc.expiresAt,
      lastRefreshAt: doc.lastRefreshAt ?? null,
      tokenVersion: doc.tokenVersion ?? null,
      brokerVerified: doc.brokerVerified ?? null
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
      await this.markStatus(uid, "TOKEN_REFRESH_PERSIST_FAILED");
      throw Object.assign(new Error("MICRO_TOKEN_PERSIST_FAILED"), {
        code: "TOKEN_REFRESH_PERSIST_FAILED",
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

let defaultVault: MicroCTraderTokenVault | null = null;
/** Shared memory docs for process-local memory mode (singleton). */
let sharedMemoryDocs: Map<string, StoredTokenDoc> | null = null;

export function createMicroTokenVault(args?: {
  mode?: MicroStorageMode;
  crypto?: MicroTokenCrypto;
  sharedMemoryDocs?: Map<string, StoredTokenDoc>;
}): MicroCTraderTokenVault {
  const mode = args?.mode ?? resolveMicroStorageMode();
  assertMicroStorageModeAllowed(mode);
  const crypto = args?.crypto ?? microTokenCrypto;
  if (mode === "firestore") {
    if (!crypto.isConfiguredForDeployed() && isDeployedMicroRuntime()) {
      throw Object.assign(new Error("MICRO_ENCRYPTION_KEY_MISSING"), {
        code: "MICRO_ENCRYPTION_KEY_MISSING"
      });
    }
    return new FirestoreMicroCTraderTokenVault(crypto);
  }
  const docs: Map<string, StoredTokenDoc> =
    args?.sharedMemoryDocs ??
    sharedMemoryDocs ??
    new Map<string, StoredTokenDoc>();
  if (!args?.sharedMemoryDocs && !sharedMemoryDocs) sharedMemoryDocs = docs;
  return new MemoryMicroCTraderTokenVault(crypto, docs);
}

export function getMicroTokenVault(): MicroCTraderTokenVault {
  if (!defaultVault) defaultVault = createMicroTokenVault();
  return defaultVault;
}

export function resetMicroTokenVaultForTests(
  shared?: Map<string, StoredTokenDoc>
): MemoryMicroCTraderTokenVault {
  sharedMemoryDocs = shared ?? new Map();
  const vault = new MemoryMicroCTraderTokenVault(microTokenCrypto, sharedMemoryDocs);
  defaultVault = vault;
  return vault;
}

export { maskAccountId };
