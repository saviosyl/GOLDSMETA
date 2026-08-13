/**
 * Micro Edge OAuth service — scope=accounts only.
 * Isolated from Core cTrader OAuth routes/services.
 *
 * Replay protection: durable OAuth session consume is authoritative.
 * usedCodeHashes is a local optimization only — NOT the security boundary.
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
  brokerMatchesAllowlist,
  selectMicroAccount,
  toSafeAccountMetadata,
  toStoredAccountMeta,
  type MicroAuthorizedAccount
} from "./accountSelection";
import { microLog } from "./microLog";

/**
 * Process-local optimization only. Authoritative replay protection is the
 * single-use durable OAuth session consume (Firestore in deployed mode).
 */
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
      permissionScope: "SCOPE_VIEW";
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
  /**
   * Must return genuine cTrader account objects (with authoritative isLive).
   * Must fail closed on SCOPE_TRADE.
   */
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

function maskSelected(id: string | null): string | null {
  if (!id) return null;
  return id.length <= 4 ? `****${id}` : `****${id.slice(-4)}`;
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
  /** Token present ≠ market feed connected. */
  authorizationStatus:
    | "AWAITING_USER_AUTHORIZATION"
    | "READ_ONLY_AUTHORIZED"
    | "DISCONNECTED"
    | "TOKEN_REFRESH_REQUIRED"
    | "TOKEN_REFRESH_FAILED";
  realConnectionStatus: "AWAITING_USER_AUTHORIZATION" | "TOKEN_PRESENT" | "DISCONNECTED";
}> {
  const { vault } = getDeps(deps);
  const app = loadMicroCTraderAppConfig();
  const oauth = await vault.getPublicStatus(uid);
  let authorizationStatus:
    | "AWAITING_USER_AUTHORIZATION"
    | "READ_ONLY_AUTHORIZED"
    | "DISCONNECTED"
    | "TOKEN_REFRESH_REQUIRED"
    | "TOKEN_REFRESH_FAILED" = "AWAITING_USER_AUTHORIZATION";
  if (oauth.status === "DISCONNECTED") authorizationStatus = "DISCONNECTED";
  else if (oauth.status === "TOKEN_REFRESH_REQUIRED") {
    authorizationStatus = "TOKEN_REFRESH_REQUIRED";
  } else if (
    oauth.status === "TOKEN_REFRESH_FAILED" ||
    oauth.status === "TOKEN_REFRESH_PERSIST_FAILED"
  ) {
    authorizationStatus = "TOKEN_REFRESH_FAILED";
  } else if (oauth.configured && oauth.status === "CONNECTED") {
    authorizationStatus = "READ_ONLY_AUTHORIZED";
  }
  return {
    oauth,
    appConfigured: app.ok,
    missingAppConfig: app.ok ? [] : app.missing,
    redirectUri: app.ok ? app.config.redirectUri : null,
    scope: "accounts",
    tradingScope: "NOT_REQUESTED",
    mutationSurface: "NONE",
    authorizationStatus,
    realConnectionStatus:
      authorizationStatus === "READ_ONLY_AUTHORIZED"
        ? "TOKEN_PRESENT"
        : authorizationStatus === "DISCONNECTED"
          ? "DISCONNECTED"
          : "AWAITING_USER_AUTHORIZATION"
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

  // Durable session consume is the security boundary (cross-instance safe).
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

  // Local optimization only — session already consumed.
  const codeHash = hashAuthorizationCode(code);
  if (usedCodeHashes.has(codeHash)) {
    return {
      ok: false,
      code: "oauth_code_reuse",
      message: "Authorization code already used"
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

  if (!fetchAuthorizedAccounts) {
    return {
      ok: false,
      code: "account_list_required",
      message: "Account list revalidation required — refuse to store unverified accounts"
    };
  }

  let accounts: MicroAuthorizedAccount[] = [];
  try {
    accounts = await fetchAuthorizedAccounts({
      accessToken: tokens.accessToken,
      clientId: app.config.clientId,
      clientSecret: app.config.clientSecret,
      environment: app.config.environment
    });
  } catch (e) {
    const codeErr = (e as { code?: string }).code ?? "account_not_authorized";
    return {
      ok: false,
      code: codeErr,
      message:
        codeErr === "MICRO_TRADING_SCOPE_REJECTED"
          ? "MICRO_TRADING_SCOPE_REJECTED"
          : "Failed to retrieve authorized account list"
    };
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
  const storedMeta = toStoredAccountMeta(accounts);

  if (!selection.ok) {
    if (selection.reason === "MULTIPLE_COMPATIBLE_NEED_SELECTION") {
      const record: MicroTokenRecord = {
        uid: args.uid,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt,
        expiresIn: tokens.expiresIn,
        environment: app.config.environment,
        authorizedAccountIds: accounts.map((a) => a.accountId),
        authorizedAccounts: storedMeta,
        selectedAccountId: null,
        selectedAccountMeta: null,
        permissionScope: "SCOPE_VIEW",
        brokerVerified: null,
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
        accounts: toSafeAccountMetadata(accounts, app.config.environment),
        permissionScope: "SCOPE_VIEW"
      };
    }
    return {
      ok: false,
      code: selection.reason,
      message: selection.reason
    };
  }

  const brokerCheck = brokerMatchesAllowlist(selection.selected.brokerHint);
  const record: MicroTokenRecord = {
    uid: args.uid,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt,
    expiresIn: tokens.expiresIn,
    environment: app.config.environment,
    authorizedAccountIds: accounts.map((a) => a.accountId),
    authorizedAccounts: storedMeta,
    selectedAccountId: selection.selectedAccountId,
    selectedAccountMeta:
      storedMeta.find((m) => m.accountId === selection.selectedAccountId) ?? null,
    permissionScope: "SCOPE_VIEW",
    brokerVerified: brokerCheck === "MATCH",
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
    accountCount: accounts.length,
    brokerVerified: record.brokerVerified
  });

  return {
    ok: true,
    status: "CONNECTED",
    environment: app.config.environment,
    selectedAccountIdMasked: maskSelected(selection.selectedAccountId),
    accounts: toSafeAccountMetadata(accounts, app.config.environment),
    permissionScope: "SCOPE_VIEW"
  };
}

/**
 * Account selection MUST revalidate against cTrader account-list.
 * Never reconstruct isLive from Micro environment or stored id strings.
 */
export async function selectMicroOAuthAccount(args: {
  uid: string;
  accountId: string;
  deps?: MicroOAuthServiceDeps;
}): Promise<MicroOAuthCallbackResult> {
  const { vault, fetchAuthorizedAccounts } = getDeps(args.deps);
  const existing = await vault.getTokens(args.uid);
  if (!existing) {
    return {
      ok: false,
      code: "oauth_missing",
      message: "No Micro token — authorize first"
    };
  }
  if (!fetchAuthorizedAccounts) {
    return {
      ok: false,
      code: "account_list_required",
      message: "Account selection requires live cTrader account-list revalidation"
    };
  }

  const app = loadMicroCTraderAppConfig();
  if (!app.ok) {
    return {
      ok: false,
      code: "oauth_missing",
      message: `Missing app config: ${app.missing.join(", ")}`
    };
  }

  let accounts: MicroAuthorizedAccount[];
  try {
    accounts = await fetchAuthorizedAccounts({
      accessToken: existing.accessToken,
      clientId: app.config.clientId,
      clientSecret: app.config.clientSecret,
      environment: existing.environment
    });
  } catch (e) {
    const codeErr = (e as { code?: string }).code ?? "account_not_authorized";
    return {
      ok: false,
      code: codeErr,
      message:
        codeErr === "MICRO_TRADING_SCOPE_REJECTED"
          ? "MICRO_TRADING_SCOPE_REJECTED"
          : "Account-list revalidation failed"
    };
  }

  const selection = selectMicroAccount({
    accounts,
    intendedEnvironment: existing.environment,
    explicitAccountId: args.accountId
  });
  if (!selection.ok) {
    return {
      ok: false,
      code:
        selection.reason === "LIVE_ACCOUNT_NOT_ALLOWED" ||
        selection.reason === "LIVE_FORBIDDEN_FOR_DEMO_ACTIVATION"
          ? "LIVE_ACCOUNT_NOT_ALLOWED"
          : selection.reason,
      message: selection.reason
    };
  }

  const storedMeta = toStoredAccountMeta(accounts);
  const brokerCheck = brokerMatchesAllowlist(selection.selected.brokerHint);
  await vault.saveTokens({
    ...existing,
    authorizedAccountIds: accounts.map((a) => a.accountId),
    authorizedAccounts: storedMeta,
    selectedAccountId: selection.selectedAccountId,
    selectedAccountMeta:
      storedMeta.find((m) => m.accountId === selection.selectedAccountId) ?? null,
    permissionScope: "SCOPE_VIEW",
    brokerVerified: brokerCheck === "MATCH",
    updatedAt: new Date().toISOString(),
    status: "CONNECTED"
  });
  return {
    ok: true,
    status: "CONNECTED",
    environment: existing.environment,
    selectedAccountIdMasked: maskSelected(selection.selectedAccountId),
    accounts: toSafeAccountMetadata(accounts, existing.environment),
    permissionScope: "SCOPE_VIEW"
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

export async function credentialsFromVault(
  uid: string,
  deps?: MicroOAuthServiceDeps
): Promise<MicroCTraderCredentials | null> {
  const { vault } = getDeps(deps);
  const app = loadMicroCTraderAppConfig();
  if (!app.ok) return null;
  const tokens = await vault.getTokens(uid);
  if (!tokens || !tokens.selectedAccountId) return null;
  if (
    tokens.status === "DISCONNECTED" ||
    tokens.status === "TOKEN_REFRESH_FAILED" ||
    tokens.status === "TOKEN_REFRESH_PERSIST_FAILED"
  ) {
    return null;
  }
  if (tokens.permissionScope !== "SCOPE_VIEW") return null;
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
  if (tokens.status === "TOKEN_REFRESH_PERSIST_FAILED") {
    // Do not retry with potentially invalidated refresh token.
    return null;
  }
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
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "TOKEN_REFRESH_PERSIST_FAILED") {
      return null;
    }
    await vault.markStatus(uid, "TOKEN_REFRESH_FAILED");
    return null;
  }
}

export function resetUsedOAuthCodesForTests(): void {
  usedCodeHashes.clear();
}

export { parseAuthorizedAccounts } from "./accountSelection";
