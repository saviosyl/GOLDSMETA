import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";

const SESSION_KEY = "microEdgeOAuthSessionId";

/**
 * SPA OAuth callback for Micro Edge (scope=accounts).
 * Completes token exchange via authenticated API — never stores tokens in the browser.
 */
export function MicroEdgeConnectCallbackPage() {
  const { api } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState("Completing read-only authorization…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const code = (params.get("code") ?? "").trim();
      const sessionId =
        (sessionStorage.getItem(SESSION_KEY) ?? params.get("session_id") ?? "").trim();
      if (!code) {
        setError("Missing authorization code.");
        return;
      }
      if (!sessionId) {
        setError("Missing Micro OAuth session. Start Connect again from Micro Edge.");
        return;
      }
      try {
        const result = (await api.microEdgeOAuthCallback({
          code,
          sessionId
        })) as { ok?: boolean; status?: string; message?: string };
        sessionStorage.removeItem(SESSION_KEY);
        if (cancelled) return;
        if (result.ok === false) {
          setError(result.message ?? "Authorization failed");
          return;
        }
        setMessage(
          result.status === "ACCOUNT_SELECTION_REQUIRED"
            ? "Authorized — select a DEMO account on Micro Edge."
            : "Read-only connection saved. Returning to Micro Edge…"
        );
        setTimeout(() => navigate("/micro-edge", { replace: true }), 800);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "OAuth callback failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, navigate, params]);

  return (
    <div className="gm-page gm-micro-edge-page" data-testid="micro-edge-oauth-callback">
      <header className="gm-page-header">
        <div>
          <h1 className="gm-page-title">Micro Edge</h1>
          <p className="gm-page-sub">Read-only authorization callback</p>
        </div>
        <div className="gm-micro-badges">
          <span className="gm-chip gm-chip-warn">SHADOW ONLY</span>
          <span className="gm-chip">NO BROKER ORDERS</span>
        </div>
      </header>
      {error ? (
        <div className="gm-banner gm-banner-danger">
          {error}
          <div style={{ marginTop: 12 }}>
            <Link to="/micro-edge">Back to Micro Edge</Link>
          </div>
        </div>
      ) : (
        <div className="gm-banner gm-banner-info">{message}</div>
      )}
    </div>
  );
}

export const MICRO_EDGE_OAUTH_SESSION_KEY = SESSION_KEY;
