import { describe, expect, it } from "vitest";
import {
  assertAccountAllowlisted,
  parseAccountAllowlist,
  requireLiveAllowlist
} from "../../../../src/services/broker/ctrader/accountAllowlist";

describe("accountAllowlist", () => {
  it("parses comma/space separated allowlist", () => {
    expect(
      parseAccountAllowlist({
        CTRADER_QUOTE_ACCOUNT_ALLOWLIST: "111, 222 333"
      } as NodeJS.ProcessEnv)
    ).toEqual(["111", "222", "333"]);
  });

  it("allows any account when allowlist empty", () => {
    expect(() =>
      assertAccountAllowlisted("999", {
        CTRADER_QUOTE_ACCOUNT_ALLOWLIST: ""
      } as NodeJS.ProcessEnv)
    ).not.toThrow();
  });

  it("rejects accounts outside allowlist", () => {
    expect(() =>
      assertAccountAllowlisted("999", {
        CTRADER_QUOTE_ACCOUNT_ALLOWLIST: "111,222"
      } as NodeJS.ProcessEnv)
    ).toThrow(/CTRADER_ACCOUNT_NOT_ALLOWLISTED/);
  });

  it("requireLiveAllowlist reads env flag", () => {
    expect(
      requireLiveAllowlist({
        CTRADER_QUOTE_REQUIRE_LIVE: "true"
      } as NodeJS.ProcessEnv)
    ).toBe(true);
    expect(
      requireLiveAllowlist({
        CTRADER_QUOTE_REQUIRE_LIVE: "false"
      } as NodeJS.ProcessEnv)
    ).toBe(false);
  });
});
