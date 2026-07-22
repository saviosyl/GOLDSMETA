/**
 * Deterministic Market Story from verified briefing/decision/score fields only.
 * Not an external AI model — never invents prices, news, or outcomes.
 */

import { classifyScoreComponent, sortScoreComponents } from "./scoreStatus";
import { formatSession, plainLanguageReason } from "./plainLanguage";

export type MarketStoryInput = {
  decision?: string | null;
  session?: string | null;
  regime?: string | null;
  positionVsPoc?: string | null;
  atrLabel?: string | null;
  poc?: number | null;
  vah?: number | null;
  val?: number | null;
  livePrice?: number | null;
  reasonCodes?: string[];
  hasValidatedPlan?: boolean;
  insufficientData?: boolean;
  components?: Array<{ label: string; score: number; max: number; reason: string }>;
};

export type MarketStoryResult = {
  story: string | null;
  insufficient: boolean;
  evidence: string[];
};

function posVsPocPhrase(raw: string | null | undefined, live: number | null, poc: number | null): string {
  const key = (raw ?? "").toUpperCase();
  if (key.includes("ABOVE")) return "price is trading above the session POC";
  if (key.includes("BELOW")) return "price is still below the session POC";
  if (key.includes("AT") || key.includes("NEAR")) return "price is near the session POC";
  if (live != null && poc != null) {
    if (live > poc) return "price is trading above the session POC";
    if (live < poc) return "price is still below the session POC";
    return "price is at the session POC";
  }
  return "the relationship to the session POC is not fully verified";
}

function directionalPhrase(decision: string, regime: string | null | undefined): string {
  const d = decision.toUpperCase();
  const r = (regime ?? "").toUpperCase();
  if (d === "BUY") {
    return r.includes("TREND")
      ? "Buyers remain in control within a trending regime"
      : "Buyers hold a directional bias";
  }
  if (d === "SELL") {
    return r.includes("TREND")
      ? "Sellers remain in control within a trending regime"
      : "Sellers hold a directional bias";
  }
  if (r.includes("RANGE")) return "The market remains range-bound";
  if (r.includes("TREND")) return "A directional regime is present, but setup gates are incomplete";
  return "Directional context is mixed";
}

function strongestSupport(
  components: Array<{ label: string; score: number; max: number; reason: string }>
): string | null {
  const ordered = sortScoreComponents(components);
  const strong = ordered
    .map((c) => ({ c, s: classifyScoreComponent(c.score, c.max, c.reason) }))
    .filter((x) => x.s.status === "strong");
  if (!strong.length) return null;
  return strong[0]!.c.label;
}

function strongestBlock(
  components: Array<{ label: string; score: number; max: number; reason: string }>
): string | null {
  const ordered = sortScoreComponents(components);
  const weak = ordered
    .map((c) => ({ c, s: classifyScoreComponent(c.score, c.max, c.reason) }))
    .filter((x) => x.s.status === "weak");
  if (!weak.length) return null;
  return weak[0]!.c.label;
}

function nextStep(decision: string, hasPlan: boolean, block: string | null): string {
  if (hasPlan) {
    return "A validated shadow plan is being tracked — review levels before any manual action.";
  }
  if (decision.toUpperCase() === "WAIT") {
    if (block) {
      return `GoldMeta remains in WAIT until ${block.toLowerCase()} improves with valid confirmation.`;
    }
    return "GoldMeta remains in WAIT until price reclaims the nearest resistance with valid confirmation.";
  }
  return "Monitor confirmation and risk geometry before treating the bias as actionable.";
}

/** Build a 3–5 sentence Market Story from verified inputs only. */
export function buildMarketStory(input: MarketStoryInput): MarketStoryResult {
  if (input.insufficientData) {
    return {
      story: null,
      insufficient: true,
      evidence: ["insufficientData=true"]
    };
  }

  const hasCore =
    input.decision != null ||
    input.poc != null ||
    input.livePrice != null ||
    (input.components && input.components.length > 0);

  if (!hasCore) {
    return {
      story: null,
      insufficient: true,
      evidence: []
    };
  }

  const decision = (input.decision ?? "WAIT").toUpperCase();
  const session = formatSession(input.session);
  const support = strongestSupport(input.components ?? []);
  const block = strongestBlock(input.components ?? []);
  const pocRel = posVsPocPhrase(input.positionVsPoc, input.livePrice ?? null, input.poc ?? null);
  const reason = plainLanguageReason(input.reasonCodes, undefined);

  const sentences: string[] = [];
  sentences.push(`${directionalPhrase(decision, input.regime)}, and ${pocRel}.`);

  const factorBits: string[] = [];
  if (support) factorBits.push(`${support} is supportive`);
  if (block) factorBits.push(`${block} remains incomplete`);
  if (input.atrLabel) factorBits.push(`ATR context is ${String(input.atrLabel).toLowerCase()}`);
  if (factorBits.length) {
    sentences.push(
      factorBits.length === 1
        ? `${factorBits[0]![0]!.toUpperCase()}${factorBits[0]!.slice(1)}.`
        : `${factorBits[0]![0]!.toUpperCase()}${factorBits[0]!.slice(1)}, while ${factorBits.slice(1).join(" and ")}.`
    );
  }

  if (reason && !/clearer verified setup/i.test(reason)) {
    sentences.push(reason.endsWith(".") ? reason : `${reason}.`);
  }

  sentences.push(nextStep(decision, Boolean(input.hasValidatedPlan), block));

  if (session !== "—") {
    // Keep session as soft context without duplicating everywhere
    sentences[0] = sentences[0]!.replace(/\.$/, ` during the ${session} session.`);
  }

  const story = sentences.slice(0, 5).join(" ");
  const words = story.split(/\s+/).length;
  const trimmed =
    words > 110 ? sentences.slice(0, 4).join(" ") : story;

  const evidence: string[] = [];
  if (input.decision) evidence.push(`decision=${input.decision}`);
  if (input.session) evidence.push(`session=${input.session}`);
  if (input.regime) evidence.push(`regime=${input.regime}`);
  if (input.positionVsPoc) evidence.push(`positionVsPoc=${input.positionVsPoc}`);
  if (input.poc != null) evidence.push(`poc=${input.poc}`);
  if (input.vah != null) evidence.push(`vah=${input.vah}`);
  if (input.val != null) evidence.push(`val=${input.val}`);
  if (input.livePrice != null) evidence.push(`livePrice=${input.livePrice}`);
  if (input.atrLabel) evidence.push(`atr=${input.atrLabel}`);
  if (input.hasValidatedPlan) evidence.push("validatedPlan=true");
  for (const c of input.components ?? []) {
    evidence.push(`${c.label}=${c.score}/${c.max}`);
  }

  return { story: trimmed, insufficient: false, evidence };
}
