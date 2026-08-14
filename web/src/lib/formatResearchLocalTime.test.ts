import { describe, expect, it } from "vitest";
import {
  formatResearchLocalTime,
  formatResearchUtcTime
} from "./formatResearchLocalTime";

describe("formatResearchLocalTime (DST-safe)", () => {
  it("August Dublin IST: 2026-08-14T20:37:42.000Z → 21:37:42 LOCAL", () => {
    expect(
      formatResearchLocalTime("2026-08-14T20:37:42.000Z", {
        timeZone: "Europe/Dublin"
      })
    ).toBe("21:37:42 LOCAL");
  });

  it("January Dublin GMT: 2026-01-14T20:37:42.000Z → 20:37:42 LOCAL", () => {
    expect(
      formatResearchLocalTime("2026-01-14T20:37:42.000Z", {
        timeZone: "Europe/Dublin"
      })
    ).toBe("20:37:42 LOCAL");
  });

  it("UTC companion unchanged from ISO instant", () => {
    expect(formatResearchUtcTime("2026-08-14T20:37:42.000Z")).toBe(
      "20:37:42 UTC"
    );
  });

  it("does not mutate the input ISO string", () => {
    const iso = "2026-08-14T20:37:42.000Z";
    const copy = iso.slice();
    formatResearchLocalTime(iso, { timeZone: "Europe/Dublin" });
    expect(iso).toBe(copy);
  });
});
