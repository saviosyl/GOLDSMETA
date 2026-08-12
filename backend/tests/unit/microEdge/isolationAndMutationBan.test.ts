import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MICRO_NAMESPACE, assertMicroShadowOnly } from "../../../src/services/microEdge/config";
import { MicroCTraderReadOnlyClient } from "../../../src/services/microEdge/marketData/microCTraderClient";
import { runMicroPredictionCycle } from "../../../src/services/microEdge/runtime/predictionWorker";
import { MemoryMicroEdgeStore } from "../../../src/services/microEdge/storage/firestoreMicroEdgeStore";
import { buildQuote } from "../../../src/services/microEdge/marketData/quoteRepository";
import type { MicroBar } from "../../../src/services/microEdge/types";

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.ts$/.test(name)) acc.push(p);
  }
  return acc;
}

describe("Micro Edge isolation + mutation ban", () => {
  it("fail-closed when MICRO_BROKER_EXECUTION_ENABLED=true", () => {
    expect(() =>
      assertMicroShadowOnly({ MICRO_BROKER_EXECUTION_ENABLED: "true" } as NodeJS.ProcessEnv)
    ).toThrow(/SHADOW ONLY|FAIL_CLOSED/i);
  });

  it("read-only client has no mutation surface", () => {
    const c = new MicroCTraderReadOnlyClient();
    expect(c.mutationSurface).toBe("NONE");
    expect(typeof (c as unknown as { createOrder?: unknown }).createOrder).toBe(
      "undefined"
    );
    expect(typeof (c as unknown as { closePosition?: unknown }).closePosition).toBe(
      "undefined"
    );
  });

  it("prediction cycle performs zero broker mutations (no order methods exist)", async () => {
    const store = new MemoryMicroEdgeStore();
    const end = Date.parse("2026-08-12T08:00:00.000Z");
    const m1: MicroBar[] = [];
    let px = 2100;
    for (let i = 0; i < 40; i++) {
      const closeTimeMs = end - (39 - i) * 60_000;
      m1.push({
        timeframe: "M1",
        openTimeMs: closeTimeMs - 60_000,
        closeTimeMs,
        open: px,
        high: px + 0.3,
        low: px - 0.3,
        close: px + 0.05,
        tickVolume: 10
      });
      px += 0.05;
    }
    const mutations: string[] = [];
    const proxyStore = new Proxy(store, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver);
        if (typeof v === "function") {
          return (...args: unknown[]) => {
            // Track store writes only — no broker channel exists.
            return (v as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return v;
      }
    });
    await runMicroPredictionCycle({
      store: proxyStore,
      candleCloseEpochMs: end,
      m1,
      m5: [],
      m15: [],
      quote: buildQuote({
        bid: px,
        ask: px + 0.15,
        brokerTimestamp: new Date(end).toISOString(),
        nowMs: end,
        freshness: "LIVE"
      }),
      spreadHistory: [0.15]
    });
    expect(mutations).toEqual([]);
    expect(store.predictions.size).toBe(1);
  });

  it("store namespace constant is Micro-only", () => {
    expect(MICRO_NAMESPACE.startsWith("microEdge/")).toBe(true);
    expect(MICRO_NAMESPACE.includes("autotrade")).toBe(false);
    expect(MICRO_NAMESPACE.includes("qualification")).toBe(false);
  });

  it("microEdge source contains none of the forbidden ProtoOA mutation tokens", () => {
    const root = join(process.cwd(), "src/services/microEdge");
    const files = walk(root);
    const banned = [
      "ProtoOANewOrderReq",
      "ProtoOAAmendOrderReq",
      "ProtoOACancelOrderReq",
      "ProtoOAClosePositionReq"
    ];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const token of banned) {
        expect(text.includes(token), `${f} contains ${token}`).toBe(false);
      }
      // Ban real imports / requires — comments documenting isolation are allowed.
      expect(/from\s+["'][^"']*services\/broker\/ctrader/.test(text)).toBe(false);
      expect(/from\s+["'][^"']*services\/autoTrade/.test(text)).toBe(false);
      expect(/require\(\s*["'][^"']*services\/broker\/ctrader/.test(text)).toBe(
        false
      );
      expect(/require\(\s*["'][^"']*services\/autoTrade/.test(text)).toBe(false);
    }
  });
});
