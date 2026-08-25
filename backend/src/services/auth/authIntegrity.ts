/**
 * Read-only owner Auth integrity monitor.
 * Never creates, deletes, renames, imports, or migrates Auth/Firestore users.
 */

import { maskUid, normalizeEmail, type OwnerAuthConfig } from "./ownerAuthConfig";
import {
  evaluateOwnerWebhookHealth,
  type WebhookConnectionRef
} from "./ownerWebhookHealth";

export type AuthIntegrityStatus =
  | "HEALTHY"
  | "OWNER_UID_MISMATCH"
  | "OWNER_AUTH_MISSING"
  | "DUPLICATE_OWNER_EMAIL"
  | "CONFIGURATION_MISSING";

export interface AuthIntegrityResult {
  status: AuthIntegrityStatus;
  ownerEmail: string;
  emailUidRedacted: string | null;
  pinnedUidRedacted: string | null;
  originalOwnerExists: boolean;
  webhookOwnedByOriginal: boolean | null;
  /** Redacted active webhook id when available. */
  activeWebhookIdRedacted: string | null;
  notes: string[];
  mutatedAuth: false;
}

export interface AuthLookupPort {
  getUserByEmail(email: string): Promise<{ uid: string; email?: string | null } | null>;
  getUser(uid: string): Promise<{ uid: string; email?: string | null } | null>;
  listWebhookConnectionsForUser?(
    userId: string
  ): Promise<Array<{ webhookId: string; status?: string; userId?: string }>>;
  /** Optional canonical current webhook id from owner profile/config. */
  getCanonicalOwnerWebhookId?(pinnedOwnerUid: string): Promise<string | null>;
  /**
   * Optional: ACTIVE webhooks that appear to be owner webhooks but are owned
   * by a different UID (replacement drift).
   */
  listForeignActiveOwnerWebhooks?(
    pinnedOwnerUid: string
  ): Promise<WebhookConnectionRef[]>;
}

export async function checkOwnerAuthIntegrity(args: {
  config: OwnerAuthConfig;
  auth: AuthLookupPort;
  /** @deprecated Ignored — gate no longer uses display suffixes. */
  expectedWebhookSuffix?: string;
}): Promise<AuthIntegrityResult> {
  const notes: string[] = [];
  const { ownerEmail, pinnedOwnerUid } = args.config;

  const base = {
    ownerEmail,
    mutatedAuth: false as const,
    activeWebhookIdRedacted: null as string | null
  };

  if (!ownerEmail || !pinnedOwnerUid) {
    return {
      ...base,
      status: "CONFIGURATION_MISSING",
      emailUidRedacted: null,
      pinnedUidRedacted: null,
      originalOwnerExists: false,
      webhookOwnedByOriginal: null,
      notes: ["GOLDMETA_PINNED_OWNER_UID (and owner email) must be configured server-side."]
    };
  }

  const pinnedUser = await args.auth.getUser(pinnedOwnerUid);
  const emailUser = await args.auth.getUserByEmail(ownerEmail);

  const originalOwnerExists = pinnedUser != null;
  const emailUid = emailUser?.uid ?? null;
  const pinnedEmail = normalizeEmail(pinnedUser?.email ?? null);

  let webhookOwnedByOriginal: boolean | null = null;
  let activeWebhookIdRedacted: string | null = null;

  if (args.auth.listWebhookConnectionsForUser && originalOwnerExists) {
    const hooks = await args.auth.listWebhookConnectionsForUser(pinnedOwnerUid);
    const canonical =
      (await args.auth.getCanonicalOwnerWebhookId?.(pinnedOwnerUid)) ?? null;
    const foreign =
      (await args.auth.listForeignActiveOwnerWebhooks?.(pinnedOwnerUid)) ?? [];
    const webhookHealth = evaluateOwnerWebhookHealth({
      pinnedOwnerUid,
      pinnedWebhooks: hooks.map((h) => ({
        webhookId: h.webhookId,
        status: h.status,
        userId: h.userId ?? pinnedOwnerUid
      })),
      canonicalWebhookId: canonical,
      foreignActiveOwnerWebhooks: foreign
    });
    webhookOwnedByOriginal = webhookHealth.ok;
    activeWebhookIdRedacted = webhookHealth.activeWebhookIdRedacted;
    notes.push(...webhookHealth.notes);
  }

  if (!originalOwnerExists) {
    return {
      ...base,
      status: "OWNER_AUTH_MISSING",
      emailUidRedacted: maskUid(emailUid),
      pinnedUidRedacted: maskUid(pinnedOwnerUid),
      originalOwnerExists: false,
      webhookOwnedByOriginal,
      activeWebhookIdRedacted,
      notes: [...notes, "Pinned owner UID is missing from Firebase Auth."]
    };
  }

  if (!emailUid) {
    return {
      ...base,
      status: "OWNER_UID_MISMATCH",
      emailUidRedacted: null,
      pinnedUidRedacted: maskUid(pinnedOwnerUid),
      originalOwnerExists: true,
      webhookOwnedByOriginal,
      activeWebhookIdRedacted,
      notes: [
        ...notes,
        "Owner email is not currently assigned to any Auth user.",
        pinnedEmail && pinnedEmail !== ownerEmail
          ? "Pinned UID exists but is not bound to the owner email."
          : "Owner email free — do not enable public signup."
      ]
    };
  }

  if (emailUid !== pinnedOwnerUid) {
    return {
      ...base,
      status: "OWNER_UID_MISMATCH",
      emailUidRedacted: maskUid(emailUid),
      pinnedUidRedacted: maskUid(pinnedOwnerUid),
      originalOwnerExists: true,
      webhookOwnedByOriginal,
      activeWebhookIdRedacted,
      notes: [
        ...notes,
        "Owner email resolves to a different UID than the pinned production owner.",
        "Treat as Auth drift — do not auto-repair from this monitor."
      ]
    };
  }

  if (pinnedEmail && pinnedEmail !== ownerEmail) {
    return {
      ...base,
      status: "DUPLICATE_OWNER_EMAIL",
      emailUidRedacted: maskUid(emailUid),
      pinnedUidRedacted: maskUid(pinnedOwnerUid),
      originalOwnerExists: true,
      webhookOwnedByOriginal,
      activeWebhookIdRedacted,
      notes: [...notes, "Unexpected email binding inconsistency on pinned UID."]
    };
  }

  return {
    ...base,
    status: "HEALTHY",
    emailUidRedacted: maskUid(emailUid),
    pinnedUidRedacted: maskUid(pinnedOwnerUid),
    originalOwnerExists: true,
    webhookOwnedByOriginal,
    activeWebhookIdRedacted,
    notes: notes.length ? notes : ["Owner email maps to pinned UID."]
  };
}
