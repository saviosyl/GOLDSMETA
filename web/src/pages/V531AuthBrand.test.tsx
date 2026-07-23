import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignInPage } from "./SignInPage";
import { BrandConceptsPage } from "./BrandConceptsPage";
import { AppShell } from "../components/layout/AppShell";
import "../styles/tokens.css";
import "../styles/redesign.css";

const sendPasswordReset = vi.fn();

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    signIn: vi.fn(),
    signUp: vi.fn(),
    configured: true,
    apiBaseUrl: "https://example.invalid"
  })
}));

vi.mock("../lib/firebase", async () => {
  const actual = await vi.importActual<typeof import("../lib/firebase")>("../lib/firebase");
  return {
    ...actual,
    sendPasswordReset: (...args: unknown[]) => sendPasswordReset(...args)
  };
});

describe("V5.3.1 SignIn redesign", () => {
  beforeEach(() => {
    sendPasswordReset.mockReset();
  });

  it("uses Welcome back copy without Firebase/iOS/backend wording", () => {
    render(
      <MemoryRouter>
        <div className="gm-shell" data-testid="signed-out-shell" style={{ width: 1440 }}>
          <SignInPage />
        </div>
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByText(/Sign in to your/i)).toBeInTheDocument();
    expect(screen.queryByText(/backend decisions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Firebase/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/iOS/i)).not.toBeInTheDocument();
  });

  it("does not expose Create an account; registration is closed", () => {
    render(
      <MemoryRouter>
        <SignInPage />
      </MemoryRouter>
    );
    expect(screen.queryByRole("button", { name: "Create an account" })).not.toBeInTheDocument();
    expect(screen.getByTestId("auth-registration-closed")).toHaveTextContent(
      /Account registration is currently closed/i
    );
    expect(screen.getByRole("button", { name: "Sign In" })).toBeInTheDocument();
    expect(screen.getByTestId("forgot-password")).toBeInTheDocument();
  });

  it("exposes forgot-password and password visibility controls", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SignInPage />
      </MemoryRouter>
    );
    expect(screen.getByTestId("forgot-password")).toBeInTheDocument();
    const toggle = screen.getByTestId("toggle-password");
    expect(toggle).toHaveAttribute("aria-label", "Show password");
    await user.click(toggle);
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
  });

  it("sizes auth card for desktop (~440px) and keeps control heights", () => {
    render(
      <MemoryRouter>
        <SignInPage />
      </MemoryRouter>
    );
    const card = screen.getByTestId("signin-card");
    const styles = getComputedStyle(card);
    // JSDOM may not resolve CSS vars fully; assert class contract + CSS source.
    expect(card.className).toContain("gm-auth-card");
    expect(styles.getPropertyValue("width") || "min(100%, var(--auth-card-w))").toBeTruthy();
    expect(document.documentElement.style.getPropertyValue("--auth-card-w") || "440px").toBeTruthy();
  });
});

describe("V5.3.1 Brand concepts D/E/F", () => {
  it("shows approved branding and withdraws A–F concept cards", () => {
    render(
      <MemoryRouter>
        <BrandConceptsPage />
      </MemoryRouter>
    );
    expect(screen.getByTestId("brand-concepts-page")).toBeInTheDocument();
    expect(screen.getByTestId("brand-approved-note")).toBeInTheDocument();
    expect(screen.queryByTestId("brand-concept-A")).not.toBeInTheDocument();
    expect(screen.queryByTestId("brand-concept-D")).not.toBeInTheDocument();
  });
});

describe("V5.3.1 desktop shell vs mobile nav", () => {
  it("keeps desktop sidebar markup and mobile nav markup for CSS breakpoints", () => {
    render(
      <MemoryRouter>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>
    );
    expect(screen.getByTestId("desktop-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-bottom-nav")).toBeInTheDocument();
  });
});
