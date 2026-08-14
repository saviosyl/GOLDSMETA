/**
 * GOLD_HUNTER FAST — Research capture types.
 * Observation-only. No trading actions, adapters, or P/L.
 */
import type { GhFastSetupId, GhFastSide } from "../types";

export const GH_FAST_RESEARCH_SCHEMA_VERSION =
  "gh-fast-research-capture-v1.0.0" as const;

export const GH_FAST_RESEARCH_MODE = "RESEARCH_CAPTURE_ONLY" as const;

export const GH_FAST_RESEARCH_GCS_PREFIX_ROOT =
  "gold-hunter-fast/research-capture" as const;

export const GH_FAST_RESEARCH_FORBIDDEN_GCS_PREFIX =
  "gold-hunter-fast/live-shadow" as const;

export type ResearchConnectionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING"
  | "RESUBSCRIBING";

export type ResearchResubscribeState =
  | "IDLE"
  | "PENDING"
  | "IN_PROGRESS"
  | "COMPLETE"
  | "FAILED";

/**
 * Depth semantic validity for a specialist evaluation row.
 * Non-DEPTH_VALID rows are DERIVED-DATA CONTAMINATED for offline qualification
 * but raw capture rows are never deleted.
 */
export type ResearchDepthValidity =
  | "DEPTH_VALID"
  | "DEPTH_UNAVAILABLE"
  | "DEPTH_CROSSED"
  | "DEPTH_STALE"
  | "RESYNC_RECOVERY";

/** A/B/C observation — never implies order submission. */
export type ResearchSpecialistObservation = {
  setup: GhFastSetupId;
  eligible: boolean;
  candidateSide: GhFastSide | null;
  rawQuality: number | null;
  failedConditions: string[];
  /** Research-only best-of flag; does NOT create an order. */
  selectedCandidate: boolean;
  /**
   * Depth book semantic validity at evaluation time.
   * Soft-stale Spot (or Depth) also forces derivedDataContaminated on the bridge
   * even when depthValidity remains DEPTH_VALID.
   */
  depthValidity: ResearchDepthValidity;
  /**
   * True when depthValidity !== DEPTH_VALID OR Spot/Depth soft-freshness fails.
   * Contaminated rows remain in raw capture; do not treat as clean evidence.
   */
  derivedDataContaminated: boolean;
};

/**
 * Bounded recent-candidate row for the research monitor UI.
 * RESEARCH OBSERVATION ONLY — never a trade / P/L / WIN-LOSS.
 */
export type ResearchRecentCandidateObservation = {
  observationId: number;
  label: "RESEARCH OBSERVATION — NOT A TRADE";
  kind:
    | "A_OBSERVATION"
    | "B_OBSERVATION"
    | "C_OBSERVATION"
    | "A_CANDIDATE"
    | "B_CANDIDATE"
    | "C_CANDIDATE"
    | "A_SELECTED"
    | "B_SELECTED"
    | "C_SELECTED";
  setup: GhFastSetupId;
  setupName: string;
  side: GhFastSide | null;
  eligible: boolean;
  rawQuality: number | null;
  selectedCandidate: boolean;
  failedConditions: string[];
  receiveSeq: number;
  eventKind: "SPOT" | "DEPTH";
  tsMs: number;
  tsIso: string;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  mid: number | null;
  imbalance: number | null;
  velocity1s: number | null;
  acceleration: number | null;
  distHigh5s: number | null;
  distLow5s: number | null;
  upTouches5s: number | null;
  downTouches5s: number | null;
  depthValidity?: ResearchDepthValidity;
  derivedDataContaminated?: boolean;
  brokerRequests: 0;
  brokerOrders: 0;
  shadowOrders: 0;
  executionAdapter: "NONE";
};

export type ResearchRecentCandidatesResponse = {
  mode: typeof GH_FAST_RESEARCH_MODE;
  label: "RESEARCH OBSERVATION FEED — NOT TRADES";
  runId: string | null;
  limit: number;
  count: number;
  filter: "SELECTED" | "ELIGIBLE" | "ALL";
  observations: ResearchRecentCandidateObservation[];
  brokerRequests: 0;
  brokerOrders: 0;
  shadowOrders: 0;
  executionAdapter: "NONE";
  mutationSurface: "NONE";
  tradingButtons: [];
  marketDataNormalizationVersion: string;
  inputNormalizationVerified: boolean;
};

export type ResearchFeatureTelemetry = {
  midVel250: number;
  midVel500: number;
  midVel1s: number;
  midVel2s: number;
  midVel3s: number;
  acceleration: number;
  efficiency1s: number;
  efficiency3s: number;
  signedImbalance1s: number;
  depthImbalance: number;
  weightedImbalance: number;
  liquidityAddedBid: number;
  liquidityAddedAsk: number;
  liquidityRemovedBid: number;
  liquidityRemovedAsk: number;
  addRateBid: number;
  addRateAsk: number;
  removeRateBid: number;
  removeRateAsk: number;
  updateRate1s: number;
  distHigh5s: number;
  distLow5s: number;
  upTouches5s: number;
  downTouches5s: number;
  bid: number;
  ask: number;
  spread: number;
  mid: number;
};

export type ResearchTransportTimestamps = {
  rawCallbackArrivalMs: number;
  bridgeEnqueueMs: number;
  processStartMs: number;
  enqueueToProcessLatencyMs: number;
};

export type ResearchSubscriptionState = {
  spotSubscribed: boolean;
  depthSubscribed: boolean;
  connectionState: ResearchConnectionState;
  disconnectTs: number | null;
  reconnectStartTs: number | null;
  reconnectFinishTs: number | null;
  resubscribeState: ResearchResubscribeState;
  reconnectReason: string | null;
};

export type ResearchDataIntegrityStatus = "CLEAN" | "DEGRADED" | "FAILED";

export const GH_FAST_RESEARCH_FRESHNESS_MS = 20_000;

export type ResearchMarketPayload =
  | {
      kind: "SPOT";
      /** Absolute price (cTrader relative ÷ 100000). */
      bid: number | null;
      ask: number | null;
      spread: number | null;
      /** Raw cTrader relative integers preserved for forensic replay. */
      bidRelative?: number | null;
      askRelative?: number | null;
      brokerTimestampMs: number | null;
      marketDataNormalizationVersion?: string;
      inputNormalizationVerified?: boolean;
    }
  | {
      kind: "DEPTH";
      /** Normalized quotes (absolute price + size units). */
      newQuotes?: unknown[];
      deletedQuotes?: unknown[];
      /** Raw ProtoOA depth payload preserved for forensic replay. */
      rawNewQuotes?: unknown[];
      rawDeletedQuotes?: unknown;
      bestBid: number | null;
      bestAsk: number | null;
      depthAvailable: boolean;
      crossed: boolean;
      bookGeneration: number;
      brokerTimestampMs: number | null;
      marketDataNormalizationVersion?: string;
      inputNormalizationVerified?: boolean;
    }
  | {
      kind: "RESYNC_MARKER";
      reason: string;
    }
  | {
      kind: "HEARTBEAT";
      heartbeatTs: number;
      eventLoopLagMs: number;
      connectionState: ResearchConnectionState;
      spotSubscribed: boolean;
      depthSubscribed: boolean;
      spotAgeMs: number | null;
      depthAgeMs: number | null;
      queueDepth: number;
      persistenceQueueDepth: number;
    }
  | {
      kind: "SESSION_TRANSITION";
      fromState: ResearchConnectionState;
      toState: ResearchConnectionState;
      reason: string | null;
      spotSubscribed: boolean;
      depthSubscribed: boolean;
      liveConnected: boolean | null;
      reconnectAttempts: number | null;
      lastErrorCode: string | null;
    };

export type ResearchCaptureRecord = {
  schemaVersion: typeof GH_FAST_RESEARCH_SCHEMA_VERSION;
  mode: typeof GH_FAST_RESEARCH_MODE;
  t: number;
  runId: string;
  datasetId: string;
  receiveSeq: number;
  eventKind: ResearchMarketPayload["kind"];
  transport: ResearchTransportTimestamps;
  subscription: ResearchSubscriptionState;
  queueDepthAtProcess: number;
  eventLoopLagMs: number | null;
  market: ResearchMarketPayload;
  features: ResearchFeatureTelemetry | null;
  specialists: ResearchSpecialistObservation[] | null;
  /** cTrader normalization identity for this record (SPOT/DEPTH). */
  marketDataNormalizationVersion?: string | null;
  inputNormalizationVerified?: boolean;
  /** Hard-coded safety counters — always zero. */
  safety: {
    brokerRequests: 0;
    brokerOrders: 0;
    shadowOrders: 0;
    openShadowTrade: false;
    executionAdapter: "NONE";
    mutationSurface: "NONE";
    permissionScope: "SCOPE_VIEW";
  };
};

export type ResearchChunkManifest = {
  runId: string;
  datasetId: string;
  schemaVersion: typeof GH_FAST_RESEARCH_SCHEMA_VERSION;
  runtimeSha: string | null;
  researchConfigSha: string;
  captureStart: string;
  chunkIndex: number;
  startTs: number;
  endTs: number;
  rowCount: number;
  sequenceStart: number;
  sequenceEnd: number;
  sha256: string;
  gcsObject?: string | null;
  localPath?: string | null;
  uploadedAt: string | null;
  storagePrefix: typeof GH_FAST_RESEARCH_GCS_PREFIX_ROOT;
  /** UTC calendar date of the chunk partition (YYYY-MM-DD). */
  captureUtcDate?: string;
};

export type ResearchDaySummary = {
  date: string;
  runId: string;
  datasetId: string;
  schemaVersion: typeof GH_FAST_RESEARCH_SCHEMA_VERSION;
  captureDayIndex: number;
  captureStart: string;
  captureEnd: string | null;
  eventsReceived: number;
  eventsDropped: number;
  spotEventCount: number;
  depthEventCount: number;
  heartbeatCount: number;
  sessionTransitionCount: number;
  feedGapCount: number;
  reconnectCount: number;
  resyncCount: number;
  bookCrossedCount: number;
  candidateA: number;
  candidateB: number;
  candidateC: number;
  chunksWritten: number;
  chunksUploaded: number;
  persistenceDroppedRows: number;
  persistenceDroppedChunks: number;
  writeErrors: number;
  uploadErrors: number;
  brokerRequests: 0;
  brokerOrders: 0;
  shadowOrders: 0;
  executionAdapter: "NONE";
  mode: typeof GH_FAST_RESEARCH_MODE;
  dataIntegrityStatus: ResearchDataIntegrityStatus;
  campaignValid: boolean;
  contaminated: boolean;
  heartbeatsPersisted: number;
  sessionTransitionsPersisted: number;
  durableMode: "GCS" | "LOCAL_BUFFER_ONLY";
  scopeVerified: boolean;
  /**
   * Technically clean enough for later offline analysis.
   * Does NOT mean profitable or independently validated.
   */
  campaignDayEligibleForLaterValidation: boolean;
  /** Offline qualification counter — remains 0 until daily qualification runs. */
  validatedIndependentDays: number;
  note?: string;
};

export type ResearchCaptureHealth = {
  mode: typeof GH_FAST_RESEARCH_MODE;
  service: "gold-hunter-fast-research-capture";
  /** Process is up (runtime constructed / started). */
  processHealthy: boolean;
  /**
   * Capture pipeline is producing valid research data right now.
   * Requires CONNECTED + both subscriptions + fresh ages + no drops + no fatal persist.
   */
  captureHealthy: boolean;
  /** Backward-compatible alias: same as captureHealthy (never true while disconnected). */
  serviceHealthy: boolean;
  dataIntegrityStatus: ResearchDataIntegrityStatus;
  campaignValid: boolean;
  scopeVerified: boolean;
  spotSubscribed: boolean;
  depthSubscribed: boolean;
  spotAgeMs: number | null;
  depthAgeMs: number | null;
  freshnessLimitMs: number;
  eventsReceived: number;
  eventsDropped: number;
  queueDepth: number;
  queueLatencyP50: number | null;
  queueLatencyP95: number | null;
  queueLatencyP99: number | null;
  eventLoopLagP50: number | null;
  eventLoopLagP95: number | null;
  eventLoopLagP99: number | null;
  feedGapCount: number;
  reconnectCount: number;
  resyncCount: number;
  /**
   * @deprecated Prefer depthCrossedEventCount — historically inflated by SPOT
   * ticks observing an already-crossed book. Equals depthCrossedEventCount.
   */
  bookCrossedCount: number;
  /** DEPTH events only. */
  depthEventCount: number;
  /** DEPTH events whose book snapshot was crossed (not SPOT observations). */
  depthCrossedEventCount: number;
  /** depthCrossedEventCount / depthEventCount, or null if no depth events. */
  depthCrossedPct: number | null;
  /** Current Depth semantic state for the monitor. */
  currentDepthState: ResearchDepthValidity;
  /** Continuous crossed duration while currently crossed; else 0. */
  crossedDurationMs: number;
  /** Sustained-cross / disconnect ordered resync recoveries. */
  depthResyncCount: number;
  /** Ordered RESYNCs from session detach / genuine disconnect ghost-clear. */
  disconnectResyncCount: number;
  /** Sustained-cross recovery resyncs (10s policy — unchanged). */
  sustainedCrossRecoveryCount: number;
  deleteHits: number;
  deleteMisses: number;
  /**
   * @deprecated Prefer eligibleA/B/C — historically mixed observations.
   * Now equals eligibleA/B/C (true candidates only).
   */
  candidateA: number;
  candidateB: number;
  candidateC: number;
  observationA: number;
  observationB: number;
  observationC: number;
  eligibleA: number;
  eligibleB: number;
  eligibleC: number;
  selectedA: number;
  selectedB: number;
  selectedC: number;
  lastBid: number | null;
  lastAsk: number | null;
  lastSpread: number | null;
  /** Research diagnostics — cTrader ProtoOASpotEvent may be one-sided. */
  spotBidOnlyEvents: number;
  spotAskOnlyEvents: number;
  spotTwoSidedEvents: number;
  /** Derived monitor-only reference paper summary (not research evidence). */
  referencePaper: {
    mode: "REFERENCE_PAPER_ONLY";
    label: string;
    paperTrades: number;
    open: number;
    wins: number;
    losses: number;
    breakeven: number;
    winRate: number | null;
    profitFactor: number | null;
    netMoveSum: number;
    tradesPerHour: number | null;
    tradesPerHourLabel: "PAPER TRADES / WALL-CLOCK RUNTIME HOUR";
    paperTradesPerRuntimeHour: number | null;
    paperTradesPerRuntimeHourLabel: "PAPER TRADES / WALL-CLOCK RUNTIME HOUR";
    totalClosedTrades: number;
    historyRows: number;
    paperEntriesBlockedDataNotOk: number;
    paperDataStaleExits: number;
    paperResyncExits: number;
    startingBalanceEur: 500;
    currentBalanceEur: number;
    totalReturnPct: number;
    referenceMarketExposureEur: 1000;
    referencePositionValueEur: 1000;
    marginRequirementPct: 50;
    referenceMarginUsedEur: 500;
    hypotheticalEurPnlSum: number;
    hypotheticalEurPnlLabel: "HYPOTHETICAL PAPER ACCOUNT · NOT A BROKER ACCOUNT P/L";
    brokerRequests: 0;
    brokerOrders: 0;
    executionAdapter: "NONE";
  };
  marketDataNormalizationVersion: string;
  inputNormalizationVerified: boolean;
  captureStart: string | null;
  captureDurationMs: number;
  runId: string;
  datasetId: string;
  schemaVersion: typeof GH_FAST_RESEARCH_SCHEMA_VERSION;
  researchConfigSha: string;
  runtimeSha: string | null;
  brokerRequests: 0;
  brokerOrders: 0;
  shadowOrders: 0;
  permissionScope: "SCOPE_VIEW";
  mutationSurface: "NONE";
  executionAdapter: "NONE";
  openShadowTrade: false;
  connectionState: ResearchConnectionState;
  storagePrefix: typeof GH_FAST_RESEARCH_GCS_PREFIX_ROOT;
  durableMode: "GCS" | "LOCAL_BUFFER_ONLY";
  persistenceQueueDepth: number;
  persistenceDroppedChunks: number;
  persistenceDroppedRows: number;
  chunksWritten: number;
  chunksUploaded: number;
  writeErrors: number;
  uploadErrors: number;
  healthWarning: string | null;
  captureUnhealthyReasons: string[];
  heartbeatsPersisted: number;
  sessionTransitionsPersisted: number;
  disclaimer: string;
};

/** UI design contract only — not wired into production trading UI. */
export type ResearchStatusUiDesign = {
  title: "GOLD_HUNTER FAST";
  subtitle: "RESEARCH CAPTURE — NO TRADING";
  data: "LIVE" | "OFFLINE";
  spot: "LIVE" | "OFFLINE";
  depth: "LIVE" | "OFFLINE";
  captureDayLabel: string;
  eventsCaptured: number;
  feedGaps: number;
  reconnects: number;
  queueLatencyP95: number | null;
  eventLoopLagP95: number | null;
  candidateObservations: { A: number; B: number; C: number };
  eligibleObservations: { A: number; B: number; C: number };
  selectedOpportunities: { A: number; B: number; C: number };
  marketDataNormalizationVersion: string;
  inputNormalizationVerified: boolean;
  safety: {
    shadowOrders: 0;
    brokerRequests: 0;
    brokerOrders: 0;
  };
  tradingButtons: never[];
};
