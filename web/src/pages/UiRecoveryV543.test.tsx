import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverviewPage } from "./OverviewPage";
import redesignCss from "../styles/redesign.css?raw";
import globalCss from "../styles/global.css?raw";

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    user: { email: "tester@example.com" },
    signOut: vi.fn(),
    api: {
      latestDecision: vi.fn().mockResolvedValue({
        decisionId: "dec_hidden_id_abc123",
        decision: "WAIT",
        reasonCodes: ["ONE-ACTIVE-SETUP"],
        reasonSummary: "Blocked",
        currentSession: "NEWYORK",
        generatedAt: "2026-07-21T21:45:00.000Z",
        lastKnownPrice: 2385.4,
        ohlcv: { high: 2391, low: 2376, close: 2385.4 },
        marketStructure: { poc: 2380, vah: 2390, val: 2370, trend: "RANGE" },
        environment: "LIVE",
        marketRegime: "RANGE"
      }),
      listActiveSetups: vi.fn().mockResolvedValue([]),
      listSetups: vi.fn().mockResolvedValue([]),
      v5Briefing: vi.fn().mockResolvedValue({
        session: "NEWYORK",
        marketRegime: "RANGE",
        positionVsPoc: "ABOVE_POC",
        atrLabel: "NORMAL",
        levels: { poc: 2380, vah: 2390, val: 2370 },
        insufficientData: false,
        dataTimestamp: "2026-07-21T21:45:00.000Z"
      }),
      v5Score: vi.fn().mockResolvedValue({
        total: 42,
        components: [
          { label: "Market Structure", score: 8, max: 20, reason: "Incomplete" }
        ],
        disclaimer: "GoldMeta Score is a rules-based quality score, not the probability of profit."
      })
    }
  })
}));

function documentOrder(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const elA = screen.getByTestId(a);
    const elB = screen.getByTestId(b);
    const pos = elA.compareDocumentPosition(elB);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

describe("V5.4.3 UI recovery — approved Dashboard structure", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });

  it("keeps V5.4.2 Dashboard section order with snapshot button after Primary Signal", async () => {
    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    );
    await screen.findByTestId("primary-signal-card");
    await screen.findByTestId("market-story");
    await screen.findByTestId("market-level-ladder");
    await screen.findByTestId("goldmeta-score");
    await screen.findByTestId("current-plan");
    expect(screen.getByTestId("share-market-snapshot")).toBeInTheDocument();

    const order = documentOrder([
      "primary-signal-card",
      "share-market-snapshot",
      "market-story",
      "market-level-ladder",
      "goldmeta-score",
      "current-plan"
    ]);
    expect(order).toEqual([
      "primary-signal-card",
      "share-market-snapshot",
      "market-story",
      "market-level-ladder",
      "goldmeta-score",
      "current-plan"
    ]);

    // Overnight Review remains optional (hidden when not relevant) — same as 384eb56
    expect(screen.queryByTestId("overnight-review")).not.toBeInTheDocument();

    const root = screen.getByTestId("overview-page");
    expect(root.className).toContain("gm-dashboard");
    expect(root.className).toContain("gm-dashboard--v542");
  });

  it("does not alter Dashboard cards while snapshot modal is closed", async () => {
    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    );
    await screen.findByTestId("primary-signal-card");
    expect(screen.queryByTestId("promo-snapshot-modal")).not.toBeInTheDocument();
    expect(screen.getByTestId("primary-signal-card").className).toMatch(/gm-primary-signal/);
    expect(screen.getByTestId("market-story")).toBeInTheDocument();
    expect(screen.getByTestId("market-level-ladder")).toBeInTheDocument();
    expect(screen.getByTestId("goldmeta-score")).toBeInTheDocument();
  });

  it("opens snapshot modal without removing existing Dashboard sections", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    );
    await screen.findByTestId("share-market-snapshot");
    await user.click(screen.getByTestId("share-market-snapshot"));
    expect(await screen.findByTestId("promo-snapshot-modal")).toBeInTheDocument();
    expect(screen.getByTestId("primary-signal-card")).toBeInTheDocument();
    expect(screen.getByTestId("market-story")).toBeInTheDocument();
  });
});

describe("V5.4.3 UI recovery — CSS scope contracts", () => {
  it("scopes snapshot styles to .gm-snapshot-* and does not redeclare shell/button baselines", () => {
    expect(redesignCss).toMatch(/\.gm-snapshot-trigger\s*\{/);
    expect(redesignCss).toMatch(/\.gm-snapshot-modal\s*\{/);
    expect(redesignCss).toMatch(/\.gm-snapshot-overlay\s*\{/);

    // Broad overrides that caused visual drift must not return
    expect(redesignCss).not.toMatch(/\*,\s*\*::before,\s*\*::after\s*\{[^}]*box-sizing/);
    expect(redesignCss).not.toMatch(/\.gm-shell\s*\{[^}]*overflow-x:\s*clip/);
    expect(redesignCss).not.toMatch(/font-size:\s*16px\s*!important/);
    expect(redesignCss).not.toMatch(
      /\.gm-section,\s*\.gm-dash-grid,\s*\.gm-dashboard--v542[\s\S]*?max-width:\s*100%/
    );

    // Must not append a second standalone .gm-btn-primary block after snapshot section
    const snapshotIdx = redesignCss.indexOf("/* ===== V5.4.3 Promo Market Snapshot");
    expect(snapshotIdx).toBeGreaterThan(0);
    const afterSnapshot = redesignCss.slice(snapshotIdx);
    expect(afterSnapshot).not.toMatch(/(^|\n)\.gm-btn-primary\s*\{/);

    // Approved ladder breakpoint/columns preserved (only minmax wrappers added)
    expect(redesignCss).toMatch(/minmax\(0,\s*88px\)\s+minmax\(0,\s*1fr\)\s+minmax\(0,\s*1\.2fr\)/);
    expect(redesignCss).toMatch(/@media \(max-width:\s*640px\)[\s\S]*?minmax\(0,\s*76px\)/);
  });

  it("keeps iOS ≥16px control text scoped to mobile media queries", () => {
    expect(globalCss).toMatch(
      /@media \(max-width:\s*767px\)\s*\{[\s\S]*?input,\s*select,\s*textarea\s*\{[\s\S]*?font-size:\s*16px/
    );
    // Desktop must not get a bare global 16px override outside media queries
    const withoutMedia = globalCss.replace(/@media[^{]+\{[\s\S]*?\n\}/g, "");
    expect(withoutMedia).not.toMatch(
      /\.field input,\s*\.field select,\s*\.field textarea,\s*input,\s*select,\s*textarea\s*\{[\s\S]*?font-size:\s*16px/
    );
  });
});
