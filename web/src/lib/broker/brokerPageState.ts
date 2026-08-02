/**
 * Canonical Broker Control Centre page state.
 * Prevents contradictory connection/account labels and supports latest-request-wins.
 */

export type BrokerAction =
  | "load"
  | "refresh_accounts"
  | "refresh_diagnostics"
  | "connect"
  | "reconnect"
  | "disconnect"
  | "select_account"
  | "preview"
  | "demo"
  | "retry"
  | "authorise_demo_trading"
  | "first_checkpoint";

export type ActionPhase = "idle" | "pending" | "success" | "error";

export type ActionBannerTone = "info" | "success" | "error" | "warning";

export type ActionBanner = {
  tone: ActionBannerTone;
  message: string;
  action?: BrokerAction;
};

export type ConnectionPhase =
  | "loading"
  | "setup_required"
  | "connected"
  | "reconnect_required"
  | "available";

export type AccountPhase =
  | "none"
  | "analysis_only"
  | "pending"
  | "demo_selected"
  | "live_selected";

export type CanonicalBrokerView = {
  connectionPhase: ConnectionPhase;
  connectionLabel: string;
  accountPhase: AccountPhase;
  accountTypeLabel: string;
  reconnectRequired: boolean;
};

export type AuthLikeCode =
  | "ACCESS_DENIED"
  | "CTRADER_TOKEN_REFRESH_FAILED"
  | "CTRADER_TOKEN_EXPIRED"
  | "CTRADER_TOKEN_VERSION_CONFLICT"
  | "VERSION_CONFLICT"
  | "UNAUTHORIZED"
  | "UNAUTHENTICATED";

const AUTH_RECONNECT_CODES = new Set<string>([
  "ACCESS_DENIED",
  "CTRADER_TOKEN_REFRESH_FAILED",
  "CTRADER_TOKEN_EXPIRED",
  "UNAUTHORIZED",
  "UNAUTHENTICATED"
]);

const VERSION_CONFLICT_CODES = new Set<string>([
  "CTRADER_TOKEN_VERSION_CONFLICT",
  "VERSION_CONFLICT"
]);

export function isAuthReconnectCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const c = code.toUpperCase();
  if (AUTH_RECONNECT_CODES.has(c)) return true;
  return c.includes("ACCESS_DENIED") || c.includes("TOKEN_REFRESH_FAILED") || c.includes("TOKEN_EXPIRED");
}

export function isVersionConflictCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const c = code.toUpperCase();
  return VERSION_CONFLICT_CODES.has(c) || c.includes("VERSION_CONFLICT");
}

/** Extract API code from ApiError-like values without importing React types. */
export function errorCodeOf(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export type DeriveCanonicalArgs = {
  pageLoading: boolean;
  hasCentre: boolean;
  selectedBrokerId: string;
  readinessConnected: boolean;
  authSetupRequired: boolean;
  setupRequired: boolean;
  reconnectRequired: boolean;
  tokenRefreshHealthy: boolean | null;
  accountSelected: boolean;
  selectedAccountIsLive: boolean;
  demoAccountSelected: boolean;
  brokerStatusLabel?: string;
};

/**
 * Single derivation path for top-status Connection + Account type labels.
 * Rules:
 * - Connected + selected account ⇒ never "Account pending"
 * - Expired / unhealthy token ⇒ reconnect_required (not Connected)
 * - Page loading only when centre is still missing
 */
export function deriveCanonicalBrokerView(args: DeriveCanonicalArgs): CanonicalBrokerView {
  const {
    pageLoading,
    hasCentre,
    selectedBrokerId,
    readinessConnected,
    authSetupRequired,
    setupRequired,
    reconnectRequired,
    tokenRefreshHealthy,
    accountSelected,
    selectedAccountIsLive,
    demoAccountSelected,
    brokerStatusLabel
  } = args;

  if (pageLoading && !hasCentre) {
    return {
      connectionPhase: "loading",
      connectionLabel: "Loading…",
      accountPhase: "none",
      accountTypeLabel: "—",
      reconnectRequired: false
    };
  }

  const tokenUnhealthy = tokenRefreshHealthy === false;
  const needsReconnect = reconnectRequired || (readinessConnected && tokenUnhealthy);

  let connectionPhase: ConnectionPhase;
  let connectionLabel: string;

  if (needsReconnect) {
    connectionPhase = "reconnect_required";
    connectionLabel = "Reconnect required";
  } else if (readinessConnected) {
    connectionPhase = "connected";
    connectionLabel = "Connected";
  } else if (authSetupRequired || setupRequired) {
    connectionPhase = "setup_required";
    connectionLabel = "Setup required";
  } else {
    connectionPhase = "available";
    connectionLabel = brokerStatusLabel && brokerStatusLabel.trim() ? brokerStatusLabel : "Available";
  }

  let accountPhase: AccountPhase;
  let accountTypeLabel: string;

  if (selectedAccountIsLive && accountSelected) {
    accountPhase = "live_selected";
    accountTypeLabel = "Live account selected";
  } else if (accountSelected || demoAccountSelected) {
    accountPhase = "demo_selected";
    accountTypeLabel = "Demo account selected";
  } else if (selectedBrokerId === "manual") {
    accountPhase = "analysis_only";
    accountTypeLabel = "Analysis only";
  } else if (connectionPhase === "connected") {
    // Connected without a selected account — pending selection only.
    accountPhase = "pending";
    accountTypeLabel = "Account pending";
  } else {
    accountPhase = "none";
    accountTypeLabel = "—";
  }

  return {
    connectionPhase,
    connectionLabel,
    accountPhase,
    accountTypeLabel,
    reconnectRequired: needsReconnect
  };
}

/** Latest-request-wins: only apply when generation still matches. */
export function shouldApplyResponse(activeGeneration: number, responseGeneration: number): boolean {
  return responseGeneration === activeGeneration;
}

export function nextGeneration(current: number): number {
  return current + 1;
}

export function actionButtonLabel(
  action: BrokerAction,
  phase: ActionPhase,
  idleLabel: string
): string {
  if (phase === "pending") {
    switch (action) {
      case "refresh_accounts":
        return "Refreshing accounts…";
      case "refresh_diagnostics":
        return "Refreshing diagnostics…";
      case "connect":
      case "reconnect":
        return "Starting…";
      case "disconnect":
        return "Disconnecting…";
      case "select_account":
        return "Selecting…";
      case "preview":
        return "Building preview…";
      case "demo":
        return "Loading demonstration…";
      case "retry":
        return "Retrying…";
      case "load":
        return "Loading…";
      default:
        return "Working…";
    }
  }
  if (phase === "success") {
    switch (action) {
      case "refresh_accounts":
        return "Accounts updated";
      case "refresh_diagnostics":
        return "Diagnostics updated";
      case "disconnect":
        return "Disconnected";
      case "select_account":
        return "Account selected";
      case "preview":
        return "Preview ready";
      case "demo":
        return "Demonstration loaded";
      default:
        return idleLabel;
    }
  }
  return idleLabel;
}

export function successBannerFor(action: BrokerAction): string {
  switch (action) {
    case "refresh_accounts":
      return "Accounts refreshed.";
    case "refresh_diagnostics":
      return "Diagnostics refreshed.";
    case "disconnect":
      return "Pepperstone disconnected.";
    case "select_account":
      return "Broker account selected.";
    case "preview":
      return "Trade preview ready — no order submitted.";
    case "demo":
      return "Labelled demonstration loaded.";
    case "connect":
    case "reconnect":
      return "Opening Pepperstone connection…";
    default:
      return "Done.";
  }
}
