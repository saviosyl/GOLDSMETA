import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  filterDisposableCleanupCandidates,
  getOwnerCleanupExclusion,
  isOwnerRestoreScriptPath
} from "../../../src/services/auth/ownerCleanupGuard";
import { PinnedOwnerMutationBlockedError } from "../../../src/services/auth/pinnedOwnerMutationGuard";

/** Fixture only — not a production UID. */
const PINNED = "testPinnedOwnerUid000000000001";
const OWNER = "saviosyl@gmail.com";
const ENV = {
  GOLDMETA_PINNED_OWNER_UID: PINNED,
  GOLDMETA_OWNER_EMAIL: OWNER
};

function listFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) listFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

describe("deploy must not restore / cleanup owner", () => {
  it("identifies restore script path", () => {
    expect(isOwnerRestoreScriptPath("backend/scripts/restorePinnedOwnerAuth.ts")).toBe(true);
    expect(isOwnerRestoreScriptPath("scripts/verifyOwnerAuthIntegrity.ts")).toBe(false);
  });

  it("CI workflows do not invoke restorePinnedOwnerAuth.ts", () => {
    const workflowsDir = path.resolve(__dirname, "../../../../.github/workflows");
    const files = listFiles(workflowsDir).filter((f) => /\.ya?ml$/i.test(f));
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      // Actual invocation patterns only.
      if (
        /tsx\s+scripts\/restorePinnedOwnerAuth/.test(text) ||
        /npm\s+run\s+[^\n]*restore[^\n]*owner/i.test(text) ||
        /npx\s+tsx\s+[^\n]*restorePinnedOwnerAuth\.ts/.test(text)
      ) {
        offenders.push(path.relative(workflowsDir, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("excludes pinned UID, owner email, OWNER role, owner claim from cleanup", () => {
    expect(getOwnerCleanupExclusion({ uid: PINNED }, ENV)).toBe("PINNED_OWNER_UID");
    expect(getOwnerCleanupExclusion({ email: OWNER }, ENV)).toBe("OWNER_EMAIL");
    expect(getOwnerCleanupExclusion({ role: "OWNER" }, ENV)).toBe("OWNER_ROLE");
    expect(getOwnerCleanupExclusion({ ownerClaim: true }, ENV)).toBe("OWNER_CLAIM");
    expect(
      getOwnerCleanupExclusion(
        { uid: "otherUid123456789012345678", email: "gm.disposable@example.com", role: "USER_PENDING" },
        ENV
      )
    ).toBeNull();

    const filtered = filterDisposableCleanupCandidates(
      [
        { uid: PINNED, email: OWNER, role: "OWNER" },
        { uid: "disposableUid1234567890123", email: "gm.disposable@example.com", role: "USER_PENDING" }
      ],
      ENV
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.email).toBe("gm.disposable@example.com");
  });

  it("cleanup of owner fails closed without break-glass", async () => {
    const { assertCleanupCandidateAllowed } = await import(
      "../../../src/services/auth/ownerCleanupGuard"
    );
    expect(() =>
      assertCleanupCandidateAllowed({ uid: PINNED, email: OWNER }, ENV)
    ).toThrow(PinnedOwnerMutationBlockedError);
  });
});
