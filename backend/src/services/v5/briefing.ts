import type { DecisionRecord } from "../../models/types";
import type { V4ShadowAnalysisRecord } from "../v4/shadowTypes";
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

  const close = a?.ohlc.close ?? d?.lastKnownPrice ?? null;
  const poc = a?.xauPoc ?? null;
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
    verifiedFacts.push(
      `Levels POC=${a.xauPoc ?? "null"} VAH=${a.vah ?? "null"} VAL=${a.val ?? "null"} (stored).`
    );
  } else {
    explanations.push("No verified V4 analysis yet for today — briefing is partial.");
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
      poc: a?.xauPoc ?? null,
      vah: a?.vah ?? null,
      val: a?.val ?? null
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
    actionable: false
  };
}
