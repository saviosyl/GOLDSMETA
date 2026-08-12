/**
 * Firestore Emulator tests for Demo qualification ownership safety.
 * Requires FIRESTORE_EMULATOR_HOST (set by firebase emulators:exec).
 * Never contacts brokers / never places orders.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, deleteApp, getApps, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  findForeignStartedQualifications,
  normalizeAccountId,
  saveQualificationDoc,
  createEmptyQualificationDoc,
  appendTransition,
  getQualificationDoc
} from "../../src/services/broker/ctrader/qualificationStore";
import {
  claimDemoQualificationOwnership,
  getQualificationOwnershipClaim,
  qualificationOwnerDocId
} from "../../src/services/broker/ctrader/qualificationOwnership";

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8081";
const PROJECT = "goldmeta-qual-ownership-test";

async function emulatorReachable(): Promise<boolean> {
  try {
    const [host, port] = EMULATOR.split(":");
    const net = await import("net");
    return await new Promise((resolve) => {
      const socket = net.connect({ host, port: Number(port) }, () => {
        socket.end();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
      socket.setTimeout(1000, () => {
        socket.destroy();
        resolve(false);
      });
    });
  } catch {
    return false;
  }
}

async function seedStartedQual(args: {
  uid: string;
  accountId: string;
  accountMasked?: string;
  state?: string;
}) {
  let doc = createEmptyQualificationDoc({
    uid: args.uid,
    accountId: args.accountId,
    accountMasked: args.accountMasked ?? "48…10",
    buildSha: "emu"
  });
  doc.startedAt = "2026-08-08T21:02:29.619Z";
  doc = await appendTransition(
    doc,
    (args.state as "LIVE_QUALIFICATION") || "LIVE_QUALIFICATION",
    "emu_seed",
    "emu"
  );
  await saveQualificationDoc(doc);
  return doc;
}

describe("Firestore emulator — qualification ownership", () => {
  let app: App | null = null;
  let ready = false;

  beforeAll(async () => {
    ready = await emulatorReachable();
    if (!ready) return;
    process.env.FIRESTORE_EMULATOR_HOST = EMULATOR;
    process.env.GCLOUD_PROJECT = PROJECT;
    process.env.GOOGLE_CLOUD_PROJECT = PROJECT;
    for (const existing of getApps()) {
      await deleteApp(existing);
    }
    app = initializeApp({ projectId: PROJECT });
  });

  afterAll(async () => {
    if (app) await deleteApp(app);
  });

  beforeEach(async () => {
    if (!ready) return;
    const db = getFirestore();
    const owners = await db.collection("autotradeQualificationOwners").listDocuments();
    await Promise.all(owners.map((d) => d.delete()));
    // Wipe prior qualification docs so exact-match tests stay isolated.
    const quals = await db.collectionGroup("autotradeQualification").get();
    const batchSize = 400;
    for (let i = 0; i < quals.docs.length; i += batchSize) {
      const batch = db.batch();
      for (const doc of quals.docs.slice(i, i + batchSize)) {
        batch.delete(doc.ref);
      }
      await batch.commit();
    }
  });

  it("1/2: >80 unrelated quals cannot hide matching foreign account (exact where)", async () => {
    if (!ready) throw new Error(`Firestore emulator not reachable at ${EMULATOR}`);
    const targetAccount = "48014710";
    const seeker = "seeker-uid";
    const foreignOwner = "foreign-owner-uid";

    // Seed 85 unrelated started quals with distinct account ids
    for (let i = 0; i < 85; i++) {
      await seedStartedQual({
        uid: `noise-uid-${i}`,
        accountId: `9000${String(i).padStart(4, "0")}`,
        accountMasked: "90…00"
      });
    }
    // Matching foreign qual AFTER the noise docs
    await seedStartedQual({
      uid: foreignOwner,
      accountId: targetAccount,
      accountMasked: "48…10",
      state: "LIVE_QUALIFICATION"
    });

    const result = await findForeignStartedQualifications(seeker, targetAccount);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hits.length).toBeGreaterThanOrEqual(1);
    expect(result.hits.some((h) => h.uid === foreignOwner)).toBe(true);
    expect(result.hits.every((h) => h.accountId === targetAccount)).toBe(true);
  });

  it("2: foreign lookup exact account match (string normalized)", async () => {
    if (!ready) throw new Error(`Firestore emulator not reachable at ${EMULATOR}`);
    await seedStartedQual({ uid: "owner-a", accountId: "48014710" });
    await seedStartedQual({ uid: "owner-b", accountId: "48019999" });
    const result = await findForeignStartedQualifications("viewer", "48014710");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hits.map((h) => h.uid)).toEqual(["owner-a"]);
  });

  it("3: lookup failure fails closed — simulated query error returns ok:false", async () => {
    if (!ready) throw new Error(`Firestore emulator not reachable at ${EMULATOR}`);
    const db = getFirestore();
    const spy = vi.spyOn(db, "collectionGroup").mockImplementation(() => {
      throw new Error("simulated index failure");
    });
    try {
      const result = await findForeignStartedQualifications("u1", "48014710");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("QUALIFICATION_OWNERSHIP_CHECK_UNAVAILABLE");
    } finally {
      spy.mockRestore();
    }
  });

  it("5/6/7: concurrent claim — exactly one wins; loser MISMATCH", async () => {
    if (!ready) throw new Error(`Firestore emulator not reachable at ${EMULATOR}`);
    const accountId = "48015555";
    const results = await Promise.all([
      claimDemoQualificationOwnership({
        uid: "uid-a",
        accountId,
        accountMasked: "48…55"
      }),
      claimDemoQualificationOwnership({
        uid: "uid-b",
        accountId,
        accountMasked: "48…55"
      })
    ]);

    const wins = results.filter((r) => r.ok);
    const losses = results.filter((r) => !r.ok);
    expect(wins.length).toBe(1);
    expect(losses.length).toBe(1);
    if (!wins[0]?.ok || losses[0]?.ok) return;
    expect(losses[0].code).toBe("QUALIFICATION_ACCOUNT_MISMATCH");

    const claim = await getQualificationOwnershipClaim(accountId);
    expect(claim?.ownerUid).toBe(wins[0].ownerUid);
    // Doc id is non-sensitive hash
    expect(qualificationOwnerDocId(accountId)).toMatch(/^[a-f0-9]{40}$/);
    expect(qualificationOwnerDocId(accountId)).not.toContain(accountId);
  });

  it("8: same UID claim is idempotent (restart/redeploy safe)", async () => {
    if (!ready) throw new Error(`Firestore emulator not reachable at ${EMULATOR}`);
    const accountId = "48016666";
    const first = await claimDemoQualificationOwnership({
      uid: "stable-owner",
      accountId,
      accountMasked: "48…66"
    });
    const second = await claimDemoQualificationOwnership({
      uid: "stable-owner",
      accountId,
      accountMasked: "48…66"
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.claimed).toBe(false);
    expect(second.ownerUid).toBe("stable-owner");
  });

  it("9: secondary cannot replace owner claim", async () => {
    if (!ready) throw new Error(`Firestore emulator not reachable at ${EMULATOR}`);
    const accountId = "48014710";
    const owner = await claimDemoQualificationOwnership({
      uid: "owner-uid",
      accountId,
      accountMasked: "48…10"
    });
    expect(owner.ok).toBe(true);
    const secondary = await claimDemoQualificationOwnership({
      uid: "secondary-uid",
      accountId,
      accountMasked: "48…10"
    });
    expect(secondary.ok).toBe(false);
    if (secondary.ok) return;
    expect(secondary.code).toBe("QUALIFICATION_ACCOUNT_MISMATCH");
    const claim = await getQualificationOwnershipClaim(accountId);
    expect(claim?.ownerUid).toBe("owner-uid");
  });

  it("normalizeAccountId string/number collapse for ownership key", () => {
    expect(normalizeAccountId(48014710)).toBe("48014710");
    expect(qualificationOwnerDocId(48014710)).toBe(qualificationOwnerDocId("48014710"));
  });

  it("started qualification doc persists under owner after claim", async () => {
    if (!ready) throw new Error(`Firestore emulator not reachable at ${EMULATOR}`);
    const accountId = "48017777";
    const uid = "persist-owner";
    await claimDemoQualificationOwnership({
      uid,
      accountId,
      accountMasked: "48…77"
    });
    await seedStartedQual({ uid, accountId, state: "LIVE_QUALIFICATION" });
    const loaded = await getQualificationDoc(uid, accountId);
    expect(loaded?.state).toBe("LIVE_QUALIFICATION");
    expect(loaded?.startedAt).toBeTruthy();
    expect(loaded?.previewCount).toBe(0);
    // Re-claim does not destroy qualification
    const again = await claimDemoQualificationOwnership({
      uid,
      accountId,
      accountMasked: "48…77"
    });
    expect(again.ok).toBe(true);
    const still = await getQualificationDoc(uid, accountId);
    expect(still?.state).toBe("LIVE_QUALIFICATION");
    expect(still?.startedAt).toBe(loaded?.startedAt);
  });
});
