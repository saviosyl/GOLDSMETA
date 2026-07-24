import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SignInPage } from "./SignInPage";

const sendPasswordReset = vi.fn();
const navigate = vi.fn();

vi.mock("../lib/firebase", () => ({
  sendPasswordReset: (...args: unknown[]) => sendPasswordReset(...args),
  getFirebaseProjectId: () => "goldmeta-web"
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigate
  };
});

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    signIn: vi.fn(),
    configured: true,
    registrationEnabled: true,
    apiBaseUrl: "https://example.test/api"
  })
}));

describe("SignInPage Forgot Password", () => {
  beforeEach(() => {
    sendPasswordReset.mockReset();
    navigate.mockReset();
  });

  it("shows Forgot Password control and rejects empty email", async () => {
    render(
      <MemoryRouter>
        <SignInPage />
      </MemoryRouter>
    );
    expect(screen.getByTestId("forgot-password")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("forgot-password"));
    expect(await screen.findByTestId("signin-error")).toHaveTextContent(/Enter your email/i);
    expect(sendPasswordReset).not.toHaveBeenCalled();
  });

  it("rejects invalid email format", async () => {
    render(
      <MemoryRouter>
        <SignInPage />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText(/Email address/i), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByTestId("forgot-password"));
    expect(await screen.findByTestId("signin-error")).toHaveTextContent(/valid email/i);
    expect(sendPasswordReset).not.toHaveBeenCalled();
  });

  it("dispatches client password reset and navigates to confirmation", async () => {
    sendPasswordReset.mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <SignInPage />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText(/Email address/i), {
      target: { value: "  gm.reset.test@example.com " }
    });
    fireEvent.click(screen.getByTestId("forgot-password"));
    await waitFor(() => expect(sendPasswordReset).toHaveBeenCalledWith("gm.reset.test@example.com"));
    expect(navigate).toHaveBeenCalledWith("/password-reset-sent");
  });

  it("does not allow uncontrolled duplicate concurrent resets", async () => {
    let resolveReset: (() => void) | undefined;
    sendPasswordReset.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveReset = resolve;
        })
    );
    render(
      <MemoryRouter>
        <SignInPage />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText(/Email address/i), {
      target: { value: "gm.reset.test@example.com" }
    });
    fireEvent.click(screen.getByTestId("forgot-password"));
    fireEvent.click(screen.getByTestId("forgot-password"));
    await waitFor(() => expect(sendPasswordReset).toHaveBeenCalledTimes(1));
    resolveReset?.();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/password-reset-sent"));
  });
});
