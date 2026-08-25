import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PublicPageShell } from "../components/layout/PublicPageShell";
import { RegisterPage } from "./RegisterPage";
import "../styles/redesign.css";

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    api: {
      registerAccount: vi.fn()
    },
    registrationEnabled: true,
    configured: true
  })
}));

describe("PublicPageShell / register layout", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("marks public shells as full-width (no sidebar grid)", () => {
    render(
      <PublicPageShell testId="register-shell">
        <div data-testid="child">ok</div>
      </PublicPageShell>
    );
    const shell = screen.getByTestId("register-shell");
    expect(shell).toHaveAttribute("data-layout", "public-fullwidth");
    expect(shell.className).toContain("gm-public-shell");
    expect(shell.className).toContain("gm-shell");
  });

  it("renders register card and submit inside public shell", () => {
    render(
      <MemoryRouter>
        <PublicPageShell testId="register-shell">
          <RegisterPage />
        </PublicPageShell>
      </MemoryRouter>
    );
    expect(screen.getByTestId("register-shell")).toBeInTheDocument();
    expect(screen.getByTestId("register-card")).toBeInTheDocument();
    expect(screen.getByTestId("register-submit")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /create account/i })).toBeInTheDocument();
  });
});
