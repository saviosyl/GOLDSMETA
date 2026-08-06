import { useId, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ApiError } from "../types/models";
import {
  OWNER_EXISTS_MESSAGE,
  normalizeEmail,
  validateRegistrationForm,
  type RegistrationFieldErrors
} from "../lib/registrationValidation";

export function RegisterPage() {
  const { api, registrationEnabled, configured } = useAuth();
  const navigate = useNavigate();
  const formId = useId();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [countryOfResidence, setCountry] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [acceptRiskWarning, setAcceptRisk] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<RegistrationFieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ownerHint = useMemo(() => {
    const n = normalizeEmail(email);
    return n === "saviosyl@gmail.com" ? OWNER_EXISTS_MESSAGE : null;
  }, [email]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const values = {
      firstName,
      lastName,
      email,
      password,
      confirmPassword,
      countryOfResidence,
      acceptTerms,
      acceptPrivacy,
      acceptRiskWarning
    };
    const validated = validateRegistrationForm(values);
    if (!validated.ok) {
      setFieldErrors(validated.fieldErrors);
      setError(validated.message);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      const payload = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: normalizeEmail(email),
        password,
        confirmPassword,
        countryOfResidence: countryOfResidence.trim(),
        acceptTerms: true,
        acceptPrivacy: true,
        acceptRiskWarning: true
      };
      await api.registerAccount(payload);
      navigate("/registration-complete", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        // One primary banner only — do not also set a duplicate field error.
        setError(
          err.message.includes("already exists") ? OWNER_EXISTS_MESSAGE : err.message
        );
        setFieldErrors({});
      } else {
        setError(err instanceof Error ? err.message : "Registration failed");
      }
    } finally {
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <div className="gm-auth-layout" data-testid="register-unconfigured">
        <div className="gm-auth-card">
          <h1 className="gm-auth-title">Configuration needed</h1>
        </div>
      </div>
    );
  }

  if (!registrationEnabled) {
    return (
      <div className="gm-auth-layout" data-testid="register-closed">
        <div className="gm-auth-card">
          <h1 className="gm-auth-title">Registration closed</h1>
          <p className="gm-auth-support">Account registration is currently closed.</p>
          <Link className="gm-auth-text-btn accent" to="/">
            Back to Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="gm-auth-layout" data-testid="register-layout">
      <div className="gm-auth-form-panel">
        <div className="gm-auth-card gm-auth-card-wide" data-testid="register-card">
          <div className="gm-auth-card-brand">
            <img src="/brand/logo-full-official.png" alt="GoldMeta" className="logo-full" width={200} />
          </div>
          <h1 className="gm-auth-title">Create account</h1>
          <p className="gm-auth-support">
            Email verification is required. Account approval may be required before full access.
            Broker trading is <strong>not</strong> enabled by registration. CFDs are high risk.
            Demo and Live trading are separate. AutoTrade is disabled by default.
            GoldMeta&apos;s market feed is centrally managed; no TradingView setup is required for
            normal users.
          </p>

          {error && (
            <div className="banner error" role="alert" data-testid="register-error">
              {error}
            </div>
          )}
          {!error && ownerHint && (
            <div className="banner" role="status" data-testid="register-owner-hint">
              {OWNER_EXISTS_MESSAGE}
            </div>
          )}

          <form id={formId} onSubmit={(e) => void onSubmit(e)} noValidate>
            <div className="gm-auth-field-grid">
              <div className="gm-auth-field">
                <label htmlFor={`${formId}-first`}>First name</label>
                <input
                  id={`${formId}-first`}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoComplete="given-name"
                  required
                />
                {fieldErrors.firstName && <span className="gm-field-error">{fieldErrors.firstName}</span>}
              </div>
              <div className="gm-auth-field">
                <label htmlFor={`${formId}-last`}>Last name</label>
                <input
                  id={`${formId}-last`}
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  autoComplete="family-name"
                  required
                />
                {fieldErrors.lastName && <span className="gm-field-error">{fieldErrors.lastName}</span>}
              </div>
            </div>

            <div className="gm-auth-field">
              <label htmlFor={`${formId}-email`}>Email address</label>
              <input
                id={`${formId}-email`}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
              {fieldErrors.email && <span className="gm-field-error">{fieldErrors.email}</span>}
            </div>

            <div className="gm-auth-field">
              <label htmlFor={`${formId}-password`}>Password</label>
              <input
                id={`${formId}-password`}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={10}
                required
                aria-describedby={`${formId}-password-rules`}
              />
              <ul
                className="gm-password-rules"
                id={`${formId}-password-rules`}
                data-testid="password-rules"
              >
                <li>At least 10 characters</li>
                <li>One uppercase and one lowercase letter</li>
                <li>One number and one special character</li>
              </ul>
              {fieldErrors.password && <span className="gm-field-error">{fieldErrors.password}</span>}
            </div>

            <div className="gm-auth-field">
              <label htmlFor={`${formId}-confirm`}>Confirm password</label>
              <input
                id={`${formId}-confirm`}
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
              {fieldErrors.confirmPassword && (
                <span className="gm-field-error">{fieldErrors.confirmPassword}</span>
              )}
            </div>

            <div className="gm-auth-field">
              <label htmlFor={`${formId}-country`}>Country of residence</label>
              <input
                id={`${formId}-country`}
                value={countryOfResidence}
                onChange={(e) => setCountry(e.target.value)}
                autoComplete="country-name"
                required
              />
              {fieldErrors.countryOfResidence && (
                <span className="gm-field-error">{fieldErrors.countryOfResidence}</span>
              )}
            </div>

            <label className="gm-auth-check">
              <input
                type="checkbox"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
              />
              I accept the{" "}
              <a href="/legal/terms" target="_blank" rel="noreferrer">
                Terms of Service
              </a>
            </label>
            <label className="gm-auth-check">
              <input
                type="checkbox"
                checked={acceptPrivacy}
                onChange={(e) => setAcceptPrivacy(e.target.checked)}
              />
              I accept the{" "}
              <a href="/legal/privacy" target="_blank" rel="noreferrer">
                Privacy Policy
              </a>
            </label>
            <label className="gm-auth-check">
              <input
                type="checkbox"
                checked={acceptRiskWarning}
                onChange={(e) => setAcceptRisk(e.target.checked)}
              />
              I understand the{" "}
              <a href="/legal/risk" target="_blank" rel="noreferrer">
                CFD / high-risk disclosure
              </a>{" "}
              — leveraged products are high risk and I may lose money. Registration does not enable
              trading. Financial results are not guaranteed.
            </label>

            <button className="gm-auth-submit" type="submit" disabled={busy} data-testid="register-submit">
              {busy ? "Creating account…" : "Create account"}
            </button>
          </form>

          <p className="gm-auth-switch">
            Already registered?{" "}
            <Link className="gm-auth-text-btn accent" to="/" data-testid="register-to-signin">
              Sign In
            </Link>
          </p>
          <p className="gm-auth-trust">
            Broker access is not enabled by registration. AutoTrade remains OFF. Start with the
            current plan, market-feed health, optional phone alerts, risk preferences, and Journal.
          </p>
        </div>
      </div>
    </div>
  );
}
