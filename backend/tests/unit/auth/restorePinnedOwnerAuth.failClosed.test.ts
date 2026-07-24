import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

const script = path.resolve(__dirname, "../../../scripts/restorePinnedOwnerAuth.ts");

describe("restorePinnedOwnerAuth fail-closed", () => {
  it("refuses to run without break-glass approval env", () => {
    const result = spawnSync(
      "npx",
      ["tsx", script],
      {
        env: {
          ...process.env,
          GOLDMETA_BREAK_GLASS_AUTH_RESTORE: "",
          GOLDMETA_PINNED_OWNER_UID: "IwlS1UKACOUoYhm9TkcoQk6Ow4C2",
          GOLDMETA_OWNER_EMAIL: "saviosyl@gmail.com",
          GOLDMETA_TEMP_PASSWORD_FILE: "/tmp/should-not-write-owner-pw",
          // Prevent accidental ADC use mutating anything if approval were wrong.
          GOOGLE_APPLICATION_CREDENTIALS: "/tmp/missing-adc.json"
        },
        encoding: "utf8"
      }
    );
    expect(result.status).not.toBe(0);
    const out = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    expect(out).toMatch(/BREAK_GLASS_NOT_APPROVED|RESTORE_FAIL/);
    expect(out).not.toMatch(/TEMP_PASSWORD_FILE=written/);
    expect(out).not.toMatch(/PINNED_CREATED=yes/);
  });

  it("refuses when password file path is missing even with approval", () => {
    const result = spawnSync("npx", ["tsx", script], {
      env: {
        ...process.env,
        GOLDMETA_BREAK_GLASS_AUTH_RESTORE: "YES_I_APPROVE_PINNED_OWNER_RESTORE",
        GOLDMETA_PINNED_OWNER_UID: "IwlS1UKACOUoYhm9TkcoQk6Ow4C2",
        GOLDMETA_OWNER_EMAIL: "saviosyl@gmail.com",
        GOLDMETA_TEMP_PASSWORD_FILE: "",
        GOOGLE_APPLICATION_CREDENTIALS: "/tmp/missing-adc.json"
      },
      encoding: "utf8"
    });
    expect(result.status).not.toBe(0);
    const out = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    expect(out).toMatch(/TEMP_PASSWORD_FILE|RESTORE_FAIL/);
    expect(out).not.toMatch(/REPLACEMENT_DELETED=/);
  });
});
