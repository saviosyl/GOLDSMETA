import { describe, expect, it } from "vitest";
import { describeClientError, formatClientError } from "./errors";
import { ApiError } from "../types/models";

describe("formatClientError", () => {
  it("maps API failures to friendly copy without raw codes", () => {
    expect(formatClientError(new ApiError(500, "INTERNAL", "boom"), "fallback")).not.toMatch(
      /^INTERNAL:/
    );
    expect(formatClientError(new ApiError(403, "FORBIDDEN", "nope"), "fallback")).toMatch(
      /do not have access/i
    );
    expect(
      formatClientError(new ApiError(403, "CTRADER_SETUP_REQUIRED", "Missing CTRADER_CLIENT_SECRET"), "x")
    ).toMatch(/secure credentials/i);
  });

  it("maps browser network/CORS failures to a friendly message", () => {
    expect(formatClientError(new TypeError("Load failed"), "fallback")).toMatch(
      /Could not reach GoldMeta/
    );
    expect(formatClientError(new TypeError("Failed to fetch"), "fallback")).toMatch(
      /Could not reach GoldMeta/
    );
  });

  it("falls back for unknown errors", () => {
    expect(formatClientError({}, "Failed to create TradingView connection")).toBe(
      "Failed to create TradingView connection"
    );
  });

  it("keeps technical details for expandable disclosure", () => {
    const detail = describeClientError(new ApiError(403, "OAUTH_CALLBACK", "OAuth callback 403"), "x");
    expect(detail.message).toMatch(/Pepperstone connection could not be completed/i);
    expect(detail.technical).toMatch(/OAUTH_CALLBACK/);
    expect(detail.nextStep).toMatch(/Broker Control Centre/i);
  });
});
