import { describe, expect, it } from "vitest";
import {
  evaluateOwnerWebhookHealth,
  maskWebhookId
} from "../../../src/services/auth/ownerWebhookHealth";
import { checkOwnerAuthIntegrity } from "../../../src/services/auth/authIntegrity";
import { maskUid } from "../../../src/services/auth/ownerAuthConfig";

const PINNED = "testPinnedOwnerUid000000000001";
const REPLACEMENT = "replacementOwnerUid00000000002";
const OWNER = "saviosyl@gmail.com";
const OLD = "Uho-1w-0uoxjFkJh85oewbuu";
const ACTIVE = "gm-webhook-active-mye3YoQ_";

describe("maskWebhookId", () => {
  it("redacts webhook ids", () => {
    expect(maskWebhookId(ACTIVE)).toBe("gm-w…YoQ_");
    expect(JSON.stringify({ id: maskWebhookId(ACTIVE) })).not.toContain(ACTIVE);
  });
});

describe("evaluateOwnerWebhookHealth", () => {
  it("PASS: old webhook revoked + new webhook active on pinned UID", () => {
    const result = evaluateOwnerWebhookHealth({
      pinnedOwnerUid: PINNED,
      pinnedWebhooks: [
        { webhookId: OLD, status: "REVOKED", userId: PINNED },
        { webhookId: ACTIVE, status: "ACTIVE", userId: PINNED }
      ]
    });
    expect(result.ok).toBe(true);
    expect(result.code).toBe("ACTIVE_WEBHOOK_ON_PINNED");
    expect(result.activeCountOnPinned).toBe(1);
    expect(result.revokedIgnoredCount).toBe(1);
    expect(result.activeWebhookIdRedacted).toBe(maskWebhookId(ACTIVE));
    expect(JSON.stringify(result)).not.toContain(ACTIVE);
    expect(JSON.stringify(result)).not.toContain(OLD);
  });

  it("FAIL: only revoked webhook exists", () => {
    const result = evaluateOwnerWebhookHealth({
      pinnedOwnerUid: PINNED,
      pinnedWebhooks: [{ webhookId: OLD, status: "REVOKED", userId: PINNED }]
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("NO_ACTIVE_WEBHOOK");
  });

  it("FAIL: active webhook belongs to replacement UID", () => {
    const result = evaluateOwnerWebhookHealth({
      pinnedOwnerUid: PINNED,
      pinnedWebhooks: [{ webhookId: OLD, status: "REVOKED", userId: PINNED }],
      foreignActiveOwnerWebhooks: [
        { webhookId: ACTIVE, status: "ACTIVE", userId: REPLACEMENT }
      ]
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("ACTIVE_OWNER_WEBHOOK_ON_OTHER_UID");
  });

  it("PASS: multiple historical revoked webhooks + one pinned active webhook", () => {
    const result = evaluateOwnerWebhookHealth({
      pinnedOwnerUid: PINNED,
      pinnedWebhooks: [
        { webhookId: "hist-1-85oewbuu", status: "REVOKED", userId: PINNED },
        { webhookId: "hist-2-oldsuffix", status: "REVOKED", userId: PINNED },
        { webhookId: ACTIVE, status: "ACTIVE", userId: PINNED }
      ]
    });
    expect(result.ok).toBe(true);
    expect(result.revokedIgnoredCount).toBe(2);
    expect(result.activeCountOnPinned).toBe(1);
  });

  it("PASS: canonical ACTIVE webhook on pinned UID", () => {
    const result = evaluateOwnerWebhookHealth({
      pinnedOwnerUid: PINNED,
      canonicalWebhookId: ACTIVE,
      pinnedWebhooks: [
        { webhookId: OLD, status: "REVOKED", userId: PINNED },
        { webhookId: ACTIVE, status: "ACTIVE", userId: PINNED }
      ]
    });
    expect(result.ok).toBe(true);
    expect(result.code).toBe("CANONICAL_ACTIVE_ON_PINNED");
  });

  it("FAIL: canonical webhook owned by other UID", () => {
    const result = evaluateOwnerWebhookHealth({
      pinnedOwnerUid: PINNED,
      canonicalWebhookId: ACTIVE,
      pinnedWebhooks: [{ webhookId: OLD, status: "REVOKED", userId: PINNED }],
      foreignActiveOwnerWebhooks: [
        { webhookId: ACTIVE, status: "ACTIVE", userId: REPLACEMENT }
      ]
    });
    expect(result.ok).toBe(false);
    expect(["CANONICAL_OWNED_BY_OTHER", "ACTIVE_OWNER_WEBHOOK_ON_OTHER_UID"]).toContain(
      result.code
    );
  });

  it("does not fail merely because an old revoked webhook exists", () => {
    const result = evaluateOwnerWebhookHealth({
      pinnedOwnerUid: PINNED,
      pinnedWebhooks: [
        { webhookId: OLD, status: "REVOKED", userId: PINNED },
        { webhookId: ACTIVE, status: "ACTIVE", userId: PINNED }
      ]
    });
    expect(result.ok).toBe(true);
    expect(result.notes.join(" ")).toMatch(/Ignored 1 revoked/i);
  });
});

describe("checkOwnerAuthIntegrity webhook ownership", () => {
  it("HEALTHY + webhookOwnedByOriginal when revoked history + active pinned webhook", async () => {
    const result = await checkOwnerAuthIntegrity({
      config: { ownerEmail: OWNER, pinnedOwnerUid: PINNED },
      auth: {
        getUserByEmail: async () => ({ uid: PINNED, email: OWNER }),
        getUser: async () => ({ uid: PINNED, email: OWNER }),
        listWebhookConnectionsForUser: async () => [
          { webhookId: OLD, status: "REVOKED", userId: PINNED },
          { webhookId: ACTIVE, status: "ACTIVE", userId: PINNED }
        ]
      }
    });
    expect(result.status).toBe("HEALTHY");
    expect(result.webhookOwnedByOriginal).toBe(true);
    expect(result.activeWebhookIdRedacted).toBe(maskWebhookId(ACTIVE));
    expect(result.emailUidRedacted).toBe(maskUid(PINNED));
    expect(JSON.stringify(result)).not.toContain(ACTIVE);
    expect(JSON.stringify(result)).not.toContain(PINNED);
  });

  it("webhookOwnedByOriginal false when only revoked webhook exists", async () => {
    const result = await checkOwnerAuthIntegrity({
      config: { ownerEmail: OWNER, pinnedOwnerUid: PINNED },
      auth: {
        getUserByEmail: async () => ({ uid: PINNED, email: OWNER }),
        getUser: async () => ({ uid: PINNED, email: OWNER }),
        listWebhookConnectionsForUser: async () => [
          { webhookId: OLD, status: "REVOKED", userId: PINNED }
        ]
      }
    });
    expect(result.status).toBe("HEALTHY");
    expect(result.webhookOwnedByOriginal).toBe(false);
  });
});
