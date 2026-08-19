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
export {
  GOLD_HUNTER_FAST_STRATEGY_VERSION,
  GOLD_HUNTER_FAST_ENGINE_VERSION,
  GOLD_HUNTER_BRAIN_VERSION,
  GOLD_HUNTER_SMART_POSITION_MANAGER_VERSION,
  GH_FAST_MAX_OPEN_POSITIONS,
  GH_FAST_BROKER_EXECUTION_ENABLED
} from "./versions";
export {
  evaluateSetupsDetailed,
  evaluateSetups,
  scoreMomentumIgnition,
  scoreFastBreakout,
  scorePullbackReaccel,
  requiredBreakoutDistance
} from "./setups";
export type { SetupHit, GhBreakoutDiagnostics } from "./setups";
export {
  frozenGhFastSoakConfig,
  frozenGhFastShadowExitConfig,
  getFrozenGhFastIdentity,
  hashGhFastConfig
} from "./frozenConfig";
export { defaultGhFastConfig } from "./defaults";
export {
  openTrade as openGhAbcTrade,
  updateOpenTrade as updateGhAbcOpenTrade,
  evaluateOpenExit as evaluateGhAbcOpenExit
} from "./exits";
export {
  applyMonotonicProtectedProfitR,
  assessSmartHarvest,
  buildClosedTradeSmartDiagnostics,
  isSmartPositionManagerEnabled,
  openTradeSmartDiagnostics,
  targetProtectedProfitR
} from "./smartPositionManager";
export type {
  GhFastConfig,
  GhFastSetupId,
  GhFastSide,
  GhFastSpotEvent,
  GhFastDepthEvent,
  GhFastMarketEvent,
  GhFastOpenTrade,
  GhFastExitReason,
  GhFastSpecialistRawEval,
  SmartPmState,
  SmartPmStopAdjustReason
} from "./types";
export {
  GoldHunterFeaturePipeline
} from "./featurePipeline";
export type { GoldHunterPipelineSnapshot } from "./featurePipeline";
