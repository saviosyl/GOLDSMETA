import { describe, expect, it } from "vitest";
import {
  DEMO_ORDER_SUBMISSION_ENABLED,
  LIVE_EXECUTION_FEATURE_FLAG,
  T212_LIVE_EXECUTION_FEATURE_FLAG,
  T212_PAPER_ORDER_SUBMISSION_ENABLED
} from "../../../src/services/autoTrade/types";
import { mapIgLoginUiReason } from "../../../src/services/autoTrade/igBrokerAdapter";

describe("ig_session_failed draft fix safety", () => {
  it("keeps every broker execution flag false", () => {
    expect(DEMO_ORDER_SUBMISSION_ENABLED).toBe(false);
    expect(LIVE_EXECUTION_FEATURE_FLAG).toBe(false);
    expect(T212_PAPER_ORDER_SUBMISSION_ENABLED).toBe(false);
    expect(T212_LIVE_EXECUTION_FEATURE_FLAG).toBe(false);
  });

  it("maps known IG api-key-invalid login failures to a stable UI reason", () => {
    expect(mapIgLoginUiReason("error.security.api-key-invalid")).toBe(
      "error.security.api-key-invalid"
    );
  });
});
