/**
 * GOLD_HUNTER FAST research capture — safety + data-integrity tests.
 * Observation only. Asserts absence of trading / execution paths.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createReadStream, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  assertResearchViewOnlyScope,
  refuseExecutionAdapter,
  researchSafetyIdentity,
  assertNoExecutionAdapterArgument,
  isForbiddenExecutionAdapterName
} from "../../../../src/services/microEdge/goldHunter/fast/research/nullExecutionGuard";
import { evaluateCaptureHealth } from "../../../../src/services/microEdge/goldHunter/fast/research/researchCaptureHealth";
import { ResearchFeaturePipeline } from "../../../../src/services/microEdge/goldHunter/fast/research/researchFeaturePipeline";
import { ResearchIngestBridge } from "../../../../src/services/microEdge/goldHunter/fast/research/researchIngestBridge";
import { ResearchDurableSink } from "../../../../src/services/microEdge/goldHunter/fast/research/researchDurableSink";
import { verifyResearchScopeFromBrokerAuth } from "../../../../src/services/microEdge/goldHunter/fast/research/researchScopeVerify";
import {
  GH_FAST_RESEARCH_FORBIDDEN_GCS_PREFIX,
  GH_FAST_RESEARCH_GCS_PREFIX_ROOT,
  GH_FAST_RESEARCH_MODE,
  GH_FAST_RESEARCH_SCHEMA_VERSION,
  type ResearchCaptureRecord
} from "../../../../src/services/microEdge/goldHunter/fast/research/researchTypes";
import { GoldHunterFastResearchCaptureRuntime } from "../../../../src/services/microEdge/runtime/fastResearchCaptureRuntime";
import type { MicroLiveMarketSession } from "../../../../src/services/microEdge/marketData/liveSession";
import type { MicroLiveSessionState } from "../../../../src/services/microEdge/marketData/liveSession";

async function readGzJsonl(dir: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    if (!existsSync(cur)) continue;
    for (const name of readdirSync(cur)) {
      const p = join(cur, name);
      if (name.endsWith(".ndjson.gz")) {
        const stream = createReadStream(p).pipe(createGunzip());
        const rl = createInterface({ input: stream, crlfDelay: Infinity });
        for await (const line of rl) {
          if (!line.trim()) continue;
          rows.push(JSON.parse(line));
        }
      } else {
        try {
          const st = await import("node:fs").then((m) => m.statSync(p));
          if (st.isDirectory()) stack.push(p);
        } catch {
          /* ignore */
        }
      }
    }
  }
  return rows;
}

function baseHealthInput(
  overrides: Partial<Parameters<typeof evaluateCaptureHealth>[0]> = {}
) {
  return {
    processHealthy: true,
    connectionState: "CONNECTED" as const,
    spotSubscribed: true,
    depthSubscribed: true,
    spotAgeMs: 100,
    depthAgeMs: 100,
    freshnessLimitMs: 20_000,
    eventsDropped: 0,
    persistenceDroppedRows: 0,
    persistenceDroppedChunks: 0,
    writeErrors: 0,
    uploadErrors: 0,
    durableMode: "LOCAL_BUFFER_ONLY" as const,
    campaignMode: false,
    scopeVerified: true,
    fatalPersistenceError: false,
    healthWarning: null,
    heartbeatsPersisted: 1,
    sessionTransitionsPersisted: 1,
    ...overrides
  };
}

function fakeRecord(seq: number): ResearchCaptureRecord {
  return {
    schemaVersion: GH_FAST_RESEARCH_SCHEMA_VERSION,
    mode: GH_FAST_RESEARCH_MODE,
    t: Date.now(),
    runId: "r",
    datasetId: "d",
    receiveSeq: seq,
    eventKind: "HEARTBEAT",
    transport: {
      rawCallbackArrivalMs: Date.now(),
      bridgeEnqueueMs: Date.now(),
      processStartMs: Date.now(),
      enqueueToProcessLatencyMs: 0
    },
    subscription: {
      spotSubscribed: true,
      depthSubscribed: true,
      connectionState: "CONNECTED",
      disconnectTs: null,
      reconnectStartTs: null,
      reconnectFinishTs: null,
      resubscribeState: "IDLE",
      reconnectReason: null
    },
    queueDepthAtProcess: 0,
    eventLoopLagMs: 0,
    market: {
      kind: "HEARTBEAT",
      heartbeatTs: Date.now(),
      eventLoopLagMs: 0,
      connectionState: "CONNECTED",
      spotSubscribed: true,
      depthSubscribed: true,
      spotAgeMs: 0,
      depthAgeMs: 0,
      queueDepth: 0,
      persistenceQueueDepth: 0
    },
    features: null,
    specialists: null,
    safety: {
      brokerRequests: 0,
      brokerOrders: 0,
      shadowOrders: 0,
      openShadowTrade: false,
      executionAdapter: "NONE",
      mutationSurface: "NONE",
      permissionScope: "SCOPE_VIEW"
    }
  };
}

describe("research null execution guard", () => {
  it("returns SCOPE_VIEW identity with zero order counters", () => {
    const id = researchSafetyIdentity();
    expect(id.permissionScope).toBe("SCOPE_VIEW");
    expect(id.mutationSurface).toBe("NONE");
    expect(id.executionAdapter).toBe("NONE");
    expect(id.brokerRequests).toBe(0);
    expect(id.brokerOrders).toBe(0);
    expect(id.shadowOrders).toBe(0);
    expect(id.openShadowTrade).toBe(false);
  });

  it("fail-closed on SCOPE_TRADE", () => {
    expect(() => assertResearchViewOnlyScope("SCOPE_TRADE")).toThrow(
      /SCOPE_TRADE/
    );
  });

  it("accepts SCOPE_VIEW", () => {
    expect(() => assertResearchViewOnlyScope("SCOPE_VIEW")).not.toThrow();
  });

  it("refuses execution adapter injection", () => {
    expect(() => refuseExecutionAdapter({ name: "ShadowExecutionAdapter" })).toThrow(
      /RESEARCH_CAPTURE_REFUSING_EXECUTION_ADAPTER/
    );
    expect(() => assertNoExecutionAdapterArgument({ name: "x" })).toThrow();
    expect(() => assertNoExecutionAdapterArgument(undefined)).not.toThrow();
  });

  it("flags forbidden adapter names", () => {
    expect(isForbiddenExecutionAdapterName("ShadowExecutionAdapter")).toBe(true);
    expect(isForbiddenExecutionAdapterName("ForbiddenLiveExecutionAdapter")).toBe(
      true
    );
    expect(isForbiddenExecutionAdapterName("ResearchNone")).toBe(false);
  });
});

describe("captureHealthy evaluation", () => {
  it("DISCONNECTED => captureHealthy=false (even if processHealthy)", () => {
    const h = evaluateCaptureHealth(
      baseHealthInput({ connectionState: "DISCONNECTED" })
    );
    expect(h.processHealthy).toBe(true);
    expect(h.captureHealthy).toBe(false);
    expect(h.serviceHealthy).toBe(false);
    expect(h.captureUnhealthyReasons).toContain("connection_not_connected");
  });

  it("Spot missing => false", () => {
    const h = evaluateCaptureHealth(baseHealthInput({ spotSubscribed: false }));
    expect(h.captureHealthy).toBe(false);
    expect(h.captureUnhealthyReasons).toContain("spot_not_subscribed");
  });

  it("Depth missing => false", () => {
    const h = evaluateCaptureHealth(baseHealthInput({ depthSubscribed: false }));
    expect(h.captureHealthy).toBe(false);
    expect(h.captureUnhealthyReasons).toContain("depth_not_subscribed");
  });

  it("stale Spot => false", () => {
    const h = evaluateCaptureHealth(
      baseHealthInput({ spotAgeMs: 25_000, freshnessLimitMs: 20_000 })
    );
    expect(h.captureHealthy).toBe(false);
    expect(h.captureUnhealthyReasons).toContain("spot_stale");
  });

  it("stale Depth => false", () => {
    const h = evaluateCaptureHealth(
      baseHealthInput({ depthAgeMs: 25_000, freshnessLimitMs: 20_000 })
    );
    expect(h.captureHealthy).toBe(false);
    expect(h.captureUnhealthyReasons).toContain("depth_stale");
  });

  it("healthy fresh Spot+Depth => true", () => {
    const h = evaluateCaptureHealth(baseHealthInput());
    expect(h.captureHealthy).toBe(true);
    expect(h.serviceHealthy).toBe(true);
    expect(h.dataIntegrityStatus).toBe("CLEAN");
  });

  it("GCS-required campaign health rejects LOCAL_BUFFER_ONLY", () => {
    const h = evaluateCaptureHealth(
      baseHealthInput({
        campaignMode: true,
        durableMode: "LOCAL_BUFFER_ONLY",
        healthWarning: "CAMPAIGN_GCS_REQUIRED"
      })
    );
    expect(h.captureHealthy).toBe(true);
    expect(h.campaignValid).toBe(false);
    expect(h.captureUnhealthyReasons).toContain("gcs_required_for_campaign");
  });

  it("campaignValid requires GCS + heartbeats + session telemetry", () => {
    const ok = evaluateCaptureHealth(
      baseHealthInput({
        campaignMode: true,
        durableMode: "GCS",
        heartbeatsPersisted: 3,
        sessionTransitionsPersisted: 2
      })
    );
    expect(ok.campaignValid).toBe(true);
    const noHb = evaluateCaptureHealth(
      baseHealthInput({
        campaignMode: true,
        durableMode: "GCS",
        heartbeatsPersisted: 0,
        sessionTransitionsPersisted: 2
      })
    );
    expect(noHb.campaignValid).toBe(false);
  });
});

describe("actual SCOPE_VIEW authorization verification", () => {
  it("accepts broker auth response resolving to SCOPE_VIEW", () => {
    const proof = verifyResearchScopeFromBrokerAuth({
      permissionScope: "SCOPE_VIEW"
    });
    expect(proof.ok).toBe(true);
    expect(proof.permissionScope).toBe("SCOPE_VIEW");
    expect(proof.source).toBe("broker_authorization_response");
  });

  it("rejects SCOPE_TRADE", () => {
    expect(() =>
      verifyResearchScopeFromBrokerAuth({ permissionScope: "SCOPE_TRADE" })
    ).toThrow(/SCOPE_TRADE/);
  });

  it("rejects UNKNOWN / missing scope", () => {
    expect(() => verifyResearchScopeFromBrokerAuth({})).toThrow(/UNKNOWN/);
    expect(() =>
      verifyResearchScopeFromBrokerAuth({ permissionScope: "WEIRD" })
    ).toThrow(/UNKNOWN/);
  });
});

describe("research feature pipeline observation", () => {
  it("emits A/B/C selectedCandidate without any order state", () => {
    const pipe = new ResearchFeaturePipeline();
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) {
      pipe.onSpot({
        kind: "SPOT",
        receiveSeq: i + 1,
        eventId: `s${i}`,
        receivedAtMs: t0 + i * 50,
        brokerTimestampMs: null,
        bid: 2300 + i * 0.01,
        ask: 2300.08 + i * 0.01
      });
    }
    const snap = pipe.onSpot({
      kind: "SPOT",
      receiveSeq: 100,
      eventId: "s100",
      receivedAtMs: t0 + 2000,
      brokerTimestampMs: null,
      bid: 2300.5,
      ask: 2300.58
    });
    expect(snap.features).not.toBeNull();
    expect(snap.specialists).not.toBeNull();
    expect(snap.specialists!.length).toBe(3);
    for (const s of snap.specialists!) {
      expect(s).toHaveProperty("selectedCandidate");
      expect(s).not.toHaveProperty("openShadowTrade");
    }
  });
});

describe("research ingest bridge + durable sink", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "gh-research-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips Spot/Depth gzip chunks and keeps A/B/C telemetry", async () => {
    const bridge = new ResearchIngestBridge({
      localDir: dir,
      chunkRows: 10,
      runId: "test_research_roundtrip",
      datasetId: "ds_test"
    });
    bridge.setConnectionState("CONNECTED");
    bridge.setSubscriptionFlags(true, true);
    const t0 = Date.now();
    for (let i = 0; i < 25; i++) {
      bridge.ingestSpot(
        { bid: 2400 + i * 0.02, ask: 2400.1 + i * 0.02 },
        t0 + i * 40
      );
      if (i % 3 === 0) {
        bridge.ingestDepth(
          {
            newQuotes: [
              { id: i, type: "BID", price: 2400 + i * 0.02, size: 1.5 },
              { id: 1000 + i, type: "ASK", price: 2400.1 + i * 0.02, size: 1.2 }
            ]
          },
          t0 + i * 40 + 1
        );
      }
    }
    await bridge.drainForTests();
    const rows = (await readGzJsonl(dir)) as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows) {
      expect(r.mode).toBe(GH_FAST_RESEARCH_MODE);
      expect(r.schemaVersion).toBe(GH_FAST_RESEARCH_SCHEMA_VERSION);
      expect(r.safety).toEqual({
        brokerRequests: 0,
        brokerOrders: 0,
        shadowOrders: 0,
        openShadowTrade: false,
        executionAdapter: "NONE",
        mutationSurface: "NONE",
        permissionScope: "SCOPE_VIEW"
      });
      expect(r).not.toHaveProperty("tradeExit");
      expect(r).not.toHaveProperty("openPosition");
      expect(JSON.stringify(r)).not.toMatch(/ENTER_BUY|ENTER_SELL|tradeExit/);
      const transport = r.transport as Record<string, number>;
      expect(transport.rawCallbackArrivalMs).toBeLessThanOrEqual(
        transport.bridgeEnqueueMs
      );
      expect(transport.bridgeEnqueueMs).toBeLessThanOrEqual(
        transport.processStartMs
      );
      expect(transport.enqueueToProcessLatencyMs).toBeGreaterThanOrEqual(0);
    }
    const withSpecs = rows.filter((r) => Array.isArray(r.specialists));
    expect(withSpecs.length).toBeGreaterThan(0);
    const sample = withSpecs[0]!.specialists as Array<Record<string, unknown>>;
    expect(sample[0]).toHaveProperty("selectedCandidate");
    expect(sample[0]).toHaveProperty("failedConditions");

    const sinkStats = bridge.getSink().stats();
    expect(sinkStats.gcsPrefix).toContain(GH_FAST_RESEARCH_GCS_PREFIX_ROOT);
    expect(sinkStats.gcsPrefix).not.toContain(GH_FAST_RESEARCH_FORBIDDEN_GCS_PREFIX);
    expect(sinkStats.localDir).toContain("research");
    expect(sinkStats.localDir).not.toContain("live-shadow");
    const dateDirs = readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    expect(dateDirs.length).toBeGreaterThan(0);
    expect(
      existsSync(join(dir, dateDirs[0]!, "chunk-00000.ndjson.gz.manifest.json"))
    ).toBe(true);
  });

  it("resync clears book without fabricating trades", async () => {
    const bridge = new ResearchIngestBridge({
      localDir: dir,
      chunkRows: 50,
      runId: "test_resync"
    });
    bridge.setConnectionState("CONNECTED");
    bridge.ingestSpot({ bid: 2500, ask: 2500.1 }, Date.now());
    bridge.noteResync("test");
    await bridge.drainForTests();
    const rows = (await readGzJsonl(dir)) as Array<Record<string, unknown>>;
    expect(rows.some((r) => r.eventKind === "RESYNC_MARKER")).toBe(true);
    expect(rows.every((r) => !("tradeExit" in r))).toBe(true);
    expect(bridge.health().resyncCount).toBe(1);
    expect(bridge.health().shadowOrders).toBe(0);
    expect(bridge.health().brokerOrders).toBe(0);
    expect(bridge.health().brokerRequests).toBe(0);
    expect(bridge.health().openShadowTrade).toBe(false);
    expect(bridge.health().executionAdapter).toBe("NONE");
  });

  it("records queue latency and event-loop lag percentiles", async () => {
    const bridge = new ResearchIngestBridge({
      localDir: dir,
      chunkRows: 100,
      runId: "test_latency"
    });
    bridge.setConnectionState("CONNECTED");
    bridge.recordHeartbeatLag(12);
    bridge.recordHeartbeatLag(30);
    bridge.recordHeartbeatLag(8);
    for (let i = 0; i < 5; i++) {
      bridge.ingestSpot({ bid: 1 + i, ask: 1.1 + i }, Date.now());
    }
    await bridge.drainForTests();
    const h = bridge.health();
    expect(h.queueLatencyP50).not.toBeNull();
    expect(h.eventLoopLagP95).not.toBeNull();
    expect(h.mode).toBe("RESEARCH_CAPTURE_ONLY");
  });

  it("bridge DISCONNECTED reports captureHealthy=false", async () => {
    const bridge = new ResearchIngestBridge({
      localDir: dir,
      chunkRows: 100,
      runId: "test_disc_health",
      scopeVerified: true
    });
    // default DISCONNECTED — process up, capture not healthy
    const h0 = bridge.health();
    expect(h0.processHealthy).toBe(true);
    expect(h0.connectionState).toBe("DISCONNECTED");
    expect(h0.captureHealthy).toBe(false);
    expect(h0.serviceHealthy).toBe(false);

    bridge.setConnectionState("CONNECTED");
    bridge.setSubscriptionFlags(true, true);
    const t = Date.now();
    bridge.ingestSpot({ bid: 1, ask: 1.1 }, t);
    bridge.ingestDepth({ newQuotes: [] }, t);
    await bridge.drainForTests();
    const h1 = bridge.health(t + 50);
    expect(h1.captureHealthy).toBe(true);
    expect(h1.dataIntegrityStatus).toBe("CLEAN");
  });

  it("stale Spot/Depth ages make captureHealthy false", async () => {
    const bridge = new ResearchIngestBridge({
      localDir: dir,
      chunkRows: 100,
      runId: "test_stale",
      freshnessLimitMs: 500,
      scopeVerified: true
    });
    bridge.setConnectionState("CONNECTED");
    bridge.setSubscriptionFlags(true, true);
    const t0 = Date.now();
    bridge.ingestSpot({ bid: 1, ask: 1.1 }, t0);
    bridge.ingestDepth({ newQuotes: [] }, t0);
    await bridge.drainForTests();
    expect(bridge.health(t0 + 50).captureHealthy).toBe(true);
    expect(bridge.health(t0 + 2000).captureHealthy).toBe(false);
    expect(bridge.health(t0 + 2000).captureUnhealthyReasons).toEqual(
      expect.arrayContaining(["spot_stale", "depth_stale"])
    );
  });

  it("persists HEARTBEAT rows with no market events", async () => {
    const bridge = new ResearchIngestBridge({
      localDir: dir,
      chunkRows: 5,
      runId: "test_heartbeat_only"
    });
    bridge.setConnectionState("CONNECTED");
    bridge.setSubscriptionFlags(true, true);
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) {
      bridge.persistHeartbeat(2 + i, t0 + i * 1000);
    }
    await bridge.drainForTests();
    const rows = (await readGzJsonl(dir)) as Array<Record<string, unknown>>;
    const heartbeats = rows.filter((r) => r.eventKind === "HEARTBEAT");
    expect(heartbeats.length).toBeGreaterThanOrEqual(5);
    const m = heartbeats[0]!.market as Record<string, unknown>;
    expect(m).toMatchObject({
      kind: "HEARTBEAT",
      connectionState: "CONNECTED",
      spotSubscribed: true,
      depthSubscribed: true
    });
    expect(m).toHaveProperty("heartbeatTs");
    expect(m).toHaveProperty("eventLoopLagMs");
    expect(m).toHaveProperty("spotAgeMs");
    expect(m).toHaveProperty("depthAgeMs");
    expect(m).toHaveProperty("queueDepth");
    expect(m).toHaveProperty("persistenceQueueDepth");
    expect(bridge.health().heartbeatsPersisted).toBeGreaterThanOrEqual(5);
    expect(bridge.health().eventsReceived).toBe(0);
  });

  it("records disconnect/reconnect and subscription loss/recovery timeline", async () => {
    const bridge = new ResearchIngestBridge({
      localDir: dir,
      chunkRows: 50,
      runId: "test_lifecycle"
    });
    bridge.setConnectionState("CONNECTED", "boot");
    bridge.setSubscriptionFlags(true, true);
    bridge.noteDisconnect("transport_lost", Date.now());
    bridge.noteReconnectStart(Date.now(), "retry");
    bridge.noteReconnectFinish(Date.now());
    bridge.noteSubscriptionChange(false, false, "subscription_lost");
    bridge.noteSubscriptionChange(true, true, "subscription_restored");
    await bridge.drainForTests();
    const rows = (await readGzJsonl(dir)) as Array<Record<string, unknown>>;
    const transitions = rows.filter((r) => r.eventKind === "SESSION_TRANSITION");
    expect(transitions.length).toBeGreaterThanOrEqual(4);
    const blob = JSON.stringify(transitions);
    expect(blob).toMatch(/DISCONNECTED/);
    expect(blob).toMatch(/RECONNECTING/);
    expect(blob).toMatch(/CONNECTED/);
    expect(blob).toMatch(/subscription/);
    expect(bridge.health().sessionTransitionsPersisted).toBeGreaterThan(0);
    expect(bridge.health().reconnectCount).toBe(1);
  });

  it("persistence backpressure fails loudly — no silent chunk loss", async () => {
    const sink = new ResearchDurableSink({
      runId: "bp",
      datasetId: "bp",
      researchConfigSha: "sha",
      captureStart: new Date().toISOString(),
      localDir: dir,
      chunkRows: 1,
      maxQueue: 1
    });
    // Flood synchronously so pending fills before drain finishes writing.
    for (let i = 0; i < 40; i++) {
      sink.enqueue(fakeRecord(i + 1));
    }
    await sink.flushAndWait(5000);
    const st = sink.stats();
    expect(st.fatalPersistenceError).toBe(true);
    expect(st.accepting).toBe(false);
    expect(st.persistenceDroppedChunks).toBeGreaterThan(0);
    expect(st.persistenceDroppedRows).toBeGreaterThan(0);
    expect(st.healthWarning).toMatch(/DATA_INTEGRITY_FAILED/);
    // Already-written evidence retained
    expect(st.chunksWritten).toBeGreaterThan(0);
    const dateDirs = readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    expect(dateDirs.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, dateDirs[0]!, "chunk-00000.ndjson.gz"))).toBe(
      true
    );

    const bridge = new ResearchIngestBridge({
      localDir: join(dir, "bridge"),
      chunkRows: 1,
      maxQueue: 1,
      runId: "bp_bridge",
      scopeVerified: true
    });
    bridge.setConnectionState("CONNECTED");
    bridge.setSubscriptionFlags(true, true);
    // Force integrity fail via sink backpressure path through bridge
    const sink2 = bridge.getSink();
    for (let i = 0; i < 40; i++) {
      sink2.enqueue(fakeRecord(100 + i));
    }
    await sink2.flushAndWait(5000);
    const h = bridge.health();
    expect(h.dataIntegrityStatus).toBe("FAILED");
    expect(h.captureHealthy).toBe(false);
    expect(h.persistenceDroppedChunks).toBeGreaterThan(0);
    expect(h.persistenceDroppedRows).toBeGreaterThan(0);
  });
});

describe("research capture runtime", () => {
  let dir: string;
  let rt: GoldHunterFastResearchCaptureRuntime;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "gh-research-rt-"));
    rt = new GoldHunterFastResearchCaptureRuntime({
      collectDir: dir,
      permissionScope: "SCOPE_VIEW",
      // Slow default so drainForTests is not starved by continuous HEARTBEATs.
      heartbeatEveryMs: 60_000,
      sessionPollEveryMs: 40
    });
    await rt.start();
    rt.markScopeVerifiedForTests();
  });

  afterEach(async () => {
    await rt.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses SCOPE_TRADE at construction", () => {
    expect(
      () =>
        new GoldHunterFastResearchCaptureRuntime({
          permissionScope: "SCOPE_TRADE"
        })
    ).toThrow(/SCOPE_TRADE/);
  });

  it("refuses execution adapter API", () => {
    expect(() => rt.submitExecutionAdapter({ name: "ShadowExecutionAdapter" })).toThrow(
      /RESEARCH_CAPTURE_REFUSING_EXECUTION_ADAPTER/
    );
  });

  it("attachSession verifies actual broker SCOPE_VIEW and rejects TRADE/UNKNOWN", async () => {
    const state: MicroLiveSessionState = {
      connectionState: "LIVE_CONNECTED",
      liveConnected: true,
      credentialsConfigured: true,
      applicationAuthenticated: true,
      accountAuthenticated: true,
      configuredAccountAuthorized: true,
      authorizedAccountCount: 1,
      symbol: null,
      spotSubscribed: true,
      spotSubscribedAt: null,
      lastSpotEventAt: null,
      depthSubscribed: true,
      depthSubscribedAt: null,
      lastDepthEventAt: null,
      lastQuote: null,
      lastQuoteTs: null,
      quoteAgeMs: null,
      lastCompletedM1Ts: null,
      lastCompletedM5Ts: null,
      lastCompletedM15Ts: null,
      lastConnectedAt: new Date().toISOString(),
      lastDisconnectedAt: null,
      reconnectAttempts: 0,
      lastErrorCode: null,
      healthReasons: [],
      collectorHeartbeatAt: null,
      m1CompletedEvents: 0,
      subscribeSpotsCallCount: 0,
      subscribeDepthCallCount: 0
    };
    const session = {
      onSpotForFast: () => () => undefined,
      onDepthForFast: () => () => undefined,
      getState: async () => state
    } as unknown as MicroLiveMarketSession;

    expect(() =>
      rt.attachSession(session, { permissionScope: "SCOPE_TRADE" })
    ).toThrow(/SCOPE_TRADE/);
    expect(() => rt.attachSession(session, {})).toThrow(/UNKNOWN/);

    rt.attachSession(session, { permissionScope: "SCOPE_VIEW" });
    expect(rt.isScopeVerified()).toBe(true);
    expect(rt.health().scopeVerified).toBe(true);
  });

  it("wires session disconnect/reconnect into bridge transitions", async () => {
    let state: MicroLiveSessionState = {
      connectionState: "LIVE_CONNECTED",
      liveConnected: true,
      credentialsConfigured: true,
      applicationAuthenticated: true,
      accountAuthenticated: true,
      configuredAccountAuthorized: true,
      authorizedAccountCount: 1,
      symbol: null,
      spotSubscribed: true,
      spotSubscribedAt: null,
      lastSpotEventAt: null,
      depthSubscribed: true,
      depthSubscribedAt: null,
      lastDepthEventAt: null,
      lastQuote: null,
      lastQuoteTs: null,
      quoteAgeMs: null,
      lastCompletedM1Ts: null,
      lastCompletedM5Ts: null,
      lastCompletedM15Ts: null,
      lastConnectedAt: new Date().toISOString(),
      lastDisconnectedAt: null,
      reconnectAttempts: 0,
      lastErrorCode: null,
      healthReasons: [],
      collectorHeartbeatAt: null,
      m1CompletedEvents: 0,
      subscribeSpotsCallCount: 0,
      subscribeDepthCallCount: 0
    };
    const session = {
      onSpotForFast: () => () => undefined,
      onDepthForFast: () => () => undefined,
      getState: async () => state
    } as unknown as MicroLiveMarketSession;

    rt.attachSession(session, { permissionScope: "SCOPE_VIEW" });
    await new Promise((r) => setTimeout(r, 60));

    state = {
      ...state,
      liveConnected: false,
      connectionState: "LIVE_NOT_CONNECTED",
      lastDisconnectedAt: new Date().toISOString(),
      lastErrorCode: "TEST_DISCONNECT",
      spotSubscribed: false,
      depthSubscribed: false,
      reconnectAttempts: 0
    };
    await new Promise((r) => setTimeout(r, 80));

    state = {
      ...state,
      reconnectAttempts: 1,
      connectionState: "LIVE_NOT_CONNECTED",
      lastErrorCode: "TEST_RECONNECTING"
    };
    await new Promise((r) => setTimeout(r, 80));

    state = {
      ...state,
      liveConnected: true,
      connectionState: "LIVE_CONNECTED",
      lastConnectedAt: new Date().toISOString(),
      spotSubscribed: true,
      depthSubscribed: true,
      lastErrorCode: null
    };
    await new Promise((r) => setTimeout(r, 80));

    await rt.drainForTests();
    const rows = (await readGzJsonl(dir)) as Array<Record<string, unknown>>;
    const transitions = rows.filter((r) => r.eventKind === "SESSION_TRANSITION");
    expect(transitions.length).toBeGreaterThan(0);
    const blob = JSON.stringify(transitions);
    expect(blob).toMatch(/DISCONNECTED|RECONNECTING|CONNECTED|subscription/);
  }, 15_000);

  it("runtime heartbeat persists without market events", async () => {
    await rt.stop();
    const hbRt = new GoldHunterFastResearchCaptureRuntime({
      collectDir: join(dir, "hb"),
      permissionScope: "SCOPE_VIEW",
      heartbeatEveryMs: 40,
      sessionPollEveryMs: 60_000
    });
    await hbRt.start();
    hbRt.markScopeVerifiedForTests();
    await new Promise((r) => setTimeout(r, 180));
    await hbRt.drainForTests();
    const rows = (await readGzJsonl(join(dir, "hb"))) as Array<
      Record<string, unknown>
    >;
    const heartbeats = rows.filter((r) => r.eventKind === "HEARTBEAT");
    expect(heartbeats.length).toBeGreaterThanOrEqual(2);
    expect(hbRt.health().heartbeatsPersisted).toBeGreaterThanOrEqual(2);
    expect(hbRt.health().brokerOrders).toBe(0);
    expect(hbRt.health().shadowOrders).toBe(0);
    await hbRt.stop();
  }, 15_000);

  it("campaignMode without GCS is not campaignValid", async () => {
    await rt.stop();
    const campaignRt = new GoldHunterFastResearchCaptureRuntime({
      collectDir: join(dir, "campaign"),
      permissionScope: "SCOPE_VIEW",
      campaignMode: true,
      gcsBucket: null,
      heartbeatEveryMs: 10_000
    });
    await campaignRt.start();
    campaignRt.markScopeVerifiedForTests();
    campaignRt.ingestSpotForTests({ bid: 1, ask: 1.1 });
    campaignRt.ingestDepthForTests({ newQuotes: [] });
    await campaignRt.drainForTests();
    const h = campaignRt.health();
    expect(h.durableMode).toBe("LOCAL_BUFFER_ONLY");
    expect(h.campaignValid).toBe(false);
    expect(h.captureUnhealthyReasons).toContain("gcs_required_for_campaign");
    await campaignRt.stop();
  });

  it("emits no ENTER/EXIT across a large synthetic stream", async () => {
    const t0 = Date.now();
    for (let i = 0; i < 200; i++) {
      rt.ingestSpotForTests({
        bid: 2600 + (i % 50) * 0.01,
        ask: 2600.08 + (i % 50) * 0.01,
        brokerTimestampMs: t0 + i
      });
      if (i % 2 === 0) {
        rt.ingestDepthForTests({
          newQuotes: [
            {
              id: `b${i}`,
              type: "BID",
              price: 2600 + (i % 50) * 0.01,
              size: 2
            },
            {
              id: `a${i}`,
              type: "ASK",
              price: 2600.08 + (i % 50) * 0.01,
              size: 2
            }
          ]
        });
      }
    }
    await rt.drainForTests();
    const h = rt.health();
    expect(h.eventsReceived).toBeGreaterThan(100);
    expect(h.brokerRequests).toBe(0);
    expect(h.brokerOrders).toBe(0);
    expect(h.shadowOrders).toBe(0);
    expect(h.openShadowTrade).toBe(false);
    expect(h.executionAdapter).toBe("NONE");
    expect(h.permissionScope).toBe("SCOPE_VIEW");
    expect(h.mutationSurface).toBe("NONE");
    expect(h.mode).toBe("RESEARCH_CAPTURE_ONLY");
    expect(h.storagePrefix).toBe(GH_FAST_RESEARCH_GCS_PREFIX_ROOT);

    const rows = (await readGzJsonl(dir)) as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(50);
    const blob = JSON.stringify(rows);
    expect(blob).not.toMatch(/ENTER_BUY/);
    expect(blob).not.toMatch(/ENTER_SELL/);
    expect(blob).not.toMatch(/"tradeExit"/);
    expect(blob).not.toMatch(/openShadowTrade":true/);
  });

  it("ui design has no trading buttons", () => {
    const ui = rt.getBridge()!.uiDesign();
    expect(ui.subtitle).toContain("NO TRADING");
    expect(ui.tradingButtons).toEqual([]);
    expect(ui.safety.shadowOrders).toBe(0);
    expect(ui.safety.brokerOrders).toBe(0);
    expect(ui.safety.brokerRequests).toBe(0);
  });
});

describe("research module source hygiene (static sample)", () => {
  it("research sources do not import execution adapters", () => {
    const researchDir = join(
      process.cwd(),
      "src/services/microEdge/goldHunter/fast/research"
    );
    const files = readdirSync(researchDir).filter((f) => f.endsWith(".ts"));
    for (const f of files) {
      const text = readFileSync(join(researchDir, f), "utf8");
      expect(text).not.toMatch(/from\s+["'][^"']*executionAdapter["']/);
      expect(text).not.toMatch(/from\s+["'][^"']*\/engine["']/);
      expect(text).not.toMatch(/from\s+["'][^"']*\/liveBridge["']/);
      expect(text).not.toMatch(/import\s*\{[^}]*\bShadowExecutionAdapter\b/);
      expect(text).not.toMatch(/new\s+ShadowExecutionAdapter\b/);
      expect(text).not.toMatch(/new\s+GoldHunterFastEngine\b/);
      expect(text).not.toMatch(/import\s*\{[^}]*\bGoldHunterFastLiveBridge\b/);
      expect(text).not.toMatch(/\bsubmitOrder\b|\bplaceOrder\b|\bENTER_BUY\b|\bENTER_SELL\b|\btradeExit\b/);
    }
    for (const rel of [
      "src/services/microEdge/runtime/fastResearchCaptureRuntime.ts",
      "src/services/microEdge/runtime/fastResearchCaptureProcess.ts",
      "scripts/microEdge/runFastResearchCaptureRuntime.ts"
    ]) {
      const raw = readFileSync(join(process.cwd(), rel), "utf8");
      const text = raw
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(text).not.toMatch(/from\s+["'][^"']*executionAdapter["']/);
      expect(text).not.toMatch(/new\s+ShadowExecutionAdapter/);
      expect(text).not.toMatch(/from\s+["'][^"']*\/engine["']/);
      expect(text).not.toMatch(/from\s+["'][^"']*\/liveBridge["']/);
      expect(text).not.toMatch(
        /import\s*\{[^}]*\b(GoldHunterFastLiveBridge|GoldHunterFastEngine)\b/
      );
      expect(text).not.toMatch(
        /new\s+(GoldHunterFastLiveBridge|GoldHunterFastEngine)\b/
      );
      expect(text).not.toMatch(/\bsubmitOrder\b|\bplaceOrder\b|\bENTER_BUY\b|\bENTER_SELL\b|\btradeExit\b/);
    }
  });
});

describe("Phase 2B research process startup gate", () => {
  it("refuses construction without explicit research GCS bucket", async () => {
    const prev = process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET;
    delete process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET;
    const { GoldHunterFastResearchCaptureProcess } = await import(
      "../../../../src/services/microEdge/runtime/fastResearchCaptureProcess"
    );
    expect(
      () =>
        new GoldHunterFastResearchCaptureProcess({
          healthPort: 0
        })
    ).toThrow(/MISSING_GCS_BUCKET/);
    if (prev != null) process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET = prev;
  });

  it("liveCaptureStartupGate requires SCOPE_VIEW + GCS + fresh feeds + heartbeats", async () => {
    const { evaluateLiveCaptureStartupGate } = await import(
      "../../../../src/services/microEdge/runtime/fastResearchCaptureProcess"
    );
    const proof = {
      permissionScope: "SCOPE_VIEW" as const,
      source: "broker_authorization_response" as const,
      verifiedAt: new Date().toISOString(),
      accountCount: 1,
      environment: "DEMO",
      selectedAccountIdPresent: true
    };
    const healthy = evaluateCaptureHealth(
      baseHealthInput({
        campaignMode: true,
        durableMode: "GCS",
        heartbeatsPersisted: 5,
        sessionTransitionsPersisted: 2,
        scopeVerified: true
      })
    );
    // synthesize a ResearchCaptureHealth-like object for the gate
    const h = {
      mode: GH_FAST_RESEARCH_MODE,
      service: "gold-hunter-fast-research-capture" as const,
      processHealthy: true,
      captureHealthy: healthy.captureHealthy,
      serviceHealthy: healthy.serviceHealthy,
      dataIntegrityStatus: healthy.dataIntegrityStatus,
      campaignValid: healthy.campaignValid,
      scopeVerified: true,
      spotSubscribed: true,
      depthSubscribed: true,
      spotAgeMs: 100,
      depthAgeMs: 100,
      freshnessLimitMs: 20_000,
      eventsReceived: 10,
      eventsDropped: 0,
      queueDepth: 0,
      queueLatencyP50: 1,
      queueLatencyP95: 2,
      queueLatencyP99: 3,
      eventLoopLagP50: 1,
      eventLoopLagP95: 2,
      eventLoopLagP99: 3,
      feedGapCount: 0,
      reconnectCount: 0,
      resyncCount: 0,
      bookCrossedCount: 0,
      candidateA: 0,
      candidateB: 0,
      candidateC: 0,
      captureStart: new Date().toISOString(),
      captureDurationMs: 1000,
      runId: "r",
      datasetId: "d",
      schemaVersion: GH_FAST_RESEARCH_SCHEMA_VERSION,
      researchConfigSha: "sha",
      runtimeSha: null,
      brokerRequests: 0 as const,
      brokerOrders: 0 as const,
      shadowOrders: 0 as const,
      permissionScope: "SCOPE_VIEW" as const,
      mutationSurface: "NONE" as const,
      executionAdapter: "NONE" as const,
      openShadowTrade: false as const,
      connectionState: "CONNECTED" as const,
      storagePrefix: GH_FAST_RESEARCH_GCS_PREFIX_ROOT,
      durableMode: "GCS" as const,
      persistenceQueueDepth: 0,
      persistenceDroppedChunks: 0,
      persistenceDroppedRows: 0,
      chunksWritten: 1,
      chunksUploaded: 1,
      writeErrors: 0,
      uploadErrors: 0,
      healthWarning: null,
      captureUnhealthyReasons: [] as string[],
      heartbeatsPersisted: 5,
      sessionTransitionsPersisted: 2,
      disclaimer: "x"
    };
    expect(evaluateLiveCaptureStartupGate(h, proof).ok).toBe(true);
    expect(
      evaluateLiveCaptureStartupGate(h, null).ok
    ).toBe(false);
    expect(
      evaluateLiveCaptureStartupGate(
        { ...h, durableMode: "LOCAL_BUFFER_ONLY", campaignValid: false },
        proof
      ).ok
    ).toBe(false);
    expect(GH_FAST_RESEARCH_FORBIDDEN_GCS_PREFIX).toContain("live-shadow");
  });
});

describe("UTC date rollover + captureDayIndex", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "gh-rollover-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("captureDayIndexFromDates advances by calendar day", async () => {
    const { captureDayIndexFromDates, utcDateFromMs } = await import(
      "../../../../src/services/microEdge/goldHunter/fast/research/researchDurableSink"
    );
    expect(captureDayIndexFromDates("2026-08-14", "2026-08-14")).toBe(1);
    expect(captureDayIndexFromDates("2026-08-14", "2026-08-15")).toBe(2);
    expect(captureDayIndexFromDates("2026-08-14", "2026-08-16")).toBe(3);
    expect(utcDateFromMs(Date.parse("2026-08-14T23:59:59.000Z"))).toBe(
      "2026-08-14"
    );
    expect(utcDateFromMs(Date.parse("2026-08-15T00:00:01.000Z"))).toBe(
      "2026-08-15"
    );
  });

  it("does not split a chunk across UTC dates and writes per-day summaries", async () => {
    const { ResearchDurableSink } = await import(
      "../../../../src/services/microEdge/goldHunter/fast/research/researchDurableSink"
    );
    const observed: Array<{ date: string; dayIndex: number }> = [];
    const sink = new ResearchDurableSink({
      runId: "rollover_test",
      datasetId: "ds_rollover",
      researchConfigSha: "sha",
      captureStart: "2026-08-14T12:00:00.000Z",
      localDir: dir,
      chunkRows: 10,
      maxQueue: 50,
      campaignMode: false,
      gcsBucket: null,
      campaignStartUtcDate: "2026-08-14",
      onCaptureDateObserved: (date, dayIndex) => {
        observed.push({ date, dayIndex });
      }
    });

    const tDay1 = Date.parse("2026-08-14T22:00:00.000Z");
    const tDay2 = Date.parse("2026-08-15T01:00:00.000Z");
    for (let i = 0; i < 3; i++) {
      const r = fakeRecord(i + 1);
      r.t = tDay1 + i * 1000;
      r.eventKind = "SPOT";
      r.market = {
        kind: "SPOT",
        bid: 1,
        ask: 1.1,
        spread: 0.1,
        brokerTimestampMs: null
      };
      sink.enqueue(r);
    }
    // Cross UTC midnight — must seal day1 before accepting day2 in same chunk.
    for (let i = 0; i < 3; i++) {
      const r = fakeRecord(100 + i);
      r.t = tDay2 + i * 1000;
      r.eventKind = "DEPTH";
      r.market = {
        kind: "DEPTH",
        bestBid: 1,
        bestAsk: 1.1,
        depthAvailable: true,
        crossed: false,
        bookGeneration: 1,
        brokerTimestampMs: null
      };
      sink.enqueue(r);
    }
    await sink.finalizeCurrentDay();

    expect(observed.map((o) => o.date)).toEqual(["2026-08-14", "2026-08-15"]);
    expect(observed.map((o) => o.dayIndex)).toEqual([1, 2]);
    expect(existsSync(join(dir, "2026-08-14"))).toBe(true);
    expect(existsSync(join(dir, "2026-08-15"))).toBe(true);
    expect(existsSync(join(dir, "2026-08-14", "CAPTURE_DAY_SUMMARY.json"))).toBe(
      true
    );
    expect(existsSync(join(dir, "2026-08-15", "CAPTURE_DAY_SUMMARY.json"))).toBe(
      true
    );

    const sum1 = JSON.parse(
      readFileSync(join(dir, "2026-08-14", "CAPTURE_DAY_SUMMARY.json"), "utf8")
    );
    const sum2 = JSON.parse(
      readFileSync(join(dir, "2026-08-15", "CAPTURE_DAY_SUMMARY.json"), "utf8")
    );
    expect(sum1.captureDayIndex).toBe(1);
    expect(sum2.captureDayIndex).toBe(2);
    expect(sum1.spotEventCount).toBe(3);
    expect(sum2.depthEventCount).toBe(3);
    expect(sum1.validatedIndependentDays).toBe(0);
    expect(sum2.validatedIndependentDays).toBe(0);
    expect(typeof sum1.campaignDayEligibleForLaterValidation).toBe("boolean");
    expect(sum1.brokerOrders).toBe(0);
    expect(sum1.shadowOrders).toBe(0);
    expect(sum1.executionAdapter).toBe("NONE");

    // No chunk mixes dates
    for (const m of sink.manifests) {
      const dates = new Set(
        // reconstruct from start/end only — same UTC date required
        [m.startTs, m.endTs].map((t) =>
          new Date(t).toISOString().slice(0, 10)
        )
      );
      expect(dates.size).toBe(1);
      expect(m.captureUtcDate).toBe([...dates][0]);
    }
    expect(sink.stats().gcsPrefix).toContain("/2026-08-15");
    expect(sink.stats().gcsPrefix).not.toContain("live-shadow");
  });
});
