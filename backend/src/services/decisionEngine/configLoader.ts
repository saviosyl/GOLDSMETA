import configV1 from "../../config/decisionEngine/v1.0.0.json";
import { decisionEngineConfigSchema, type DecisionEngineConfig } from "./types";

export const DEFAULT_DECISION_ENGINE_VERSION = "1.0.0";

const registry: Record<string, DecisionEngineConfig> = {
  "1.0.0": decisionEngineConfigSchema.parse(configV1)
};

export const loadDecisionEngineConfig = (
  version: string = DEFAULT_DECISION_ENGINE_VERSION
): DecisionEngineConfig => {
  const config = registry[version];
  if (!config) {
    throw new Error(`Unknown decision engine config version: ${version}`);
  }
  return config;
};

export const listDecisionEngineVersions = (): string[] => Object.keys(registry);
