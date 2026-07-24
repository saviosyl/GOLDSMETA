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
    message: "Only the GoldMeta owner can manage the Pepperstone connection.",
    whatHappened: "This action is restricted to the pinned owner account.",
    impact: "Your analysis access is unchanged. Owner tokens stay private.",
    nextStep: "Ask the owner to complete connection setup from Broker Control Centre."
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
    message: "Pepperstone sign-in did not match the owner account.",
    whatHappened: "OAuth state ownership check failed.",
    impact: "No connection was created.",
    nextStep: "Sign in as the owner and restart the connection."
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
    message: "Pepperstone is not connected yet.",
    whatHappened: "No Demo OAuth connection is stored for the owner.",
    impact: "Live Demo data and previews are unavailable.",
    nextStep: "Connect a Pepperstone cTrader Demo account from Broker Control Centre."
  },
  CTRADER_DEMO_ACCOUNT_NOT_FOUND: {
    message: "That Demo account could not be found.",
    whatHappened: "The selected account is missing from the Demo discovery list.",
    impact: "No account was selected.",
    nextStep: "Refresh the Demo account list and choose an active Demo account."
  },
  CTRADER_LIVE_ACCOUNT_REJECTED: {
    message: "Live cTrader accounts cannot be connected in this phase.",
    whatHappened: "A Live account was offered and rejected.",
    impact: "Only Demo accounts are allowed. Trading stays locked.",
    nextStep: "Select a genuine Pepperstone cTrader Demo account."
  },
  CTRADER_ACCOUNT_OR_SYMBOL_REQUIRED: {
    message: "Select a Demo account and confirm gold symbol first.",
    whatHappened: "Account or XAUUSD symbol metadata is not ready.",
    impact: "Quotes and previews stay unavailable.",
    nextStep: "Complete Demo account selection so GoldMeta can discover the gold symbol."
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
    message: "Pepperstone connection could not be started yet.",
    whatHappened: "Owner Auth integrity must be HEALTHY before OAuth.",
    impact: "Broker connect stays disabled. Dashboard still works.",
    nextStep: "Resolve Auth health, then retry from Broker Control Centre."
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
