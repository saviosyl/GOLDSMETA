import { createHash } from "crypto";
import OpenAI from "openai";
import { env } from "../../config/env";
import type { AiExplanation, DecisionDirection, GuardResult, ScoreResult } from "../../models/types";
import { hoursSinceEpoch } from "../../utils/time";
import { logger } from "../logging/logger";
import { buildFallbackExplanation } from "./fallback";
import { AI_PROMPT_VERSION, GOLDMETA_SYSTEM_PROMPT } from "./prompt";
import { aiExplanationSchema } from "./schema";

export interface ExplainerInput {
  decision: DecisionDirection;
  score: ScoreResult;
  guards: GuardResult;
  warnings: string[];
  deterministicInput: unknown;
}

const normalizeForHash = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeForHash);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeForHash(entry)])
    );
  }
  return value;
};

const hashInput = (input: unknown): string =>
  createHash("sha256").update(JSON.stringify(normalizeForHash(input))).digest("hex");

export class AiExplainer {
  private readonly client: OpenAI | null;
  private readonly cache = new Map<string, AiExplanation>();
  private readonly hourlyCounts = new Map<number, number>();

  constructor() {
    this.client =
      env.AI_ENABLED && env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;
  }

  async explain(input: ExplainerInput): Promise<AiExplanation> {
    const fallback = buildFallbackExplanation(input.decision, input.score, input.guards, input.warnings);
    if (!this.client) {
      return fallback;
    }

    const cacheKey = hashInput(input.deterministicInput);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const hour = hoursSinceEpoch();
    const count = this.hourlyCounts.get(hour) ?? 0;
    if (count >= env.AI_MAX_CALLS_PER_HOUR) {
      return fallback;
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        this.hourlyCounts.set(hour, count + 1);
        const result = await this.callOpenAi(input);
        this.cache.set(cacheKey, result);
        return result;
      } catch (error: unknown) {
        logger.warn("AI explainer call failed", {
          attempt,
          error: error instanceof Error ? error.message : "unknown"
        });
      }
    }

    return fallback;
  }

  private async callOpenAi(input: ExplainerInput): Promise<AiExplanation> {
    if (!this.client) {
      return buildFallbackExplanation(input.decision, input.score, input.guards, input.warnings);
    }

    const response = await this.client.chat.completions.create({
      model: env.OPENAI_MODEL,
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: GOLDMETA_SYSTEM_PROMPT
        },
        {
          role: "user",
          content: JSON.stringify({
            decision: input.decision,
            score: input.score,
            guards: input.guards,
            warnings: input.warnings,
            deterministicInput: input.deterministicInput
          })
        }
      ]
    });

    const content = response.choices[0]?.message.content ?? "";
    const parsedJson = JSON.parse(content) as unknown;
    const parsed = aiExplanationSchema.parse(parsedJson);

    return {
      summary: parsed.summary,
      warnings: parsed.warnings,
      recommendWait: parsed.recommendWait,
      modelId: env.OPENAI_MODEL,
      promptVersion: AI_PROMPT_VERSION,
      safetyDowngraded: false
    };
  }
}
