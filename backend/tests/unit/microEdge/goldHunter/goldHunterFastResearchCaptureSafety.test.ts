/**
 * GOLD_HUNTER FAST research capture — safety + telemetry tests.
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
import { ResearchFeaturePipeline } from "../../../../src/services/microEdge/goldHunter/fast/research/researchFeaturePipeline";
import { ResearchIngestBridge } from "../../../../src/services/microEdge/goldHunter/fast/research/researchIngestBridge";
import {
  GH_FAST_RESEARCH_FORBIDDEN_GCS_PREFIX,
  GH_FAST_RESEARCH_GCS_PREFIX_ROOT,
  GH_FAST_RESEARCH_MODE,
  GH_FAST_RESEARCH_SCHEMA_VERSION
} from "../../../../src/services/microEdge/goldHunter/fast/research/researchTypes";
import { GoldHunterFastResearchCaptureRuntime } from "../../../../src/services/microEdge/runtime/fastResearchCaptureRuntime";

async function readGzJsonl(dir: string): Promise<unknown[]> {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".ndjson.gz"))
    .sort();
  const rows: unknown[] = [];
  for (const file of files) {
    const stream = createReadStream(join(dir, file)).pipe(createGunzip());
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      rows.push(JSON.parse(line));
    }
  }
  return rows;
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
    expect(existsSync(join(dir, "chunk-00000.ndjson.gz.manifest.json"))).toBe(
      true
    );
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
});

describe("research capture runtime", () => {
  let dir: string;
  let rt: GoldHunterFastResearchCaptureRuntime;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "gh-research-rt-"));
    rt = new GoldHunterFastResearchCaptureRuntime({
      collectDir: dir,
      permissionScope: "SCOPE_VIEW",
      heartbeatEveryMs: 50
    });
    await rt.start();
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
    const runtime = readFileSync(
      join(
        process.cwd(),
        "src/services/microEdge/runtime/fastResearchCaptureRuntime.ts"
      ),
      "utf8"
    );
    expect(runtime).not.toMatch(/from\s+["'][^"']*executionAdapter["']/);
    expect(runtime).not.toMatch(/new\s+ShadowExecutionAdapter/);
    expect(runtime).not.toMatch(/from\s+["'][^"']*\/engine["']/);
    expect(runtime).not.toMatch(/\bsubmitOrder\b|\bplaceOrder\b|\bENTER_BUY\b|\bENTER_SELL\b|\btradeExit\b/);
  });
});
