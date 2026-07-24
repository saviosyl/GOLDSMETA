import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import {
  AccountSuspendedPage,
  AwaitingApprovalPage,
  VerifyEmailPage
} from "../pages/auth/StatusPages";

const PENDING_ALLOWED = new Set([
  "/verify-email",
  "/awaiting-approval",
  "/account-suspended",
  "/settings",
  "/registration-complete"
]);

export function AccountAccessGate({ children }: { children: ReactNode }) {
  const { user, account, loading, refreshAccount } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="gm-shell" data-testid="session-loading">
        <div className="gm-main">
          <div className="gm-main-inner">
            <div className="gm-section brand-loading" role="status">
              <img src="/brand/mark-official.png" alt="" width={48} height={48} />
              <p>Checking GoldMeta session…</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!user) return <>{children}</>;

  // Soft refresh once if account state not loaded yet.
  if (!account) {
    void refreshAccount();
  }

  const access = account?.access ?? (user.emailVerified ? "UNKNOWN" : "VERIFY_EMAIL");
  const path = location.pathname;

  if (access === "SUSPENDED") {
    if (path === "/account-suspended") return <>{children}</>;
    return <AccountSuspendedPage />;
  }

  if (access === "VERIFY_EMAIL" || (!user.emailVerified && account?.role !== "OWNER" && account?.role !== "ADMIN")) {
    if (path === "/verify-email" || PENDING_ALLOWED.has(path)) {
      if (path === "/verify-email") return <>{children}</>;
    }
    return <VerifyEmailPage />;
  }

  if (access === "AWAITING_APPROVAL" || account?.role === "USER_PENDING") {
    if (PENDING_ALLOWED.has(path)) return <>{children}</>;
    return <AwaitingApprovalPage />;
  }

  if (path === "/admin/users" && account && account.role !== "OWNER" && account.role !== "ADMIN") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
