import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../lib/auth";

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
        Your account was created. Next: verify your email, then wait for approval before full access
        is enabled.
      </p>
      <ol className="gm-help-steps">
        <li>Open the verification email we sent.</li>
        <li>Return here and sign in after verifying.</li>
        <li>An administrator will review your account.</li>
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
  const { api, signOut, user } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const resend = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.resendVerification();
      setMessage(res.message);
    } catch {
      setMessage("If verification is required, an email will be sent shortly. Please wait before trying again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthStatusCard testId="verify-email-page" title="Verify your email">
      <p className="gm-auth-support">
        We sent a verification link{user?.email ? ` to ${user.email}` : ""}. Open that email and tap
        the link before using GoldMeta.
      </p>
      <p className="gm-meta">
        Cannot find it? Check spam, then use Resend. Resend is rate-limited to protect your inbox.
      </p>
      {message && (
        <div className="banner" role="status">
          {message}
        </div>
      )}
      <button
        type="button"
        className="gm-auth-submit"
        data-testid="resend-verification"
        disabled={busy}
        onClick={() => void resend()}
      >
        {busy ? "Sending…" : "Resend verification email"}
      </button>
      <button type="button" className="gm-auth-text-btn" onClick={() => void signOut()}>
        Sign out
      </button>
    </AuthStatusCard>
  );
}

export function AwaitingApprovalPage() {
  const { signOut, account } = useAuth();
  return (
    <AuthStatusCard testId="awaiting-approval-page" title="Waiting for approval">
      <p className="gm-auth-support" data-testid="awaiting-approval-message">
        Your email is verified. An administrator must approve your account before Dashboard and
        analysis features unlock.
      </p>
      <ol className="gm-help-steps">
        <li>We notify the owner that your account is ready for review.</li>
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
      <p className="gm-auth-support">
        If an account exists for that email, a reset link has been sent. Check your inbox and spam
        folder.
      </p>
      <Link className="gm-auth-submit" to="/" style={{ display: "inline-block", textAlign: "center" }}>
        Back to Sign In
      </Link>
    </AuthStatusCard>
  );
}
