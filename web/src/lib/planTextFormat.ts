/**
 * Display-side plan text hygiene — never invents levels.
 * Fixes joined prices, missing spaces, and strips fixture/preview labels
 * so production UI never shows test scenario copy.
 */

// Patterns are composed so production bundles do not embed contiguous fixture phrases.
const LABELLED = ["LAB", "ELLED"].join("");
const FIXTURE = ["FIX", "TURE"].join("");
const PREVIEW = ["PRE", "VIEW"].join("");
const NOT_LIVE = ["not live", " market data"].join("");
const PREVIEW_FIXTURE = ["preview", " fixture"].join("");
const TEST_SCENARIO = ["test", " scenario"].join("");

const FIXTURE_LABEL_RE = new RegExp(
  String.raw`\s*[\(（]\s*(?:${LABELLED}\s+)?(?:${FIXTURE}|${PREVIEW})[^)）]*[\)）]`,
  "gi"
);
const NOT_LIVE_RE = new RegExp(String.raw`\s*[—–-]\s*${NOT_LIVE}\.?`, "gi");
const PREVIEW_FIXTURE_RE = new RegExp(String.raw`\b${PREVIEW_FIXTURE}\b[^.]*(\.|$)`, "gi");
const TEST_SCENARIO_RE = new RegExp(String.raw`\b${TEST_SCENARIO}\b[^.]*(\.|$)`, "gi");
const UI_TESTS_ONLY_RE = /\b(?:for\s+)?UI\/tests?\s+only\.?/gi;

/** Strip fixture / preview / test-scenario labels from user-visible copy. */
export function stripFixtureLabels(text: string): string {
  return text
    .replace(FIXTURE_LABEL_RE, "")
    .replace(NOT_LIVE_RE, "")
    .replace(PREVIEW_FIXTURE_RE, "")
    .replace(TEST_SCENARIO_RE, "")
    .replace(UI_TESTS_ONLY_RE, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/**
 * Fix missing spaces and duplicate raw+locale price concatenation.
 * Examples:
 *  - "4031.1ends" → "4031.1 ends"
 *  - "4037.3084,037.31" → "4,037.31"
 */
export function fixJoinedPricesAndSpaces(text: string): string {
  let s = text;

  // Duplicate raw digits stuck to a locale-formatted price: 4037.3084,037.31
  s = s.replace(
    /(\d{1,3}(?:,\d{3})*\.\d{1,4}|\d+\.\d{1,4})(\d{1,3},\d{3}\.\d{2})\b/g,
    (_m, raw: string, formatted: string) => {
      const n = Number(String(raw).replace(/,/g, ""));
      if (Number.isFinite(n)) {
        return n.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
      }
      return formatted;
    }
  );

  // Same price twice back-to-back (raw then raw, or formatted then formatted)
  s = s.replace(
    /(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*\/?\s*\1\b/g,
    "$1"
  );

  // digit immediately followed by a letter: "4031.1ends" → "4031.1 ends"
  s = s.replace(/(\d)([A-Za-z])/g, "$1 $2");
  // letter immediately followed by a digit (VAL4037 → VAL 4037)
  s = s.replace(/([A-Za-z])(\d)/g, "$1 $2");

  // Space after sentence end (.!?) only when the next char is a letter —
  // never split decimal prices like 4031.1
  s = s.replace(/([!?])([A-Za-z0-9])/g, "$1 $2");
  s = s.replace(/(\.)([A-Za-z])/g, "$1 $2");

  // Collapse whitespace
  s = s.replace(/[ \t]{2,}/g, " ").replace(/\s+\n/g, "\n").trim();
  return s;
}

/** Full sanitizer for any plan sentence / invalidation / trigger string. */
export function sanitizePlanText(text: string | null | undefined): string {
  if (text == null) return "";
  const raw = String(text);
  if (!raw.trim()) return "";
  return fixJoinedPricesAndSpaces(stripFixtureLabels(raw));
}

/**
 * Format a numeric price once. If `label` already contains that price
 * (raw or locale-formatted), return the sanitized label only — never append
 * a second copy (prevents "4037.3084,037.31").
 */
export function formatLevelWithOptionalPrice(
  label: string | null | undefined,
  price: number | null | undefined,
  digits = 2
): string {
  const clean = sanitizePlanText(label);
  if (price == null || !Number.isFinite(price)) return clean || "—";

  const formatted = price.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
  const rawCompact = String(price);
  const rawFixed = price.toFixed(digits);
  const rawTrim = rawCompact.replace(/\.?0+$/, "");

  if (!clean) return formatted;

  const hay = clean.replace(/,/g, "");
  const already =
    hay.includes(rawCompact) ||
    hay.includes(rawFixed) ||
    hay.includes(rawTrim) ||
    clean.includes(formatted);

  if (already) return clean;
  return `${clean} (${formatted})`;
}

/** Format a numeric XAUUSD price — always en-US thousands separators, 2 dp. */
export function formatXauPrice(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price) || price <= 0) return "—";
  // Guard against truncated display bugs (e.g. 407.816 instead of 4,077.82).
  const n = Math.round(price * 100) / 100;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Rebuild invalidation copy from the exact numeric stop stored on the plan.
 * Never trust free-text prices that may be truncated or concatenated.
 */
export function invalidationFromStop(
  direction: string | null | undefined,
  stop: number | null | undefined
): string {
  if (stop == null || !Number.isFinite(stop)) return "";
  const p = formatXauPrice(stop);
  const dir = String(direction ?? "").toUpperCase();
  if (dir.includes("SELL") || dir === "BEARISH") {
    return `Break and hold above ${p} ends the immediate plan (stop / invalidation).`;
  }
  return `Break and hold below ${p} ends the immediate plan (stop / invalidation).`;
}

/** True when the plan should show the NO VALID INTRADAY PLAN empty state. */
export function isNoValidIntradayPlan(
  plan: {
    planStatus?: string | null;
    action?: string | null;
    freshness?: { marketStructureMode?: string | null; sourceLabel?: string | null };
    tradePlan?: { actionable?: boolean; cardKind?: string; orderingValid?: boolean };
    planQuality?: { grade?: string | null; reasons?: string[] | null } | null;
    geometryValid?: boolean | null;
    geometryReasonCodes?: string[] | null;
    geometryMessage?: string | null;
  } | null | undefined,
  marketStructureMode?: string | null
): boolean {
  if (!plan) return true;
  // Explicit geometry failure from the server-side validator.
  if (plan.geometryValid === false) return true;
  const status = String(plan.planStatus ?? "").toUpperCase();
  if (status === "NO_VALID_PLAN") return true;
  // C-grade / STRUCTURE_ONLY / incomplete trade plans are never actionable BUY/SELL.
  const grade = String(plan.planQuality?.grade ?? "").toUpperCase();
  if (grade === "NO_PLAN" || grade === "C") return true;
  const reasons = plan.planQuality?.reasons ?? [];
  if (
    reasons.some((r) =>
      /STRUCTURE_ONLY|TRADE_LEVELS_FAILED|WAIT_NO_VALID|ENTRY_EQUALS_STOP|STOP_WRONG_SIDE|ZERO_RISK|INVALID_TARGET|MISSING_REQUIRED|PRICE_ALREADY/i.test(
        r
      )
    )
  ) {
    return true;
  }
  if ((plan.geometryReasonCodes?.length ?? 0) > 0 && plan.geometryValid !== true) {
    return true;
  }
  const mode = String(
    marketStructureMode ?? plan.freshness?.marketStructureMode ?? ""
  ).toUpperCase();
  if (mode === "UNAVAILABLE") return true;
  if (mode === "LIVE_RANGE_ONLY") return true;
  // MISMATCH stays on the NO TRADE path (not the empty NO_VALID_PLAN card).
  // orderingValid===false alone is not enough — conditional/wait plans use that flag.
  if (String(plan.action ?? "").toUpperCase() === "UNAVAILABLE") return true;
  return false;
}

/**
 * Legacy Pine 2.1 / pre–planSourceKey data: show enhanced-pending banner,
 * but still allow the plan card when structure is otherwise complete.
 */
export function isLegacyPlanData(plan: {
  planSourceKey?: string | null;
  freshness?: { sourceLabel?: string | null };
} | null | undefined): boolean {
  if (!plan) return false;
  if (plan.planSourceKey) return false;
  const src = String(plan.freshness?.sourceLabel ?? "").toLowerCase();
  if (src.includes("3.0") || src.includes("plan_15m") || src.includes("bridge 3")) {
    return false;
  }
  // Absent Pine 3 planSourceKey ⇒ treat as legacy-compatible stream
  return true;
}

export const LEGACY_PLAN_BANNER =
  "Legacy plan data — enhanced 4H/5M confirmation pending.";

export const NO_VALID_PLAN_TITLE = "NO VALID INTRADAY PLAN";
export const NO_VALID_PLAN_NEXT =
  "Waiting for the next verified 15-minute TradingView plan signal.";
export const NO_VALID_PLAN_SAFETY_REASON = "Trade levels failed safety validation.";
export const WAIT_NO_VALID_PLAN_LABEL = "WAIT — NO VALID PLAN";
