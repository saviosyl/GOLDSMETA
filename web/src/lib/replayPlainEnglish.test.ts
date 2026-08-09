import { describe, expect, it } from "vitest";
import { replayPlainEnglish } from "./replayPlainEnglish";

describe("replayPlainEnglish", () => {
  it("translates bias and behaviour enums", () => {
    expect(replayPlainEnglish("BUY_BIAS BREAKOUT_EXPANSION rejects=3")).toMatch(/Bullish/i);
    expect(replayPlainEnglish("BUY_BIAS BREAKOUT_EXPANSION rejects=3")).toMatch(
      /Breakout expansion/i
    );
    expect(replayPlainEnglish("BUY_BIAS BREAKOUT_EXPANSION rejects=3")).not.toMatch(/rejects=/i);
  });
});
