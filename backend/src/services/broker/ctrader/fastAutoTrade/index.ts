export {
  FAST_AUTOTRADE_STRATEGY_ID,
  FAST_EXTENSION_ATR_MIN_SAMPLES,
  FAST_EXTENSION_ATR_PERIOD,
  FAST_EXTENSION_M1_GAP_TOLERANCE_SECONDS,
  FAST_EXTENSION_M1_HISTORY,
  FAST_EXTENSION_M1_PERIOD_SECONDS,
  type FastAction,
  type FastAutoTradeDecision,
  type FastAutoTradeInput,
  type FastBias,
  type FastExtensionAnchorType,
  type FastExtensionAtrSource,
  type FastExtensionDiagnostic,
  type FastGrade,
  type FastLifecycleState,
  type FastRegime,
  type FastSetupType,
  type FastWaitReason,
  type FastM1Availability
} from "./types";
export {
  DEFAULT_FAST_AUTOTRADE_CONFIG,
  entryThresholdForRegime,
  gradeForScore,
  isFastAutoTradeV1Enabled,
  loadFastAutoTradeConfig
} from "./config";
export {
  assessExtension,
  brokenStructureLevel,
  buildFastGeometry,
  candleKey,
  classifyFastRegime,
  completedBarTrueRange,
  contiguousExtensionTrueRanges,
  determineFastBias,
  detectFastSetup,
  detectFastTrigger,
  estimateAtr,
  estimateExtensionAtr,
  isConsecutiveCompletedM1,
  evaluateFastAutoTrade,
  evaluateFastReentry,
  forwardTradeBarrier,
  hardSafetyVeto,
  isExtended,
  scoreFastQuality,
  selectExtensionAnchor,
  tradeSpaceOk
} from "./engine";
export { evaluateFastManagement } from "./management";
export {
  FAST_AUTOTRADE_V1_DEMO_ONLY,
  FastAutoTradeLiveBlockedError,
  assertFastAutoTradeDemoOnly,
  evaluateFastAutoTradeDemoLock
} from "./demoLock";
export { mapDecisionToFastInput } from "./fromDecision";
export {
  buildFastAutoTradeInput,
  loadFastOneMinuteMarket,
  ohlcFromTrendbar,
  oneMinuteMarketFromBars
} from "./qualificationInput";
export {
  classifyCompletedM1Freshness,
  DEFAULT_MAX_COMPLETED_M1_AGE_MS,
  filterCompletedM1Bars,
  loadCompletedM1BarsForFastAutoTrade,
  useCompletedM1LoaderForTests
} from "./completedM1Candles";
export {
  loadFastReentryState,
  persistFastReentryEntry,
  persistFastReentryExit,
  resetFastReentryMemoryStore,
  saveFastReentryState,
  useFastReentryMemoryStore
} from "./reentryStateStore";
export {
  isPendingStateStuck,
  nextLifecycleState,
  setupIdentityKey
} from "./stateMachine";
