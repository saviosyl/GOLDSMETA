import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelpPage } from "./HelpPage";
import {
  AccountReadyPage,
  AwaitingApprovalPage,
  AccountSuspendedPage,
  VerifyEmailPage
} from "./auth/StatusPages";
import { AdminUsersPage } from "./admin/AdminUsersPage";
import { RegisterPage } from "./RegisterPage";
import {
  approvalStatusLabel,
  wizardStatusLabel,
  friendlyApiCode
} from "../lib/plainLanguage";
import "../styles/redesign.css";

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    user: { email: "user@example.com" },
    account: { role: "OWNER", profile: {} },
    signOut: vi.fn(),
    configured: true,
    registrationEnabled: true,
    api: {
      resendVerification: vi.fn().mockResolvedValue({ message: "Sent" }),
      listAdminUsers: vi.fn().mockResolvedValue({
        users: [
          {
            userId: "u1",
            userIdMasked: "u1…",
            firstName: "Ada",
            lastName: "Lovelace",
            email: "ada@example.com",
            registeredAt: "2026-07-20T00:00:00.000Z",
            emailVerified: true,
            approvalStatus: "USER_PENDING",
            role: "USER_PENDING",
            lastSignInAt: null,
            suspended: false
          }
        ]
      }),
      adminUserAction: vi.fn(),
      registerAccount: vi.fn()
    }
  })
}));

describe("plain language status maps", () => {
  it("hides raw pending roles", () => {
    expect(approvalStatusLabel("USER_PENDING")).toBe("Waiting for approval");
    expect(wizardStatusLabel("SETUP_REQUIRED")).toBe("Action required");
    expect(wizardStatusLabel("COMPLETE")).toBe("Complete");
    expect(friendlyApiCode("FORBIDDEN", "x", 403).message).toMatch(/do not have access/i);
  });
});

describe("HelpPage", () => {
  it("shows first-use guide and glossary", () => {
    render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>
    );
    expect(screen.getByTestId("help-page")).toBeInTheDocument();
    expect(screen.getByTestId("first-use-guide")).toHaveTextContent(/Open Plan/i);
    expect(screen.getByTestId("glossary-gold-hunter")).toBeInTheDocument();
    expect(screen.getByTestId("glossary-poc")).toBeInTheDocument();
    expect(screen.getByTestId("glossary-trend")).toBeInTheDocument();
    expect(screen.getByTestId("glossary-entry")).toBeInTheDocument();
    expect(screen.getByTestId("glossary-risk")).toBeInTheDocument();
    expect(screen.getByTestId("help-analysis-disclaimer")).toHaveTextContent(
      /no profit guarantee/i
    );
  });
});

describe("auth status pages", () => {
  it("shows account ready activation screen without raw roles", () => {
    render(
      <MemoryRouter>
        <AccountReadyPage />
      </MemoryRouter>
    );
    expect(screen.getByTestId("account-ready-page")).toHaveTextContent(/Your account is ready/i);
    expect(screen.getByTestId("account-ready-message")).toHaveTextContent(/now active/i);
    expect(screen.getByTestId("account-ready-open-dashboard")).toHaveTextContent(/Open Dashboard/i);
    expect(screen.queryByText("USER_APPROVED")).not.toBeInTheDocument();
    expect(screen.queryByText("USER_PENDING")).not.toBeInTheDocument();
  });

  it("explains awaiting approval without raw roles", () => {
    render(
      <MemoryRouter>
        <AwaitingApprovalPage />
      </MemoryRouter>
    );
    expect(screen.getByTestId("awaiting-approval-page")).toHaveTextContent(/Waiting for approval/i);
    expect(screen.queryByText("USER_PENDING")).not.toBeInTheDocument();
  });

  it("explains suspended calmly", () => {
    render(
      <MemoryRouter>
        <AccountSuspendedPage />
      </MemoryRouter>
    );
    expect(screen.getByTestId("suspended-message")).toHaveTextContent(/paused/i);
  });

  it("makes resend verification obvious", () => {
    render(
      <MemoryRouter>
        <VerifyEmailPage />
      </MemoryRouter>
    );
    expect(screen.getByTestId("resend-verification")).toBeInTheDocument();
  });
});

describe("AdminUsersPage", () => {
  it("shows friendly approval labels", async () => {
    render(
      <MemoryRouter>
        <AdminUsersPage />
      </MemoryRouter>
    );
    expect(await screen.findAllByText("Waiting for approval")).not.toHaveLength(0);
    expect(screen.queryByText("USER_PENDING")).not.toBeInTheDocument();
  });
});

describe("RegisterPage", () => {
  it("shows password rules before submit", () => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    );
    expect(screen.getByTestId("password-rules")).toHaveTextContent(/At least 10 characters/i);
  });
});
