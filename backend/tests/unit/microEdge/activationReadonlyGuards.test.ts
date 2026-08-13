import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MicroCTraderReadOnlyClient } from "../../../src/services/microEdge/marketData/microCTraderClient";
import { MicroLiveCollectorWorker } from "../../../src/services/microEdge/runtime/liveCollectorWorker";
import { MicroLiveMarketSession } from "../../../src/services/microEdge/marketData/liveSession";
import { RealMicroCTraderTransport } from "../../../src/services/microEdge/marketData/microCTraderTransport";
import { MICRO_ALLOWED_READ_COMMANDS } from "../../../src/services/microEdge/marketData/microCTraderProtocol";
import { MemoryMicroMarketDataStore } from "../../../src/services/microEdge/marketData/marketDataStore";

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.ts$/.test(name)) acc.push(p);
  }
  return acc;
}

function publicMethodNames(obj: object): string[] {
  const names = new Set<string>();
  let proto: object | null = obj;
  while (proto && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === "constructor") continue;
      const desc = Object.getOwnPropertyDescriptor(proto, key);
      if (desc && typeof desc.value === "function") names.add(key);
    }
    proto = Object.getPrototypeOf(proto);
  }
  return [...names];
}

describe("Micro activation read-only guards", () => {
  it("protocol allowlist is read-only and includes GetTickData", () => {
    expect(MICRO_ALLOWED_READ_COMMANDS.has("ProtoOAGetTickDataReq")).toBe(true);
    expect(MICRO_ALLOWED_READ_COMMANDS.has("ProtoOAGetTrendbarsReq")).toBe(true);
    for (const cmd of MICRO_ALLOWED_READ_COMMANDS) {
      expect(cmd.toLowerCase()).not.toContain("neworder");
      expect(cmd.toLowerCase()).not.toContain("closeposition");
      expect(cmd.toLowerCase()).not.toContain("amend");
      expect(cmd.toLowerCase()).not.toContain("cancelorder");
    }
  });

  it("runtime public methods contain no order/mutation verbs", () => {
    const banned = [
      "order",
      "executetrade",
      "submittrade",
      "closeposition",
      "amendposition",
      "cancelorder",
      "modifyposition"
    ];
    const targets: object[] = [
      new MicroCTraderReadOnlyClient(),
      new MicroLiveCollectorWorker({ store: new MemoryMicroMarketDataStore() }),
      Object.create(MicroLiveMarketSession.prototype),
      Object.create(RealMicroCTraderTransport.prototype)
    ];
    for (const t of targets) {
      for (const name of publicMethodNames(t)) {
        const lower = name.toLowerCase();
        for (const b of banned) {
          expect(lower.includes(b)).toBe(false);
        }
      }
    }
  });

  it("HISTORICAL_TICKS is no longer FEATURE_GATED", () => {
    const c = new MicroCTraderReadOnlyClient();
    expect(c.capabilityStates().HISTORICAL_TICKS).not.toBe("FEATURE_GATED");
    expect(c.mutationSurface).toBe("NONE");
  });

  it("micro source has no Core token env reads", () => {
    const root = join(process.cwd(), "src/services/microEdge");
    const files = walk(root);
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(text).not.toMatch(/process\.env\.CTRADER_ACCESS_TOKEN/);
      expect(text).not.toMatch(/process\.env\.CTRADER_REFRESH_TOKEN/);
    }
  });

  it("collector worker mutationSurface is NONE", () => {
    const w = new MicroLiveCollectorWorker();
    expect(w.mutationSurface).toBe("NONE");
  });
});
