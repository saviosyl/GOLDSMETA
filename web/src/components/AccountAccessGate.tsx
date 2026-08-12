import { useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { PublicPageShell } from "./layout/PublicPageShell";
import {
  AccountReadyPage,
  AccountSuspendedPage,
  AwaitingApprovalPage,
  VerifyEmailPage
} from "../pages/auth/StatusPages";

const PENDING_ALLOWED = new Set([
  "/verify-email",
  "/awaiting-approval",
  "/account-ready",
  "/account-suspended",
  "/settings",
  "/registration-complete",
  "/account/delete-request",
  "/legal/terms",
  "/legal/privacy",
  "/legal/risk"
]);

const READY_HANDOFF_PATHS = new Set([
  "/verify-email",
  "/awaiting-approval",
  "/registration-complete"
]);

function SessionLoading() {
  return (
    <PublicPageShell testId="session-loading">
      <div className="gm-main">
        <div className="gm-main-inner">
          <div className="gm-section brand-loading" role="status">
            <img src="/brand/mark-official.png" alt="" width={48} height={48} />
            <p>Checking GoldMeta session…</p>
          </div>
        </div>
      </div>
    </PublicPageShell>
  );
}

function AccountLookupFailure({
  message,
  onRetry,
  onSignOut,
  retrying
}: {
  message: string;
  onRetry: () => void;
  onSignOut: () => void;
  retrying: boolean;
}) {
  return (
    <PublicPageShell testId="account-lookup-error">
      <div className="gm-main">
        <div className="gm-main-inner">
          <div className="gm-auth-card" role="alert" data-testid="account-lookup-error-card">
            <h1 className="gm-auth-title">Account check failed</h1>
            <p className="gm-meta" data-testid="account-lookup-error-message">
              {message}
            </p>
            <div className="gm-auth-actions" style={{ display: "grid", gap: 8, marginTop: 16 }}>
              <button
                type="button"
                className="gm-btn-gold"
                data-testid="account-lookup-retry"
                onClick={onRetry}
                disabled={retrying}
                aria-busy={retrying}
              >
                {retrying ? "Retrying…" : "Retry"}
              </button>
              <button
                type="button"
                className="gm-btn-outline"
                data-testid="account-lookup-sign-out"
                onClick={onSignOut}
                disabled={retrying}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
    </PublicPageShell>
  );
}

export function AccountAccessGate({ children }: { children: ReactNode }) {
  const {
    user,
    account,
    loading,
    accountLoading,
    accountError,
    accountResolved,
    refreshAccount,
    signOut
  } = useAuth();
  const location = useLocation();
  const [retrying, setRetrying] = useState(false);

  if (loading) {
    return <SessionLoading />;
  }

  if (!user) return <>{children}</>;

  // Mid-flight /auth/me — never flash protected UI.
  if (accountLoading || !accountResolved) {
    return <SessionLoading />;
  }

  // Durable failure: terminal friendly UI (not endless spinner).
  if (accountError || !account) {
    return (
      <AccountLookupFailure
        message={
          accountError ||
          "We could not verify your GoldMeta account right now. Check your connection and try again."
        }
        retrying={retrying || accountLoading}
        onRetry={() => {
          setRetrying(true);
          void refreshAccount().finally(() => setRetrying(false));
        }}
        onSignOut={() => {
          void signOut();
        }}
      />
    );
  }

  const access = account.access ?? (user.emailVerified ? "UNKNOWN" : "VERIFY_EMAIL");
  const path = location.pathname;

  if (access === "SUSPENDED") {
    if (path === "/account-suspended") return <>{children}</>;
    return <AccountSuspendedPage />;
  }

  if (
    access === "VERIFY_EMAIL" ||
    (!user.emailVerified && account.role !== "OWNER" && account.role !== "ADMIN")
  ) {
    if (path === "/verify-email" || PENDING_ALLOWED.has(path)) {
      if (path === "/verify-email") return <>{children}</>;
    }
    return <VerifyEmailPage />;
  }

  if (access === "AWAITING_APPROVAL" || account.role === "USER_PENDING") {
    if (PENDING_ALLOWED.has(path)) return <>{children}</>;
    return <AwaitingApprovalPage />;
  }

  // After verification + automatic activation, show the success handoff once.
  if (access === "APP" && READY_HANDOFF_PATHS.has(path)) {
    return <AccountReadyPage />;
  }

  if (path === "/account-ready") {
    return <AccountReadyPage />;
  }

  if (path === "/admin/users" && account.role !== "OWNER" && account.role !== "ADMIN") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
