import { useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";

export function SignInPage() {
  const { signIn, signUp, configured, apiBaseUrl } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
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

  if (!configured) {
    return (
      <div className="card">
        <h2>Firebase not configured</h2>
        <p className="muted">
          Set <code>VITE_FIREBASE_*</code> and <code>VITE_API_BASE_URL</code> in <code>web/.env</code>.
          See <code>docs/WEB_PWA_SETUP.md</code>. There is no auth bypass.
        </p>
        <p className="muted">Current API base: {apiBaseUrl}</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>{mode === "signin" ? "Sign in" : "Create account"}</h2>
      <p className="muted">Same Firebase project and users as the native iOS app.</p>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button className="btn primary block" type="submit" disabled={busy}>
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Sign up"}
        </button>
      </form>
      <button
        type="button"
        className="btn block"
        style={{ marginTop: 10 }}
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
      >
        {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
      </button>
    </div>
  );
}
