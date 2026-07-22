/**
 * Semantic status for GoldMeta Score components.
 * Does not change score calculations — display mapping only.
 */

export type ScoreStatus = "strong" | "partial" | "weak" | "unavailable";

export type ScoreStatusResult = {
  status: ScoreStatus;
  label: string;
  tone: "positive" | "warning" | "negative" | "neutral";
  ratio: number | null;
};

const UNAVAILABLE_RE =
  /not fully verified|incomplete|unknown|unavailable|not evaluated|missing|no verified|partial credit only|insufficient/i;

export function classifyScoreComponent(
  score: number,
  max: number,
  reason?: string
): ScoreStatusResult {
  if (!Number.isFinite(max) || max <= 0) {
    return { status: "unavailable", label: "Unavailable", tone: "neutral", ratio: null };
  }

  const reasonText = reason ?? "";
  // Explicit unavailable / not evaluated — neutral, not failed
  if (
    /not evaluated|unavailable|no verified calendar|insufficient verified/i.test(reasonText) &&
    score === 0
  ) {
    return { status: "unavailable", label: "Unavailable", tone: "neutral", ratio: null };
  }

  const ratio = score / max;

  if (UNAVAILABLE_RE.test(reasonText) && ratio < 0.4 && score === 0) {
    return { status: "unavailable", label: "Unavailable", tone: "neutral", ratio };
  }

  if (ratio >= 0.75) {
    return { status: "strong", label: "Strong", tone: "positive", ratio };
  }
  if (ratio >= 0.4) {
    return { status: "partial", label: "Partial", tone: "warning", ratio };
  }
  return { status: "weak", label: "Weak", tone: "negative", ratio };
}

export function classifyOverallScore(total: number | null | undefined): {
  band: "red" | "amber" | "light-green" | "strong-green";
  label: string;
} {
  if (total == null || !Number.isFinite(total)) {
    return { band: "amber", label: "INCOMPLETE" };
  }
  if (total < 40) return { band: "red", label: "WEAK SETUP" };
  if (total < 70) return { band: "amber", label: "SETUP INCOMPLETE" };
  if (total < 85) return { band: "light-green", label: "SOLID SETUP" };
  return { band: "strong-green", label: "HIGH QUALITY" };
}

/** Preferred display order for score components (most important first). */
export const SCORE_COMPONENT_PRIORITY = [
  "Market Structure",
  "Structure",
  "Confirmation",
  "Risk Geometry",
  "Trend",
  "Volume Profile",
  "ATR",
  "Session",
  "Liquidity",
  "Momentum",
  "News"
];

export function sortScoreComponents<T extends { label: string }>(components: T[]): T[] {
  const rank = (label: string) => {
    const i = SCORE_COMPONENT_PRIORITY.findIndex(
      (p) => label.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(label.toLowerCase())
    );
    return i === -1 ? 100 : i;
  };
  return [...components].sort((a, b) => rank(a.label) - rank(b.label));
}
