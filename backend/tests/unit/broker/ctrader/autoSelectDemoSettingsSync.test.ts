/**
 * When the sole Pepperstone Demo is auto-selected, selectedAccountId must be
 * persisted into users/{uid}/autotradeSettings/demo (same as explicit select).
 *
 * Tests the persistence contract used by GET /v1/ctrader/accounts.
 */
import { describe, expect, it, vi } from "vitest";
import { saveUserAutoTradeSettings } from "../../../../src/services/broker/ctrader/userAutoTradeSettings";

const memory = new Map<string, Record<string, unknown>>();

vi.mock("firebase-admin/firestore", () => {
  const doc = (path: string) => ({
    async get() {
      const data = memory.get(path);
      return { exists: Boolean(data), data: () => data };
    },
    async set(data: Record<string, unknown>, opts?: { merge?: boolean }) {
      const prev = memory.get(path) ?? {};
      memory.set(path, opts?.merge ? { ...prev, ...data } : data);
    }
  });
  return {
    getFirestore: () => ({
      doc,
      collection: (path: string) => ({
        doc: (id: string) => doc(`${path}/${id}`)
      })
    }),
    FieldValue: { serverTimestamp: () => "server" }
  };
});

describe("auto-select Demo settings sync contract", () => {
  it("persists selectedAccountId into autotradeSettings/demo", async () => {
    const uid = "owner-auto-select";
    const accountId = "48014710";
    // Same call the accounts auto-select path now makes.
    await saveUserAutoTradeSettings(uid, "demo", {
      selectedAccountId: accountId
    });
    const path = `users/${uid}/autotradeSettings/demo`;
    const saved = memory.get(path);
    expect(saved?.selectedAccountId).toBe(accountId);
  });

  it("matches explicit select persistence semantics", async () => {
    const uid = "owner-explicit";
    await saveUserAutoTradeSettings(uid, "demo", {
      selectedAccountId: "48014710"
    });
    await saveUserAutoTradeSettings(uid, "demo", {
      selectedAccountId: "48014710",
      autoTradeEnabledIntent: true
    });
    const saved = memory.get(`users/${uid}/autotradeSettings/demo`);
    expect(saved?.selectedAccountId).toBe("48014710");
    expect(saved?.autoTradeEnabledIntent).toBe(true);
  });
});

// Ensure route source contains the sync (regression guard against silent removal).
describe("accounts route source includes Demo settings sync", () => {
  it("GET accounts auto-select writes saveUserAutoTradeSettings demo", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../../../../src/routes/ctrader.ts", import.meta.url),
      "utf8"
    );
    expect(src).toMatch(/pepperstoneDemos\.length === 1/);
    expect(src).toMatch(/saveUserAutoTradeSettings\(uid, "demo"/);
    expect(src).toMatch(/selectedAccountId: only\.ctidTraderAccountId/);
  });
});
