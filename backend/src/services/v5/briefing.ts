import type { DecisionRecord } from "../../models/types";
import type { V4ShadowAnalysisRecord } from "../v4/shadowTypes";
import { pricesAreConsistent } from "../snapshot/priceConsistency";
import type { DailyBriefing } from "./types";

export function buildDailyBriefing(input: {
  nowIso?: string;
  latestDecision?: DecisionRecord | null;
  latestAnalysis?: V4ShadowAnalysisRecord | null;
}): DailyBriefing {
  const now = input.nowIso ?? new Date().toISOString();
  const date = now.slice(0, 10);
  const a = input.latestAnalysis ?? null;
  const d = input.latestDecision ?? null;

  // Prefer a single source family. Never combine V4 profile levels (~4050) with a
  // stale/test V3 close (~2408) — that produces an invalid Market Structure Map.
  const analysisClose = a?.ohlc?.close ?? null;
  const decisionClose = d?.lastKnownPrice ?? d?.ohlcv?.close ?? null;
  const sourcesConsistent = pricesAreConsistent(analysisClose, decisionClose);
  // When TV analysis and V3 decision disagree, do not publish either close as a
  // combined "live" reference and omit all levels (UI shows mismatch state).
  const close = sourcesConsistent ? analysisClose ?? decisionClose : null;

  const pickLevel = (
    analysisLevel: number | null | undefined,
    decisionLevel: number | null | undefined
  ): number | null => {
    if (!sourcesConsistent || close == null) return null;
    if (pricesAreConsistent(close, analysisLevel)) return analysisLevel ?? null;
    if (pricesAreConsistent(close, decisionLevel)) return decisionLevel ?? null;
    return null;
  };
  const poc = pickLevel(a?.xauPoc, d?.marketStructure?.poc);
  const vah = pickLevel(a?.vah, d?.marketStructure?.vah);
  const val = pickLevel(a?.val, d?.marketStructure?.val);
  const levelsConsistentWithClose =
    sourcesConsistent &&
    ((a?.xauPoc == null && a?.vah == null && a?.val == null) ||
      (pricesAreConsistent(close, poc) &&
        pricesAreConsistent(close, vah) &&
        pricesAreConsistent(close, val) &&
        (poc != null || vah != null || val != null)));

  let positionVsPoc: DailyBriefing["positionVsPoc"] = "UNKNOWN";
  if (close != null && poc != null) {
    if (Math.abs(close - poc) < 0.5) positionVsPoc = "AT_POC";
    else positionVsPoc = close > poc ? "ABOVE_POC" : "BELOW_POC";
  }

  const atr = a?.atr ?? null;
  let atrLabel: DailyBriefing["atrLabel"] = "UNKNOWN";
  if (atr != null) {
    if (atr < 5) atrLabel = "LOW";
    else if (atr < 15) atrLabel = "MEDIUM";
    else atrLabel = "HIGH";
  }

  const verifiedFacts: string[] = [];
  const explanations: string[] = [];
  if (d) {
    verifiedFacts.push(`V3 decision=${d.decision} at ${d.generatedAt}.`);
  }
  if (a) {
    verifiedFacts.push(
      `V4 shadow analysis bar=${a.barTime}, session=${a.session}, regime=${a.regime}, bias=${a.bias}.`
    );
    if (levelsConsistentWithClose) {
      verifiedFacts.push(
        `Levels POC=${a.xauPoc ?? "null"} VAH=${a.vah ?? "null"} VAL=${a.val ?? "null"} (stored).`
      );
    } else {
      explanations.push(
        "V4 profile levels were omitted due to a price-source mismatch with the decision/alert close."
      );
    }
  } else {
    explanations.push("No verified V4 analysis yet for today — briefing is partial.");
  }
  if (!sourcesConsistent && analysisClose != null && decisionClose != null) {
    explanations.push(
      `Market data mismatch: V4 close ${analysisClose} vs decision close ${decisionClose}. Levels not combined.`
    );
  }
  explanations.push("Briefing does not create a trade. V4 remains SHADOW only.");

  const currentState: DailyBriefing["currentState"] = d
    ? d.decision === "BUY" || d.decision === "SELL" || d.decision === "WAIT"
      ? d.decision
      : "UNKNOWN"
    : a
      ? "SHADOW_ONLY"
      : "UNKNOWN";

  return {
    date,
    session: a?.session ?? d?.currentSession ?? null,
    marketRegime: a?.regime ?? d?.marketRegime ?? null,
    positionVsPoc,
    atrLabel,
    atrValue: atr,
    levels: {
      poc,
      vah,
      val
    },
    bias: a?.bias ?? null,
    news:
      a?.gateFailures.some((g) => g.includes("NEWS") || g.includes("BLACKOUT"))
        ? "BLACKOUT (verified gate)"
        : "None verified in payload",
    currentState,
    v3Decision: d?.decision ?? null,
    v4ShadowBias: a?.bias ?? null,
    verifiedFacts,
    explanations,
    insufficientData: !d && !a,
    disclaimer:
      "Daily briefing is informational only. Not a trade recommendation. Broker DISABLED.",
    actionable: false,
    symbol: "XAUUSD",
    timeframe: a?.timeframe ?? d?.timeframe ?? null,
    dataTimestamp: a?.barTime ?? d?.generatedAt ?? null,
    environment: a?.environment ?? d?.environment ?? "LIVE",
    strategyVersion: a?.strategyVersion ?? d?.backendVersion ?? null,
    mode: "SHADOW",
    freshness: !d && !a ? "UNAVAILABLE" : a && !d ? "PARTIAL" : "VERIFIED"
  };
}
