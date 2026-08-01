import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { sendVerificationEmail } from "../../lib/firebase";
import {
  VERIFICATION_SENT_MESSAGE,
  formatResendCountdown,
  getVerificationCooldownRemainingMs,
  isVerificationResendAllowed,
  markVerificationEmailSent
} from "../../lib/verificationEmail";

function AuthStatusCard({
  testId,
  title,
  children
}: {
  testId: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="gm-auth-layout" data-testid={testId}>
      <div className="gm-auth-form-panel">
        <div className="gm-auth-card">
          <div className="gm-auth-card-brand">
            <img src="/brand/logo-full-official.png" alt="GoldMeta" className="logo-full" width={180} />
          </div>
          <h1 className="gm-auth-title">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}

export function RegistrationCompletePage() {
  return (
    <AuthStatusCard testId="registration-complete" title="Registration complete">
      <p className="gm-auth-support" data-testid="registration-complete-message">
        Your account was created. Next: verify your email. After verification, your GoldMeta account
        activates automatically for Dashboard and analysis.
      </p>
      <ol className="gm-help-steps">
        <li>Open the verification email we sent.</li>
        <li>Return here and sign in after verifying.</li>
        <li>Open the Dashboard — broker trading stays locked separately.</li>
      </ol>
      <p className="gm-auth-trust">
        Broker trading is not enabled by registration. AutoTrade remains OFF.
      </p>
      <Link className="gm-auth-submit" to="/" style={{ display: "inline-block", textAlign: "center" }}>
        Go to Sign In
      </Link>
    </AuthStatusCard>
  );
}

export function VerifyEmailPage() {
  const { signOut, user, refreshAccount } = useAuth();
  const location = useLocation();
  const noticeFromNav =
    typeof (location.state as { verificationNotice?: unknown } | null)?.verificationNotice ===
    "string"
      ? String((location.state as { verificationNotice: string }).verificationNotice)
      : null;
  const [message, setMessage] = useState<string | null>(noticeFromNav ?? VERIFICATION_SENT_MESSAGE);
  const [busy, setBusy] = useState(false);
  const [remainingMs, setRemainingMs] = useState(() => getVerificationCooldownRemainingMs());

  useEffect(() => {
    const id = window.setInterval(() => {
      setRemainingMs(getVerificationCooldownRemainingMs());
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  // If Firebase already shows verified (e.g. returning from action URL), refresh token + /me.
  useEffect(() => {
    if (!user?.emailVerified) return;
    void (async () => {
      await refreshAccount();
    })();
  }, [user?.emailVerified, refreshAccount]);

  const resendAllowed = isVerificationResendAllowed() && !busy;

  const resend = async () => {
    if (!isVerificationResendAllowed()) {
      setMessage(formatResendCountdown(getVerificationCooldownRemainingMs()));
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await sendVerificationEmail(user);
      markVerificationEmailSent(user?.uid);
      setRemainingMs(getVerificationCooldownRemainingMs());
      setMessage(VERIFICATION_SENT_MESSAGE);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Too many verification attempts. Please wait a few minutes, then try Resend again."
      );
      // Still arm cooldown so rapid clicks cannot flood Identity Toolkit.
      markVerificationEmailSent(user?.uid);
      setRemainingMs(getVerificationCooldownRemainingMs());
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthStatusCard testId="verify-email-page" title="Verify your email">
      <p className="gm-auth-support">
        {VERIFICATION_SENT_MESSAGE}
        {user?.email ? ` (${user.email})` : ""}
      </p>
      <p className="gm-meta">
        Cannot find it? Check spam, then use Resend. Resend waits 60 seconds between sends to protect
        your inbox.
      </p>
      {message && (
        <div className="banner" role="status" data-testid="verify-email-status">
          {message}
        </div>
      )}
      <button
        type="button"
        className="gm-auth-submit"
        data-testid="resend-verification"
        disabled={!resendAllowed}
        onClick={() => void resend()}
      >
        {busy
          ? "Sending…"
          : remainingMs > 0
            ? formatResendCountdown(remainingMs)
            : "Resend verification email"}
      </button>
      <button type="button" className="gm-auth-text-btn" onClick={() => void signOut()}>
        Sign out
      </button>
    </AuthStatusCard>
  );
}

export function AccountReadyPage() {
  return (
    <AuthStatusCard testId="account-ready-page" title="Your account is ready">
      <p className="gm-auth-support" data-testid="account-ready-message">
        Your email has been verified and your GoldMeta account is now active.
      </p>
      <ol className="gm-help-steps">
        <li>Dashboard and market analysis are available.</li>
        <li>Broker connection and trading stay locked until separately enabled.</li>
        <li>AutoTrade remains OFF.</li>
      </ol>
      <p className="gm-auth-trust">
        Registration never enables broker orders, Demo trading, or Live trading.
      </p>
      <Link
        className="gm-auth-submit"
        to="/"
        style={{ display: "inline-block", textAlign: "center" }}
        data-testid="account-ready-open-dashboard"
      >
        Open Dashboard
      </Link>
    </AuthStatusCard>
  );
}

export function AwaitingApprovalPage() {
  const { signOut, account } = useAuth();
  return (
    <AuthStatusCard testId="awaiting-approval-page" title="Waiting for approval">
      <p className="gm-auth-support" data-testid="awaiting-approval-message">
        Your email is verified. This account still needs a manual review before Dashboard access
        unlocks.
      </p>
      <ol className="gm-help-steps">
        <li>This screen is for accounts that require exceptional review.</li>
        <li>When approved, sign in again to access GoldMeta.</li>
        <li>Broker connection is separate and stays locked until a Demo setup is completed later.</li>
      </ol>
      <p className="gm-auth-trust">
        {account?.profile?.brokerMessage ??
          "Broker access is not enabled by account approval alone."}
      </p>
      <Link className="gm-auth-text-btn accent" to="/help">
        Open help
      </Link>
      <button type="button" className="gm-auth-text-btn" onClick={() => void signOut()}>
        Sign out
      </button>
    </AuthStatusCard>
  );
}

export function AccountSuspendedPage() {
  const { signOut } = useAuth();
  return (
    <AuthStatusCard testId="account-suspended-page" title="Account paused">
      <p className="gm-auth-support" data-testid="suspended-message">
        This account has been paused. You cannot use GoldMeta until an administrator restores access.
      </p>
      <p className="gm-meta">
        If you believe this is a mistake, contact support with the email you used to register. We
        will review calmly and reply as soon as possible.
      </p>
      <button type="button" className="gm-auth-submit" onClick={() => void signOut()}>
        Sign out
      </button>
    </AuthStatusCard>
  );
}

export function PasswordResetSentPage() {
  return (
    <AuthStatusCard testId="password-reset-sent" title="Password reset sent">
      <p className="gm-auth-support" data-testid="password-reset-sent-message">
        If an account exists for this email, a password-reset message has been sent. Please check
        your inbox and spam folder.
      </p>
      <Link
        className="gm-auth-submit"
        to="/login"
        style={{ display: "inline-block", textAlign: "center" }}
        data-testid="password-reset-back-signin"
      >
        Back to Sign In
      </Link>
    </AuthStatusCard>
  );
}
