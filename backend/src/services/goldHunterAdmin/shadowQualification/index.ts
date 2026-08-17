/**
 * Gold Hunter Clean Shadow Qualification V1 — public surface.
 * Research / shadow only. No broker mutation.
 */
export {
  GH_SHADOW_QUALIFICATION_VERSION,
  GH_SHADOW_QUALIFICATION_EPOCH_PREFIX
} from "./types";
export type {
  GhShadowTrade,
  GhShadowQualificationEpoch,
  GhShadowDecisionRecord,
  GhShadowEconomicExposure,
  GhShadowDataQuality,
  GhShadowExitReason
} from "./types";

export {
  GH_SHADOW_VALUE_PER_POINT_PER_OZ_EUR,
  computeGhShadowEconomicExposure,
  simulateGhShadowCashPnl,
  shadowEntryPrice,
  shadowExitPrice,
  shadowInitialStop
} from "./economics";

export {
  GH_SHADOW_QUALIFICATION_STORAGE_PATH,
  loadGhShadowEpoch,
  listGhShadowTrades,
  listGhShadowDecisions,
  resetGhShadowQualificationMemoryForTests
} from "./store";

export {
  computeGhShadowPerformanceReport
} from "./performance";
export type {
  GhShadowPerformanceReport,
  GhShadowPayoffDiagnostics
} from "./performance";

export {
  tryOpenGhShadowFromOpportunity,
  tickGhShadowPosition,
  closeGhShadowTrade,
  resetGhShadowPositionManagerForTests,
  getGhShadowOpenTradeId
} from "./positionManager";

export {
  getGhShadowBrokerMutationProof,
  refuseGhShadowBrokerMutation,
  resetGhShadowBrokerMutationProofForTests,
  assertGhShadowNoBrokerMutationSurface
} from "./brokerMutationGuard";

export {
  isGhShadowQualificationEnabled,
  enqueueGhShadowQualificationTick,
  drainGhShadowQualificationForTests,
  buildGhShadowQualificationStatus,
  getGhShadowStrategyConfigIdentity,
  resetGhShadowQualificationRuntimeForTests,
  updateGhShadowReplayStatus
} from "./runtime";

export {
  replayGhShadowEventSequence,
  buildMinimalReplayEventsFromTrade
} from "./replay";
export type {
  GhShadowReplayMarketEvent,
  GhShadowReplayResult
} from "./replay";
