import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RegisterPage } from "./RegisterPage";

const registerAccount = vi.fn();
const navigate = vi.fn();
const firebaseSignIn = vi.fn();
const sendVerificationEmail = vi.fn();
const markVerificationEmailSent = vi.fn<(uid?: string | null) => void>();
const wasInitialVerificationSentFor = vi.fn<(uid?: string | null) => boolean>(() => false);

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigate
  };
});

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    api: { registerAccount },
    registrationEnabled: true,
    configured: true
  })
}));

vi.mock("../lib/firebase", () => ({
  signIn: (...args: unknown[]) => firebaseSignIn(...args),
  sendVerificationEmail: (...args: unknown[]) => sendVerificationEmail(...args)
}));

vi.mock("../lib/verificationEmail", async () => {
  const actual = await vi.importActual<typeof import("../lib/verificationEmail")>(
    "../lib/verificationEmail"
  );
  return {
    ...actual,
    markVerificationEmailSent: (uid: string | null | undefined) =>
      markVerificationEmailSent(uid),
    wasInitialVerificationSentFor: (uid: string | null | undefined) =>
      wasInitialVerificationSentFor(uid)
  };
});

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/First name/i), { target: { value: "Ada" } });
  fireEvent.change(screen.getByLabelText(/Last name/i), { target: { value: "Lovelace" } });
  fireEvent.change(screen.getByLabelText(/Email address/i), {
    target: { value: "ada@example.com" }
  });
  fireEvent.change(screen.getByLabelText(/^Password$/i), {
    target: { value: "SecurePass1!" }
  });
  fireEvent.change(screen.getByLabelText(/Confirm password/i), {
    target: { value: "SecurePass1!" }
  });
  fireEvent.change(screen.getByLabelText(/Country of residence/i), {
    target: { value: "Ireland" }
  });
  fireEvent.click(screen.getByLabelText(/Terms of Service/i));
  fireEvent.click(screen.getByLabelText(/Privacy Policy/i));
  fireEvent.click(screen.getByLabelText(/CFD \/ high-risk/i));
}

describe("RegisterPage", () => {
  beforeEach(() => {
    registerAccount.mockReset();
    navigate.mockReset();
    firebaseSignIn.mockReset();
    sendVerificationEmail.mockReset();
    markVerificationEmailSent.mockReset();
    wasInitialVerificationSentFor.mockReset();
    wasInitialVerificationSentFor.mockReturnValue(false);
    registerAccount.mockResolvedValue({
      role: "USER_PENDING",
      emailVerificationSent: false,
      emailVerificationDelivery: "client_sdk"
    });
    firebaseSignIn.mockResolvedValue({ uid: "uid-1", email: "ada@example.com" });
    sendVerificationEmail.mockResolvedValue(undefined);
  });

  it("renders create-account form and mobile-friendly fields", () => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "Create account" })).toBeInTheDocument();
    expect(screen.getByLabelText(/First name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Country of residence/i)).toBeInTheDocument();
    expect(screen.getByText(/Broker trading is/i)).toBeInTheDocument();
    expect(screen.getByTestId("register-card").className).toMatch(/gm-auth-card/);
  });

  it("shows owner-email hint and does not submit", async () => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText(/Email address/i), {
      target: { value: "saviosyl@gmail.com" }
    });
    expect(await screen.findByTestId("register-owner-hint")).toHaveTextContent(/Forgot Password/i);
    fireEvent.click(screen.getByTestId("register-submit"));
    await waitFor(() => expect(registerAccount).not.toHaveBeenCalled());
  });

  it("registers then sends exactly one client verification email", async () => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    );
    fillValidForm();
    fireEvent.click(screen.getByTestId("register-submit"));

    await waitFor(() => expect(registerAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(firebaseSignIn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(sendVerificationEmail).toHaveBeenCalledTimes(1));
    expect(markVerificationEmailSent).toHaveBeenCalledWith("uid-1");
    expect(navigate).toHaveBeenCalledWith(
      "/verify-email",
      expect.objectContaining({ replace: true })
    );
  });

  it("does not resend when initial send already recorded for uid", async () => {
    wasInitialVerificationSentFor.mockReturnValue(true);
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    );
    fillValidForm();
    fireEvent.click(screen.getByTestId("register-submit"));

    await waitFor(() => expect(registerAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(firebaseSignIn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });
});
