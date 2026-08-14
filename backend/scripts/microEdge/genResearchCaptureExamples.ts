import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, createReadStream, readdirSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { GoldHunterFastResearchCaptureRuntime } from "../../src/services/microEdge/runtime/fastResearchCaptureRuntime";

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "gh-ex-"));
  const rt = new GoldHunterFastResearchCaptureRuntime({
    collectDir: dir,
    permissionScope: "SCOPE_VIEW"
  });
  await rt.start();
  const t0 = Date.now();
  for (let i = 0; i < 30; i++) {
    rt.ingestSpotForTests({
      bid: 2700 + i * 0.01,
      ask: 2700.08 + i * 0.01,
      brokerTimestampMs: t0 + i
    });
    if (i % 2 === 0) {
      rt.ingestDepthForTests({
        newQuotes: [
          { id: i, type: "BID", price: 2700 + i * 0.01, size: 1 },
          { id: 100 + i, type: "ASK", price: 2700.08 + i * 0.01, size: 1 }
        ]
      });
    }
  }
  const bridge = rt.getBridge();
  if (!bridge) throw new Error("no bridge");
  bridge.recordHeartbeatLag(5);
  bridge.noteResync("example");
  await rt.drainForTests();
  const h = rt.health();
  const out =
    "src/services/microEdge/goldHunter/fast/artifacts/v2-phase2a-research-collector";
  writeFileSync(join(out, "HEALTH_EXAMPLE.json"), JSON.stringify(h, null, 2));
  writeFileSync(
    join(out, "UI_DESIGN_EXAMPLE.json"),
    JSON.stringify(bridge.uiDesign(), null, 2)
  );

  const files = readdirSync(dir).filter((f) => f.endsWith(".ndjson.gz")).sort();
  const rows: Array<Record<string, unknown>> = [];
  for (const file of files) {
    const stream = createReadStream(join(dir, file)).pipe(createGunzip());
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (line.trim()) rows.push(JSON.parse(line) as Record<string, unknown>);
    }
  }
  const withSpec = rows.find((r) => Array.isArray(r.specialists));
  const withSpot = rows.find((r) => r.eventKind === "SPOT");
  writeFileSync(
    join(out, "ABC_TELEMETRY_EXAMPLE.json"),
    JSON.stringify(withSpec?.specialists ?? [], null, 2)
  );
  writeFileSync(
    join(out, "TRANSPORT_TIMESTAMP_EXAMPLE.json"),
    JSON.stringify(withSpot?.transport ?? {}, null, 2)
  );
  await rt.stop();
  await rm(dir, { recursive: true, force: true });
  console.log(
    JSON.stringify(
      {
        events: h.eventsReceived,
        adapter: h.executionAdapter,
        prefix: h.storagePrefix,
        brokers: h.brokerOrders,
        shadow: h.shadowOrders
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
