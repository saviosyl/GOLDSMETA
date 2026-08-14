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

/** A/B/C observation — never implies order submission. */
export type ResearchSpecialistObservation = {
  setup: GhFastSetupId;
  eligible: boolean;
  candidateSide: GhFastSide | null;
  rawQuality: number | null;
  failedConditions: string[];
  /** Research-only best-of flag; does NOT create an order. */
  selectedCandidate: boolean;
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
      bid: number | null;
      ask: number | null;
      spread: number | null;
      brokerTimestampMs: number | null;
    }
  | {
      kind: "DEPTH";
      newQuotes?: unknown[];
      deletedQuotes?: unknown[];
      bestBid: number | null;
      bestAsk: number | null;
      depthAvailable: boolean;
      crossed: boolean;
      bookGeneration: number;
      brokerTimestampMs: number | null;
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
  bookCrossedCount: number;
  candidateA: number;
  candidateB: number;
  candidateC: number;
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
  safety: {
    shadowOrders: 0;
    brokerRequests: 0;
    brokerOrders: 0;
  };
  tradingButtons: never[];
};
