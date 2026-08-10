/**
 * Guards the production failure mode where Firebase Functions ran stale dist/
 * while src/ contained Demo Auto reconcile / authority fixes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const backendRoot = resolve(__dirname, "../../../../");

describe("Demo Auto dist deploy guard", () => {
  it("package main points at dist (Cloud Functions runtime entry)", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(backendRoot, "package.json"), "utf8")
    ) as { main?: string };
    expect(pkg.main).toBe("dist/index.js");
  });

  it("firebase.json rebuilds dist before functions deploy", () => {
    const fb = JSON.parse(
      readFileSync(resolve(backendRoot, "firebase.json"), "utf8")
    ) as {
      functions?: Array<{ predeploy?: string[] }> | { predeploy?: string[] };
    };
    const fns = Array.isArray(fb.functions) ? fb.functions[0] : fb.functions;
    const hooks = fns?.predeploy ?? [];
    expect(hooks.some((h) => h.includes("run build"))).toBe(true);
  });

  it("built dist includes open-position reconcile (fail if deploy skipped build)", () => {
    const reconcileJs = resolve(
      backendRoot,
      "dist/services/broker/ctrader/openPositionReconcile.js"
    );
    const indexJs = resolve(backendRoot, "dist/index.js");
    expect(existsSync(reconcileJs)).toBe(true);
    expect(existsSync(indexJs)).toBe(true);
    const index = readFileSync(indexJs, "utf8");
    expect(index).toContain("manage_demo_positions_pass");
    const reconcile = readFileSync(reconcileJs, "utf8");
    expect(reconcile).toContain("reconcileDemoOpenPositionCounters");
    expect(reconcile).toContain("backfillLifecycleFromBroker");
  });
});
