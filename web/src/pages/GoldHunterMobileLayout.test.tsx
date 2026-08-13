import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("GOLD_HUNTER mobile trade history", () => {
  it("uses dedicated mobile rows and hides desktop table under 860px", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/redesign.css"), "utf8");
    expect(css).toContain(".gm-gh-trades-mobile");
    expect(css).toContain(".gm-gh-mobile-row");
    expect(css).toMatch(/@media \(max-width:\s*860px\)/);
    expect(css).toContain("overflow-x: hidden");

    const page = readFileSync(join(process.cwd(), "src/pages/MicroEdgePage.tsx"), "utf8");
    expect(page).toContain('data-testid="gh-trades-mobile"');
    expect(page).toContain('data-testid="gh-mobile-trade-row"');
    expect(page).toContain("GOLD_HUNTER");
    expect(page).toContain("NO BROKER ORDERS");
    // Must not force a single shared scroll table for mobile
    expect(page).toContain("gm-gh-trades-desktop");
  });
});
