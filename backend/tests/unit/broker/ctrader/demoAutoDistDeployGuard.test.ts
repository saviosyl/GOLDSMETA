/**
 * Guards the production failure mode where Firebase Functions ran stale dist/
 * while src/ contained Demo Auto reconcile / authority fixes.
 *
 * CI runs unit tests before `npm run build`, and dist/ is gitignored — so this
 * suite asserts deploy contracts + source presence, not a prebuilt dist tree.
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

  it("retired Core/FAST scheduler no longer scans or submits", () => {
    const indexTs = resolve(backendRoot, "src/index.ts");
    expect(existsSync(indexTs)).toBe(true);
    const index = readFileSync(indexTs, "utf8");
    expect(index).toContain("manage_demo_positions_retired");
    expect(index).toContain("decision_autotrade_retired");
    expect(index).not.toContain("runFastAutoTradeScanPass");
    expect(index).not.toContain("processDecisionForQualification");
    expect(index).not.toContain("processDecisionForAutoTrade");
  });
});
