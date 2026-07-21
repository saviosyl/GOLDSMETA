import type { GoldMetaScoreComponent, GoldMetaScoreResult } from "./types";

export interface GoldMetaScoreInput {
  /** Verified fields — nulls reduce score honestly */
  trendAligned?: boolean | null;
  structureClear?: boolean | null;
  volumeProfileValid?: boolean | null;
  riskGeometryValid?: boolean | null;
  atrSuitable?: boolean | null;
  sessionQuality?: "GOOD" | "OK" | "POOR" | "UNKNOWN" | null;
  confirmationComplete?: boolean | null;
  liquidityContextOk?: boolean | null;
  momentumSupportive?: boolean | null;
  newsClear?: boolean | null;
  /** Optional numeric quality from V4 locked plan if present */
  v4QualityTotal?: number | null;
}

const WEIGHTS = {
  trend: 12,
  structure: 12,
  volumeProfile: 12,
  riskGeometry: 14,
  atr: 10,
  session: 8,
  confirmation: 12,
  liquidity: 8,
  momentum: 7,
  news: 5
} as const;

function component(
  id: string,
  label: string,
  weight: number,
  earned: number,
  reason: string
): GoldMetaScoreComponent {
  return {
    id,
    label,
    weight,
    score: Math.max(0, Math.min(weight, Math.round(earned * 10) / 10)),
    max: weight,
    reason,
    kind: "VERIFIED"
  };
}

/**
 * GoldMeta Score 0–100 — rules-based quality, NOT probability.
 */
export function computeGoldMetaScore(input: GoldMetaScoreInput): GoldMetaScoreResult {
  if (input.v4QualityTotal != null && Number.isFinite(input.v4QualityTotal)) {
    // Prefer transparent rebuild even when V4 quality exists — still show components.
  }

  const comps: GoldMetaScoreComponent[] = [
    component(
      "trend",
      "Trend",
      WEIGHTS.trend,
      input.trendAligned == null ? WEIGHTS.trend * 0.35 : input.trendAligned ? WEIGHTS.trend : 2,
      input.trendAligned == null
        ? "Trend alignment not fully verified — partial credit only."
        : input.trendAligned
          ? "Directional context aligns with candidate bias."
          : "Trend conflict reduces quality."
    ),
    component(
      "structure",
      "Market Structure",
      WEIGHTS.structure,
      input.structureClear == null ? WEIGHTS.structure * 0.35 : input.structureClear ? WEIGHTS.structure : 2,
      input.structureClear == null
        ? "Structure clarity incomplete in verified data."
        : input.structureClear
          ? "Clear invalidation / structure reference present."
          : "No clear invalidation structure."
    ),
    component(
      "volumeProfile",
      "Volume Profile",
      WEIGHTS.volumeProfile,
      input.volumeProfileValid == null
        ? WEIGHTS.volumeProfile * 0.3
        : input.volumeProfileValid
          ? WEIGHTS.volumeProfile
          : 2,
      input.volumeProfileValid == null
        ? "Profile validity not fully verified."
        : input.volumeProfileValid
          ? "XAUUSD profile gates satisfied."
          : "Profile invalid or stale — quality reduced."
    ),
    component(
      "riskGeometry",
      "Risk Geometry",
      WEIGHTS.riskGeometry,
      input.riskGeometryValid == null
        ? WEIGHTS.riskGeometry * 0.25
        : input.riskGeometryValid
          ? WEIGHTS.riskGeometry
          : 0,
      input.riskGeometryValid == null
        ? "Risk geometry not evaluated on this bar."
        : input.riskGeometryValid
          ? "Stop distance passes ATR / spread / absolute floors."
          : "NO_TRADE_INVALID_RISK_GEOMETRY — stop too close/far or RR after costs fails."
    ),
    component(
      "atr",
      "ATR",
      WEIGHTS.atr,
      input.atrSuitable == null ? WEIGHTS.atr * 0.4 : input.atrSuitable ? WEIGHTS.atr : 3,
      input.atrSuitable == null
        ? "ATR suitability partially unknown."
        : input.atrSuitable
          ? "Volatility regime suitable for configured stop geometry."
          : "ATR regime unsuitable (too quiet or extreme)."
    ),
    component(
      "session",
      "Session",
      WEIGHTS.session,
      input.sessionQuality === "GOOD"
        ? WEIGHTS.session
        : input.sessionQuality === "OK"
          ? WEIGHTS.session * 0.7
          : input.sessionQuality === "POOR"
            ? 2
            : WEIGHTS.session * 0.4,
      `Session quality: ${input.sessionQuality ?? "UNKNOWN"}.`
    ),
    component(
      "confirmation",
      "Confirmation",
      WEIGHTS.confirmation,
      input.confirmationComplete == null
        ? WEIGHTS.confirmation * 0.3
        : input.confirmationComplete
          ? WEIGHTS.confirmation
          : 2,
      input.confirmationComplete == null
        ? "Confirmation state incomplete."
        : input.confirmationComplete
          ? "Multi-bar confirmation requirements met."
          : "Multi-bar confirmation incomplete."
    ),
    component(
      "liquidity",
      "Liquidity",
      WEIGHTS.liquidity,
      input.liquidityContextOk == null
        ? WEIGHTS.liquidity * 0.4
        : input.liquidityContextOk
          ? WEIGHTS.liquidity
          : 2,
      input.liquidityContextOk == null
        ? "Liquidity context not fully verified."
        : input.liquidityContextOk
          ? "Liquidity / sweep context supportive or neutral."
          : "Hostile liquidity context."
    ),
    component(
      "momentum",
      "Momentum",
      WEIGHTS.momentum,
      input.momentumSupportive == null
        ? WEIGHTS.momentum * 0.4
        : input.momentumSupportive
          ? WEIGHTS.momentum
          : 2,
      input.momentumSupportive == null
        ? "Momentum not fully verified."
        : input.momentumSupportive
          ? "Momentum supportive of bias."
          : "Momentum conflicts with bias."
    ),
    component(
      "news",
      "News",
      WEIGHTS.news,
      input.newsClear == null ? WEIGHTS.news * 0.5 : input.newsClear ? WEIGHTS.news : 0,
      input.newsClear == null
        ? "No verified news calendar — partial credit."
        : input.newsClear
          ? "Outside news blackout."
          : "News blackout active — no new plans."
    )
  ];

  const total = Math.min(
    100,
    Math.round(comps.reduce((a, c) => a + c.score, 0))
  );

  return {
    total,
    max: 100,
    components: comps,
    disclaimer:
      "GoldMeta Score is a rules-based setup-quality measurement. It is not the probability of a profitable trade.",
    actionable: false
  };
}

/** Map a V4 shadow analysis / plan snapshot into score inputs. */
export function scoreInputFromV4Shadow(input: {
  bias?: string | null;
  regime?: string | null;
  profileSource?: string | null;
  gateFailures?: string[];
  rejectionReasons?: string[];
  session?: string | null;
  atr?: number | null;
  confirmationBarsSeen?: number | null;
  confirmationBarsRequired?: number | null;
  riskDistance?: number | null;
  absoluteMinPoints?: number;
  gcConfirmation?: string | null;
}): GoldMetaScoreInput {
  const gates = input.gateFailures ?? [];
  const rejects = input.rejectionReasons ?? [];
  const all = [...gates, ...rejects].join(" ");
  const riskOk =
    input.riskDistance != null
      ? input.riskDistance >= (input.absoluteMinPoints ?? 1.5) &&
        !all.includes("NO_TRADE_INVALID_RISK_GEOMETRY")
      : all.includes("NO_TRADE_INVALID_RISK_GEOMETRY")
        ? false
        : null;
  const confReq = input.confirmationBarsRequired ?? 2;
  const confSeen = input.confirmationBarsSeen;
  return {
    trendAligned:
      input.bias && input.regime
        ? !(input.regime.includes("RANGE") && input.bias.includes("BIAS"))
        : null,
    structureClear: !all.includes("structure") && !all.toLowerCase().includes("invalidation")
      ? all.includes("No approved strategy")
        ? false
        : null
      : false,
    volumeProfileValid:
      input.profileSource != null && input.profileSource !== "UNKNOWN"
        ? !all.toLowerCase().includes("profile")
        : null,
    riskGeometryValid: riskOk,
    atrSuitable: input.atr == null ? null : input.atr >= 1,
    sessionQuality:
      input.session === "LONDON" || input.session === "NEWYORK" || input.session === "OVERLAP"
        ? "GOOD"
        : input.session === "ASIA"
          ? "OK"
          : "UNKNOWN",
    confirmationComplete:
      confSeen == null ? null : confSeen >= confReq && !all.includes("confirmation incomplete"),
    liquidityContextOk: all.toLowerCase().includes("failed auction") ? true : null,
    momentumSupportive: input.bias && input.bias !== "NEUTRAL" ? true : null,
    newsClear: all.includes("NEWS") || all.includes("BLACKOUT") ? false : null
  };
}
