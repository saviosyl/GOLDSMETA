/**
 * User-facing copy helpers — hide technical IDs unless expanded.
 */

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

export function formatUserTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC"
  })
    .format(d)
    .replace(",", "") + " UTC";
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
  if (d === "BUY") return "Buy bias (manual)";
  if (d === "SELL") return "Sell bias (manual)";
  return d;
}
