export {
  FAST_AUTOTRADE_STRATEGY_ID,
  type FastAction,
  type FastAutoTradeDecision,
  type FastAutoTradeInput,
  type FastBias,
  type FastGrade,
  type FastLifecycleState,
  type FastRegime,
  type FastSetupType,
  type FastWaitReason
} from "./types";
export {
  DEFAULT_FAST_AUTOTRADE_CONFIG,
  entryThresholdForRegime,
  gradeForScore,
  isFastAutoTradeV1Enabled,
  loadFastAutoTradeConfig
} from "./config";
export {
  classifyFastRegime,
  determineFastBias,
  detectFastSetup,
  detectFastTrigger,
  evaluateFastAutoTrade,
  evaluateFastReentry,
  hardSafetyVeto
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
