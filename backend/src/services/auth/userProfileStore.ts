import { randomUUID } from "crypto";
import { getFirestoreDb } from "../firebaseAdmin";
import { maskUid } from "./ownerAuthConfig";
import type { AccountRole } from "./roles";
import type { AdminAuditEvent, UserProfileRecord } from "./userProfile";

export interface UserProfileStore {
  getProfile(uid: string): Promise<UserProfileRecord | null>;
  upsertProfile(profile: UserProfileRecord): Promise<void>;
  listProfiles(): Promise<UserProfileRecord[]>;
  writeAudit(event: Omit<AdminAuditEvent, "id" | "at"> & { at?: string }): Promise<AdminAuditEvent>;
  listAudit(limit?: number): Promise<AdminAuditEvent[]>;
}

const memoryProfiles = new Map<string, UserProfileRecord>();
const memoryAudit: AdminAuditEvent[] = [];

export function resetInMemoryUserProfiles(): void {
  memoryProfiles.clear();
  memoryAudit.length = 0;
}

export class InMemoryUserProfileStore implements UserProfileStore {
  async getProfile(uid: string): Promise<UserProfileRecord | null> {
    return memoryProfiles.get(uid) ?? null;
  }

  async upsertProfile(profile: UserProfileRecord): Promise<void> {
    memoryProfiles.set(profile.uid, profile);
  }

  async listProfiles(): Promise<UserProfileRecord[]> {
    return [...memoryProfiles.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }

  async writeAudit(
    event: Omit<AdminAuditEvent, "id" | "at"> & { at?: string }
  ): Promise<AdminAuditEvent> {
    const full: AdminAuditEvent = {
      id: randomUUID(),
      at: event.at ?? new Date().toISOString(),
      actorUidMasked: event.actorUidMasked,
      actorRole: event.actorRole,
      action: event.action,
      targetUidMasked: event.targetUidMasked,
      detail: event.detail
    };
    memoryAudit.unshift(full);
    return full;
  }

  async listAudit(limit = 50): Promise<AdminAuditEvent[]> {
    return memoryAudit.slice(0, limit);
  }
}

export class FirestoreUserProfileStore implements UserProfileStore {
  async getProfile(uid: string): Promise<UserProfileRecord | null> {
    const db = getFirestoreDb();
    if (!db) return null;
    const snap = await db.doc(`users/${uid}/profile/main`).get();
    if (!snap.exists) return null;
    return snap.data() as UserProfileRecord;
  }

  async upsertProfile(profile: UserProfileRecord): Promise<void> {
    const db = getFirestoreDb();
    if (!db) {
      throw new Error("FIRESTORE_UNAVAILABLE");
    }
    await db.doc(`users/${profile.uid}/profile/main`).set(profile, { merge: true });
    // Index doc for admin listing (no secrets).
    await db.doc(`userDirectory/${profile.uid}`).set(
      {
        uid: profile.uid,
        email: profile.email,
        firstName: profile.firstName,
        lastName: profile.lastName,
        role: profile.role,
        approvalStatus: profile.approvalStatus,
        emailVerified: profile.emailVerified,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        lastSignInAt: profile.lastSignInAt,
        suspendedAt: profile.suspendedAt
      },
      { merge: true }
    );
  }

  async listProfiles(): Promise<UserProfileRecord[]> {
    const db = getFirestoreDb();
    if (!db) return [];
    const snap = await db.collection("userDirectory").orderBy("createdAt", "desc").limit(200).get();
    const out: UserProfileRecord[] = [];
    for (const doc of snap.docs) {
      const full = await this.getProfile(doc.id);
      if (full) out.push(full);
    }
    return out;
  }

  async writeAudit(
    event: Omit<AdminAuditEvent, "id" | "at"> & { at?: string }
  ): Promise<AdminAuditEvent> {
    const db = getFirestoreDb();
    const full: AdminAuditEvent = {
      id: randomUUID(),
      at: event.at ?? new Date().toISOString(),
      actorUidMasked: event.actorUidMasked,
      actorRole: event.actorRole,
      action: event.action,
      targetUidMasked: event.targetUidMasked,
      detail: event.detail
    };
    if (!db) return full;
    await db.doc(`adminAudit/${full.id}`).set(full);
    return full;
  }

  async listAudit(limit = 50): Promise<AdminAuditEvent[]> {
    const db = getFirestoreDb();
    if (!db) return [];
    const snap = await db.collection("adminAudit").orderBy("at", "desc").limit(limit).get();
    return snap.docs.map((d) => d.data() as AdminAuditEvent);
  }
}

let sharedStore: UserProfileStore | null = null;

export function getUserProfileStore(): UserProfileStore {
  if (sharedStore) return sharedStore;
  if (process.env.APP_ENV === "test" || process.env.STORAGE_BACKEND === "memory") {
    sharedStore = new InMemoryUserProfileStore();
  } else {
    sharedStore = new FirestoreUserProfileStore();
  }
  return sharedStore;
}

export function setUserProfileStoreForTests(store: UserProfileStore | null): void {
  sharedStore = store;
}

export function redactAuditTarget(uid: string): string {
  return maskUid(uid) ?? "unknown";
}

export function assertNotOwnerEscalation(args: {
  targetUid: string;
  pinnedOwnerUid: string | null;
  nextRole: AccountRole;
}): void {
  if ((args.nextRole as string) === "OWNER") {
    throw new Error("OWNER_PROMOTION_FORBIDDEN");
  }
  if (args.pinnedOwnerUid && args.targetUid === args.pinnedOwnerUid) {
    // Never demote/delete owner via approval APIs — callers must reject separately.
    throw new Error("OWNER_MUTATION_FORBIDDEN");
  }
}
