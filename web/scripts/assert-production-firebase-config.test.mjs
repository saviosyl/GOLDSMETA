import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = dirname(fileURLToPath(import.meta.url));
const script = join(root, "assert-production-firebase-config.mjs");

const run = (args, env = {}) =>
  spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, ...env },
    encoding: "utf8"
  });

describe("assert-production-firebase-config", () => {
  it("fails --env when VITE_FIREBASE_* are missing", () => {
    const res = run(["--env"], {
      VITE_FIREBASE_API_KEY: "",
      VITE_FIREBASE_AUTH_DOMAIN: "",
      VITE_FIREBASE_PROJECT_ID: "",
      VITE_FIREBASE_APP_ID: "",
      VITE_API_BASE_URL: ""
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/Missing required build\/runtime env/);
    expect(res.stderr).toMatch(/Configuration needed/);
  });

  it("passes --env when required vars are present", () => {
    const res = run(["--env"], {
      // Do not inherit a host production gate from the agent/CI shell.
      GOLD_META_PRODUCTION_GATE: "",
      VITE_FIREBASE_API_KEY: "test-api-key",
      VITE_FIREBASE_AUTH_DOMAIN: "example.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "example-project",
      VITE_FIREBASE_APP_ID: "1:000:web:test",
      VITE_API_BASE_URL: "http://127.0.0.1:8080"
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/PASS: required VITE_\* present/);
  });

  it("fails --production --env when project is not goldmeta-web", () => {
    const res = run(["--env", "--production"], {
      VITE_FIREBASE_API_KEY: "test-api-key",
      VITE_FIREBASE_AUTH_DOMAIN: "example.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "example-project",
      VITE_FIREBASE_APP_ID: "1:000:web:test",
      VITE_API_BASE_URL: "http://127.0.0.1:8080"
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/goldmeta-web/);
  });
});
