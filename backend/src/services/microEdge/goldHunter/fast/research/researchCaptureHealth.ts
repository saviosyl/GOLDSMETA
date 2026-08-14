/**
 * Pure capture-health / campaign-validity evaluation for research collector.
 */
import {
  GH_FAST_RESEARCH_FRESHNESS_MS,
  type ResearchCaptureHealth,
  type ResearchConnectionState,
  type ResearchDataIntegrityStatus
} from "./researchTypes";

export type CaptureHealthInputs = {
  processHealthy: boolean;
  connectionState: ResearchConnectionState;
  spotSubscribed: boolean;
  depthSubscribed: boolean;
  spotAgeMs: number | null;
  depthAgeMs: number | null;
  freshnessLimitMs?: number;
  eventsDropped: number;
  persistenceDroppedRows: number;
  persistenceDroppedChunks: number;
  writeErrors: number;
  uploadErrors: number;
  durableMode: "GCS" | "LOCAL_BUFFER_ONLY";
  campaignMode: boolean;
  scopeVerified: boolean;
  fatalPersistenceError: boolean;
  healthWarning: string | null;
  /** Independent HEARTBEAT rows persisted (campaign requires > 0). */
  heartbeatsPersisted?: number;
  /** SESSION_TRANSITION rows persisted (campaign requires > 0). */
  sessionTransitionsPersisted?: number;
};

export function evaluateCaptureHealth(input: CaptureHealthInputs): {
  captureHealthy: boolean;
  processHealthy: boolean;
  serviceHealthy: boolean;
  dataIntegrityStatus: ResearchDataIntegrityStatus;
  campaignValid: boolean;
  captureUnhealthyReasons: string[];
} {
  const freshness = input.freshnessLimitMs ?? GH_FAST_RESEARCH_FRESHNESS_MS;
  const reasons: string[] = [];

  if (input.connectionState !== "CONNECTED") {
    reasons.push("connection_not_connected");
  }
  if (!input.spotSubscribed) reasons.push("spot_not_subscribed");
  if (!input.depthSubscribed) reasons.push("depth_not_subscribed");
  if (input.spotAgeMs == null) reasons.push("spot_age_missing");
  else if (input.spotAgeMs > freshness) reasons.push("spot_stale");
  if (input.depthAgeMs == null) reasons.push("depth_age_missing");
  else if (input.depthAgeMs > freshness) reasons.push("depth_stale");
  if (input.eventsDropped > 0) reasons.push("events_dropped");
  if (input.persistenceDroppedRows > 0) reasons.push("persistence_dropped_rows");
  if (input.persistenceDroppedChunks > 0) {
    reasons.push("persistence_dropped_chunks");
  }
  if (input.fatalPersistenceError) reasons.push("fatal_persistence_error");
  if (input.writeErrors > 0) reasons.push("write_errors");

  const captureHealthy = input.processHealthy && reasons.length === 0;

  let dataIntegrityStatus: ResearchDataIntegrityStatus = "CLEAN";
  if (
    input.fatalPersistenceError ||
    input.persistenceDroppedRows > 0 ||
    input.persistenceDroppedChunks > 0 ||
    input.eventsDropped > 0
  ) {
    dataIntegrityStatus = "FAILED";
  } else if (input.writeErrors > 0 || input.uploadErrors > 0) {
    // Mode advisories (e.g. LOCAL_BUFFER_ONLY) stay on healthWarning —
    // they do not by themselves mark captured rows as integrity-degraded.
    dataIntegrityStatus = "DEGRADED";
  }

  const campaignReasons: string[] = [];
  if (!input.scopeVerified) campaignReasons.push("scope_not_verified");
  if (input.campaignMode && input.durableMode !== "GCS") {
    campaignReasons.push("gcs_required_for_campaign");
  }
  if (dataIntegrityStatus !== "CLEAN") {
    campaignReasons.push(`integrity_${dataIntegrityStatus.toLowerCase()}`);
  }
  if (!captureHealthy) campaignReasons.push("capture_unhealthy");
  if (input.campaignMode && (input.heartbeatsPersisted ?? 0) <= 0) {
    campaignReasons.push("heartbeats_missing");
  }
  if (input.campaignMode && (input.sessionTransitionsPersisted ?? 0) <= 0) {
    campaignReasons.push("session_telemetry_missing");
  }

  const campaignValid =
    captureHealthy &&
    input.scopeVerified &&
    dataIntegrityStatus === "CLEAN" &&
    (!input.campaignMode || input.durableMode === "GCS") &&
    (!input.campaignMode || (input.heartbeatsPersisted ?? 0) > 0) &&
    (!input.campaignMode || (input.sessionTransitionsPersisted ?? 0) > 0) &&
    campaignReasons.length === 0;

  return {
    processHealthy: input.processHealthy,
    captureHealthy,
    serviceHealthy: captureHealthy,
    dataIntegrityStatus,
    campaignValid,
    captureUnhealthyReasons: [...reasons, ...campaignReasons.filter((r) => !reasons.includes(r))]
  };
}

/** Narrow helper for tests / docs — extract key health flags. */
export function summarizeHealthFlags(h: ResearchCaptureHealth): {
  processHealthy: boolean;
  captureHealthy: boolean;
  serviceHealthy: boolean;
  dataIntegrityStatus: ResearchDataIntegrityStatus;
  campaignValid: boolean;
} {
  return {
    processHealthy: h.processHealthy,
    captureHealthy: h.captureHealthy,
    serviceHealthy: h.serviceHealthy,
    dataIntegrityStatus: h.dataIntegrityStatus,
    campaignValid: h.campaignValid
  };
}
