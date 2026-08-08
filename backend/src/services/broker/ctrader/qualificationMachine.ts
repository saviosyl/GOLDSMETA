/**
 * Pure qualification state derivation — no I/O.
 */

import type {
  QualificationBlocker,
  QualificationDocument,
  QualificationPublicView,
  QualificationState,
  SafetyCheckRecord
} from "./qualificationTypes";
import { QUALIFICATION_GATES } from "./qualificationTypes";

export type SetupSnapshot = {
  authenticated: boolean;
  approved: boolean;
  oauthConnected: boolean;
  demoAccountSelected: boolean;
  accountIsLive: boolean;
  accountMasked: string | null;
  accountId: string | null;
  symbolResolved: boolean;
  tradingScope: boolean;
  brokerQuoteHealthy: boolean;
  riskConfigured: boolean;
  emergencyStopHealthy: boolean;
  emergencyStopActive: boolean;
  dailyLimitsConfigured: boolean;
};

export function buildSetupBlockers(s: SetupSnapshot): QualificationBlocker[] {
  return [
    {
      id: "auth",
      label: "GoldMeta account approved",
      ok: s.authenticated && s.approved
    },
    {
      id: "oauth",
      label: s.accountMasked
        ? `Pepperstone Demo ${s.accountMasked} connected`
        : "Pepperstone Demo connected",
      ok: s.oauthConnected && s.demoAccountSelected && !s.accountIsLive
    },
    {
      id: "symbol",
      label: "XAUUSD verified",
      ok: s.symbolResolved
    },
    {
      id: "trading_scope",
      label: "Demo trading permission",
      ok: s.tradingScope,
      action: s.tradingScope ? null : "Authorise Demo Trading"
    },
    {
      id: "broker_quotes",
      label: "Broker quotes available",
      ok: s.brokerQuoteHealthy
    },
    {
      id: "risk",
      label: "Risk settings configured",
      ok: s.riskConfigured
    },
    {
      id: "daily_limits",
      label: "Daily limits configured",
      ok: s.dailyLimitsConfigured
    },
    {
      id: "emergency_stop",
      label: "Emergency Stop healthy",
      ok: s.emergencyStopHealthy && !s.emergencyStopActive
    }
  ];
}

export function setupReady(blockers: QualificationBlocker[]): boolean {
  return blockers.every((b) => b.ok);
}

export function observationProgress(firstTradeAt: string | null, now = new Date()): {
  day: number | null;
  remainingMs: number | null;
  complete: boolean;
} {
  if (!firstTradeAt) return { day: null, remainingMs: null, complete: false };
  const start = Date.parse(firstTradeAt);
  if (!Number.isFinite(start)) return { day: null, remainingMs: null, complete: false };
  const elapsedMs = Math.max(0, now.getTime() - start);
  const day = Math.min(
    QUALIFICATION_GATES.requiredObservationDays,
    Math.floor(elapsedMs / 86_400_000) + 1
  );
  const needMs = QUALIFICATION_GATES.requiredObservationDays * 86_400_000;
  const remainingMs = Math.max(0, needMs - elapsedMs);
  return {
    day,
    remainingMs,
    complete: elapsedMs >= needMs
  };
}

export function safetyCompleted(checks: SafetyCheckRecord[]): number {
  return checks.filter((c) => c.ok).length;
}

export function deriveAdvancedState(
  doc: QualificationDocument,
  now = new Date()
): QualificationState {
  if (doc.state === "PAUSED" || doc.state === "BLOCKED" || doc.state === "LIVE_AUTO_ENABLED") {
    return doc.state;
  }
  if (doc.state === "LIVE_ACTIVATION_REQUIRED" || doc.state === "LIVE_AUTO_ELIGIBLE") {
    return doc.state;
  }
  if (doc.state === "DEMO_AUTO_ENABLED" || doc.state === "LIVE_QUALIFICATION") {
    const obs = observationProgress(doc.firstDemoAutoTradeAt, now);
    if (
      doc.demoAutoTradeCount >= QUALIFICATION_GATES.requiredDemoAutoTrades &&
      obs.complete &&
      doc.criticalSafetyFailures === 0 &&
      safetyCompleted(doc.safetyChecks) >= QUALIFICATION_GATES.requiredSafetyChecks
    ) {
      return "LIVE_AUTO_ELIGIBLE";
    }
    return doc.demoAutoEnabledAt ? "LIVE_QUALIFICATION" : "DEMO_AUTO_ENABLED";
  }

  if (doc.state === "DEMO_AUTO_READY") return "DEMO_AUTO_READY";

  const obs = observationProgress(doc.firstControlledDemoTradeAt, now);
  const safetyOk =
    safetyCompleted(doc.safetyChecks) >= QUALIFICATION_GATES.requiredSafetyChecks;

  if (
    doc.previewCount >= QUALIFICATION_GATES.requiredPreviews &&
    doc.controlledTradeCount >= QUALIFICATION_GATES.requiredControlledTrades &&
    obs.complete &&
    safetyOk
  ) {
    return "DEMO_AUTO_READY";
  }

  if (doc.previewCount >= QUALIFICATION_GATES.requiredPreviews) {
    if (doc.controlledTradeCount >= QUALIFICATION_GATES.requiredControlledTrades) {
      return obs.complete ? "DEMO_AUTO_READY" : "OBSERVATION_PERIOD";
    }
    return "CONTROLLED_DEMO_QUALIFICATION";
  }

  if (doc.startedAt) return "PREVIEW_QUALIFICATION";
  return doc.state === "READY_TO_QUALIFY" ? "READY_TO_QUALIFY" : "SETUP_REQUIRED";
}

export function overallLabel(state: QualificationState): string {
  switch (state) {
    case "SETUP_REQUIRED":
      return "Setup required";
    case "READY_TO_QUALIFY":
      return "Ready to qualify";
    case "PREVIEW_QUALIFICATION":
    case "CONTROLLED_DEMO_QUALIFICATION":
    case "OBSERVATION_PERIOD":
    case "LIVE_QUALIFICATION":
      return "Qualifying";
    case "DEMO_AUTO_READY":
      return "Demo Auto ready";
    case "DEMO_AUTO_ENABLED":
      return "Demo Auto on";
    case "LIVE_AUTO_ELIGIBLE":
    case "LIVE_ACTIVATION_REQUIRED":
      return "Live Auto eligible";
    case "LIVE_AUTO_ENABLED":
      return "Live Auto on";
    case "PAUSED":
      return "Paused";
    case "BLOCKED":
      return "Blocked";
    default:
      return state;
  }
}

export function nextActionFor(
  state: QualificationState,
  blockers: QualificationBlocker[]
): string {
  const firstBlock = blockers.find((b) => !b.ok);
  if (state === "SETUP_REQUIRED" || (state === "READY_TO_QUALIFY" && firstBlock)) {
    if (firstBlock?.id === "oauth") return "Connect Pepperstone Demo";
    if (firstBlock?.id === "trading_scope") return "Authorise Demo Trading";
    if (firstBlock?.id === "risk" || firstBlock?.id === "daily_limits") {
      return "Review risk settings";
    }
    if (firstBlock) return firstBlock.action || firstBlock.label;
  }
  switch (state) {
    case "READY_TO_QUALIFY":
      return "Start qualification";
    case "PREVIEW_QUALIFICATION":
      return "Waiting for valid market setup";
    case "CONTROLLED_DEMO_QUALIFICATION":
      return "Waiting for controlled Demo trade";
    case "OBSERVATION_PERIOD":
      return "Continue observation period";
    case "DEMO_AUTO_READY":
      return "Enable Demo Auto";
    case "DEMO_AUTO_ENABLED":
    case "LIVE_QUALIFICATION":
      return "Continue Demo proving period";
    case "LIVE_AUTO_ELIGIBLE":
    case "LIVE_ACTIVATION_REQUIRED":
      return "Begin Live activation";
    case "PAUSED":
      return "Resume qualification";
    case "BLOCKED":
      return "Resolve Emergency Stop / block";
    case "LIVE_AUTO_ENABLED":
      return "Live Auto active — monitor risk";
    default:
      return "Continue setup";
  }
}

export function nextRequirementFor(doc: QualificationDocument, state: QualificationState): string {
  if (state === "PREVIEW_QUALIFICATION") {
    const left = Math.max(0, QUALIFICATION_GATES.requiredPreviews - doc.previewCount);
    return left === 0 ? "Advance to controlled Demo" : `${left} more previews`;
  }
  if (state === "CONTROLLED_DEMO_QUALIFICATION") {
    const left = Math.max(
      0,
      QUALIFICATION_GATES.requiredControlledTrades - doc.controlledTradeCount
    );
    return left === 0 ? "Advance observation" : `${left} more controlled Demo trades`;
  }
  if (state === "OBSERVATION_PERIOD") {
    const obs = observationProgress(doc.firstControlledDemoTradeAt);
    if (obs.remainingMs == null) return "Observation pending first trade";
    const days = Math.floor(obs.remainingMs / 86_400_000);
    const hours = Math.floor((obs.remainingMs % 86_400_000) / 3_600_000);
    return `${days}d ${hours}h remaining minimum`;
  }
  if (state === "LIVE_QUALIFICATION" || state === "DEMO_AUTO_ENABLED") {
    const left = Math.max(
      0,
      QUALIFICATION_GATES.requiredDemoAutoTrades - doc.demoAutoTradeCount
    );
    if (left > 0) return `${left} more automated Demo trades`;
    const obs = observationProgress(doc.firstDemoAutoTradeAt);
    if (obs.remainingMs != null && obs.remainingMs > 0) {
      const days = Math.floor(obs.remainingMs / 86_400_000);
      const hours = Math.floor((obs.remainingMs % 86_400_000) / 3_600_000);
      return `Live observation ${days}d ${hours}h remaining`;
    }
    return "Finalising Live eligibility";
  }
  if (state === "DEMO_AUTO_READY") return "Press Enable Demo Auto";
  if (state === "LIVE_AUTO_ELIGIBLE" || state === "LIVE_ACTIVATION_REQUIRED") {
    return "Explicit Live activation required";
  }
  return "Complete setup requirements";
}

export function toPublicView(args: {
  doc: QualificationDocument | null;
  setup: SetupSnapshot;
  stateOverride?: QualificationState;
}): QualificationPublicView {
  const blockers = buildSetupBlockers(args.setup);
  const ready = setupReady(blockers);
  const doc = args.doc;
  let state: QualificationState =
    args.stateOverride ??
    (doc ? deriveAdvancedState(doc) : ready ? "READY_TO_QUALIFY" : "SETUP_REQUIRED");

  if (!ready && state !== "PAUSED" && state !== "BLOCKED") {
    // Connected users mid-qualification keep their state even if a transient check fails,
    // but brand-new users stay in setup.
    if (!doc?.startedAt) state = "SETUP_REQUIRED";
  }

  const obs = observationProgress(doc?.firstControlledDemoTradeAt ?? null);
  const liveObs = observationProgress(doc?.firstDemoAutoTradeAt ?? null);
  const safety = doc?.safetyChecks ?? [];
  const safetyDone = safetyCompleted(safety);

  let liveStatus: QualificationPublicView["liveEligibility"]["status"] = "LOCKED";
  if (state === "LIVE_AUTO_ENABLED") liveStatus = "ENABLED";
  else if (state === "LIVE_ACTIVATION_REQUIRED") liveStatus = "ACTIVATION_REQUIRED";
  else if (state === "LIVE_AUTO_ELIGIBLE") liveStatus = "ELIGIBLE";
  else if (state === "LIVE_QUALIFICATION" || state === "DEMO_AUTO_ENABLED")
    liveStatus = "QUALIFYING";

  return {
    state,
    overallLabel: overallLabel(state),
    accountMasked: args.setup.accountMasked ?? doc?.accountMasked ?? null,
    accountIdPresent: Boolean(args.setup.accountId),
    environment: "DEMO",
    nextAction: nextActionFor(state, blockers),
    nextRequirement: doc
      ? nextRequirementFor(doc, state)
      : firstBlockerLabel(blockers) || "Complete setup",
    blockers,
    canStart: ready && (state === "READY_TO_QUALIFY" || state === "SETUP_REQUIRED"),
    canPause:
      state === "PREVIEW_QUALIFICATION" ||
      state === "CONTROLLED_DEMO_QUALIFICATION" ||
      state === "OBSERVATION_PERIOD" ||
      state === "LIVE_QUALIFICATION",
    canResume: state === "PAUSED",
    canEnableDemoAuto: state === "DEMO_AUTO_READY",
    canBeginLiveActivation:
      state === "LIVE_AUTO_ELIGIBLE" || state === "LIVE_ACTIVATION_REQUIRED",
    preview: {
      completed: doc?.previewCount ?? 0,
      required: QUALIFICATION_GATES.requiredPreviews
    },
    controlledDemo: {
      completed: doc?.controlledTradeCount ?? 0,
      required: QUALIFICATION_GATES.requiredControlledTrades,
      open: doc?.controlledOpenCount ?? 0,
      blockedAttempts: doc?.controlledBlockedAttempts ?? 0
    },
    observation: {
      day: obs.day,
      requiredDays: QUALIFICATION_GATES.requiredObservationDays,
      firstTradeAt: doc?.firstControlledDemoTradeAt ?? null,
      remainingMs: obs.remainingMs
    },
    safety: {
      completed: safetyDone,
      required: QUALIFICATION_GATES.requiredSafetyChecks,
      checks: safety
    },
    liveEligibility: {
      demoAutoTrades: doc?.demoAutoTradeCount ?? 0,
      requiredTrades: QUALIFICATION_GATES.requiredDemoAutoTrades,
      observationDay: liveObs.day,
      requiredDays: QUALIFICATION_GATES.requiredLiveObservationDays,
      criticalSafetyFailures: doc?.criticalSafetyFailures ?? 0,
      status: liveStatus
    },
    demoAuto: {
      enabled: state === "DEMO_AUTO_ENABLED" || state === "LIVE_QUALIFICATION" || state === "LIVE_AUTO_ELIGIBLE" || state === "LIVE_ACTIVATION_REQUIRED" || state === "LIVE_AUTO_ENABLED",
      ready: state === "DEMO_AUTO_READY" || state === "DEMO_AUTO_ENABLED" || state === "LIVE_QUALIFICATION" || state === "LIVE_AUTO_ELIGIBLE" || state === "LIVE_ACTIVATION_REQUIRED" || state === "LIVE_AUTO_ENABLED"
    },
    liveOrders: "LOCKED",
    recentPreviews: (doc?.previews ?? []).slice(-8).reverse(),
    recentControlledTrades: (doc?.controlledTrades ?? []).slice(-8).reverse(),
    todayActivity: { evaluated: 0, qualified: 0, rejected: 0 },
    recentEvaluations: [],
    startedAt: doc?.startedAt ?? null,
    updatedAt: doc?.updatedAt ?? null
  };
}

function firstBlockerLabel(blockers: QualificationBlocker[]): string {
  return blockers.find((b) => !b.ok)?.label ?? "";
}

/** States that may submit Pepperstone Demo orders (never Live). */
export function allowsDemoOrderSubmission(state: QualificationState): boolean {
  return (
    state === "CONTROLLED_DEMO_QUALIFICATION" ||
    state === "DEMO_AUTO_ENABLED" ||
    state === "LIVE_QUALIFICATION"
  );
}
