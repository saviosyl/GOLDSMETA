/**
 * Layout guards for mobile viewports — overflow and bottom-nav clearance.
 * These assert CSS/token contracts and Risk Planner single-column rules.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const gmV2 = readFileSync(resolve(here, "../styles/gm-v2.css"), "utf8");
const redesign = readFileSync(resolve(here, "../styles/redesign.css"), "utf8");
const tokens = readFileSync(resolve(here, "../styles/tokens.css"), "utf8");

describe("Mobile layout guards", () => {
  it("defines mobile nav height and safe-area tokens", () => {
    expect(tokens).toMatch(/--mobile-nav-h:\s*72px/);
    expect(tokens).toMatch(/--safe-bottom:\s*env\(safe-area-inset-bottom/);
  });

  it("pads main content above fixed bottom navigation", () => {
    expect(redesign).toMatch(
      /\.gm-main-inner\s*\{[^}]*padding:[^;]*calc\(96px \+ var\(--safe-bottom\)\)/s
    );
    expect(gmV2).toMatch(
      /\.gm-main-inner\s*\{[^}]*padding:[^;]*var\(--mobile-nav-h\)/s
    );
  });

  it("anchors mobile bottom nav to viewport bottom with safe-area", () => {
    expect(gmV2).toMatch(/\.gm-mobile-nav\s*\{[^}]*position:\s*fixed\s*!important/s);
    expect(gmV2).toMatch(/\.gm-mobile-nav\s*\{[^}]*bottom:\s*0\s*!important/s);
    expect(gmV2).toMatch(/\.gm-mobile-nav\s*\{[^}]*var\(--safe-bottom\)/s);
    expect(gmV2).toMatch(/\.gm-mobile-action-bar\s*\{[^}]*display:\s*none\s*!important/s);
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
