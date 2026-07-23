/**
 * Firestore rules contract for Trading 212 owner collections.
 * Asserts client writes are denied in rules source (Admin SDK bypasses rules).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const rules = readFileSync(resolve(__dirname, "../../../firestore.rules"), "utf8");

function extractMatch(blockName: string): string {
  const re = new RegExp(
    `match /${blockName}/\\{document=\\*\\*\\} \\{[\\s\\S]*?\\n\\s*\\}`,
    "m"
  );
  const m = rules.match(re);
  if (!m) throw new Error(`Missing rules match for ${blockName}`);
  return m[0];
}

describe("T212 Firestore rules contract", () => {
  it.each([
    "brokerSelection",
    "t212SelectedInstrument",
    "t212Proposals",
    "t212ProposalIdempotency",
    "autoTradeT212Preview"
  ])("denies client writes for %s", (name) => {
    const block = extractMatch(name);
    expect(block).toMatch(/allow write:\s*if false/);
  });

  it("allows owner read for brokerSelection / instrument / proposals", () => {
    for (const name of ["brokerSelection", "t212SelectedInstrument", "t212Proposals"]) {
      const block = extractMatch(name);
      expect(block).toMatch(/allow read:\s*if isOwner\(userId\)/);
    }
  });

  it("keeps idempotency index fully client-denied", () => {
    const block = extractMatch("t212ProposalIdempotency");
    expect(block).toMatch(/allow read:\s*if false/);
    expect(block).toMatch(/allow write:\s*if false/);
  });
});
