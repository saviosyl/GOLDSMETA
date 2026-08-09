/**
 * Layout guards for mobile viewports — overflow and bottom-nav clearance.
 * These assert CSS/token contracts and Risk Planner single-column rules.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const gmV2 = readFileSync(resolve(__dirname, "../styles/gm-v2.css"), "utf8");
const redesign = readFileSync(resolve(__dirname, "../styles/redesign.css"), "utf8");
const tokens = readFileSync(resolve(__dirname, "../styles/tokens.css"), "utf8");

describe("Mobile layout guards", () => {
  it("defines mobile nav height and safe-area tokens", () => {
    expect(tokens).toMatch(/--mobile-nav-h:\s*72px/);
    expect(tokens).toMatch(/--safe-bottom:\s*env\(safe-area-inset-bottom/);
  });

  it("pads main content above fixed bottom navigation", () => {
    expect(redesign).toMatch(
      /\.gm-main-inner\s*\{[^}]*padding:[^;]*calc\(96px \+ var\(--safe-bottom\)\)/s
    );
  });

  it("forces Risk Planner to single column below 900px", () => {
    expect(gmV2).toMatch(/@media \(max-width: 899px\)/);
    expect(gmV2).toMatch(
      /\.gm-risk-planner-layout \.form-grid[\s\S]*grid-template-columns:\s*1fr\s*!important/
    );
  });

  it("keeps auth checkboxes wrapping with min-width 0", () => {
    expect(redesign).toMatch(/\.gm-auth-check\s*\{[^}]*min-width:\s*0/s);
    expect(redesign).toMatch(/\.gm-auth-check > span\s*\{[^}]*min-width:\s*0/s);
  });
});
