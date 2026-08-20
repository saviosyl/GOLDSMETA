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
    api: {}
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
  it("renders desktop sidebar primary Trade routes without Core AutoTrade", async () => {
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
    expect(sidebar.querySelector('a[href="/autotrade"]')).toBeNull();
    expect(sidebar.textContent).toMatch(/Markets/);
    expect(sidebar.textContent).toMatch(/Journal/);
    expect(sidebar.textContent).toMatch(/Insights/);
    expect(sidebar.textContent).not.toMatch(/TradingView/);
    expect(sidebar.querySelector('a[href="/gold-hunter"]')).toBeNull();
    expect(screen.getByTestId("topbar-live-locked")).toHaveTextContent(/Live locked/i);
  });

  it("renders mobile bottom navigation without AutoTrade", () => {
    render(
      wrap(
        <AppShell>
          <div>content</div>
        </AppShell>
      )
    );
    const nav = screen.getByTestId("mobile-bottom-nav");
    expect(nav).toBeInTheDocument();
    expect(nav.querySelectorAll("a").length).toBe(3);
    expect(nav.textContent).toMatch(/Plan/);
    expect(nav.textContent).not.toMatch(/AutoTrade/);
    expect(nav.textContent).toMatch(/Markets/);
    expect(nav.textContent).toMatch(/Journal/);
    expect(nav.textContent).toMatch(/More/);
    expect(nav.textContent).not.toMatch(/Alerts/);
    expect(nav.querySelector("a.active, [aria-current='page']")).toBeTruthy();
  });

  it("does not render Core AutoTrade header status", () => {
    render(
      wrap(
        <AppShell>
          <div>content</div>
        </AppShell>
      )
    );
    expect(screen.queryByTestId("topbar-autotrade-status")).not.toBeInTheDocument();
    expect(screen.getByTestId("topbar-live-locked")).toHaveTextContent(/Live locked/i);
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
