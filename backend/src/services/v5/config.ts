/**
 * GoldMeta V5 configuration — intelligence layer only.
 * Never enables broker execution or overrides V4 decisions.
 */
function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

export const V5_ENGINE_VERSION = "1.0.0-v5-intelligence";
export const V5_CONFIG_VERSION = "v5-config-1.0.0";

export const v5Config = {
  engineVersion: V5_ENGINE_VERSION,
  configVersion: V5_CONFIG_VERSION,
  flags: {
    intelligenceEnabled: envBool("V5_INTELLIGENCE_ENABLED", true),
    learningEnabled: envBool("V5_LEARNING_ENABLED", true),
    briefingEnabled: envBool("V5_BRIEFING_ENABLED", true),
    replayEnabled: envBool("V5_REPLAY_ENABLED", true),
    screenshotCompareEnabled: envBool("V5_SCREENSHOT_COMPARE_ENABLED", true),
    weeklyCoachEnabled: envBool("V5_WEEKLY_COACH_ENABLED", true),
    /** Optional LLM polish — never required; never invents verified facts. */
    optionalAiNarration: false
  },
  brokerExecution: "DISABLED" as const,
  overridesV4: false as const,
  selfModifiesRules: false as const
};

export function v5FlagSnapshot(): Record<string, unknown> {
  return {
    V5_INTELLIGENCE_ENABLED: v5Config.flags.intelligenceEnabled,
    V5_LEARNING_ENABLED: v5Config.flags.learningEnabled,
    V5_BRIEFING_ENABLED: v5Config.flags.briefingEnabled,
    V5_REPLAY_ENABLED: v5Config.flags.replayEnabled,
    V5_SCREENSHOT_COMPARE_ENABLED: v5Config.flags.screenshotCompareEnabled,
    V5_WEEKLY_COACH_ENABLED: v5Config.flags.weeklyCoachEnabled,
    V5_OPTIONAL_AI_NARRATION: v5Config.flags.optionalAiNarration,
    brokerExecution: v5Config.brokerExecution,
    overridesV4: v5Config.overridesV4,
    selfModifiesRules: v5Config.selfModifiesRules,
    engineVersion: v5Config.engineVersion
  };
}
