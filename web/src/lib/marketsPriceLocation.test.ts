import { describe, expect, it } from "vitest";
import { marketsPriceLocationLabel } from "./marketsPriceLocation";

describe("marketsPriceLocationLabel", () => {
  it("returns Context unavailable without verified levels", () => {
    expect(marketsPriceLocationLabel({ price: 4300 })).toBe("Context unavailable");
  });

  it("derives inside value / near levels from structure", () => {
    expect(
      marketsPriceLocationLabel({
        price: 4260,
        structure: { poc: 4260, vah: 4280, val: 4240 }
      })
    ).toMatch(/POC|Inside value/i);

    expect(
      marketsPriceLocationLabel({
        price: 4279,
        structure: { poc: 4260, vah: 4280, val: 4240 }
      })
    ).toBe("Near resistance");
  });

  it("respects explicit valueLocation when known", () => {
    expect(
      marketsPriceLocationLabel({
        price: 1,
        valueLocation: "INSIDE_VALUE"
      })
    ).toBe("Inside value");
  });
});
