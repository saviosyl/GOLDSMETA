/**
 * Micro Edge OAuth service — scope=accounts only.
 * Isolated from Core cTrader OAuth routes/services.
 */
import {
  buildMicroAccountsAuthorizationUrl,
  exchangeMicroAuthorizationCode,
  loadMicroCTraderAppConfig,
  refreshMicroAccessToken,
  type MicroCTraderCredentials,
  type MicroCTraderEnvironment
} from "./microCTraderAuth";
import {
  getMicroOAuthSessionStore,
  hashAuthorizationCode,
  type MicroOAuthSessionStore
} from "./oauthSessionStore";
import {
  getMicroTokenVault,
  type MicroCTraderTokenVault,
  type MicroTokenPublicStatus,
  type MicroTokenRecord
} from "./tokenVault";
import {
  parseAuthorizedAccounts,
  selectMicroAccount,
  toSafeAccountMetadata,
  type MicroAuthorizedAccount
} from "./accountSelection";
import { microLog } from "./microLog";

/** In-memory single-use authorization code hashes (process-local). */
const usedCodeHashes = new Set<string>();

export type MicroOAuthStartResult = {
  authorizationUrl: string;
  sessionId: string;
  scope: "accounts";
  tradingScopeRequested: false;
  redirectUri: string;
  confirmation: {
    permissionRequested: "VIEW-ONLY ACCOUNT ACCESS";
    tradingPermission: "NOT REQUESTED";
    brokerOrders: "IMPOSSIBLE FROM MICRO EDGE";
  };
};

export type MicroOAuthCallbackResult =
  | {
      ok: true;
      status: "CONNECTED" | "ACCOUNT_SELECTION_REQUIRED";
      environment: MicroCTraderEnvironment;
      selectedAccountIdMasked: string | null;
      accounts: ReturnType<typeof toSafeAccountMetadata>;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

export type MicroOAuthServiceDeps = {
  vault?: MicroCTraderTokenVault;
  sessions?: MicroOAuthSessionStore;
  fetchImpl?: typeof fetch;
  /** Optional: fetch account list via transport factory after token exchange. */
  fetchAuthorizedAccounts?: (args: {
    accessToken: string;
    clientId: string;
    clientSecret: string;
    environment: MicroCTraderEnvironment;
  }) => Promise<MicroAuthorizedAccount[]>;
};

function getDeps(deps?: MicroOAuthServiceDeps) {
  return {
    vault: deps?.vault ?? getMicroTokenVault(),
    sessions: deps?.sessions ?? getMicroOAuthSessionStore(),
    fetchImpl: deps?.fetchImpl ?? fetch,
    fetchAuthorizedAccounts: deps?.fetchAuthorizedAccounts
  };
}

export async function getMicroOAuthStatus(
  uid: string,
  deps?: MicroOAuthServiceDeps
): Promise<{
  oauth: MicroTokenPublicStatus;
  appConfigured: boolean;
  missingAppConfig: string[];
  redirectUri: string | null;
  scope: "accounts";
  tradingScope: "NOT_REQUESTED";
  mutationSurface: "NONE";
  realConnectionStatus: "AWAITING_USER_AUTHORIZATION" | "TOKEN_PRESENT" | "DISCONNECTED";
}> {
  const { vault } = getDeps(deps);
  const app = loadMicroCTraderAppConfig();
  const oauth = await vault.getPublicStatus(uid);
  let realConnectionStatus:
    | "AWAITING_USER_AUTHORIZATION"
    | "TOKEN_PRESENT"
    | "DISCONNECTED" = "AWAITING_USER_AUTHORIZATION";
  if (oauth.status === "DISCONNECTED") realConnectionStatus = "DISCONNECTED";
  else if (oauth.configured && oauth.status === "CONNECTED") {
    realConnectionStatus = "TOKEN_PRESENT";
  }
  return {
    oauth,
    appConfigured: app.ok,
    missingAppConfig: app.ok ? [] : app.missing,
    redirectUri: app.ok ? app.config.redirectUri : null,
    scope: "accounts",
    tradingScope: "NOT_REQUESTED",
    mutationSurface: "NONE",
    realConnectionStatus
  };
}

export async function startMicroOAuth(
  uid: string,
  deps?: MicroOAuthServiceDeps
): Promise<MicroOAuthStartResult> {
  const { sessions } = getDeps(deps);
  const app = loadMicroCTraderAppConfig();
  if (!app.ok) {
    throw Object.assign(new Error("MICRO_OAUTH_APP_CONFIG_MISSING"), {
      code: "oauth_missing",
      missing: app.missing
    });
  }
  const session = await sessions.create({
    uid,
    redirectUri: app.config.redirectUri
  });
  // Pass sessionId as a path/query on OUR redirect only — not as undocumented cTrader param.
  // Authorization URL uses only documented params.
  const authorizationUrl = buildMicroAccountsAuthorizationUrl({
    clientId: app.config.clientId,
    redirectUri: app.config.redirectUri,
    authUrl: app.config.authUrl
  });
  microLog("MICRO_OAUTH_START", { uidHash: uid.slice(0, 6), sessionStarted: true });
  return {
    authorizationUrl,
    sessionId: session.sessionId,
    scope: "accounts",
    tradingScopeRequested: false,
    redirectUri: app.config.redirectUri,
    confirmation: {
      permissionRequested: "VIEW-ONLY ACCOUNT ACCESS",
      tradingPermission: "NOT REQUESTED",
      brokerOrders: "IMPOSSIBLE FROM MICRO EDGE"
    }
  };
}

/**
 * Complete OAuth callback. Code is single-use.
 * sessionId must be supplied by the frontend (stored before redirect).
 */
export async function completeMicroOAuthCallback(args: {
  uid: string;
  code: string;
  sessionId: string;
  explicitAccountId?: string | null;
  deps?: MicroOAuthServiceDeps;
}): Promise<MicroOAuthCallbackResult> {
  const { vault, sessions, fetchImpl, fetchAuthorizedAccounts } = getDeps(
    args.deps
  );
  const app = loadMicroCTraderAppConfig();
  if (!app.ok) {
    return {
      ok: false,
      code: "oauth_missing",
      message: `Missing app config: ${app.missing.join(", ")}`
    };
  }

  const code = args.code.trim();
  if (!code) {
    return { ok: false, code: "oauth_missing", message: "Authorization code missing" };
  }

  const codeHash = hashAuthorizationCode(code);
  if (usedCodeHashes.has(codeHash)) {
    return {
      ok: false,
      code: "oauth_code_reuse",
      message: "Authorization code already used"
    };
  }

  let session;
  try {
    session = await sessions.consume({
      sessionId: args.sessionId,
      uid: args.uid
    });
  } catch (e) {
    return {
      ok: false,
      code: (e as { code?: string }).code ?? "oauth_session_invalid",
      message: (e as Error).message
    };
  }

  if (session.redirectUri !== app.config.redirectUri) {
    return {
      ok: false,
      code: "oauth_session_invalid",
      message: "Redirect URI mismatch"
    };
  }

  let tokens;
  try {
    tokens = await exchangeMicroAuthorizationCode({
      code,
      clientId: app.config.clientId,
      clientSecret: app.config.clientSecret,
      redirectUri: app.config.redirectUri,
      tokenUrl: app.config.tokenUrl,
      fetchImpl
    });
  } catch (e) {
    return {
      ok: false,
      code: (e as { code?: string }).code ?? "oauth_exchange_failed",
      message: "Token exchange failed"
    };
  }
  usedCodeHashes.add(codeHash);

  let accounts: MicroAuthorizedAccount[] = [];
  if (fetchAuthorizedAccounts) {
    try {
      accounts = await fetchAuthorizedAccounts({
        accessToken: tokens.accessToken,
        clientId: app.config.clientId,
        clientSecret: app.config.clientSecret,
        environment: app.config.environment
      });
    } catch {
      return {
        ok: false,
        code: "account_not_authorized",
        message: "Failed to retrieve authorized account list"
      };
    }
  }

  const selection = selectMicroAccount({
    accounts,
    intendedEnvironment: app.config.environment,
    explicitAccountId: args.explicitAccountId
  });

  const now = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + Math.max(0, tokens.expiresIn) * 1000
  ).toISOString();

  if (!selection.ok) {
    if (selection.reason === "MULTIPLE_COMPATIBLE_NEED_SELECTION") {
      // Persist tokens without selected account — UI must choose.
      const record: MicroTokenRecord = {
        uid: args.uid,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt,
        expiresIn: tokens.expiresIn,
        environment: app.config.environment,
        authorizedAccountIds: accounts.map((a) => a.accountId),
        selectedAccountId: null,
        scope: "accounts",
        createdAt: now,
        updatedAt: now,
        lastRefreshAt: null,
        tokenVersion: 1,
        status: "CONNECTED"
      };
      await vault.saveTokens(record);
      return {
        ok: true,
        status: "ACCOUNT_SELECTION_REQUIRED",
        environment: app.config.environment,
        selectedAccountIdMasked: null,
        accounts: toSafeAccountMetadata(accounts)
      };
    }
    return {
      ok: false,
      code: selection.reason.toLowerCase(),
      message: selection.reason
    };
  }

  const record: MicroTokenRecord = {
    uid: args.uid,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt,
    expiresIn: tokens.expiresIn,
    environment: app.config.environment,
    authorizedAccountIds: accounts.map((a) => a.accountId),
    selectedAccountId: selection.selectedAccountId,
    scope: "accounts",
    createdAt: now,
    updatedAt: now,
    lastRefreshAt: null,
    tokenVersion: 1,
    status: "CONNECTED"
  };
  await vault.saveTokens(record);
  microLog("MICRO_OAUTH_CONNECTED", {
    environment: app.config.environment,
    accountCount: accounts.length
  });

  return {
    ok: true,
    status: "CONNECTED",
    environment: app.config.environment,
    selectedAccountIdMasked:
      selection.selectedAccountId.length <= 4
        ? `****${selection.selectedAccountId}`
        : `****${selection.selectedAccountId.slice(-4)}`,
    accounts: toSafeAccountMetadata(accounts)
  };
}

export async function selectMicroOAuthAccount(args: {
  uid: string;
  accountId: string;
  authorizedAccounts?: MicroAuthorizedAccount[];
  deps?: MicroOAuthServiceDeps;
}): Promise<MicroOAuthCallbackResult> {
  const { vault } = getDeps(args.deps);
  const existing = await vault.getTokens(args.uid);
  if (!existing) {
    return {
      ok: false,
      code: "oauth_missing",
      message: "No Micro token — authorize first"
    };
  }
  const accounts =
    args.authorizedAccounts ??
    existing.authorizedAccountIds.map((id) => ({
      accountId: id,
      isLive: existing.environment === "LIVE" ? true : false,
      traderLogin: null,
      brokerHint: null
    }));
  const selection = selectMicroAccount({
    accounts,
    intendedEnvironment: existing.environment,
    explicitAccountId: args.accountId
  });
  if (!selection.ok) {
    return {
      ok: false,
      code: selection.reason.toLowerCase(),
      message: selection.reason
    };
  }
  await vault.saveTokens({
    ...existing,
    selectedAccountId: selection.selectedAccountId,
    updatedAt: new Date().toISOString(),
    status: "CONNECTED"
  });
  return {
    ok: true,
    status: "CONNECTED",
    environment: existing.environment,
    selectedAccountIdMasked:
      selection.selectedAccountId.length <= 4
        ? `****${selection.selectedAccountId}`
        : `****${selection.selectedAccountId.slice(-4)}`,
    accounts: toSafeAccountMetadata(accounts)
  };
}

export async function disconnectMicroOAuth(
  uid: string,
  deps?: MicroOAuthServiceDeps
): Promise<{
  ok: true;
  status: "DISCONNECTED";
  remoteRevocation: "NOT_CLAIMED";
  coreUnaffected: true;
}> {
  const { vault } = getDeps(deps);
  await vault.clearTokens(uid);
  microLog("MICRO_OAUTH_DISCONNECTED", { localOnly: true });
  return {
    ok: true,
    status: "DISCONNECTED",
    remoteRevocation: "NOT_CLAIMED",
    coreUnaffected: true
  };
}

/**
 * Build runtime credentials from vault for collector.
 * Does NOT read Core CTRADER_ACCESS_TOKEN / CTRADER_REFRESH_TOKEN.
 */
export async function credentialsFromVault(
  uid: string,
  deps?: MicroOAuthServiceDeps
): Promise<MicroCTraderCredentials | null> {
  const { vault } = getDeps(deps);
  const app = loadMicroCTraderAppConfig();
  if (!app.ok) return null;
  const tokens = await vault.getTokens(uid);
  if (!tokens || !tokens.selectedAccountId) return null;
  if (tokens.status === "DISCONNECTED" || tokens.status === "TOKEN_REFRESH_FAILED") {
    return null;
  }
  return {
    clientId: app.config.clientId,
    clientSecret: app.config.clientSecret,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accountId: tokens.selectedAccountId,
    environment: tokens.environment,
    tokenUrl: app.config.tokenUrl,
    authUrl: app.config.authUrl,
    redirectUri: app.config.redirectUri
  };
}

export async function refreshVaultTokensIfNeeded(
  uid: string,
  deps?: MicroOAuthServiceDeps
): Promise<MicroTokenRecord | null> {
  const { vault, fetchImpl } = getDeps(deps);
  const app = loadMicroCTraderAppConfig();
  if (!app.ok) return null;
  const tokens = await vault.getTokens(uid);
  if (!tokens) return null;
  const expiresAt = Date.parse(tokens.expiresAt);
  const skewMs = 60_000;
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > skewMs) {
    return tokens;
  }
  if (!tokens.refreshToken) {
    await vault.markStatus(uid, "TOKEN_REFRESH_REQUIRED");
    return null;
  }
  try {
    const next = await refreshMicroAccessToken({
      refreshToken: tokens.refreshToken,
      clientId: app.config.clientId,
      clientSecret: app.config.clientSecret,
      tokenUrl: app.config.tokenUrl,
      fetchImpl
    });
    return await vault.replaceAfterRefresh(uid, next);
  } catch {
    await vault.markStatus(uid, "TOKEN_REFRESH_FAILED");
    return null;
  }
}

/** Test helper — clear used code hashes. */
export function resetUsedOAuthCodesForTests(): void {
  usedCodeHashes.clear();
}

/** Re-export parse for account-list wiring without transport import cycles in tests. */
export { parseAuthorizedAccounts };
