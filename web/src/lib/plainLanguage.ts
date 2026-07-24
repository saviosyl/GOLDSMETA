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
    IN_PROGRESS: "In progress",
    COMPLETE: "Complete",
    COMPLETED: "Complete",
    BLOCKED: "Blocked",
    LOCKED: "Blocked"
  };
  return map[s] ?? status?.replace(/_/g, " ") ?? "Not started";
}

export function wizardStatusTone(
  status: string | null | undefined
): "neutral" | "positive" | "warning" | "negative" | "gold" {
  const s = (status ?? "").toUpperCase();
  if (s.includes("COMPLETE")) return "positive";
  if (s.includes("BLOCK") || s.includes("LOCK") || s.includes("ERROR")) return "negative";
  if (s.includes("PROGRESS")) return "gold";
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
    pepperstone_ctrader: "Pepperstone cTrader Demo",
    ig: "IG — Coming later"
  };
  if (id && map[id]) return map[id];
  return (
    fallbackName
      ?.replace(/PEPPERSTONE\s*cTRADER\s*CFD/i, "Pepperstone cTrader Demo")
      .replace(/TRADING\s*212\s*INVEST/i, "Trading 212 Practice")
      .replace(/\bMANUAL\b/i, "Manual")
      .replace(/\bIG\b/i, "IG — Coming later") ?? "Broker"
  );
}

export function brokerBadgeLabel(badge: string | null | undefined): string {
  const b = (badge ?? "").toUpperCase();
  const map: Record<string, string> = {
    MANUAL: "Manual",
    READ_ONLY: "Read only",
    DEMO_PREVIEW: "Setup required",
    DEMO: "Demo",
    PARKED: "Coming later",
    CONNECTED: "Connected",
    LIVE_LOCKED: "Live locked"
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
    LIVE_LOCKED: "Live locked",
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
    c.includes("CTRADER_SETUP") ||
    c.includes("SETUP_REQUIRED") ||
    /CTRADER_CLIENT|Missing CTRADER/i.test(msg)
  ) {
    return {
      message: "Pepperstone secure credentials have not been added yet.",
      whatHappened: "GoldMeta is ready for connection setup, but Pepperstone API credentials are missing.",
      impact: "Market analysis still works. Broker connection and trading stay locked.",
      nextStep: "Open Broker Control Centre and follow the Pepperstone setup steps."
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

  if (c.includes("OAUTH") || /OAuth/i.test(msg)) {
    return {
      message: "Pepperstone connection could not be completed. Please restart the connection from the Broker Control Centre.",
      whatHappened: "The secure sign-in with Pepperstone did not finish.",
      impact: "No orders were placed. Analysis still works.",
      nextStep: "Return to Broker Control Centre and start the connection again."
    };
  }

  if (c.includes("LIVE_ACCOUNT") || c.includes("CTRADER_LIVE")) {
    return {
      message: "Live cTrader accounts cannot be connected in this phase.",
      whatHappened: "A Live account was rejected.",
      impact: "Only Demo accounts are allowed. Trading stays locked.",
      nextStep: "Select a genuine Pepperstone cTrader Demo account."
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
      message: "Only the GoldMeta owner can manage the Pepperstone connection.",
      whatHappened: "This broker action is restricted to the owner.",
      impact: "Your analysis access is unchanged.",
      nextStep: "Ask the owner to complete connection setup."
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
