/**
 * Server-side short-lived Micro OAuth authorization sessions.
 * Bound to authenticated GoldMeta UID + single-use nonce.
 * cTrader does not reliably round-trip an app `state` param — we bind by code+session.
 */
import { randomBytes, createHash } from "crypto";
import { getFirestore } from "firebase-admin/firestore";
import { MICRO_NAMESPACE } from "../config";
import {
  assertMicroStorageModeAllowed,
  resolveMicroStorageMode,
  type MicroStorageMode
} from "./storageMode";

export type MicroOAuthSession = {
  sessionId: string;
  uid: string;
  nonce: string;
  redirectUri: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
};

const SESSION_TTL_MS = 10 * 60_000;

function assertSessionPath(sessionId: string): void {
  const full = `${MICRO_NAMESPACE}/private/oauth/sessions/${sessionId}`;
  if (!full.startsWith(`${MICRO_NAMESPACE}/private/oauth/sessions/`)) {
    throw new Error(`MICRO_OAUTH_SESSION_NAMESPACE_VIOLATION: ${full}`);
  }
}

export interface MicroOAuthSessionStore {
  create(args: {
    uid: string;
    redirectUri: string;
    nowMs?: number;
  }): Promise<MicroOAuthSession>;
  /** Single-use consume for the owning uid. */
  consume(args: {
    sessionId: string;
    uid: string;
    nowMs?: number;
  }): Promise<MicroOAuthSession>;
  get(sessionId: string): Promise<MicroOAuthSession | null>;
}

export class MemoryMicroOAuthSessionStore implements MicroOAuthSessionStore {
  readonly storageMode = "memory" as const;
  private readonly sessions: Map<string, MicroOAuthSession>;

  constructor(shared?: Map<string, MicroOAuthSession>) {
    this.sessions = shared ?? new Map<string, MicroOAuthSession>();
  }

  getSharedSessionsForTests(): Map<string, MicroOAuthSession> {
    return this.sessions;
  }

  async create(args: {
    uid: string;
    redirectUri: string;
    nowMs?: number;
  }): Promise<MicroOAuthSession> {
    const now = args.nowMs ?? Date.now();
    const sessionId = randomBytes(24).toString("hex");
    const nonce = randomBytes(16).toString("hex");
    assertSessionPath(sessionId);
    const session: MicroOAuthSession = {
      sessionId,
      uid: args.uid,
      nonce,
      redirectUri: args.redirectUri,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
      consumedAt: null
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  async get(sessionId: string): Promise<MicroOAuthSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async consume(args: {
    sessionId: string;
    uid: string;
    nowMs?: number;
  }): Promise<MicroOAuthSession> {
    const now = args.nowMs ?? Date.now();
    const session = this.sessions.get(args.sessionId);
    if (!session) {
      throw Object.assign(new Error("MICRO_OAUTH_SESSION_NOT_FOUND"), {
        code: "oauth_session_invalid"
      });
    }
    if (session.uid !== args.uid) {
      throw Object.assign(new Error("MICRO_OAUTH_SESSION_UID_MISMATCH"), {
        code: "oauth_session_invalid"
      });
    }
    if (session.consumedAt) {
      throw Object.assign(new Error("MICRO_OAUTH_SESSION_ALREADY_USED"), {
        code: "oauth_session_invalid"
      });
    }
    if (Date.parse(session.expiresAt) < now) {
      throw Object.assign(new Error("MICRO_OAUTH_SESSION_EXPIRED"), {
        code: "oauth_session_invalid"
      });
    }
    const consumed = {
      ...session,
      consumedAt: new Date(now).toISOString()
    };
    this.sessions.set(args.sessionId, consumed);
    return consumed;
  }
}

export class FirestoreMicroOAuthSessionStore implements MicroOAuthSessionStore {
  readonly storageMode = "firestore" as const;

  private col() {
    const [root, docId] = MICRO_NAMESPACE.split("/");
    return getFirestore()
      .collection(root!)
      .doc(docId!)
      .collection("private")
      .doc("oauth")
      .collection("sessions");
  }

  async create(args: {
    uid: string;
    redirectUri: string;
    nowMs?: number;
  }): Promise<MicroOAuthSession> {
    const now = args.nowMs ?? Date.now();
    const sessionId = randomBytes(24).toString("hex");
    assertSessionPath(sessionId);
    const session: MicroOAuthSession = {
      sessionId,
      uid: args.uid,
      nonce: randomBytes(16).toString("hex"),
      redirectUri: args.redirectUri,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
      consumedAt: null
    };
    await this.col().doc(sessionId).set(session);
    return session;
  }

  async get(sessionId: string): Promise<MicroOAuthSession | null> {
    const snap = await this.col().doc(sessionId).get();
    if (!snap.exists) return null;
    return snap.data() as MicroOAuthSession;
  }

  async consume(args: {
    sessionId: string;
    uid: string;
    nowMs?: number;
  }): Promise<MicroOAuthSession> {
    const now = args.nowMs ?? Date.now();
    const ref = this.col().doc(args.sessionId);
    return getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw Object.assign(new Error("MICRO_OAUTH_SESSION_NOT_FOUND"), {
          code: "oauth_session_invalid"
        });
      }
      const session = snap.data() as MicroOAuthSession;
      if (session.uid !== args.uid) {
        throw Object.assign(new Error("MICRO_OAUTH_SESSION_UID_MISMATCH"), {
          code: "oauth_session_invalid"
        });
      }
      if (session.consumedAt) {
        throw Object.assign(new Error("MICRO_OAUTH_SESSION_ALREADY_USED"), {
          code: "oauth_session_invalid"
        });
      }
      if (Date.parse(session.expiresAt) < now) {
        throw Object.assign(new Error("MICRO_OAUTH_SESSION_EXPIRED"), {
          code: "oauth_session_invalid"
        });
      }
      const consumed = {
        ...session,
        consumedAt: new Date(now).toISOString()
      };
      tx.set(ref, consumed);
      return consumed;
    });
  }
}

/**
 * Optional local optimization only — NOT the security boundary.
 * Durable single-use OAuth session consume is authoritative replay protection.
 */
export function hashAuthorizationCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

let defaultSessionStore: MicroOAuthSessionStore | null = null;
let sharedMemorySessions: Map<string, MicroOAuthSession> | null = null;

export function createMicroOAuthSessionStore(args?: {
  mode?: MicroStorageMode;
  sharedSessions?: Map<string, MicroOAuthSession>;
}): MicroOAuthSessionStore {
  const mode = args?.mode ?? resolveMicroStorageMode();
  assertMicroStorageModeAllowed(mode);
  if (mode === "firestore") return new FirestoreMicroOAuthSessionStore();
  const sessions: Map<string, MicroOAuthSession> =
    args?.sharedSessions ?? sharedMemorySessions ?? new Map<string, MicroOAuthSession>();
  if (!args?.sharedSessions && !sharedMemorySessions) {
    sharedMemorySessions = sessions;
  }
  return new MemoryMicroOAuthSessionStore(sessions);
}

export function getMicroOAuthSessionStore(): MicroOAuthSessionStore {
  if (!defaultSessionStore) defaultSessionStore = createMicroOAuthSessionStore();
  return defaultSessionStore;
}

export function resetMicroOAuthSessionStoreForTests(
  shared?: Map<string, MicroOAuthSession>
): MemoryMicroOAuthSessionStore {
  sharedMemorySessions = shared ?? new Map();
  const store = new MemoryMicroOAuthSessionStore(sharedMemorySessions);
  defaultSessionStore = store;
  return store;
}
