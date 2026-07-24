/**
 * Read-only owner webhook ownership checks.
 * Does not depend on display suffixes. Never mutates webhook records.
 */

export type WebhookConnectionRef = {
  webhookId: string;
  status?: string | null;
  userId?: string | null;
};

export type OwnerWebhookHealth = {
  ok: boolean;
  code:
    | "ACTIVE_WEBHOOK_ON_PINNED"
    | "CANONICAL_ACTIVE_ON_PINNED"
    | "NO_ACTIVE_WEBHOOK"
    | "CANONICAL_MISSING"
    | "CANONICAL_NOT_ACTIVE"
    | "CANONICAL_OWNED_BY_OTHER"
    | "ACTIVE_OWNER_WEBHOOK_ON_OTHER_UID";
  /** Redacted only — never full webhook IDs. */
  activeWebhookIdRedacted: string | null;
  activeCountOnPinned: number;
  revokedIgnoredCount: number;
  notes: string[];
};

export function maskWebhookId(webhookId: string | null | undefined): string | null {
  if (!webhookId) return null;
  const id = webhookId.trim();
  if (!id) return null;
  if (id.length <= 8) return `${id.slice(0, 2)}…${id.slice(-2)}`;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function isActiveStatus(status: string | null | undefined): boolean {
  const s = String(status ?? "ACTIVE").toUpperCase();
  return s !== "REVOKED" && s !== "DISABLED" && s !== "INACTIVE";
}

/**
 * Evaluate whether the pinned owner has a healthy ACTIVE webhook.
 * Prefer a canonical webhook ID when provided; otherwise any ACTIVE webhook
 * owned by the pinned UID is sufficient. REVOKED historical webhooks are ignored.
 */
export function evaluateOwnerWebhookHealth(args: {
  pinnedOwnerUid: string;
  /** Webhooks belonging to the pinned UID (any status). */
  pinnedWebhooks: WebhookConnectionRef[];
  /** Optional canonical current webhook ID from owner profile/config. */
  canonicalWebhookId?: string | null;
  /**
   * Optional ACTIVE webhooks that claim to be the owner/canonical webhook
   * but are owned by another UID (replacement drift).
   */
  foreignActiveOwnerWebhooks?: WebhookConnectionRef[];
}): OwnerWebhookHealth {
  const pinned = args.pinnedOwnerUid;
  const notes: string[] = [];
  const revokedIgnoredCount = args.pinnedWebhooks.filter(
    (h) => !isActiveStatus(h.status)
  ).length;
  const activeOnPinned = args.pinnedWebhooks.filter((h) => isActiveStatus(h.status));
  const foreign = (args.foreignActiveOwnerWebhooks ?? []).filter(
    (h) => isActiveStatus(h.status) && h.userId && h.userId !== pinned
  );

  if (foreign.length > 0) {
    return {
      ok: false,
      code: "ACTIVE_OWNER_WEBHOOK_ON_OTHER_UID",
      activeWebhookIdRedacted: maskWebhookId(foreign[0]?.webhookId),
      activeCountOnPinned: activeOnPinned.length,
      revokedIgnoredCount,
      notes: [
        "An ACTIVE owner webhook is assigned to a UID other than the pinned owner.",
        `Ignored ${revokedIgnoredCount} revoked/inactive historical webhook(s) on pinned UID.`
      ]
    };
  }

  const canonical = (args.canonicalWebhookId ?? "").trim();
  if (canonical) {
    const onPinned = args.pinnedWebhooks.find((h) => h.webhookId === canonical);
    if (!onPinned) {
      // Canonical may exist on another UID — check foreign list already handled;
      // if not present at all on pinned, fail missing.
      const onForeign = (args.foreignActiveOwnerWebhooks ?? []).find(
        (h) => h.webhookId === canonical
      );
      if (onForeign && onForeign.userId && onForeign.userId !== pinned) {
        return {
          ok: false,
          code: "CANONICAL_OWNED_BY_OTHER",
          activeWebhookIdRedacted: maskWebhookId(canonical),
          activeCountOnPinned: activeOnPinned.length,
          revokedIgnoredCount,
          notes: ["Canonical webhook exists but is owned by a different UID."]
        };
      }
      return {
        ok: false,
        code: "CANONICAL_MISSING",
        activeWebhookIdRedacted: maskWebhookId(canonical),
        activeCountOnPinned: activeOnPinned.length,
        revokedIgnoredCount,
        notes: ["Canonical webhook reference not found under pinned owner."]
      };
    }
    if (!isActiveStatus(onPinned.status)) {
      return {
        ok: false,
        code: "CANONICAL_NOT_ACTIVE",
        activeWebhookIdRedacted: maskWebhookId(canonical),
        activeCountOnPinned: activeOnPinned.length,
        revokedIgnoredCount,
        notes: [
          "Canonical webhook is not ACTIVE.",
          `Ignored ${revokedIgnoredCount} revoked/inactive historical webhook(s).`
        ]
      };
    }
    notes.push("Canonical ACTIVE webhook owned by pinned UID.");
    if (revokedIgnoredCount > 0) {
      notes.push(
        `Ignored ${revokedIgnoredCount} revoked/inactive historical webhook(s) on pinned UID.`
      );
    }
    return {
      ok: true,
      code: "CANONICAL_ACTIVE_ON_PINNED",
      activeWebhookIdRedacted: maskWebhookId(canonical),
      activeCountOnPinned: activeOnPinned.length,
      revokedIgnoredCount,
      notes
    };
  }

  if (activeOnPinned.length === 0) {
    return {
      ok: false,
      code: "NO_ACTIVE_WEBHOOK",
      activeWebhookIdRedacted: null,
      activeCountOnPinned: 0,
      revokedIgnoredCount,
      notes: [
        "Pinned owner UID has no ACTIVE webhook.",
        revokedIgnoredCount > 0
          ? `Found ${revokedIgnoredCount} revoked/inactive historical webhook(s); they do not satisfy the gate.`
          : "No webhook records found for pinned UID."
      ]
    };
  }

  notes.push("At least one ACTIVE webhook owned by pinned UID.");
  if (revokedIgnoredCount > 0) {
    notes.push(
      `Ignored ${revokedIgnoredCount} revoked/inactive historical webhook(s) on pinned UID.`
    );
  }
  return {
    ok: true,
    code: "ACTIVE_WEBHOOK_ON_PINNED",
    activeWebhookIdRedacted: maskWebhookId(activeOnPinned[0]?.webhookId),
    activeCountOnPinned: activeOnPinned.length,
    revokedIgnoredCount,
    notes
  };
}
