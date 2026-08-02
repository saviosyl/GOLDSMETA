/**
 * Friendly cTrader error payloads — never include tokens or raw broker payloads.
 */

export type FriendlyCTraderError = {
  error: string;
  message: string;
  whatHappened: string;
  impact: string;
  nextStep: string;
};

const MAP: Record<string, Omit<FriendlyCTraderError, "error">> = {
  CTRADER_SETUP_REQUIRED: {
    message: "Pepperstone secure credentials have not been added yet.",
    whatHappened: "Client ID, client secret or redirect URI is missing on the server.",
    impact: "Broker connection stays locked. Analysis still works.",
    nextStep: "Ask the owner to store Open API credentials in Secret Manager, then retry."
  },
  CTRADER_TOKEN_ENCRYPTION_KEY_MISSING: {
    message: "Secure token storage is not configured yet.",
    whatHappened: "The server encryption key for OAuth tokens is missing.",
    impact: "OAuth cannot start. No orders are possible.",
    nextStep: "Store CTRADER_TOKEN_ENCRYPTION_KEY in Secret Manager, then retry."
  },
  CTRADER_OWNER_ONLY: {
    message: "This broker action is not available for your account.",
    whatHappened: "Access was denied for this broker operation.",
    impact: "Your own broker connection and analysis access are unchanged.",
    nextStep: "Sign in with a verified active account and try again from AutoTrade."
  },
  UNAUTHENTICATED: {
    message: "Sign in is required.",
    whatHappened: "No authenticated user was found for this request.",
    impact: "Broker data was not changed.",
    nextStep: "Sign in, then open AutoTrade again."
  },
  CTRADER_ACCOUNT_NOT_AUTHORISED: {
    message: "That broker account is not authorised for your login.",
    whatHappened: "The account ID was not returned by your cTrader OAuth connection.",
    impact: "No account was selected. Tokens stay private.",
    nextStep: "Refresh your authorised accounts and choose one from the list."
  },
  CTRADER_LIVE_SELECTION_CONFIRMATION_REQUIRED: {
    message: "Confirm Live account selection before continuing.",
    whatHappened: "A Live (real money) account was chosen without confirmation.",
    impact: "The Live account was not selected. Demo settings are unchanged.",
    nextStep: "Review the Live confirmation screen, then confirm the Live account."
  },
  CTRADER_DEMO_TRADING_LIVE_ACCOUNT_FORBIDDEN: {
    message: "Demo trading authorisation cannot use a Live account.",
    whatHappened: "A Live account was selected while authorising Demo trading.",
    impact: "No Live account was selected. AutoTrade stays OFF. No order was placed.",
    nextStep: "Select your Pepperstone Demo account only, then continue Demo trading checks."
  },
  CTRADER_TRADING_CONFIRMATION_REQUIRED: {
    message: "Confirm trading permission before continuing.",
    whatHappened: "Authorise Demo Trading was started without the confirmation flag.",
    impact: "No OAuth consent was opened. Tokens were not changed.",
    nextStep: "Confirm that you are granting trading permission for your Demo account, then retry."
  },
  CTRADER_ACCOUNT_TYPE_MISMATCH: {
    message: "That account does not match the selected Demo or Live mode.",
    whatHappened: "A Demo account was used with Live settings, or a Live account with Demo settings.",
    impact: "Settings were not saved.",
    nextStep: "Select a matching Demo or Live account for the mode you chose."
  },
  LIVE_ACTIVATION_REQUIRED: {
    message: "Live AutoTrade needs an explicit activation confirmation.",
    whatHappened: "Live enable was requested without completing Live confirmation.",
    impact: "Live AutoTrade stays OFF. Demo mode is unaffected.",
    nextStep: "Type ENABLE LIVE on the confirmation screen, then try again."
  },
  LIVE_CONFIRMATION_PHRASE_MISMATCH: {
    message: "Live confirmation phrase did not match.",
    whatHappened: "The typed confirmation was not exactly ENABLE LIVE.",
    impact: "Live AutoTrade was not activated.",
    nextStep: "Type ENABLE LIVE exactly, then confirm again."
  },
  SETTINGS_VALIDATION_FAILED: {
    message: "One or more AutoTrade settings are invalid.",
    whatHappened: "A value was outside the allowed range or format.",
    impact: "Settings were not saved.",
    nextStep: "Correct the highlighted field and save again."
  },
  OAUTH_STATE_MISSING: {
    message: "Pepperstone sign-in could not be verified.",
    whatHappened: "The OAuth state was missing or unknown.",
    impact: "No connection was created. No orders were placed.",
    nextStep: "Return to Broker Control Centre and start the connection again."
  },
  OAUTH_STATE_REPLAY: {
    message: "This Pepperstone sign-in link was already used.",
    whatHappened: "OAuth state replay protection rejected a reused callback.",
    impact: "No connection change. No orders were placed.",
    nextStep: "Start a fresh connection from Broker Control Centre."
  },
  OAUTH_STATE_EXPIRED: {
    message: "Pepperstone sign-in expired.",
    whatHappened: "The OAuth state timed out before completion.",
    impact: "No connection was created.",
    nextStep: "Start the connection again from Broker Control Centre."
  },
  OAUTH_STATE_OWNER_MISMATCH: {
    message: "Broker sign-in did not match your signed-in account.",
    whatHappened: "OAuth state ownership check failed.",
    impact: "No connection was created.",
    nextStep: "Stay signed in and restart the connection from AutoTrade."
  },
  OAUTH_REDIRECT_NOT_ALLOWLISTED: {
    message: "Pepperstone redirect URL was rejected.",
    whatHappened: "The redirect URI did not match the server allowlist.",
    impact: "OAuth stopped. No tokens were stored.",
    nextStep: "Confirm the Open API redirect URI matches the GoldMeta callback exactly."
  },
  OAUTH_CANCELLED: {
    message: "Pepperstone sign-in was cancelled.",
    whatHappened: "The OAuth provider returned without an authorization code.",
    impact: "No connection was created.",
    nextStep: "Try Connect Pepperstone again when ready."
  },
  CTRADER_NOT_CONNECTED: {
    message: "Your broker is not connected yet.",
    whatHappened: "No cTrader OAuth connection is stored for your account.",
    impact: "Quotes and previews are unavailable.",
    nextStep: "Connect your cTrader account from AutoTrade or Broker Control Centre."
  },
  CTRADER_DEMO_ACCOUNT_NOT_FOUND: {
    message: "That broker account could not be found.",
    whatHappened: "The selected account is missing from your authorised account list.",
    impact: "No account was selected.",
    nextStep: "Refresh your authorised accounts and choose Demo or Live."
  },
  CTRADER_LIVE_ACCOUNT_REJECTED: {
    message: "Live account selection needs a separate confirmation.",
    whatHappened: "A Live account was chosen without the Live confirmation step.",
    impact: "The Live account was not selected. Order submission stays disabled.",
    nextStep: "Use the Live confirmation flow, then select the Live account."
  },
  CTRADER_ACCOUNT_OR_SYMBOL_REQUIRED: {
    message: "Select a broker account and confirm the gold symbol first.",
    whatHappened: "Account or XAUUSD symbol metadata is not ready.",
    impact: "Quotes and previews stay unavailable.",
    nextStep: "Choose a Demo or Live account so GoldMeta can discover the gold symbol."
  },
  CTRADER_SYMBOL_NOT_FOUND: {
    message: "Gold symbol could not be found on this Demo account.",
    whatHappened: "Symbol discovery did not match XAUUSD / GOLD variants.",
    impact: "Quotes and previews stay unavailable.",
    nextStep: "Confirm the Demo account trades gold, then retry symbol discovery."
  },
  CTRADER_QUOTE_STALE: {
    message: "Market quote is stale.",
    whatHappened: "The last bid/ask is older than the safety window.",
    impact: "Trade previews are blocked until a fresh quote arrives.",
    nextStep: "Wait for a live Demo quote refresh, then try the preview again."
  },
  CTRADER_QUOTE_UNAVAILABLE: {
    message: "Live Demo quote is unavailable.",
    whatHappened: "cTrader did not return a usable bid/ask.",
    impact: "Previews stay blocked. No order was placed.",
    nextStep: "Check market hours and connection health, then retry."
  },
  CTRADER_TOKEN_REFRESH_FAILED: {
    message: "Pepperstone session refresh failed.",
    whatHappened: "The stored refresh token could not obtain a new access token.",
    impact: "Live Demo data may be unavailable until you reconnect.",
    nextStep: "Disconnect and reconnect the Demo account from Broker Control Centre."
  },
  CTRADER_TOKEN_EXPIRED: {
    message: "Pepperstone session expired.",
    whatHappened: "Access token expiry was reached and refresh did not succeed.",
    impact: "Quotes and account sync pause until reconnect.",
    nextStep: "Reconnect Pepperstone from Broker Control Centre."
  },
  ACCESS_DENIED: {
    message: "Pepperstone denied this session.",
    whatHappened: "cTrader returned ACCESS_DENIED for the stored OAuth tokens.",
    impact: "Read-only broker data pauses until you reconnect. AutoTrade stays OFF.",
    nextStep: "Reconnect Pepperstone from Broker Control Centre with scope=accounts only."
  },
  CTRADER_TOKEN_VERSION_CONFLICT: {
    message: "Broker connection was updated elsewhere.",
    whatHappened: "A concurrent token refresh won compare-and-set; the stale write was discarded.",
    impact: "No partial token overwrite occurred. The winning persisted session is used.",
    nextStep: "Reload diagnostics to adopt the latest connection state."
  },
  VERSION_CONFLICT: {
    message: "Broker connection was updated elsewhere.",
    whatHappened: "A concurrent token refresh won compare-and-set; the stale write was discarded.",
    impact: "No partial token overwrite occurred. The winning persisted session is used.",
    nextStep: "Reload diagnostics to adopt the latest connection state."
  },
  CTRADER_RATE_LIMITED: {
    message: "cTrader rate limit reached.",
    whatHappened: "Too many Open API requests were sent in a short period.",
    impact: "Temporary delay for Demo data. No orders were placed.",
    nextStep: "Wait a moment, then refresh diagnostics."
  },
  CTRADER_UNAVAILABLE: {
    message: "cTrader is temporarily unavailable.",
    whatHappened: "The Open API host did not respond successfully.",
    impact: "Demo data may be stale or disconnected.",
    nextStep: "Retry shortly. Analysis continues without broker data."
  },
  AUTH_SETUP_REQUIRED: {
    message: "Broker connection could not be started yet.",
    whatHappened: "Server credentials or security checks are not ready.",
    impact: "Broker connect stays disabled. Dashboard still works.",
    nextStep: "Retry from AutoTrade after credentials are configured."
  },
  PEPPERSTONE_NOT_CONFIRMED: {
    message: "Pepperstone broker name was not confirmed.",
    whatHappened: "Account metadata did not clearly identify Pepperstone.",
    impact: "Account selection may stay incomplete until confirmed.",
    nextStep: "Confirm this is your Pepperstone Demo account, then continue."
  },
  MARKET_CLOSED: {
    message: "The gold market appears closed.",
    whatHappened: "Market status is not open for trading hours.",
    impact: "Previews may be blocked. No orders are submitted anyway.",
    nextStep: "Retry when the market is open, or use labelled demonstration data."
  }
};

export function friendlyCTraderError(code: string): FriendlyCTraderError {
  const key = (code || "CTRADER_UNAVAILABLE").toUpperCase();
  const mapped = MAP[key] ?? {
    message: "Pepperstone connection hit an unexpected problem.",
    whatHappened: "A Demo read-only operation failed.",
    impact: "Trading remains locked. Analysis may still work.",
    nextStep: "Retry from Broker Control Centre. If it persists, check diagnostics."
  };
  return { error: key, ...mapped };
}

export function sendFriendlyError(
  res: { status: (code: number) => { json: (body: unknown) => void } },
  status: number,
  code: string,
  extra?: Record<string, unknown>
): void {
  res.status(status).json({
    ...friendlyCTraderError(code),
    orderSubmissionEnabled: false,
    autoTrade: "OFF",
    ...extra
  });
}
