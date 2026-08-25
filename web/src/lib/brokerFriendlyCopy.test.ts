import { describe, expect, it } from "vitest";
import { friendlyBrokerReason, friendlyPreviewNote } from "./brokerFriendlyCopy";

describe("friendlyBrokerReason", () => {
  it("maps margin and volume codes to plain language", () => {
    expect(friendlyBrokerReason("MARGIN_ELIGIBILITY_UNKNOWN")).toMatch(/Margin information/i);
    expect(friendlyBrokerReason("VOLUME_BELOW_MINIMUM_AFTER_ROUNDING")).toMatch(
      /minimum trade size/i
    );
  });

  it("maps execution lock without exposing env assignment", () => {
    expect(friendlyBrokerReason("BROKER_EXECUTION_ENABLED=false")).toMatch(
      /disabled in this preview/i
    );
    expect(friendlyPreviewNote("BROKER_EXECUTION_ENABLED=false")).toMatch(
      /disabled in this preview/i
    );
  });
});
