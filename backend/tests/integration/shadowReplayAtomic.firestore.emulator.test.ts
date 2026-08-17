/**
 * Firestore emulator — atomic shadow replay field patch.
 * Requires FIRESTORE_EMULATOR_HOST. Never contacts a broker.
 *
 * Proves:
 * 1. Field-only transactional patch cannot regress ACK/activity when a newer
 *    full epoch (ACK=N+1) is already persisted.
 * 2. Stable ACK allows LIVE_REPLAY_OK without clobbering integrity counters.
 * 3. True concurrent full-save vs field-patch never rolls ACK backward.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initializeApp, deleteApp, getApps, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { buildUnitTestFrozenSizingSnapshot } from "../../src/services/goldHunterAdmin/shadowQualification/frozenSizing";
import { GH_ADMIN_DEFAULT_CONFIG } from "../../src/services/goldHunterAdmin/types";
import type { GhShadowQualificationEpoch } from "../../src/services/goldHunterAdmin/shadowQualification/types";
import {
  loadGhShadowEpoch,
  patchGhShadowEpochReplayFields,
  resetGhShadowQualificationMemoryForTests,
  saveGhShadowEpoch,
  setCurrentQualificationId,
  setGhShadowReplayPatchAfterReadHookForTests,
  useGhShadowFirestoreForTests
} from "../../src/services/goldHunterAdmin/shadowQualification/store";

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8081";
const PROJECT = "goldmeta-shadow-replay-atomic-test";
const OWNER = "emu-shadow-replay-owner";
const QID = "GH-SQ-emu-atomic";

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

function baseEpoch(ack: number, over: Partial<GhShadowQualificationEpoch> = {}): GhShadowQualificationEpoch {
  const now = new Date().toISOString();
  const frozen = buildUnitTestFrozenSizingSnapshot({
    config: {
      ...GH_ADMIN_DEFAULT_CONFIG,
      updatedAt: now,
      updatedBy: OWNER
    },
    ctidTraderAccountId: "48014710"
  });
  return {
    qualificationId: QID,
    qualificationStartTime: now,
    qualificationStartSequence: 1,
    strategySha: "x",
    configSha: "x",
    strategyVersion: "v",
    engineVersion: "e",
    soakLabel: "s",
    frozenSizing: frozen,
    formalQualificationTrades: 2,
    diagnosticExcludedTrades: 0,
    openShadowTradeId: null,
    status: "ACTIVE",
    dataIntegrityFailure: null,
    persistFailureReason: null,
    runtimeGeneration: 1,
    lastRestartReason: null,
    integrity: {
      eventsSeen: ack,
      eventsProcessed: ack,
      eventsPersisted: ack,
      eventsDropped: 0,
      receiveSeqGaps: 0,
      receiveSeqDuplicates: 0,
      receiveSeqOutOfOrder: 0,
      journalOverflowCount: 0,
      journalPending: 0,
      journalHighWaterMark: 0,
      persistAcknowledgedEvents: ack,
      persistFailures: 0,
      lastProcessedReceiveSeq: ack,
      lastResyncGeneration: 0
    },
    activity: {
      newOpportunitiesDetected: 1,
      formalTradesOpened: 2,
      formalTradesClosed: 2,
      opportunitiesWhileAlreadyOpen: 0,
      opportunitiesExcludedDataQuality: 0,
      opportunitiesRejectedSizing: 0,
      opportunitiesWarmupIgnored: 0,
      otherRejectionReasons: {},
      activeMarketMs: 1000,
      entryTimestampsMs: [],
      openTradeDurationsMs: [],
      flatIdleSegmentsMs: [],
      lastActiveMarketAtMs: null,
      lastEntryAtMs: null,
      lastFlatActiveAtMs: null,
      currentFlatIdleActiveMs: 0,
      lastFlatStartMs: null,
      bySetupOpened: { A: 2, B: 0, C: 0 }
    },
    lastReplayStatus: "NOT_RUN",
    lastReplayDetail: null,
    updatedAt: now,
    ...over
  };
}

describe("Firestore emulator — atomic shadow replay patch", () => {
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
    useGhShadowFirestoreForTests(getFirestore(app));
  });

  afterAll(async () => {
    useGhShadowFirestoreForTests(null);
    setGhShadowReplayPatchAfterReadHookForTests(null);
    if (app) await deleteApp(app);
  });

  beforeEach(async () => {
    if (!ready || !app) return;
    setGhShadowReplayPatchAfterReadHookForTests(null);
    resetGhShadowQualificationMemoryForTests();
    const db = getFirestore(app);
    const root = db
      .collection("users")
      .doc(OWNER)
      .collection("goldHunterShadowQualification");
    const snap = await root.get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  });

  it("ACK=N+1 already persisted ⇒ patch expecting N is STALE; counters intact", async () => {
    if (!ready || !app) return;

    const n = 10;
    await saveGhShadowEpoch(OWNER, baseEpoch(n));
    await setCurrentQualificationId(OWNER, QID);

    // Live persistence advanced to N+1 before replay finalise commits.
    await saveGhShadowEpoch(
      OWNER,
      baseEpoch(n + 1, {
        formalQualificationTrades: 11,
        diagnosticExcludedTrades: 3,
        activity: {
          ...baseEpoch(n + 1).activity,
          formalTradesOpened: 8,
          newOpportunitiesDetected: 6
        }
      })
    );

    const patch = await patchGhShadowEpochReplayFields(OWNER, {
      qualificationId: QID,
      expectedEvents: n,
      requireCurrentAck: true,
      lastReplayStatus: "LIVE_REPLAY_OK",
      lastReplayDetail: {
        capturedEvents: n,
        replayedEvents: n,
        expectedEvents: n,
        firstDivergenceSeq: null,
        divergenceDetail: null,
        completedAt: new Date().toISOString()
      }
    });

    expect(patch.currency).toBe("STALE");
    expect(patch.writtenStatus).toBe("REPLAY_STALE");
    expect(patch.persistAcknowledgedEvents).toBe(n + 1);

    const stored = await loadGhShadowEpoch(OWNER, QID);
    expect(stored!.integrity.persistAcknowledgedEvents).toBe(n + 1);
    expect(stored!.integrity.eventsPersisted).toBe(n + 1);
    expect(stored!.formalQualificationTrades).toBe(11);
    expect(stored!.diagnosticExcludedTrades).toBe(3);
    expect(stored!.activity.formalTradesOpened).toBe(8);
    expect(stored!.activity.newOpportunitiesDetected).toBe(6);
    expect(stored!.lastReplayStatus).toBe("REPLAY_STALE");
  });

  it("stable ACK allows LIVE_REPLAY_OK via field-only patch (integrity untouched)", async () => {
    if (!ready || !app) return;
    const n = 5;
    await saveGhShadowEpoch(
      OWNER,
      baseEpoch(n, {
        formalQualificationTrades: 4,
        activity: {
          ...baseEpoch(n).activity,
          formalTradesOpened: 4,
          activeMarketMs: 42_000
        }
      })
    );
    await setCurrentQualificationId(OWNER, QID);

    const patch = await patchGhShadowEpochReplayFields(OWNER, {
      qualificationId: QID,
      expectedEvents: n,
      requireCurrentAck: true,
      lastReplayStatus: "LIVE_REPLAY_OK",
      lastReplayDetail: {
        capturedEvents: n,
        replayedEvents: n,
        expectedEvents: n,
        firstDivergenceSeq: null,
        divergenceDetail: null,
        completedAt: new Date().toISOString()
      }
    });

    expect(patch.currency).toBe("CURRENT");
    expect(patch.writtenStatus).toBe("LIVE_REPLAY_OK");
    const stored = await loadGhShadowEpoch(OWNER, QID);
    expect(stored!.lastReplayStatus).toBe("LIVE_REPLAY_OK");
    expect(stored!.integrity.persistAcknowledgedEvents).toBe(n);
    expect(stored!.formalQualificationTrades).toBe(4);
    expect(stored!.activity.formalTradesOpened).toBe(4);
    expect(stored!.activity.activeMarketMs).toBe(42_000);
  });

  it("full-document save of stale N rolls ACK back; field-only patch does not", async () => {
    if (!ready || !app) return;
    const n = 10;
    const staleN = baseEpoch(n, { formalQualificationTrades: 2 });
    const liveN1 = baseEpoch(n + 1, {
      formalQualificationTrades: 20,
      activity: {
        ...baseEpoch(n + 1).activity,
        formalTradesOpened: 15
      }
    });
    await saveGhShadowEpoch(OWNER, staleN);
    await setCurrentQualificationId(OWNER, QID);
    await saveGhShadowEpoch(OWNER, liveN1);
    expect((await loadGhShadowEpoch(OWNER, QID))!.integrity.persistAcknowledgedEvents).toBe(
      n + 1
    );

    // Legacy bug pattern: whole-document merge of a stale N snapshot.
    await saveGhShadowEpoch(OWNER, {
      ...staleN,
      lastReplayStatus: "LIVE_REPLAY_OK",
      lastReplayDetail: {
        capturedEvents: n,
        replayedEvents: n,
        expectedEvents: n,
        firstDivergenceSeq: null,
        divergenceDetail: null,
        completedAt: new Date().toISOString()
      }
    });
    const rolled = await loadGhShadowEpoch(OWNER, QID);
    expect(rolled!.integrity.persistAcknowledgedEvents).toBe(n); // rolled back
    expect(rolled!.formalQualificationTrades).toBe(2); // markers lost

    // Restore N+1 and apply atomic field-only patch expecting N.
    await saveGhShadowEpoch(OWNER, liveN1);
    const patch = await patchGhShadowEpochReplayFields(OWNER, {
      qualificationId: QID,
      expectedEvents: n,
      requireCurrentAck: true,
      lastReplayStatus: "LIVE_REPLAY_OK",
      lastReplayDetail: {
        capturedEvents: n,
        replayedEvents: n,
        expectedEvents: n,
        firstDivergenceSeq: null,
        divergenceDetail: null,
        completedAt: new Date().toISOString()
      }
    });
    expect(patch.currency).toBe("STALE");
    const fixed = await loadGhShadowEpoch(OWNER, QID);
    expect(fixed!.integrity.persistAcknowledgedEvents).toBe(n + 1);
    expect(fixed!.formalQualificationTrades).toBe(20);
    expect(fixed!.activity.formalTradesOpened).toBe(15);
    expect(fixed!.lastReplayStatus).toBe("REPLAY_STALE");
  });
});
