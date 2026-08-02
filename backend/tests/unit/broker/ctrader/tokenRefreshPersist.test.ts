/**
 * Guards against rotate-without-persist and stale concurrent refresh writes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type DocData = Record<string, unknown>;

const store = vi.hoisted(() => {
  const connections = new Map<string, DocData>();
  return {
    connections,
    reset() {
      connections.clear();
    }
  };
});

vi.mock("firebase-admin/firestore", () => {
  function connectionDoc(path: string) {
    return {
      path,
      async set(data: DocData, opts?: { merge?: boolean }) {
        const prev = store.connections.get(path) ?? {};
        store.connections.set(path, opts?.merge ? { ...prev, ...data } : { ...data });
      },
      async get() {
        const data = store.connections.get(path);
        return { exists: Boolean(data), data: () => data };
      }
    };
  }

  return {
    getFirestore: () => ({
      collection() {
        throw new Error("unexpected collection");
      },
      doc(path: string) {
        return connectionDoc(path);
      },
      async runTransaction<T>(
        fn: (tx: {
          get: (ref: { get: () => Promise<{ exists: boolean; data: () => unknown }> }) => Promise<{
            exists: boolean;
            data: () => unknown;
          }>;
          set: (
            ref: { set: (data: DocData, opts?: { merge?: boolean }) => Promise<void> },
            data: DocData,
            opts?: { merge?: boolean }
          ) => void;
        }) => Promise<T>
      ) {
        return fn({
          get: async (ref) => ref.get(),
          set: (ref, data, opts) => {
            void ref.set(data, opts);
          }
        });
      }
    })
  };
});

import {
  persistRotatedTokensAtomic,
  type CTraderConnectionRecord
} from "../../../../src/services/broker/ctrader/connectionStore";
import { encryptTokenPayload } from "../../../../src/services/broker/ctrader/tokenCrypto";

const SECRET = "unit-test-token-encryption-secret-key";
const OWNER = "owner-uid-refresh-persist-test";
const PATH = `users/${OWNER}/ctraderConnection/current`;

function seedConnection(ciphertext: string, tokenVersion = 1): CTraderConnectionRecord {
  const record: CTraderConnectionRecord = {
    ownerUid: OWNER,
    environment: "DEMO",
    connectedAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    tokens: {
      ciphertext,
      accessExpiresAt: "2026-08-01T00:05:00.000Z",
      refreshedAt: null,
      tokenVersion
    },
    selectedAccountId: "48123410",
    selectedAccountMasked: "48…10",
    selectedAccountKeyHash: "hash",
    selectedAccountIsLive: false,
    brokerName: "Pepperstone - Europe",
    brokerConfirmedPepperstone: true,
    currency: "EUR",
    leverage: 30,
    balance: 50000,
    symbolId: "41",
    symbolName: "XAUUSD",
    lastSyncAt: "2026-08-01T00:00:00.000Z",
    lastQuoteAt: null,
    lastErrorCode: null,
    disconnectedAt: null,
    liveSelectionConfirmedAt: null
  };
  store.connections.set(PATH, { ...record });
  return record;
}

describe("persistRotatedTokensAtomic", () => {
  beforeEach(() => {
    store.reset();
    process.env.CTRADER_TOKEN_ENCRYPTION_KEY = SECRET;
  });

  it("persists a full replacement and increments tokenVersion", async () => {
    const oldCipher = encryptTokenPayload(
      JSON.stringify({ accessToken: "access-old-xxxxxxxxx", refreshToken: "refresh-old-xxxxxxxx" }),
      SECRET
    );
    seedConnection(oldCipher, 1);
    const newCipher = encryptTokenPayload(
      JSON.stringify({ accessToken: "access-new-xxxxxxxxx", refreshToken: "refresh-new-xxxxxxxx" }),
      SECRET
    );

    const result = await persistRotatedTokensAtomic({
      ownerUid: OWNER,
      expectedCiphertext: oldCipher,
      expectedTokenVersion: 1,
      newTokens: {
        ciphertext: newCipher,
        accessExpiresAt: "2026-08-02T00:00:00.000Z",
        refreshedAt: "2026-08-01T12:00:00.000Z"
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.tokens.ciphertext).toBe(newCipher);
    expect(result.record.tokens.tokenVersion).toBe(2);
    expect(result.record.tokens.refreshedAt).toBe("2026-08-01T12:00:00.000Z");
    expect(store.connections.get(PATH)?.tokens).toMatchObject({
      ciphertext: newCipher,
      tokenVersion: 2
    });
  });

  it("rejects stale writes when ciphertext/version no longer match", async () => {
    const v1 = encryptTokenPayload(
      JSON.stringify({ accessToken: "access-v1-xxxxxxxxxx", refreshToken: "refresh-v1-xxxxxxxxx" }),
      SECRET
    );
    const v2 = encryptTokenPayload(
      JSON.stringify({ accessToken: "access-v2-xxxxxxxxxx", refreshToken: "refresh-v2-xxxxxxxxx" }),
      SECRET
    );
    seedConnection(v2, 2); // winner already persisted
    const stale = encryptTokenPayload(
      JSON.stringify({ accessToken: "access-stale-xxxxxxx", refreshToken: "refresh-stale-xxxxxx" }),
      SECRET
    );

    const result = await persistRotatedTokensAtomic({
      ownerUid: OWNER,
      expectedCiphertext: v1,
      expectedTokenVersion: 1,
      newTokens: {
        ciphertext: stale,
        accessExpiresAt: "2026-08-02T00:00:00.000Z",
        refreshedAt: "2026-08-01T13:00:00.000Z"
      }
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CTRADER_TOKEN_VERSION_CONFLICT");
    expect(store.connections.get(PATH)?.tokens).toMatchObject({
      ciphertext: v2,
      tokenVersion: 2
    });
  });

  it("never overwrites with a partial token blob", async () => {
    const oldCipher = encryptTokenPayload(
      JSON.stringify({ accessToken: "access-old-xxxxxxxxx", refreshToken: "refresh-old-xxxxxxxx" }),
      SECRET
    );
    seedConnection(oldCipher, 1);

    await expect(
      persistRotatedTokensAtomic({
        ownerUid: OWNER,
        expectedCiphertext: oldCipher,
        expectedTokenVersion: 1,
        newTokens: {
          ciphertext: "",
          accessExpiresAt: "2026-08-02T00:00:00.000Z",
          refreshedAt: "2026-08-01T12:00:00.000Z"
        }
      })
    ).rejects.toMatchObject({ code: "CTRADER_TOKEN_PERSIST_PARTIAL" });

    expect(store.connections.get(PATH)?.tokens).toMatchObject({
      ciphertext: oldCipher,
      tokenVersion: 1
    });
  });
});
