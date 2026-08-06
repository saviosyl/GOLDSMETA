/**
 * User-facing copy helpers — hide technical IDs unless expanded.
 */

import { formatLocalTimestamp } from "./timezone";

export function formatSession(raw: string | null | undefined): string {
  if (!raw) return "—";
  const key = raw.toUpperCase().replace(/\s+/g, "");
  const map: Record<string, string> = {
    NEWYORK: "New York",
    LONDON: "London",
    ASIA: "Asia",
    OVERLAP: "London / New York overlap",
    TOKYO: "Tokyo",
    SYDNEY: "Sydney"
  };
  return map[key] ?? raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Local-first timestamp for ordinary UI (UTC secondary via timezone helpers). */
export function formatUserTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const formatted = formatLocalTimestamp(iso);
  if (formatted.timeZone === "UTC") return `${formatted.primary} UTC`;
  return `${formatted.primary} · ${formatted.timeZone}`;
}

export function plainLanguageReason(codes: string[] | undefined, fallback?: string): string {
  const joined = (codes ?? []).join(" ").toUpperCase();
  if (!joined && fallback) return fallback;
  if (joined.includes("ONE-ACTIVE") || joined.includes("ONE_ACTIVE") || joined.includes("STILL OPEN")) {
    return "A new setup was not created because another plan is still being tracked.";
  }
  if (joined.includes("CONFLICTED_DATA") || joined.includes("CONFLICTED")) {
    return "Verified signals currently disagree.";
  }
  if (joined.includes("NO APPROVED STRATEGY") || joined.includes("NO_APPROVED")) {
    return "No approved setup pattern is present yet.";
  }
  if (joined.includes("CONFIRMATION")) {
    return "Multi-bar confirmation is still incomplete.";
  }
  if (joined.includes("RISK_GEOMETRY") || joined.includes("INVALID_RISK")) {
    return "Risk geometry does not meet GoldMeta’s safety floors yet.";
  }
  if (joined.includes("WAIT") || joined.includes("GATES")) {
    return "Mandatory gates have not all cleared for a setup.";
  }
  return fallback ?? "GoldMeta is waiting for a clearer verified setup.";
}

export function humanDecisionState(decision: string | null | undefined): string {
  const d = (decision ?? "WAIT").toUpperCase();
  if (d === "WAIT") return "Waiting";
  if (d === "BUY") return "Buy";
  if (d === "SELL") return "Sell";
  return d;
}

/** Map wizard / readiness machine statuses to beginner-friendly labels. */
export function wizardStatusLabel(status: string | null | undefined): string {
  const s = (status ?? "").toUpperCase().replace(/\s+/g, "_");
  const map: Record<string, string> = {
    NOT_STARTED: "Not started",
    SETUP_REQUIRED: "Action required",
    AVAILABLE: "Action required",
    ACTION_REQUIRED: "Action required",
    IN_PROGRESS: "Partially complete",
    PARTIAL: "Partially complete",
    PARTIALLY_COMPLETE: "Partially complete",
    COMPLETE: "Complete",
    COMPLETED: "Complete",
    BLOCKED: "On hold",
    LOCKED: "On hold"
  };
  return map[s] ?? status?.replace(/_/g, " ") ?? "Not started";
}

export function wizardStatusTone(
  status: string | null | undefined
): "neutral" | "positive" | "warning" | "negative" | "gold" {
  const s = (status ?? "").toUpperCase();
  if (s.includes("PARTIAL") || s.includes("IN_PROGRESS") || s.includes("PROGRESS")) return "gold";
  if (s.includes("COMPLETE")) return "positive";
  if (s.includes("BLOCK") || s.includes("LOCK") || s.includes("ERROR")) return "negative";
  if (s.includes("AVAILABLE") || s.includes("SETUP") || s.includes("ACTION") || s.includes("REQUIRED")) {
    return "warning";
  }
  return "neutral";
}

/** Approval / account role labels — never show USER_PENDING raw in normal UI. */
export function approvalStatusLabel(status: string | null | undefined): string {
  const s = (status ?? "").toUpperCase().replace(/\s+/g, "_");
  const map: Record<string, string> = {
    USER_PENDING: "Waiting for approval",
    PENDING: "Waiting for approval",
    AWAITING_APPROVAL: "Waiting for approval",
    APPROVED: "Approved",
    ACTIVE: "Approved",
    REJECTED: "Not approved",
    SUSPENDED: "Suspended",
    EMAIL_UNVERIFIED: "Email not verified",
    VERIFIED: "Verified"
  };
  return map[s] ?? (status ? status.replace(/_/g, " ") : "Unknown");
}

export function roleLabel(role: string | null | undefined): string {
  const r = (role ?? "").toUpperCase();
  if (r === "OWNER") return "Owner";
  if (r === "ADMIN") return "Admin";
  if (r === "USER" || r === "MEMBER" || r === "USER_APPROVED") return "Member";
  if (r === "USER_PENDING") return "Waiting for approval";
  return role?.replace(/_/g, " ") ?? "Member";
}

export function brokerDisplayName(id: string | null | undefined, fallbackName?: string): string {
  const map: Record<string, string> = {
    manual: "Manual",
    trading212_invest: "Trading 212 Practice",
    pepperstone_ctrader: "Pepperstone cTrader",
    PEPPERSTONE_CTRADER: "Pepperstone cTrader",
    T212_INVEST: "Trading 212 Practice",
    MANUAL: "Manual"
  };
  if (id && map[id]) return map[id];
  return (
    fallbackName
      ?.replace(/PEPPERSTONE\s*cTRADER\s*CFD/i, "Pepperstone cTrader Demo")
      .replace(/TRADING\s*212\s*INVEST/i, "Trading 212 Practice")
      .replace(/\bMANUAL\b/i, "Manual") ?? "Broker"
  );
}

export function brokerBadgeLabel(badge: string | null | undefined): string {
  const b = (badge ?? "").toUpperCase();
  const map: Record<string, string> = {
    MANUAL: "Manual",
    READ_ONLY: "Read only",
    PREVIEW: "Preview",
    DEMO_PREVIEW: "Preview",
    DEMO: "Demo",
    PARKED: "Coming later",
    CONNECTED: "Connected",
    LIVE_LOCKED: "Preview — Live not active"
  };
  return map[b] ?? (badge ? badge.replace(/_/g, " ") : "Status");
}

export function connectionStatusLabel(raw: string | null | undefined): string {
  const s = (raw ?? "").toUpperCase().replace(/\s+/g, "_");
  const map: Record<string, string> = {
    CONNECTED: "Connected",
    SETUP_REQUIRED: "Setup required",
    CTRADER_SETUP_REQUIRED: "Pepperstone connection required",
    AUTH_SETUP_REQUIRED: "Connection setup required",
    DISCONNECTED: "Not connected",
    WAITING_FOR_APPROVAL: "Waiting for approval",
    VERIFIED: "Verified",
    TRADING_LOCKED: "Trading locked",
    READ_ONLY: "Read only",
    DEMO: "Demo",
    LIVE_LOCKED: "Live not active in preview",
    ERROR: "Error",
    ACTION_REQUIRED: "Action required",
    NOT_HEALTHY: "Action required",
    HEALTHY: "Verified",
    UNKNOWN: "Setup required"
  };
  return map[s] ?? (raw ? raw.replace(/_/g, " ") : "Setup required");
}

export type FriendlyApiMapping = {
  message: string;
  whatHappened: string;
  impact: string;
  nextStep: string;
};

export function friendlyApiCode(
  code: string,
  serverMessage: string,
  status?: number
): FriendlyApiMapping {
  const c = (code ?? "").toUpperCase();
  const msg = serverMessage ?? "";

  if (
    c.includes("CONFIGURATION_REQUIRED") ||
    c.includes("CTRADER_SETUP") ||
    c.includes("SETUP_REQUIRED") ||
    /CTRADER_CLIENT|Missing CTRADER|Encryption key unavailable|Redirect URI not configured/i.test(
      msg
    )
  ) {
    return {
      message: "Pepperstone server configuration is incomplete.",
      whatHappened:
        "GoldMeta identified specific missing non-secret configuration items required for OAuth.",
      impact: "Market analysis still works. Broker connection and trading stay locked. AutoTrade stays OFF.",
      nextStep:
        "Open Broker Control Centre and fix the listed missing configuration items, then press Authorise Demo Trading."
    };
  }

  if (c.includes("AUTH_SETUP") || /AUTH SETUP REQUIRED/i.test(msg)) {
    return {
      message: "Pepperstone connection could not be started yet.",
      whatHappened: "Account security checks must pass before a broker connection can begin.",
      impact: "Dashboard and analysis remain available. Broker connect stays disabled.",
      nextStep: "Try again later from the Broker Control Centre, or contact the owner if this persists."
    };
  }

  if (
    c === "ACCESS_DENIED" ||
    c.includes("TOKEN_REFRESH_FAILED") ||
    c.includes("TOKEN_EXPIRED") ||
    c.includes("CTRADER_TOKEN_EXPIRED")
  ) {
    return {
      message: "Pepperstone session expired. Please reconnect from Broker Control Centre.",
      whatHappened: "The stored Pepperstone session could not be refreshed or was denied.",
      impact: "Read-only broker data pauses until you reconnect. AutoTrade stays OFF. No orders are submitted.",
      nextStep: "Tap Reconnect cTrader, complete OAuth again, then refresh accounts."
    };
  }

  if (c.includes("VERSION_CONFLICT") || c.includes("TOKEN_VERSION_CONFLICT")) {
    return {
      message: "Broker connection was updated elsewhere. Reloading the latest state.",
      whatHappened: "A concurrent token refresh won compare-and-set; the previous write was discarded safely.",
      impact: "No tokens were partially overwritten. AutoTrade stays OFF.",
      nextStep: "Wait for the page to reload the winning connection state, then continue."
    };
  }

  if (c.includes("OAUTH") || /OAuth/i.test(msg)) {
    return {
      message: "Pepperstone connection could not be completed. Please restart the connection from the Broker Control Centre.",
      whatHappened: "The secure sign-in with Pepperstone did not finish.",
      impact: "No orders were placed. Analysis still works.",
      nextStep: "Return to Broker Control Centre and start the connection again."
    };
  }

  if (c.includes("LIVE_SELECTION_CONFIRMATION") || c.includes("LIVE_ACTIVATION")) {
    return {
      message: "Live AutoTrade needs an explicit confirmation.",
      whatHappened: "A Live (real money) action was requested without confirmation.",
      impact: "Live AutoTrade stays OFF. Demo settings are unchanged.",
      nextStep: "Review the Live confirmation screen and type ENABLE LIVE."
    };
  }

  if (c.includes("LIVE_ACCOUNT") || (c.includes("CTRADER_LIVE") && c.includes("REJECT"))) {
    return {
      message: "Live account selection needs confirmation. Order execution stays disabled in this preview.",
      whatHappened: "A Live (real money) account action was blocked or needs confirmation.",
      impact: "Demo settings are unchanged. No orders are submitted.",
      nextStep: "Select the account again and complete the Live confirmation if prompted."
    };
  }

  if (c.includes("QUOTE_STALE") || c.includes("STALE")) {
    return {
      message: "Market quote is stale.",
      whatHappened: "The last bid/ask is older than the safety window.",
      impact: "Trade previews are blocked until a fresh quote arrives.",
      nextStep: "Wait for a live Demo quote refresh, then try again."
    };
  }

  if (c.includes("OWNER_ONLY") || c.includes("CTRADER_OWNER")) {
    return {
      message: "This broker action is not available for your account.",
      whatHappened: "Access was denied for this broker operation.",
      impact: "Your analysis access is unchanged.",
      nextStep: "Sign in with a verified active account and open AutoTrade."
    };
  }

  if (
    c.includes("MARGIN_ELIGIBILITY_UNKNOWN") ||
    (c.includes("MARGIN") && c.includes("UNKNOWN"))
  ) {
    return {
      message: "Margin information is not available yet. Trading remains locked.",
      whatHappened: "The broker has not returned complete margin metadata.",
      impact: "Previews and automation stay locked until margin data is available.",
      nextStep: "Refresh diagnostics after the broker connection is healthy."
    };
  }

  if (
    c.includes("VOLUME_BELOW_MINIMUM") ||
    c.includes("VOLUME_BELOW_MINIMUM_AFTER_ROUNDING")
  ) {
    return {
      message: "Your selected risk is too low for the broker’s minimum trade size.",
      whatHappened: "Calculated size is below the broker minimum after rounding.",
      impact: "No order is submitted. Your saved risk setting is unchanged.",
      nextStep: "Increase risk, switch to manual lots that meet the minimum, or choose another account."
    };
  }

  if (
    c.includes("BROKER_EXECUTION") ||
    c.includes("ORDER_SUBMISSION") ||
    /BROKER_EXECUTION_ENABLED\s*=\s*false/i.test(msg)
  ) {
    return {
      message: "Order submission is currently disabled in this preview.",
      whatHappened: "Preview locks prevent Demo and Live order submission.",
      impact: "AutoTrade stays OFF. Settings and previews still work.",
      nextStep: "Continue configuration. Execution will require a later approved phase."
    };
  }

  if (status === 403 || c === "FORBIDDEN" || /403/.test(msg)) {
    return {
      message: "You do not have access to this feature yet.",
      whatHappened: "This action needs a higher access level or owner approval.",
      impact: "Account features you already have still work. This specific action is blocked.",
      nextStep: "If you recently registered, wait for approval. Otherwise open Help or contact support."
    };
  }

  if (status === 401 || c === "UNAUTHORIZED") {
    return {
      message: "Your session has expired. Please sign in again.",
      whatHappened: "GoldMeta could not confirm you are still signed in.",
      impact: "Protected pages are unavailable until you sign in again.",
      nextStep: "Sign in again. Your analysis settings are kept."
    };
  }

  if (status === 429 || c.includes("RATE")) {
    return {
      message: "Please wait a moment before trying again.",
      whatHappened: "Too many requests were sent in a short time.",
      impact: "This action is temporarily paused.",
      nextStep: "Wait a minute, then retry."
    };
  }

  if (c === "NOT_FOUND" || status === 404) {
    return {
      message: "That information is not available yet.",
      whatHappened: "GoldMeta looked for a record that is not ready or no longer exists.",
      impact: "Other pages should still work.",
      nextStep: "Refresh the page or return to the Dashboard."
    };
  }

  // Prefer a clean server message when it already looks human; otherwise fallback.
  const humanish =
    msg &&
    !/[A-Z]{3,}_[A-Z0-9_]+/.test(msg) &&
    !/auth\//i.test(msg) &&
    msg.length < 180
      ? msg
      : "Something went wrong. Please try again.";

  return {
    message: humanish,
    whatHappened: humanish,
    impact: "Some information on this page may be incomplete. Trading stays locked.",
    nextStep: "Tap Retry if available, or refresh the page."
  };
}

/** Market structure plain labels for beginners. */
export function structureLevelLabel(key: "poc" | "vah" | "val"): string {
  if (key === "poc") return "Fair value (POC)";
  if (key === "vah") return "High value (VAH)";
  return "Low value (VAL)";
}
