import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RegisterPage } from "./RegisterPage";

const registerAccount = vi.fn();

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    api: { registerAccount },
    registrationEnabled: true,
    configured: true
  })
}));

describe("RegisterPage", () => {
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
});
