import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AccountAccessGate } from "./AccountAccessGate";
import type { AuthContextValue, AuthMeResponse } from "../lib/auth";

const refreshAccount = vi.fn();
const signOut = vi.fn();

let authState: Partial<AuthContextValue>;

vi.mock("../lib/auth", () => ({
  useAuth: () => authState
}));

function renderGate(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AccountAccessGate>
        <Routes>
          <Route path="/" element={<div data-testid="protected-home">Protected home</div>} />
          <Route path="/signin" element={<div data-testid="signin">Sign in</div>} />
        </Routes>
      </AccountAccessGate>
    </MemoryRouter>
  );
}

const appAccount: AuthMeResponse = {
  uidMasked: "ab****yz",
  role: "USER",
  approvalStatus: "APPROVED",
  emailVerified: true,
  access: "APP",
  profile: { email: "user@example.com" }
};

describe("AccountAccessGate — /auth/me resolution", () => {
  beforeEach(() => {
    refreshAccount.mockReset();
    signOut.mockReset();
    authState = {
      user: { email: "user@example.com", emailVerified: true } as AuthContextValue["user"],
      loading: false,
      account: null,
      accountLoading: false,
      accountError: null,
      accountResolved: false,
      refreshAccount,
      signOut
    };
  });

  it("shows session loading while account is resolving (no protected flash)", () => {
    authState.accountLoading = true;
    authState.accountResolved = false;
    renderGate();
    expect(screen.getByTestId("session-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("protected-home")).not.toBeInTheDocument();
  });

  it("/auth/me succeeds → app routes normally", () => {
    authState.account = appAccount;
    authState.accountResolved = true;
    authState.accountLoading = false;
    renderGate();
    expect(screen.getByTestId("protected-home")).toBeInTheDocument();
    expect(screen.queryByTestId("session-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("account-lookup-error")).not.toBeInTheDocument();
  });

  it("durable /auth/me failure → friendly error, NOT endless spinner", () => {
    authState.account = null;
    authState.accountResolved = true;
    authState.accountLoading = false;
    authState.accountError = "We could not verify your GoldMeta account right now.";
    renderGate();
    expect(screen.queryByTestId("session-loading")).not.toBeInTheDocument();
    expect(screen.getByTestId("account-lookup-error")).toBeInTheDocument();
    expect(screen.getByTestId("account-lookup-error-message")).toHaveTextContent(
      /could not verify/i
    );
    expect(screen.queryByTestId("protected-home")).not.toBeInTheDocument();
    expect(screen.getByTestId("account-lookup-retry")).toBeInTheDocument();
    expect(screen.getByTestId("account-lookup-sign-out")).toBeInTheDocument();
  });

  it("Retry succeeds → access restored", async () => {
    const user = userEvent.setup();
    authState.account = null;
    authState.accountResolved = true;
    authState.accountError = "We could not verify your GoldMeta account right now.";
    refreshAccount.mockImplementation(async () => {
      authState.account = appAccount;
      authState.accountError = null;
      authState.accountResolved = true;
      authState.accountLoading = false;
      return appAccount;
    });
    const { rerender } = renderGate();
    expect(screen.getByTestId("account-lookup-error")).toBeInTheDocument();
    await user.click(screen.getByTestId("account-lookup-retry"));
    await waitFor(() => expect(refreshAccount).toHaveBeenCalled());
    // Re-render with updated auth state after successful retry.
    authState = { ...authState, account: appAccount, accountError: null };
    rerender(
      <MemoryRouter initialEntries={["/"]}>
        <AccountAccessGate>
          <Routes>
            <Route path="/" element={<div data-testid="protected-home">Protected home</div>} />
          </Routes>
        </AccountAccessGate>
      </MemoryRouter>
    );
    expect(screen.getByTestId("protected-home")).toBeInTheDocument();
  });

  it("Sign out works from failure screen", async () => {
    const user = userEvent.setup();
    authState.accountResolved = true;
    authState.accountError = "We could not verify your GoldMeta account right now.";
    signOut.mockResolvedValue(undefined);
    renderGate();
    await user.click(screen.getByTestId("account-lookup-sign-out"));
    expect(signOut).toHaveBeenCalled();
  });

  it("signed-out users are not trapped on loading", () => {
    authState.user = null;
    authState.accountResolved = true;
    render(
      <MemoryRouter initialEntries={["/signin"]}>
        <AccountAccessGate>
          <div data-testid="public-signin">Public</div>
        </AccountAccessGate>
      </MemoryRouter>
    );
    expect(screen.getByTestId("public-signin")).toBeInTheDocument();
  });
});
