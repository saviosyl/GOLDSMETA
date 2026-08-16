/**
 * Gold Hunter A/B/C pure pipeline — selective port from research PR #126.
 * Thresholds / frozen config MUST NOT be retuned here.
 * Not Fast AutoTrade. Not research collector / Cloud Run capture.
 */
export {
  GH_FAST_MARKET_DATA_NORMALIZATION_VERSION,
  normalizeCTraderSpotPayload,
  normalizeCTraderDepthPayload
} from "./ctraderMarketNormalize";
export { InMemoryDepthBook } from "./depthBook";
export type { DepthBookStats } from "./depthBook";
export {
  classifyResearchDepthValidity,
  isDerivedDataContaminated
} from "./depthRecovery";
export type { ResearchDepthValidity } from "./depthRecovery";
export { FastFeatureEngine } from "./features";
export type { GhFastFeatureSnapshot } from "./features";
export { evaluateSetupsDetailed, evaluateSetups } from "./setups";
export type { SetupHit } from "./setups";
export {
  frozenGhFastSoakConfig,
  getFrozenGhFastIdentity,
  hashGhFastConfig
} from "./frozenConfig";
export { defaultGhFastConfig } from "./defaults";
export {
  openTrade as openGhAbcTrade,
  updateOpenTrade as updateGhAbcOpenTrade,
  evaluateOpenExit as evaluateGhAbcOpenExit
} from "./exits";
export type {
  GhFastConfig,
  GhFastSetupId,
  GhFastSide,
  GhFastSpotEvent,
  GhFastDepthEvent,
  GhFastMarketEvent,
  GhFastOpenTrade,
  GhFastExitReason,
  GhFastSpecialistRawEval
} from "./types";
export {
  GOLD_HUNTER_FAST_STRATEGY_VERSION,
  GOLD_HUNTER_FAST_ENGINE_VERSION
} from "./versions";
export {
  GoldHunterFeaturePipeline
} from "./featurePipeline";
export type { GoldHunterPipelineSnapshot } from "./featurePipeline";
