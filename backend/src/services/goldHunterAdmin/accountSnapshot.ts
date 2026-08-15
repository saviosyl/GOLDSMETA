/**
 * Gold Hunter — authoritative cTrader DEMO account money snapshot.
 * Reuses Demo Open API margin derivation. Never invents equity/margin.
 * Independent of Fast AutoTrade / qualification engine.
 */

import { loadCTraderConfig } from "../broker/ctrader/config";
import {
  getConnection,
  loadTokenEncryptionSecret,
  persistRotatedTokensAtomic,
  type CTraderConnectionRecord
} from "../broker/ctrader/connectionStore";
import { refreshAccessToken } from "../broker/ctrader/oauth";
import {
  createOpenApiClient,
  type CTraderOpenApiClient
} from "../broker/ctrader/openApiClient";
import { decryptTokenPayload, encryptTokenPayload } from "../broker/ctrader/tokenCrypto";
import type { AuthoritativeMarginSnapshot } from "../broker/ctrader/authoritativeMargin";
import {
  isCTraderDemoOrderSubmissionEnabled,
  isCTraderLiveEnabled
} from "../broker/ctrader/flags";

/** Soft cache — status polls every ~5s; avoid hammering Open API. */
const SNAPSHOT_CACHE_TTL_MS = 20_000;
/** Snapshot older than this is STALE for risk/arming. */
export const GH_ACCOUNT_SNAPSHOT_STALE_MS = 60_000;

export type GoldHunterAccountAuthState =
  | "CONNECTED"
  | "AUTHORISED"
  | "STALE"
  | "DISCONNECTED"
  | "REAUTH_REQUIRED"
  | "LIVE_REFUSED"
  | "UNKNOWN";

export type GoldHunterAccountSnapshot = {
  provider: "cTrader";
  environment: "DEMO" | "LIVE" | null;
  authState: GoldHunterAccountAuthState;
  authorised: boolean;
  accountMasked: string | null;
  brokerName: string | null;
  currency: string | null;
  balance: number | null;
  equity: number | null;
  marginUsed: number | null;
  freeMargin: number | null;
  openPositionCount: number | null;
  capturedAt: string | null;
  ageMs: number | null;
  source: "AUTHORITATIVE_DEMO" | "CONNECTION_FALLBACK" | "NONE";
  notes: string[];
  demoOrderSubmissionEnabled: boolean;
  /** True when DEMO + balance finite + snapshot not stale. */
  validForRisk: boolean;
};

type CacheEntry = {
  atMs: number;
  snapshot: GoldHunterAccountSnapshot;
};

const cache = new Map<string, CacheEntry>();

export function resetGoldHunterAccountSnapshotCache(): void {
  cache.clear();
}

export type FetchGoldHunterAccountSnapshotArgs = {
  ownerUid: string;
  /** Bypass soft cache (manual refresh / post-fill). */
  forceRefresh?: boolean;
  nowMs?: number;
  openApiClient?: CTraderOpenApiClient;
};

async function ensureFreshAccessToken(ownerUid: string): Promise<{
  accessToken: string;
  connection: CTraderConnectionRecord;
}> {
  const cfg = loadCTraderConfig();
  const clientId = (process.env.CTRADER_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.CTRADER_CLIENT_SECRET ?? "").trim();
  if (!cfg.configured || !clientId || !clientSecret) {
    throw Object.assign(new Error("CONFIGURATION_REQUIRED"), {
      code: "CONFIGURATION_REQUIRED"
    });
  }

  const connection = await getConnection(ownerUid);
  if (!connection) {
    throw Object.assign(new Error("CTRADER_NOT_CONNECTED"), {
      code: "CTRADER_NOT_CONNECTED"
    });
  }
  const secret = loadTokenEncryptionSecret();
  if (!secret) {
    throw Object.assign(new Error("TOKEN_ENCRYPTION_UNAVAILABLE"), {
      code: "TOKEN_ENCRYPTION_UNAVAILABLE"
    });
  }
  const payload = JSON.parse(
    decryptTokenPayload(connection.tokens.ciphertext, secret)
  ) as { accessToken?: string; refreshToken?: string };
  if (!payload.accessToken || !payload.refreshToken) {
    throw Object.assign(new Error("CTRADER_TOKENS_MISSING"), {
      code: "REAUTH_REQUIRED"
    });
  }

  let accessToken = payload.accessToken;
  const refreshToken = payload.refreshToken;
  const tokenVersion = connection.tokens.tokenVersion ?? 0;
  let freshConn = connection;

  const expiresAt = Date.parse(connection.tokens.accessExpiresAt);
  const stale =
    !Number.isFinite(expiresAt) || expiresAt < Date.now() + 60_000;
  if (stale) {
    const rotated = await refreshAccessToken({
      clientId,
      clientSecret,
      refreshToken
    });
    const ciphertext = encryptTokenPayload(
      JSON.stringify({
        accessToken: rotated.accessToken,
        refreshToken: rotated.refreshToken ?? refreshToken
      }),
      secret
    );
    await persistRotatedTokensAtomic({
      ownerUid,
      expectedCiphertext: connection.tokens.ciphertext,
      expectedTokenVersion: tokenVersion,
      newTokens: {
        ciphertext,
        accessExpiresAt: new Date(
          Date.now() + (rotated.expiresIn ?? 3600) * 1000
        ).toISOString(),
        refreshedAt: new Date().toISOString(),
        tokenVersion: tokenVersion + 1
      }
    });
    accessToken = rotated.accessToken;
    freshConn = (await getConnection(ownerUid))!;
  }

  return { accessToken, connection: freshConn };
}

function emptySnapshot(
  partial: Partial<GoldHunterAccountSnapshot>
): GoldHunterAccountSnapshot {
  return {
    provider: "cTrader",
    environment: null,
    authState: "DISCONNECTED",
    authorised: false,
    accountMasked: null,
    brokerName: null,
    currency: null,
    balance: null,
    equity: null,
    marginUsed: null,
    freeMargin: null,
    openPositionCount: null,
    capturedAt: null,
    ageMs: null,
    source: "NONE",
    notes: [],
    demoOrderSubmissionEnabled: isCTraderDemoOrderSubmissionEnabled(),
    validForRisk: false,
    ...partial
  };
}

function fromAuthoritative(
  connection: CTraderConnectionRecord,
  snap: AuthoritativeMarginSnapshot,
  nowMs: number
): GoldHunterAccountSnapshot {
  const environment: "DEMO" | "LIVE" = connection.selectedAccountIsLive
    ? "LIVE"
    : "DEMO";
  const ageMs = Math.max(0, nowMs - Date.parse(snap.capturedAt));
  const stale = ageMs > GH_ACCOUNT_SNAPSHOT_STALE_MS;
  const liveRefused = environment === "LIVE" || isCTraderLiveEnabled();
  const authState: GoldHunterAccountAuthState = liveRefused
    ? "LIVE_REFUSED"
    : stale
      ? "STALE"
      : "AUTHORISED";
  const validForRisk =
    !liveRefused &&
    environment === "DEMO" &&
    Number.isFinite(snap.balance) &&
    !stale;

  return {
    provider: "cTrader",
    environment,
    authState,
    authorised: authState === "AUTHORISED" || authState === "STALE",
    accountMasked: connection.selectedAccountMasked,
    brokerName: connection.brokerName,
    currency: connection.currency,
    balance: snap.balance,
    equity: snap.equity,
    marginUsed: snap.usedMargin,
    freeMargin: snap.freeMargin,
    openPositionCount: snap.openPositionCount,
    capturedAt: snap.capturedAt,
    ageMs,
    source: "AUTHORITATIVE_DEMO",
    notes: [],
    demoOrderSubmissionEnabled: isCTraderDemoOrderSubmissionEnabled(),
    validForRisk
  };
}

function fromConnectionFallback(
  connection: CTraderConnectionRecord,
  notes: string[]
): GoldHunterAccountSnapshot {
  const environment: "DEMO" | "LIVE" | null = connection.selectedAccountId
    ? connection.selectedAccountIsLive
      ? "LIVE"
      : "DEMO"
    : null;
  const liveRefused = environment === "LIVE" || isCTraderLiveEnabled();
  return emptySnapshot({
    environment,
    authState: liveRefused
      ? "LIVE_REFUSED"
      : connection.selectedAccountId
        ? "CONNECTED"
        : "DISCONNECTED",
    authorised: Boolean(connection.selectedAccountId) && !liveRefused,
    accountMasked: connection.selectedAccountMasked,
    brokerName: connection.brokerName,
    currency: connection.currency,
    // Only show stored balance — never invent equity from it.
    balance: connection.balance,
    equity: null,
    marginUsed: null,
    freeMargin: null,
    capturedAt: connection.lastSyncAt,
    ageMs: connection.lastSyncAt
      ? Math.max(0, Date.now() - Date.parse(connection.lastSyncAt))
      : null,
    source: connection.balance != null ? "CONNECTION_FALLBACK" : "NONE",
    notes,
    // Fallback balance is not authoritative enough for arming/risk.
    validForRisk: false
  });
}

/**
 * Fetch (or soft-cache) Gold Hunter Demo account money fields.
 */
export async function fetchGoldHunterAccountSnapshot(
  args: FetchGoldHunterAccountSnapshotArgs
): Promise<GoldHunterAccountSnapshot> {
  const nowMs = args.nowMs ?? Date.now();
  if (!args.forceRefresh) {
    const hit = cache.get(args.ownerUid);
    if (hit && nowMs - hit.atMs < SNAPSHOT_CACHE_TTL_MS) {
      return {
        ...hit.snapshot,
        ageMs: hit.snapshot.capturedAt
          ? Math.max(0, nowMs - Date.parse(hit.snapshot.capturedAt))
          : hit.snapshot.ageMs
      };
    }
  }

  if (isCTraderLiveEnabled()) {
    const refused = emptySnapshot({
      authState: "LIVE_REFUSED",
      notes: ["CTRADER_LIVE_ENABLED refused for Gold Hunter"]
    });
    cache.set(args.ownerUid, { atMs: nowMs, snapshot: refused });
    return refused;
  }

  let connection: CTraderConnectionRecord | null = null;
  try {
    connection = await getConnection(args.ownerUid);
  } catch {
    connection = null;
  }

  if (!connection?.selectedAccountId) {
    const snap = emptySnapshot({
      authState: "DISCONNECTED",
      notes: ["No selected cTrader account"]
    });
    cache.set(args.ownerUid, { atMs: nowMs, snapshot: snap });
    return snap;
  }

  if (connection.selectedAccountIsLive || connection.environment === "LIVE") {
    const snap = fromConnectionFallback(connection, [
      "Selected account is LIVE — Gold Hunter refuses money snapshot for execution"
    ]);
    snap.authState = "LIVE_REFUSED";
    snap.validForRisk = false;
    cache.set(args.ownerUid, { atMs: nowMs, snapshot: snap });
    return snap;
  }

  try {
    const { accessToken, connection: fresh } = await ensureFreshAccessToken(
      args.ownerUid
    );
    const cfg = loadCTraderConfig();
    const clientId = (process.env.CTRADER_CLIENT_ID ?? "").trim();
    const clientSecret = (process.env.CTRADER_CLIENT_SECRET ?? "").trim();
    if (!cfg.configured || !clientId || !clientSecret) {
      const snap = fromConnectionFallback(fresh, ["CONFIGURATION_REQUIRED"]);
      cache.set(args.ownerUid, { atMs: nowMs, snapshot: snap });
      return snap;
    }

    const api = args.openApiClient ?? createOpenApiClient();
    if (!api.fetchAuthoritativeDemoMarginSnapshot) {
      const snap = fromConnectionFallback(fresh, [
        "Open API authoritative margin method unavailable"
      ]);
      cache.set(args.ownerUid, { atMs: nowMs, snapshot: snap });
      return snap;
    }

    const res = await api.fetchAuthoritativeDemoMarginSnapshot({
      accessToken,
      clientId,
      clientSecret,
      ctidTraderAccountId: fresh.selectedAccountId!
    });

    if (!res.ok) {
      const snap = fromConnectionFallback(fresh, res.notes);
      snap.notes = res.notes;
      cache.set(args.ownerUid, { atMs: nowMs, snapshot: snap });
      return snap;
    }

    const snap = fromAuthoritative(fresh, res.snapshot, nowMs);
    cache.set(args.ownerUid, { atMs: nowMs, snapshot: snap });
    return snap;
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "";
    const message = err instanceof Error ? err.message : "account_snapshot_failed";
    if (code === "REAUTH_REQUIRED" || /TOKENS_MISSING|REAUTH/i.test(message)) {
      const snap = emptySnapshot({
        environment: connection.selectedAccountIsLive ? "LIVE" : "DEMO",
        authState: "REAUTH_REQUIRED",
        accountMasked: connection.selectedAccountMasked,
        brokerName: connection.brokerName,
        currency: connection.currency,
        balance: connection.balance,
        notes: [message]
      });
      cache.set(args.ownerUid, { atMs: nowMs, snapshot: snap });
      return snap;
    }
    const snap = fromConnectionFallback(connection, [message]);
    cache.set(args.ownerUid, { atMs: nowMs, snapshot: snap });
    return snap;
  }
}

/**
 * Arming preflight — DEMO only, authorised snapshot, submission enabled.
 * Does NOT require market open / signal (those gate orders, not arming).
 */
export function evaluateGoldHunterArmingReadiness(args: {
  snapshot: GoldHunterAccountSnapshot;
  allocatedCapitalEur: number;
  riskPerTradePct: number;
  /** True only when a Gold Hunter A/B/C selector is wired. */
  strategySelectorConnected: boolean;
}): { ok: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (isCTraderLiveEnabled()) blockers.push("LIVE_EXECUTION_DISABLED");
  if (args.snapshot.environment !== "DEMO") {
    blockers.push(
      args.snapshot.environment == null
        ? "ACCOUNT_ENVIRONMENT_UNKNOWN"
        : "LIVE_OR_NON_DEMO_ACCOUNT"
    );
  }
  if (args.snapshot.authState === "LIVE_REFUSED") {
    blockers.push("LIVE_ACCOUNT_REFUSED");
  }
  if (
    args.snapshot.authState === "DISCONNECTED" ||
    args.snapshot.authState === "REAUTH_REQUIRED"
  ) {
    blockers.push(`ACCOUNT_${args.snapshot.authState}`);
  }
  if (!args.snapshot.validForRisk || args.snapshot.balance == null) {
    blockers.push("ACCOUNT_SNAPSHOT_INVALID");
  }
  if (!args.snapshot.demoOrderSubmissionEnabled) {
    blockers.push("DEMO_ORDER_SUBMISSION_DISABLED");
  }
  if (!(args.allocatedCapitalEur > 0)) blockers.push("ALLOCATION_INVALID");
  if (!(args.riskPerTradePct > 0)) blockers.push("RISK_PCT_INVALID");
  if (!args.strategySelectorConnected) {
    blockers.push("STRATEGY_SELECTOR_NOT_CONNECTED");
  }
  return { ok: blockers.length === 0, blockers };
}
