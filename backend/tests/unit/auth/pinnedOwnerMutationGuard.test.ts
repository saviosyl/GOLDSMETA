import { describe, expect, it } from "vitest";
import {
  assertPinnedOwnerMutationAllowed,
  isBreakGlassOwnerMutationAllowed,
  isPinnedOwnerEmail,
  isPinnedOwnerUid,
  PinnedOwnerMutationBlockedError
} from "../../../src/services/auth/pinnedOwnerMutationGuard";

const PINNED = "IwlS1UKACOUoYhm9TkcoQk6Ow4C2";
const OWNER = "saviosyl@gmail.com";

describe("pinnedOwnerMutationGuard", () => {
  it("blocks delete of pinned UID without break-glass", () => {
    expect(() =>
      assertPinnedOwnerMutationAllowed({
        mutation: "DELETE",
        targetUid: PINNED,
        source: { GOLDMETA_PINNED_OWNER_UID: PINNED, GOLDMETA_OWNER_EMAIL: OWNER }
      })
    ).toThrow(PinnedOwnerMutationBlockedError);
  });

  it("blocks email rename of owner email without break-glass", () => {
    expect(() =>
      assertPinnedOwnerMutationAllowed({
        mutation: "EMAIL_RENAME",
        targetEmail: "  SavioSyl@gmail.com ",
        source: { GOLDMETA_PINNED_OWNER_UID: PINNED, GOLDMETA_OWNER_EMAIL: OWNER }
      })
    ).toThrow(/PINNED_OWNER|Refusing EMAIL_RENAME/);
  });

  it("allows delete of non-owner subjects", () => {
    expect(() =>
      assertPinnedOwnerMutationAllowed({
        mutation: "DELETE",
        targetUid: "randomUidNotPinned00000000001",
        targetEmail: "other@example.com",
        source: { GOLDMETA_PINNED_OWNER_UID: PINNED, GOLDMETA_OWNER_EMAIL: OWNER }
      })
    ).not.toThrow();
  });

  it("allows pinned mutation only with both break-glass flags", () => {
    expect(
      isBreakGlassOwnerMutationAllowed({
        GOLDMETA_BREAK_GLASS_OWNER_AUTH_MUTATION: "1"
      })
    ).toBe(false);
    expect(
      isBreakGlassOwnerMutationAllowed({
        GOLDMETA_BREAK_GLASS_OWNER_AUTH_MUTATION: "1",
        GOLDMETA_BREAK_GLASS_OWNER_AUTH_CONFIRM: "I_UNDERSTAND_PINNED_OWNER_MUTATION"
      })
    ).toBe(true);

    expect(() =>
      assertPinnedOwnerMutationAllowed({
        mutation: "DISABLE",
        targetUid: PINNED,
        source: {
          GOLDMETA_PINNED_OWNER_UID: PINNED,
          GOLDMETA_OWNER_EMAIL: OWNER,
          GOLDMETA_BREAK_GLASS_OWNER_AUTH_MUTATION: "1",
          GOLDMETA_BREAK_GLASS_OWNER_AUTH_CONFIRM: "I_UNDERSTAND_PINNED_OWNER_MUTATION"
        }
      })
    ).not.toThrow();
  });

  it("recognises pinned uid/email helpers", () => {
    const source = { GOLDMETA_PINNED_OWNER_UID: PINNED, GOLDMETA_OWNER_EMAIL: OWNER };
    expect(isPinnedOwnerUid(PINNED, source)).toBe(true);
    expect(isPinnedOwnerUid("other", source)).toBe(false);
    expect(isPinnedOwnerEmail("SavioSyl@gmail.com", source)).toBe(true);
    expect(isPinnedOwnerEmail("x@y.com", source)).toBe(false);
  });
});
