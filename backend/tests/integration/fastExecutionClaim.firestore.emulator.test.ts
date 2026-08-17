/**
 * Firestore emulator — atomic FAST execution claims.
 * Requires FIRESTORE_EMULATOR_HOST. Never contacts a broker.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initializeApp, deleteApp, getApps, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  createFirestoreClaimBackend,
  generateFastClientOrderId,
  useFastExecutionClaimBackendForTests,
  resetFastExecutionClaimsForTests,
  reserveFastExecutionClaim,
  dropFastExecutionClaimCacheForTests,
  getFastExecutionClaim,
  updateFastExecutionClaim
} from "../../src/services/broker/ctrader/fastAutoTrade/executionClaimStore";

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8081";
const PROJECT = "goldmeta-fast-claim-test";
const OWNER = "emu-fast-owner";
const SIGNAL = "fast_emu_signal";
const CLIENT = generateFastClientOrderId(SIGNAL);

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

describe("Firestore emulator — FAST execution claims", () => {
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
    const db = getFirestore(app);
    useFastExecutionClaimBackendForTests(createFirestoreClaimBackend(db));
  });

  afterAll(async () => {
    useFastExecutionClaimBackendForTests(null);
    if (app) await deleteApp(app);
  });

  beforeEach(async () => {
    if (!ready || !app) return;
    const db = getFirestore(app);
    const snap = await db
      .collection("users")
      .doc(OWNER)
      .collection("fastExecutionClaims")
      .get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
    dropFastExecutionClaimCacheForTests();
    await resetFastExecutionClaimsForTests();
  });

  it("concurrent reserve → exactly one winner", async () => {
    if (!ready) return;
    const [a, b] = await Promise.all([
      reserveFastExecutionClaim({
        ownerUid: OWNER,
        signalId: SIGNAL,
        clientOrderId: CLIENT
      }),
      reserveFastExecutionClaim({
        ownerUid: OWNER,
        signalId: SIGNAL,
        clientOrderId: CLIENT
      })
    ]);
    const winners = [a, b].filter((r) => r.ok);
    const losers = [a, b].filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]?.reason).toBe("ALREADY_CLAIMED");
  });

  it("cold start cache drop still reads Firestore claim", async () => {
    if (!ready) return;
    const reserved = await reserveFastExecutionClaim({
      ownerUid: OWNER,
      signalId: SIGNAL,
      clientOrderId: CLIENT
    });
    expect(reserved.ok).toBe(true);
    await updateFastExecutionClaim(OWNER, SIGNAL, {
      requestSent: true,
      newOrderReqCount: 1,
      state: "BROKER_ACCEPTED_PENDING_FILL"
    });
    dropFastExecutionClaimCacheForTests();
    const again = await getFastExecutionClaim(OWNER, SIGNAL);
    expect(again?.state).toBe("BROKER_ACCEPTED_PENDING_FILL");
    expect(again?.requestSent).toBe(true);
    const second = await reserveFastExecutionClaim({
      ownerUid: OWNER,
      signalId: SIGNAL,
      clientOrderId: "fa_other"
    });
    expect(second.ok).toBe(false);
  });
});
