import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppShell } from "./AppShell";
import { QuoteProvider } from "../../lib/quoteContext";

vi.mock("../../lib/auth", () => ({
  useAuth: () => ({
    user: { email: "owner@example.com" },
    account: { role: "OWNER" },
    signOut: vi.fn(),
    api: {}
  })
}));

function wrap(ui: ReactNode) {
  return (
    <MemoryRouter>
      <QuoteProvider>{ui}</QuoteProvider>
    </MemoryRouter>
  );
}

describe("AppShell staff nav", () => {
  it("keeps Gold Hunter in Admin as staffOnly and does not restore Core AutoTrade", () => {
    render(
      wrap(
        <AppShell>
          <div>content</div>
        </AppShell>
      )
    );
    const sidebar = screen.getByTestId("desktop-sidebar");
    const goldHunter = sidebar.querySelector('a[href="/gold-hunter"]');
    expect(goldHunter).toBeTruthy();
    expect(goldHunter?.textContent).toMatch(/Gold Hunter/);
    expect(sidebar.querySelector('a[href="/autotrade"]')).toBeNull();
  });
});
