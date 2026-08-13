/**
 * Measure real event→decision latency for GOLD_HUNTER FAST (shadow-only).
 */
import {
  GoldHunterFastEngine,
  ShadowExecutionAdapter,
  defaultGhFastConfig
} from "../../src/services/microEdge/goldHunter/fast";

async function main(): Promise<void> {
  const cfg = defaultGhFastConfig({
    minSetupQuality: 0.2,
    momentumVelMin: 0.00002,
    friction: 0.001,
    safetyBuffer: 0.001
  });
  const adapter = new ShadowExecutionAdapter();
  const engine = new GoldHunterFastEngine({ config: cfg, adapter });
  const BASE = 2400;
  const t0 = 8_000_000;
  await engine.onMarketEvent({
    kind: "DEPTH",
    receivedAtMs: t0,
    brokerTimestampMs: t0,
    newQuotes: [
      { id: "b1", type: "BID", price: BASE, size: 100 },
      { id: "a1", type: "ASK", price: BASE + 0.12, size: 80 }
    ]
  });
  for (let i = 0; i < 400; i++) {
    const t = t0 + i * 20;
    const mid = BASE + i * 0.03;
    await engine.onMarketEvent({
      kind: "SPOT",
      receivedAtMs: t,
      brokerTimestampMs: t,
      bid: mid - 0.05,
      ask: mid + 0.05
    });
    if (i % 4 === 0) {
      await engine.onMarketEvent({
        kind: "DEPTH",
        receivedAtMs: t + 1,
        brokerTimestampMs: t + 1,
        newQuotes: [
          { id: "b1", type: "BID", price: mid - 0.05, size: 120 },
          {
            id: "a1",
            type: "ASK",
            price: mid + 0.05,
            size: Math.max(5, 70 - i)
          }
        ],
        deletedQuotes: i > 20 ? [{ id: "a2" }] : []
      });
    }
  }
  const p = engine.latency.percentiles();
  console.log(
    JSON.stringify(
      {
        event: "gh_fast_latency_probe",
        latency: p,
        shadowOrders: adapter.orders.length,
        closed: engine.closed.length,
        brokerRequests: 0,
        brokerOrders: 0,
        mutationSurface: "NONE",
        targets: { p50: 20, p95: 50 }
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
