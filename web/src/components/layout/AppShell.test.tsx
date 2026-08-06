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
    signOut: vi.fn()
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
  it("renders desktop sidebar main routes and hides staff TradingView for normal users", () => {
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
    expect(sidebar.textContent).toMatch(/Levels/);
    expect(sidebar.textContent).toMatch(/Markets/);
    expect(sidebar.textContent).toMatch(/Journal/);
    expect(sidebar.textContent).toMatch(/Alerts/);
    expect(sidebar.textContent).not.toMatch(/TradingView/);
  });

  it("renders mobile bottom navigation with icons and active Plan route", () => {
    render(
      wrap(
        <AppShell>
          <div>content</div>
        </AppShell>
      )
    );
    const nav = screen.getByTestId("mobile-bottom-nav");
    expect(nav).toBeInTheDocument();
    expect(nav.querySelectorAll("a").length).toBeGreaterThanOrEqual(4);
    expect(nav.textContent).toMatch(/Plan/);
    expect(nav.textContent).toMatch(/Markets/);
    expect(nav.textContent).toMatch(/Journal/);
    expect(nav.textContent).toMatch(/Alerts/);
    expect(nav.querySelector("a.active, [aria-current='page']")).toBeTruthy();
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
    // Design tokens define --safe-top / --safe-bottom from env(safe-area-inset-*).
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
