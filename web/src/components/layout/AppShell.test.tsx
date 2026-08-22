import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppShell } from "./AppShell";

vi.mock("../../lib/auth", () => ({
  useAuth: () => ({
    user: { email: "user@example.com" },
    account: { role: "USER" },
    signOut: vi.fn(),
    api: {}
  })
}));

vi.mock("../../lib/quoteContext", () => ({
  useShellQuote: () => ({
    quote: {
      price: 2364.42,
      bid: 2364.38,
      ask: 2364.46,
      fresh: true,
      freshness: "LIVE",
      marketStatus: "OPEN",
      sessionLabel: "London / New York"
    }
  })
}));

vi.mock("../decision/NotificationCentre", () => ({
  NotificationCentre: () => <button type="button" aria-label="Notifications centre">Notifications</button>
}));

function wrap(ui: ReactNode, path = "/") {
  return <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>;
}

function navLabels(element: HTMLElement): string[] {
  return within(element).getAllByRole("link").map((link) => link.textContent?.trim() ?? "");
}

describe("AppShell GoldMeta 2026 redesign", () => {
  it("keeps the desktop primary navigation focused on the five approved product screens", () => {
    render(wrap(<AppShell><div>content</div></AppShell>));

    const sidebar = screen.getByLabelText("GoldMeta navigation");
    const primaryNav = sidebar.querySelector(".gm26-sidebar-nav");
    expect(primaryNav).toBeTruthy();
    expect(navLabels(primaryNav as HTMLElement)).toEqual([
      "Home",
      "Short-Term",
      "Day Trade",
      "Gold Hunter",
      "History"
    ]);
    expect(primaryNav?.querySelector('a[href="/autotrade"]')).toBeNull();
    expect(primaryNav?.textContent).not.toMatch(/Levels|Analysis|Journal|Insights|Planner/);
  });

  it("uses the same five-screen information architecture on mobile", () => {
    render(wrap(<AppShell><div>content</div></AppShell>, "/short-term"));

    const mobileNav = screen.getByLabelText("GoldMeta mobile navigation");
    expect(navLabels(mobileNav)).toEqual(["Home", "Short", "Day", "Hunter", "History"]);
    expect(mobileNav.querySelectorAll("a")).toHaveLength(5);
    expect(mobileNav.querySelector('a[href="/short-term"]')).toHaveAttribute("aria-current", "page");
    expect(mobileNav.querySelector('a[href="/autotrade"]')).toBeNull();
  });

  it("shows the live XAUUSD quote in the application chrome", () => {
    render(wrap(<AppShell><div>content</div></AppShell>));

    expect(screen.getByText("2364.42")).toBeInTheDocument();
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.getByText("London / New York")).toBeInTheDocument();
  });

  it("moves secondary account tools into the profile menu instead of primary navigation", () => {
    render(wrap(<AppShell><div>content</div></AppShell>));

    fireEvent.click(screen.getByRole("button", { name: "Open profile menu" }));
    const menu = screen.getByRole("dialog", { name: "Profile menu" });

    expect(within(menu).getByRole("link", { name: "Account" })).toHaveAttribute("href", "/settings");
    expect(within(menu).getByRole("link", { name: "Notifications" })).toHaveAttribute("href", "/alerts");
    expect(within(menu).getByRole("link", { name: "Connections" })).toHaveAttribute("href", "/brokers");
    expect(within(menu).getByRole("link", { name: "Risk planner" })).toHaveAttribute("href", "/planner");
    expect(within(menu).getByRole("link", { name: "Learn" })).toHaveAttribute("href", "/learn");
    expect(within(menu).getByRole("link", { name: "Help" })).toHaveAttribute("href", "/help");
    expect(within(menu).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(within(menu).queryByRole("link", { name: "Advanced" })).not.toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("renders Gold Hunter as a standalone product surface without duplicating the main shell", () => {
    render(wrap(<AppShell><div data-testid="gold-hunter-content">Gold Hunter content</div></AppShell>, "/gold-hunter"));

    expect(screen.getByTestId("gold-hunter-content")).toBeInTheDocument();
    expect(screen.queryByLabelText("GoldMeta navigation")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("GoldMeta mobile navigation")).not.toBeInTheDocument();
  });
});
