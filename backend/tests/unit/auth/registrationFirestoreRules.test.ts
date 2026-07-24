/**
 * Firestore rules contract for registration / roles / broker isolation.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const rules = readFileSync(resolve(__dirname, "../../../firestore.rules"), "utf8");

describe("registration Firestore rules contract", () => {
  it("defines staff and pending helpers", () => {
    expect(rules).toMatch(/function isStaff\(\)/);
    expect(rules).toMatch(/function isPending\(\)/);
    expect(rules).toMatch(/claimRole\(\)/);
  });

  it("keeps profile documents client-read / server-write only", () => {
    expect(rules).toMatch(/match \/profile\/\{document=\*\*\}/);
    const profileIdx = rules.indexOf("match /profile/{document=**}");
    const slice = rules.slice(profileIdx, profileIdx + 220);
    expect(slice).toMatch(/allow write:\s*if false/);
    expect(slice).toMatch(/allow read:\s*if isOwner\(userId\)/);
  });

  it("prevents pending users from reading broker and webhook data", () => {
    expect(rules).toMatch(/brokerSettings\/\{document=\*\*\}[\s\S]*!isPending\(\)/);
    expect(rules).toMatch(/brokerConnections\/\{document=\*\*\}[\s\S]*!isPending\(\)/);
    expect(rules).toMatch(/webhookConnections\/\{webhookId\}[\s\S]*!isPending\(\)/);
  });

  it("keeps userDirectory and adminAudit client-write denied", () => {
    expect(rules).toMatch(/match \/userDirectory\/\{userId\}[\s\S]*allow write:\s*if false/);
    expect(rules).toMatch(/match \/adminAudit\/\{eventId\}[\s\S]*allow write:\s*if false/);
  });

  it("never allows client role writes on users root", () => {
    const usersBlock = rules.match(/match \/users\/\{userId\} \{[\s\S]*?allow create, update, delete: if false;/);
    expect(usersBlock).toBeTruthy();
  });
});
