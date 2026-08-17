/**
 * Authoritative Demo margin sequence for FAST submission.
 *
 * Expected margin FIRST, authoritative snapshot LAST, then evaluate.
 * Snapshot age is measured at evaluation time (immediately after the
 * final snapshot), not from before a slow expected-margin call.
 */

import {
  evaluateMarginSafetyGate,
  type AuthoritativeMarginSnapshot,
  type MarginGateResult
} from "../authoritativeMargin";
import type {
  AuthoritativeMarginSnapshotResult,
  ExpectedMarginResult
} from "../openApiClient";

export async function runAuthoritativeMarginSequence(args: {
  fetchExpectedMargin: () => Promise<ExpectedMarginResult>;
  fetchAuthoritativeSnapshot: () => Promise<AuthoritativeMarginSnapshotResult>;
  nowMs?: number;
  maxAgeMs?: number;
  selectedAccountIsLive?: boolean;
}): Promise<MarginGateResult> {
  if (args.selectedAccountIsLive) {
    return evaluateMarginSafetyGate({
      snapshot: null,
      expectedMargin: null,
      expectedMarginOk: false,
      nowMs: args.nowMs,
      maxAgeMs: args.maxAgeMs,
      selectedAccountIsLive: true
    });
  }

  let expected: ExpectedMarginResult;
  try {
    expected = await args.fetchExpectedMargin();
  } catch {
    return evaluateMarginSafetyGate({
      snapshot: null,
      expectedMargin: null,
      expectedMarginOk: false,
      nowMs: args.nowMs,
      maxAgeMs: args.maxAgeMs,
      selectedAccountIsLive: false
    });
  }

  if (!expected.ok) {
    let snapshot: AuthoritativeMarginSnapshot | null = null;
    try {
      const snapRes = await args.fetchAuthoritativeSnapshot();
      snapshot = snapRes.ok ? snapRes.snapshot : null;
    } catch {
      snapshot = null;
    }
    return evaluateMarginSafetyGate({
      snapshot,
      expectedMargin: null,
      expectedMarginOk: false,
      nowMs: args.nowMs ?? Date.now(),
      maxAgeMs: args.maxAgeMs,
      selectedAccountIsLive: false
    });
  }

  let snapshot: AuthoritativeMarginSnapshot | null = null;
  try {
    const snapRes = await args.fetchAuthoritativeSnapshot();
    if (!snapRes.ok) {
      return evaluateMarginSafetyGate({
        snapshot: null,
        expectedMargin: expected.expectedMargin,
        expectedMarginOk: true,
        nowMs: args.nowMs ?? Date.now(),
        maxAgeMs: args.maxAgeMs,
        selectedAccountIsLive: false
      });
    }
    snapshot = snapRes.snapshot;
  } catch {
    return evaluateMarginSafetyGate({
      snapshot: null,
      expectedMargin: expected.expectedMargin,
      expectedMarginOk: true,
      nowMs: args.nowMs ?? Date.now(),
      maxAgeMs: args.maxAgeMs,
      selectedAccountIsLive: false
    });
  }

  return evaluateMarginSafetyGate({
    snapshot,
    expectedMargin: expected.expectedMargin,
    expectedMarginOk: true,
    nowMs: args.nowMs ?? Date.now(),
    maxAgeMs: args.maxAgeMs,
    selectedAccountIsLive: false
  });
}
