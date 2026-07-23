/**
 * Runtime execution flags — fail closed unless env explicitly enables.
 * Production Cloud Run keeps all false. Isolated apiT212OrderPreview may enable
 * Practice paper submission only (never Live).
 */

function envTrue(name: string): boolean {
  return (process.env[name] ?? "").trim().toLowerCase() === "true";
}

export function isLiveExecutionFeatureFlag(): boolean {
  return envTrue("LIVE_EXECUTION_FEATURE_FLAG");
}

export function isDemoOrderSubmissionEnabled(): boolean {
  return envTrue("DEMO_ORDER_SUBMISSION_ENABLED");
}

export function isT212PaperOrderSubmissionEnabled(): boolean {
  return envTrue("T212_PAPER_ORDER_SUBMISSION_ENABLED");
}

export function isT212LiveExecutionFeatureFlag(): boolean {
  return envTrue("T212_LIVE_EXECUTION_FEATURE_FLAG");
}

export function isBrokerExecutionEnabled(): boolean {
  return envTrue("BROKER_EXECUTION_ENABLED");
}

/** Practice order path may run only when paper+broker are on and Live stays off. */
export function isPracticeOrderSubmissionAllowed(): boolean {
  return (
    isBrokerExecutionEnabled() &&
    isT212PaperOrderSubmissionEnabled() &&
    isDemoOrderSubmissionEnabled() &&
    !isT212LiveExecutionFeatureFlag() &&
    !isLiveExecutionFeatureFlag()
  );
}

/** Live order paths are never allowed in this release. */
export function assertLiveExecutionDisabled(): void {
  if (isT212LiveExecutionFeatureFlag() || isLiveExecutionFeatureFlag()) {
    throw Object.assign(new Error("LIVE_EXECUTION_FEATURE_DISABLED"), {
      code: "LIVE_EXECUTION_FEATURE_DISABLED"
    });
  }
}

export function assertPracticeOrderSubmissionAllowed(): void {
  assertLiveExecutionDisabled();
  if (!isPracticeOrderSubmissionAllowed()) {
    throw Object.assign(new Error("PRACTICE_ORDER_SUBMISSION_DISABLED"), {
      code: "PRACTICE_ORDER_SUBMISSION_DISABLED"
    });
  }
}

export function snapshotExecutionFlags(): {
  BROKER_EXECUTION_ENABLED: boolean;
  T212_PAPER_ORDER_SUBMISSION_ENABLED: boolean;
  T212_LIVE_EXECUTION_FEATURE_FLAG: boolean;
  DEMO_ORDER_SUBMISSION_ENABLED: boolean;
  LIVE_EXECUTION_FEATURE_FLAG: boolean;
  practiceOrderSubmissionAllowed: boolean;
} {
  return {
    BROKER_EXECUTION_ENABLED: isBrokerExecutionEnabled(),
    T212_PAPER_ORDER_SUBMISSION_ENABLED: isT212PaperOrderSubmissionEnabled(),
    T212_LIVE_EXECUTION_FEATURE_FLAG: isT212LiveExecutionFeatureFlag(),
    DEMO_ORDER_SUBMISSION_ENABLED: isDemoOrderSubmissionEnabled(),
    LIVE_EXECUTION_FEATURE_FLAG: isLiveExecutionFeatureFlag(),
    practiceOrderSubmissionAllowed: isPracticeOrderSubmissionAllowed()
  };
}
