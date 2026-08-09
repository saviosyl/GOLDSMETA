import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppShell } from "./AppShell";
import { QuoteProvider } from "../../lib/quoteContext";

vi.mock("../../lib/auth", () => ({
  useAuth: () => ({
    user: { email: "user@example.com" },
    account: { role: "USER" },
    signOut: vi.fn(),
    api: {
      getAutoTradeQualification: vi.fn(async () => ({
        state: "PREVIEW_QUALIFICATION",
        overallLabel: "Preview",
        nextAction: "Waiting for valid market setup",
        demoAuto: { enabled: false, ready: false },
        liveOrders: "LOCKED"
      })),
      autoTradeStatus: vi.fn(async () => ({
        mode: "OFF",
        displayStatus: "OFF",
        locked: true
      }))
    }
  })
}));

function wrap(ui: ReactNode, path = "/") {
  return (
    <MemoryRouter initialEntries={[path]}>
      <QuoteProvider>{ui}</QuoteProvider>
    </MemoryRouter>
  );
}

describe("AppShell premium V2", () => {
  it("renders desktop sidebar primary Trade routes", async () => {
    render(
      wrap(
        <AppShell>
          <div>content</div>
        </AppShell>
      )
    );
    const sidebar = screen.getByTestId("desktop-sidebar");
    expect(sidebar).toBeInTheDocument();
    expect(sidebar.textContent).toMatch(/Plan/);
    expect(sidebar.textContent).toMatch(/AutoTrade/);
    expect(sidebar.textContent).toMatch(/Markets/);
    expect(sidebar.textContent).toMatch(/Journal/);
    expect(sidebar.textContent).toMatch(/Insights/);
    expect(sidebar.textContent).not.toMatch(/TradingView/);
    expect(await screen.findByTestId("topbar-autotrade-status")).toBeInTheDocument();
  });

  it("renders mobile bottom navigation with AutoTrade primary (not Alerts)", () => {
    render(
      wrap(
        <AppShell>
          <div>content</div>
        </AppShell>
      )
    );
    const nav = screen.getByTestId("mobile-bottom-nav");
    expect(nav).toBeInTheDocument();
    expect(nav.querySelectorAll("a").length).toBe(4);
    expect(nav.textContent).toMatch(/Plan/);
    expect(nav.textContent).toMatch(/AutoTrade/);
    expect(nav.textContent).toMatch(/Markets/);
    expect(nav.textContent).toMatch(/Journal/);
    expect(nav.textContent).toMatch(/More/);
    expect(nav.textContent).not.toMatch(/Alerts/);
    expect(nav.querySelector("a.active, [aria-current='page']")).toBeTruthy();
  });

  it("shows canonical AutoTrade header status (not hardcoded OFF while qualifying)", async () => {
    render(
      wrap(
        <AppShell>
          <div>content</div>
        </AppShell>
      )
    );
    const pill = await screen.findByTestId("topbar-autotrade-status");
    expect(pill.getAttribute("data-state")).toBe("QUALIFYING");
    expect(pill.textContent).toMatch(/QUALIFYING/i);
    expect(pill.textContent).not.toMatch(/AutoTrade OFF/i);
  });

  it("keeps safe-area CSS tokens available for mobile chrome", () => {
    render(
      wrap(
        <AppShell>
          <div>content</div>
        </AppShell>
      )
    );
    expect(screen.getByTestId("mobile-bottom-nav")).toBeInTheDocument();
    expect(screen.getByTestId("topbar")).toBeInTheDocument();
    const rootStyles = getComputedStyle(document.documentElement);
    expect(
      rootStyles.getPropertyValue("--safe-top") !== undefined ||
        rootStyles.getPropertyValue("--safe-bottom") !== undefined
    ).toBe(true);
  });

  it("does not render duplicate bottom navigation bars", () => {
    render(
      wrap(
        <AppShell>
          <div>content</div>
        </AppShell>
      )
    );
    expect(screen.getAllByTestId("mobile-bottom-nav")).toHaveLength(1);
  });
});
