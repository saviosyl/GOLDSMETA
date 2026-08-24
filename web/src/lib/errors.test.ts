import { describe, expect, it } from "vitest";
import { formatClientError } from "./errors";
import { ApiError } from "../types/models";

describe("formatClientError", () => {
  it("keeps API error codes for server failures", () => {
    expect(formatClientError(new ApiError(500, "INTERNAL", "boom"), "fallback")).toBe(
      "INTERNAL: boom"
    );
  });

  it("maps browser network/CORS failures to a friendly message", () => {
    expect(formatClientError(new TypeError("Load failed"), "fallback")).toMatch(
      /Could not reach the GoldMeta API/
    );
    expect(formatClientError(new TypeError("Failed to fetch"), "fallback")).toMatch(
      /Could not reach the GoldMeta API/
    );
  });

  it("falls back for unknown errors", () => {
    expect(formatClientError({}, "Failed to create TradingView connection")).toBe(
      "Failed to create TradingView connection"
    );
  });
});
