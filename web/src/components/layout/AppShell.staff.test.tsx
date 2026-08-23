import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppShell } from "./AppShell";

vi.mock("../../lib/auth", () => ({
  useAuth: () => ({
    user: { email: "owner@example.com" },
    account: { role: "OWNER" },
    signOut: vi.fn(),
    api: {}
  })
}));

vi.mock("../../lib/quoteContext", () => ({
  useShellQuote: () => ({ quote: null })
}));

vi.mock("../decision/NotificationCentre", () => ({
  NotificationCentre: () => <button type="button" aria-label="Notifications centre">Notifications</button>
}));

function wrap(ui: ReactNode) {
  return <MemoryRouter>{ui}</MemoryRouter>;
}

describe("AppShell staff navigation", () => {
  it("keeps Gold Hunter in the primary product navigation without restoring legacy Core AutoTrade", () => {
    render(wrap(<AppShell><div>content</div></AppShell>));

    const sidebar = screen.getByLabelText("GoldMeta navigation");
    const primaryNav = sidebar.querySelector(".gm26-sidebar-nav");
    expect(primaryNav?.querySelector('a[href="/gold-hunter"]')).toHaveTextContent("Gold Hunter");
    expect(primaryNav?.querySelector('a[href="/autotrade"]')).toBeNull();
  });

  it("keeps engineering and research tools behind the staff Advanced entry", () => {
    render(wrap(<AppShell><div>content</div></AppShell>));

    const sidebar = screen.getByLabelText("GoldMeta navigation");
    expect(within(sidebar).queryByRole("link", { name: /TradingView Setup/i })).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole("link", { name: /Diagnostics/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open profile menu" }));
    const menu = screen.getByRole("dialog", { name: "Profile menu" });
    expect(within(menu).getByRole("link", { name: "Advanced" })).toHaveAttribute("href", "/advanced");
  });
});
