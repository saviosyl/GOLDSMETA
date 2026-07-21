import type {
  V4LockedShadowPlan,
  V4ShadowAnalysisRecord,
  V4ShadowCandidateRecord
} from "../v4/shadowTypes";
import type { DecisionRecord } from "../../models/types";
import type { IntelligenceAnswer } from "./types";
import { computeGoldMetaScore, scoreInputFromV4Shadow } from "./goldMetaScore";
import { v4Config } from "../v4/config";

const DISCLAIMER =
  "Answers distinguish Verified data from Explanation. Insufficient verified data is stated honestly. Not a trade recommendation. Broker execution DISABLED.";

function insufficient(question: string, missing: string): IntelligenceAnswer {
  return {
    question,
    answer: `Insufficient verified data. ${missing}`,
    verifiedFacts: [],
    explanations: [missing],
    citations: [{ kind: "EXPLANATION", source: "intelligence", detail: missing }],
    insufficientData: true,
    disclaimer: DISCLAIMER
  };
}

/**
 * Rules-based Market Intelligence — not a generic chatbot.
 * Never invents prices, indicators, news, or performance.
 */
export function answerMarketIntelligence(input: {
  question: string;
  latestDecision?: DecisionRecord | null;
  latestAnalysis?: V4ShadowAnalysisRecord | null;
  previousAnalysis?: V4ShadowAnalysisRecord | null;
  candidates?: V4ShadowCandidateRecord[];
  openPlan?: V4LockedShadowPlan | null;
  analyticsSummary?: {
    sampleSize: number;
    profitFactor: number | null;
    netExpectancyR: number | null;
    byStrategy?: Record<string, number>;
  } | null;
}): IntelligenceAnswer {
  const q = input.question.trim().toLowerCase();
  const analysis = input.latestAnalysis ?? null;
  const decision = input.latestDecision ?? null;

  if (!q) {
    return insufficient(input.question, "No question provided.");
  }

  // Why waiting?
  if (q.includes("why") && (q.includes("wait") || q.includes("waiting"))) {
    const facts: string[] = [];
    const explanations: string[] = [];
    if (decision) {
      facts.push(
        `Verified V3 decision=${decision.decision} at ${decision.generatedAt} (environment=${decision.environment}).`
      );
    }
    if (analysis) {
      facts.push(
        `Verified V4 shadow bias=${analysis.bias}, regime=${analysis.regime}, session=${analysis.session}.`
      );
      if (analysis.rejectionReasons.length) {
        facts.push(`Verified rejection reasons: ${analysis.rejectionReasons.join("; ")}.`);
      }
      if (analysis.gateFailures.length) {
        facts.push(`Verified gate failures: ${analysis.gateFailures.join("; ")}.`);
      }
    }
    if (!decision && !analysis) {
      return insufficient(input.question, "No verified V3 decision or V4 analysis is available.");
    }
    explanations.push(
      "WAIT means mandatory gates did not all pass for an actionable setup — or production remains on V3 WAIT while V4 is SHADOW only."
    );
    if (!input.openPlan) {
      explanations.push("No open immutable V4 shadow plan is currently locked.");
    }
    return {
      question: input.question,
      answer: facts.length
        ? `We are waiting because verified gates/rejections did not clear a locked plan. ${facts[0]}`
        : "We are waiting based on verified state.",
      verifiedFacts: facts,
      explanations,
      citations: facts.map((f) => ({ kind: "VERIFIED" as const, source: "v3/v4", detail: f })),
      insufficientData: false,
      disclaimer: DISCLAIMER
    };
  }

  // Why rejected?
  if (q.includes("reject") || q.includes("blocked") || q.includes("which rule")) {
    if (!analysis && !(input.candidates && input.candidates.length)) {
      return insufficient(input.question, "No verified rejection reasons on file.");
    }
    const reasons = [
      ...(analysis?.rejectionReasons ?? []),
      ...(analysis?.gateFailures ?? []),
      ...((input.candidates ?? []).map((c) => c.cancelReason).filter(Boolean) as string[])
    ];
    if (!reasons.length) {
      return insufficient(input.question, "Latest analysis has no recorded rejection reasons.");
    }
    return {
      question: input.question,
      answer: `Verified blocking reasons: ${[...new Set(reasons)].join(" · ")}`,
      verifiedFacts: [...new Set(reasons)].map((r) => `Rule/reason: ${r}`),
      explanations: [
        "These codes come from stored V4 shadow analysis/candidate records — not invented.",
        "Improving a setup requires addressing the specific failed gate (structure, confirmation, geometry, profile, news)."
      ],
      citations: reasons.map((r) => ({ kind: "VERIFIED" as const, source: "v4Analyses", detail: r })),
      insufficientData: false,
      disclaimer: DISCLAIMER
    };
  }

  // Risk geometry
  if (q.includes("risk geometry") || q.includes("invalid risk") || q.includes("stop too")) {
    const hasCode =
      analysis?.gateFailures.includes("NO_TRADE_INVALID_RISK_GEOMETRY") ||
      analysis?.rejectionReasons.some((r) => r.includes("RISK_GEOMETRY")) ||
      (input.candidates ?? []).some((c) => c.cancelReason === "NO_TRADE_INVALID_RISK_GEOMETRY");
    if (!hasCode && input.openPlan == null && analysis == null) {
      return insufficient(input.question, "No verified risk-geometry evaluation available.");
    }
    const facts: string[] = [];
    if (hasCode) facts.push("Verified: NO_TRADE_INVALID_RISK_GEOMETRY recorded.");
    if (input.openPlan) {
      facts.push(
        `Verified locked plan riskDistance=${input.openPlan.riskDistance} (immutable).`
      );
    }
    facts.push(
      `Configured absolute XAUUSD minimum stop distance=${v4Config.stop.absoluteMinPoints}.`
    );
    return {
      question: input.question,
      answer: hasCode
        ? "Risk geometry failed a mandatory gate — no shadow plan was (or should be) created."
        : "No invalid risk-geometry rejection is on the latest analysis; see configured floors.",
      verifiedFacts: facts,
      explanations: [
        "Final stop distance must consider max(structural, ATR minimum, spread×safety, absolute floor).",
        "Tiny stops (e.g. 0.22) are always unsafe and rejected."
      ],
      citations: facts.map((f) => ({ kind: "VERIFIED" as const, source: "v4", detail: f })),
      insufficientData: false,
      disclaimer: DISCLAIMER
    };
  }

  // What changed since previous candle?
  if (q.includes("changed") || q.includes("previous candle") || q.includes("since last")) {
    if (!analysis || !input.previousAnalysis) {
      return insufficient(
        input.question,
        "Need at least two verified V4 analyses to compare candles."
      );
    }
    const prev = input.previousAnalysis;
    const facts: string[] = [
      `Previous bar ${prev.barTime}: bias=${prev.bias}, regime=${prev.regime}.`,
      `Current bar ${analysis.barTime}: bias=${analysis.bias}, regime=${analysis.regime}.`
    ];
    if (prev.bias !== analysis.bias) facts.push(`Bias changed ${prev.bias} → ${analysis.bias}.`);
    if (prev.regime !== analysis.regime)
      facts.push(`Regime changed ${prev.regime} → ${analysis.regime}.`);
    if (prev.xauPoc !== analysis.xauPoc)
      facts.push(`POC ${prev.xauPoc ?? "null"} → ${analysis.xauPoc ?? "null"} (verified stored values).`);
    return {
      question: input.question,
      answer: facts.join(" "),
      verifiedFacts: facts,
      explanations: ["Comparison uses stored analysis fields only — no invented ticks."],
      citations: facts.map((f) => ({ kind: "VERIFIED" as const, source: "v4Analyses", detail: f })),
      insufficientData: false,
      disclaimer: DISCLAIMER
    };
  }

  // Strategy historical performance
  if (q.includes("strategy a") || q.includes("historically") || q.includes("profit factor")) {
    const a = input.analyticsSummary;
    if (!a || a.sampleSize < 1) {
      return insufficient(
        input.question,
        "No resolved LIVE shadow sample is available yet for historical performance."
      );
    }
    const facts = [
      `Verified resolved sample size n=${a.sampleSize}.`,
      `Verified profitFactor=${a.profitFactor ?? "null"}.`,
      `Verified netExpectancyR=${a.netExpectancyR ?? "null"}.`
    ];
    if (a.byStrategy) {
      for (const [k, v] of Object.entries(a.byStrategy)) {
        facts.push(`Verified plan count for ${k}=${v}.`);
      }
    }
    return {
      question: input.question,
      answer:
        a.sampleSize < 20
          ? `Extremely small sample (n=${a.sampleSize}). Treat rates as non-meaningful.`
          : `Sample n=${a.sampleSize}; PF=${a.profitFactor ?? "n/a"}; net expectancy R=${a.netExpectancyR ?? "n/a"}.`,
      verifiedFacts: facts,
      explanations: [
        "Performance figures come only from stored resolved shadow plans.",
        "This is not proof of future profitability."
      ],
      citations: facts.map((f) => ({ kind: "VERIFIED" as const, source: "v4Analytics", detail: f })),
      insufficientData: false,
      disclaimer: DISCLAIMER
    };
  }

  // Why TP2 failed / lifecycle
  if (q.includes("tp2") || q.includes("lifecycle") || q.includes("why did")) {
    if (!input.openPlan && !(input.candidates && input.candidates.length)) {
      return insufficient(input.question, "No verified shadow plan/candidate lifecycle to explain.");
    }
    const plan = input.openPlan;
    if (!plan) {
      return insufficient(input.question, "No open or selected shadow plan in verified storage.");
    }
    const facts = [
      `Verified plan status=${plan.status}.`,
      `Verified direction=${plan.direction}, entry=${plan.entry}, SL=${plan.stopLoss}, TP1=${plan.tp1}, TP2=${plan.tp2}, TP3=${plan.tp3}.`,
      `Verified grossR=${plan.grossR ?? "null"}, netR=${plan.netR ?? "null"}, mfe=${plan.mfe ?? "null"}, mae=${plan.mae ?? "null"}.`
    ];
    return {
      question: input.question,
      answer: `Lifecycle status is ${plan.status}. Levels are immutable.`,
      verifiedFacts: facts,
      explanations: [
        "Same-candle SL+TP resolves worst-case SL-first (AMBIGUOUS_WORST_CASE_SL).",
        "Later candles never mutate locked entry/SL/TP fields."
      ],
      citations: facts.map((f) => ({ kind: "VERIFIED" as const, source: "v4ShadowPlans", detail: f })),
      insufficientData: false,
      disclaimer: DISCLAIMER
    };
  }

  // Score / weaker than yesterday
  if (q.includes("weaker") || q.includes("score") || q.includes("quality")) {
    if (!analysis) {
      return insufficient(input.question, "No verified V4 analysis to score.");
    }
    const score = computeGoldMetaScore(
      scoreInputFromV4Shadow({
        bias: analysis.bias,
        regime: analysis.regime,
        profileSource: analysis.profileSource,
        gateFailures: analysis.gateFailures,
        rejectionReasons: analysis.rejectionReasons,
        session: analysis.session,
        atr: analysis.atr,
        gcConfirmation: analysis.gcConfirmation
      })
    );
    const facts = [
      `GoldMeta Score=${score.total}/100 (rules-based, not probability).`,
      ...score.components.map((c) => `${c.label}: ${c.score}/${c.max} — ${c.reason}`)
    ];
    return {
      question: input.question,
      answer: `Current GoldMeta Score is ${score.total}. See component breakdown in verifiedFacts.`,
      verifiedFacts: facts,
      explanations: [
        "Score explains relative setup quality versus gates — not that today is better than yesterday unless two analyses are compared."
      ],
      citations: [{ kind: "VERIFIED", source: "goldMetaScore", detail: `total=${score.total}` }],
      insufficientData: false,
      disclaimer: DISCLAIMER
    };
  }

  // What would improve
  if (q.includes("improve") || q.includes("what would")) {
    if (!analysis) {
      return insufficient(input.question, "No verified analysis to suggest improvements against.");
    }
    const improvements: string[] = [];
    for (const r of [...analysis.rejectionReasons, ...analysis.gateFailures]) {
      improvements.push(`Address verified issue: ${r}`);
    }
    if (analysis.gcConfirmation === "UNAVAILABLE") {
      improvements.push(
        "GC confirmation unavailable — wiring an authorised delayed/paid feed (with approval) could remove the quality penalty."
      );
    }
    if (!improvements.length) {
      improvements.push("No specific rejection codes — continue collecting multi-bar confirmation evidence.");
    }
    return {
      question: input.question,
      answer: improvements.join(" "),
      verifiedFacts: analysis.rejectionReasons.map((r) => `Verified rejection: ${r}`),
      explanations: improvements,
      citations: analysis.rejectionReasons.map((r) => ({
        kind: "VERIFIED" as const,
        source: "v4Analyses",
        detail: r
      })),
      insufficientData: false,
      disclaimer: DISCLAIMER
    };
  }

  return {
    question: input.question,
    answer:
      "I can explain WAIT, rejections, risk geometry, candle changes, strategy sample stats, lifecycle, and GoldMeta Score using verified GoldMeta data. Ask one of those, or provide more context.",
    verifiedFacts: analysis
      ? [
          `Latest V4 analysis bar=${analysis.barTime}, bias=${analysis.bias}, session=${analysis.session}.`
        ]
      : [],
    explanations: [
      "This assistant is GoldMeta-specific and will not invent market data.",
      "Broker execution remains DISABLED. V4 is SHADOW only."
    ],
    citations: [],
    insufficientData: !analysis && !decision,
    disclaimer: DISCLAIMER
  };
}
