/**
 * Trader-facing record kind for History rows.
 * Distinguishes hypothetical SIGNAL records from broker Demo/Live results.
 */

import type { Decision, SetupRecord, SignalOutcomeRecord } from "../types/models";

export type HistoryRecordKind =
  | "SIGNAL"
  | "HYPOTHETICAL"
  | "CONTROLLED_DEMO"
  | "DEMO_AUTO"
  | "LIVE_AUTO";

export function historyRecordKind(args: {
  decision: Decision;
  setup?: { status: string; resolution: string; environment: string } | null;
  outcome?: SignalOutcomeRecord | null;
}): { kind: HistoryRecordKind; label: string } {
  const env = String(args.decision.environment ?? args.setup?.environment ?? "").toUpperCase();
  const setupStatus = String(args.setup?.status ?? "").toUpperCase();
  const resolution = String(args.setup?.resolution ?? "").toUpperCase();

  if (/LIVE_AUTO|LIVE_ORDER|BROKER_LIVE/.test(setupStatus) || env === "LIVE_AUTO") {
    return { kind: "LIVE_AUTO", label: "LIVE AUTO" };
  }
  if (/DEMO_AUTO|IG_DEMO_AUTO/.test(setupStatus) || env === "DEMO_AUTO") {
    return { kind: "DEMO_AUTO", label: "DEMO AUTO" };
  }
  if (
    /CONTROLLED_DEMO|QUALIFICATION|DEMO_QUAL/.test(setupStatus) ||
    /CONTROLLED/.test(resolution)
  ) {
    return { kind: "CONTROLLED_DEMO", label: "CONTROLLED DEMO" };
  }

  // Signal / hypothetical tracking (default for decision history)
  if (args.outcome || args.decision.analysisOnly !== false) {
    if (args.outcome?.finalResult?.outcome || args.outcome?.monitoring?.lifecycle) {
      return { kind: "HYPOTHETICAL", label: "HYPOTHETICAL" };
    }
    return { kind: "SIGNAL", label: "SIGNAL" };
  }

  if (env === "TEST") return { kind: "SIGNAL", label: "SIGNAL" };
  return { kind: "SIGNAL", label: "SIGNAL" };
}
