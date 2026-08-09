/**
 * Canonical AutoTrade header status for the global shell.
 * Derives trader-facing labels from qualification + AutoTrade status — never hardcode OFF.
 */

import type { AutoTradeStatus } from "./autoTradeTypes";
import type { QualificationPublicView, QualificationState } from "./broker/qualificationTypes";

export type AutoTradeHeaderTone = "success" | "warning" | "danger" | "info" | "neutral";

export type AutoTradeHeaderStatus = {
  /** Short pill label, e.g. "DEMO · QUALIFYING" */
  label: string;
  /** Environment segment: DEMO / LIVE / OFF */
  environment: "DEMO" | "LIVE" | "OFF";
  /** State segment for tests and a11y */
  stateKey:
    | "QUALIFYING"
    | "DEMO_AUTO_READY"
    | "DEMO_AUTO"
    | "DEMO_PAUSED"
    | "LIVE_ELIGIBLE"
    | "LIVE_LOCKED"
    | "OFF"
    | "BLOCKED"
    | "LOADING";
  tone: AutoTradeHeaderTone;
  /** Plain-English next action when available */
  nextAction: string | null;
};

const QUALIFYING_STATES: QualificationState[] = [
  "PREVIEW_QUALIFICATION",
  "CONTROLLED_DEMO_QUALIFICATION",
  "OBSERVATION_PERIOD",
  "READY_TO_QUALIFY",
  "LIVE_QUALIFICATION"
];

export function deriveAutoTradeHeaderStatus(args: {
  qualification: QualificationPublicView | null | undefined;
  status: AutoTradeStatus | null | undefined;
  loading?: boolean;
}): AutoTradeHeaderStatus {
  const { qualification, status, loading } = args;

  if (loading && !qualification && !status) {
    return {
      label: "AutoTrade …",
      environment: "OFF",
      stateKey: "LOADING",
      tone: "neutral",
      nextAction: null
    };
  }

  const qState = qualification?.state;
  const liveLocked = qualification?.liveOrders === "LOCKED" || status?.locked === true;
  const demoAutoEnabled = Boolean(qualification?.demoAuto?.enabled);
  const demoAutoReady = Boolean(qualification?.demoAuto?.ready);
  const emergency =
    status?.displayStatus === "LOCKED" ||
    (status?.mode === "OFF" && status?.locked === true && status?.displayStatus === "LOCKED");

  if (qState === "BLOCKED" || emergency) {
    return {
      label: "BLOCKED",
      environment: "DEMO",
      stateKey: "BLOCKED",
      tone: "danger",
      nextAction: qualification?.nextAction ?? "Trading paused by safety controls"
    };
  }

  if (qState === "PAUSED") {
    return {
      label: "DEMO · PAUSED",
      environment: "DEMO",
      stateKey: "DEMO_PAUSED",
      tone: "warning",
      nextAction: qualification?.nextAction ?? "Qualification paused"
    };
  }

  if (qState === "DEMO_AUTO_ENABLED" || demoAutoEnabled) {
    const modeActive =
      status?.mode === "IG_DEMO_AUTO" || status?.displayStatus === "DEMO";
    return {
      label: modeActive ? "DEMO AUTO · ACTIVE" : "DEMO AUTO · READY",
      environment: "DEMO",
      stateKey: "DEMO_AUTO",
      tone: "success",
      nextAction: qualification?.nextAction ?? null
    };
  }

  if (qState === "DEMO_AUTO_READY" || (demoAutoReady && !demoAutoEnabled)) {
    return {
      label: "DEMO · AUTO READY",
      environment: "DEMO",
      stateKey: "DEMO_AUTO_READY",
      tone: "success",
      nextAction: qualification?.nextAction ?? "Demo Auto is ready to enable"
    };
  }

  if (qState === "LIVE_AUTO_ELIGIBLE" || qState === "LIVE_ACTIVATION_REQUIRED") {
    return {
      label: "LIVE · ELIGIBLE",
      environment: "LIVE",
      stateKey: "LIVE_ELIGIBLE",
      tone: "warning",
      nextAction: qualification?.nextAction ?? "Live activation required"
    };
  }

  if (qState === "LIVE_AUTO_ENABLED") {
    return {
      label: liveLocked ? "LIVE · LOCKED" : "LIVE · ACTIVE",
      environment: "LIVE",
      stateKey: liveLocked ? "LIVE_LOCKED" : "LIVE_ELIGIBLE",
      tone: liveLocked ? "warning" : "success",
      nextAction: qualification?.nextAction ?? null
    };
  }

  if (qState && QUALIFYING_STATES.includes(qState)) {
    return {
      label: "DEMO · QUALIFYING",
      environment: "DEMO",
      stateKey: "QUALIFYING",
      tone: "warning",
      nextAction: qualification?.nextAction ?? "Waiting for valid market setup"
    };
  }

  if (liveLocked && (status?.displayStatus === "OFF" || !status?.mode || status.mode === "OFF")) {
    // Connected demo path with Live hard-locked — still may be setup-required
    if (qState === "SETUP_REQUIRED") {
      return {
        label: "DEMO · SETUP",
        environment: "DEMO",
        stateKey: "OFF",
        tone: "neutral",
        nextAction: qualification?.nextAction ?? "Complete broker setup"
      };
    }
  }

  if (status?.displayStatus === "SHADOW" || status?.mode === "SHADOW") {
    return {
      label: "DEMO · RESEARCH",
      environment: "DEMO",
      stateKey: "OFF",
      tone: "info",
      nextAction: "Research mode — no orders placed"
    };
  }

  // Default: truthful OFF when nothing active
  const envLabel = liveLocked ? "LIVE · LOCKED" : "OFF";
  if (liveLocked && !qState) {
    return {
      label: "LIVE · LOCKED",
      environment: "LIVE",
      stateKey: "LIVE_LOCKED",
      tone: "warning",
      nextAction: null
    };
  }

  return {
    label: envLabel === "LIVE · LOCKED" ? envLabel : "OFF",
    environment: "OFF",
    stateKey: "OFF",
    tone: "neutral",
    nextAction: qualification?.nextAction ?? null
  };
}
