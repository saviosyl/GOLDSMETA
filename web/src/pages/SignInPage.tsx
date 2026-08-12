import { useId, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { getFirebaseProjectId, sendPasswordReset } from "../lib/firebase";
import { friendlyAuthError } from "../lib/authErrors";

const GENERIC_RESET_SENT =
  "If an account exists for this email, a password-reset message has been sent. Please check your inbox and spam folder.";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** V5.4 light premium sign-in — registration open via Create account. */
export function SignInPage() {
  const { signIn, configured, registrationEnabled } = useAuth();
  const navigate = useNavigate();
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resetInFlight = useRef(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const onForgot = async () => {
    if (resetInFlight.current || busy) return;
    setError(null);
    setMessage(null);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError("Enter your email address first, then tap Forgot password.");
      return;
    }
    if (!isValidEmail(trimmed)) {
      setError("Enter a valid email address, then tap Forgot password.");
      return;
    }

    const projectId = getFirebaseProjectId();
    if (projectId && projectId !== "goldmeta-web" && import.meta.env.PROD) {
      setError("Sign-in is misconfigured for this environment. Please try again later.");
      return;
    }

    resetInFlight.current = true;
    setBusy(true);
    try {
      // Client SDK sendPasswordResetEmail actually delivers mail (same family as
      // Firebase Console). Do NOT also POST /v1/auth/password-reset here — that
      // would double-send once the API sendOobCode fix is deployed.
      // Server rate limits still apply to direct API callers; UI uses in-flight lock.
      await sendPasswordReset(trimmed);
      navigate("/password-reset-sent");
    } catch (err) {
      const friendly = friendlyAuthError(err);
      if (/too many/i.test(friendly)) {
        setError(friendly);
      } else if (/network/i.test(friendly)) {
        setError(friendly);
      } else {
        // Enumeration-safe generic confirmation.
        setMessage(GENERIC_RESET_SENT);
        setError(null);
      }
    } finally {
      resetInFlight.current = false;
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <div className="gm-auth-layout" data-testid="signin-unconfigured">
        <div className="gm-auth-card">
          <img src="/brand/logo-full-official.png" alt="GoldMeta" className="logo-full" width={200} />
          <h1 className="gm-auth-title">Configuration needed</h1>
          <p className="gm-auth-support">GoldMeta is not configured for this environment.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="gm-auth-layout" data-testid="signin-layout">
      <div className="gm-auth-side-notes" aria-hidden>
        <span>Smart tools. Clearer decisions.</span>
        <span>Secure. Reliable. Analysis only.</span>
      </div>

      <div className="gm-auth-form-panel">
        <div className="gm-auth-card" data-testid="signin-card">
          <div className="gm-auth-card-brand" data-testid="signin-logo">
            <img
              src="/brand/logo-full-official.png"
              alt="GoldMeta"
              className="logo-full"
              width={200}
            />
          </div>

          <h1 className="gm-auth-title">Welcome back</h1>
          <p className="gm-auth-support">
            Sign in to your <span className="brand-inline">GOLDMETA</span> account
          </p>

          {error && (
            <div className="banner error" role="alert" id={errorId} data-testid="signin-error">
              {error}
            </div>
          )}
          {message && !error && (
            <div className="banner" role="status" data-testid="signin-message">
              {message}
            </div>
          )}

          <form onSubmit={onSubmit} noValidate>
            <div className="gm-auth-field">
              <label htmlFor={emailId}>Email address</label>
              <input
                id={emailId}
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                placeholder="Enter your email"
                value={email}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="gm-auth-field">
              <label htmlFor={passwordId}>Password</label>
              <div className="gm-auth-password-wrap">
                <input
                  id={passwordId}
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  minLength={6}
                  placeholder="Enter your password"
                  value={password}
                  aria-invalid={Boolean(error)}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="gm-auth-reveal"
                  data-testid="toggle-password"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <div className="gm-auth-row">
              <label>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Remember me
              </label>
              <button
                type="button"
                className="gm-auth-text-btn accent"
                data-testid="forgot-password"
                disabled={busy}
                onClick={() => void onForgot()}
              >
                Forgot password?
              </button>
            </div>

            <button
              className="gm-auth-submit"
              type="submit"
              disabled={busy}
              data-testid="signin-submit"
            >
              {busy ? "Please wait…" : "Sign In"}
            </button>
          </form>

          {registrationEnabled ? (
            <p className="gm-auth-switch" data-testid="auth-create-account">
              New here?{" "}
              <Link className="gm-auth-text-btn accent" to="/register" data-testid="create-account-link">
                Create account
              </Link>
            </p>
          ) : (
            <p className="gm-auth-switch" data-testid="auth-registration-closed">
              Account registration is currently closed.
            </p>
          )}

          <p className="gm-auth-trust">Secure access to your GoldMeta account.</p>
        </div>
      </div>

      <p className="gm-auth-footer-note">© 2026 MetaMech Solutions. All rights reserved.</p>
    </div>
  );
}
