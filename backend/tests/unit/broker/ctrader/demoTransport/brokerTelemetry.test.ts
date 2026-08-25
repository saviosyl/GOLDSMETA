import { describe, expect, it } from "vitest";
import {
  sanitizeBrokerErrorCode,
  sanitizeBrokerFailure
} from "../../../../../src/services/broker/ctrader/demoTransport/brokerTelemetry";

describe("FAST broker telemetry sanitizer", () => {
  it("redacts tokens and secrets", () => {
    const out = sanitizeBrokerFailure(
      new Error("refresh_token=abc access_token=eyJabc.def Bearer xyz client_secret=shh")
    );
    expect(out.message).not.toMatch(/refresh_token=abc|access_token=|Bearer xyz|client_secret=shh/i);
    expect(out.message).toContain("[REDACTED]");
  });

  it("sanitizes broker error codes", () => {
    expect(sanitizeBrokerErrorCode("MARKET_CLOSED")).toBe("MARKET_CLOSED");
    expect(sanitizeBrokerErrorCode("Bearer abc.def")).toContain("[REDACTED]");
    expect(sanitizeBrokerErrorCode(null)).toBe("BROKER_REJECTED");
  });
});
