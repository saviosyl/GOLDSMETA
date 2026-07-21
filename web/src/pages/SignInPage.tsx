import { useId, useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import { sendPasswordReset } from "../lib/firebase";

/**
 * V5.3.1 authentication screen — desktop-first balanced layout.
 * No internal Firebase/iOS wording. Sign-up is a secondary text link.
 */
export function SignInPage() {
  const { signIn, signUp, configured } = useAuth();
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      if (mode === "signin") await signIn(email.trim(), password);
      else await signUp(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const onForgot = async () => {
    setError(null);
    setMessage(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter your email address first, then tap Forgot password.");
      return;
    }
    setBusy(true);
    try {
      await sendPasswordReset(trimmed);
      setMessage("If an account exists for that email, a reset link has been sent.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start password reset");
    } finally {
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <div className="gm-auth-card" data-testid="signin-unconfigured">
        <img src="/brand/mark-dark.svg" alt="" width={40} height={40} />
        <h1 className="gm-auth-title">Configuration needed</h1>
        <p className="gm-auth-support">
          GoldMeta is not configured for this environment. Contact your operator.
        </p>
      </div>
    );
  }

  return (
    <div className="gm-auth-layout" data-testid="signin-layout">
      <aside className="gm-auth-brand-panel" aria-hidden={false}>
        <div className="gm-auth-brand-inner">
          <img src="/brand/mark-dark.svg" alt="" width={48} height={48} />
          <p className="gm-auth-product">GoldMeta</p>
          <p className="gm-auth-tagline">Gold market intelligence</p>
          <p className="gm-auth-brand-copy">
            Calm, verified context for XAUUSD. Analysis only — GoldMeta does not place trades.
          </p>
        </div>
      </aside>

      <div className="gm-auth-form-panel">
        <div className="gm-auth-card" data-testid="signin-card">
          <div className="gm-auth-card-brand" data-testid="signin-logo">
            <img src="/brand/mark-dark.svg" alt="GoldMeta" width={36} height={36} />
            <span>GoldMeta</span>
          </div>

          <h1 className="gm-auth-title">
            {mode === "signin" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="gm-auth-support">
            {mode === "signin"
              ? "Sign in to continue to GoldMeta."
              : "Create an account to continue to GoldMeta."}
          </p>

          {error && (
            <div className="banner error" role="alert" id={errorId} data-testid="signin-error">
              {error}
            </div>
          )}
          {message && (
            <div className="banner" role="status" data-testid="signin-message">
              {message}
            </div>
          )}

          <form onSubmit={onSubmit} noValidate>
            <div className="gm-auth-field">
              <label htmlFor={emailId}>Email</label>
              <input
                id={emailId}
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={email}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="gm-auth-field">
              <div className="gm-auth-label-row">
                <label htmlFor={passwordId}>Password</label>
                {mode === "signin" && (
                  <button
                    type="button"
                    className="gm-auth-text-btn"
                    data-testid="forgot-password"
                    disabled={busy}
                    onClick={() => void onForgot()}
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="gm-auth-password-wrap">
                <input
                  id={passwordId}
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  required
                  minLength={6}
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

            <button
              className="gm-auth-submit"
              type="submit"
              disabled={busy}
              data-testid="signin-submit"
            >
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <div className="gm-auth-divider" role="presentation">
            <span>or</span>
          </div>

          <p className="gm-auth-switch" data-testid="auth-switch">
            {mode === "signin" ? (
              <>
                New to GoldMeta?{" "}
                <button
                  type="button"
                  className="gm-auth-text-btn accent"
                  onClick={() => {
                    setMode("signup");
                    setError(null);
                    setMessage(null);
                  }}
                >
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  className="gm-auth-text-btn accent"
                  onClick={() => {
                    setMode("signin");
                    setError(null);
                    setMessage(null);
                  }}
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
