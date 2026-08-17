/**
 * Gold Hunter Clean Shadow Qualification V1 — public surface.
 * Research / shadow only. No broker mutation.
 */
export {
  GH_SHADOW_QUALIFICATION_VERSION,
  GH_SHADOW_QUALIFICATION_EPOCH_PREFIX
} from "./types";
export { GH_SHADOW_QUALIFICATION_STORAGE_PATH } from "./store";
export type {
  GhShadowTrade,
  GhShadowQualificationEpoch,
  GhShadowDecisionRecord,
  GhShadowEconomicExposure,
  GhShadowDataQuality,
  GhShadowExitReason,
  GhShadowCapturedEvent,
  GhShadowCashPnl,
  GhShadowIntegrityCounters
} from "./types";

export {
  GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS,
  computeGhShadowEconomicExposure,
  simulateGhShadowCashPnl,
  shadowEntryPrice,
  shadowExitPrice,
  shadowInitialStop,
  provenGrossPnlEurExample,
  PEPPERSTONE_CTRADER_XAUUSD_DEMO
} from "./economics";

export {
  loadGhShadowEpoch,
  listGhShadowTrades,
  listGhShadowDecisions,
  listGhShadowCapturedEvents,
  resetGhShadowQualificationMemoryForTests,
  saveGhShadowEpoch,
  setCurrentQualificationId
} from "./store";

export { computeGhShadowPerformanceReport } from "./performance";
export type {
  GhShadowPerformanceReport,
  GhShadowPayoffDiagnostics
} from "./performance";

export {
  GhShadowQualificationEngine,
  getGhShadowEngine,
  resetGhShadowEnginesForTests
} from "./engine";

export {
  getGhShadowMutationSurfaceReport,
  getGhShadowBrokerMutationProof,
  refuseGhShadowBrokerMutation,
  resetGhShadowBrokerMutationProofForTests,
  assertGhShadowNoBrokerMutationSurface
} from "./brokerMutationGuard";

export {
  isGhShadowQualificationEnabled,
  enqueueGhShadowQualificationTick,
  onGhShadowSelectorTick,
  processGhShadowMarketEventSync,
  drainGhShadowQualificationForTests,
  flushGhShadowPersistenceForTests,
  buildGhShadowQualificationStatus,
  getGhShadowStrategyConfigIdentity,
  resetGhShadowQualificationRuntimeForTests,
  runGhShadowReplayAndGate,
  setGhShadowPersistDelayMsForTests,
  setGhShadowSizingOverridesForTests
} from "./runtime";

export {
  replayGhShadowCapturedEvents,
  buildMinimalReplayEventsFromTrade
} from "./replay";
export type {
  GhShadowReplayResult,
  GhShadowReplayComparePoint
} from "./replay";

export { GhShadowEventJournal } from "./journal";
