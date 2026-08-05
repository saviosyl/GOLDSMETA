import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import type { AdminDiagnostics } from "../types/models";
import { ApiError } from "../types/models";
import { formatWhen } from "../lib/format";

function flagBool(flags: Record<string, unknown>, key: string): boolean | null {
  const value = flags[key];
  return typeof value === "boolean" ? value : null;
}

function flagString(flags: Record<string, unknown>, key: string): string | null {
  const value = flags[key];
  return typeof value === "string" ? value : null;
}

function flagEnvironments(flags: Record<string, unknown>): string[] | null {
  const value = flags.setupTrackingEnvironments;
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Admin-only diagnostics — secrets never shown.
 * Backend enforces Firebase custom claim admin=true (403 for non-admin).
 */
export function DiagnosticsPage() {
  const { api } = useAuth();
  const [diagnostics, setDiagnostics] = useState<AdminDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    void api
      .adminDiagnostics()
      .then((data) => {
        setDiagnostics(data);
        setForbidden(false);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) {
          setForbidden(true);
          setError("Admin access required. Diagnostics are restricted to operators with the admin claim.");
          return;
        }
        setError(err instanceof Error ? err.message : "Access failed");
      });
  }, [api]);

  if (forbidden || error) {
    return (
      <div
        className={`banner ${forbidden ? "stale" : "error"}`}
        role="alert"
        data-testid={forbidden ? "diagnostics-forbidden" : "diagnostics-error"}
      >
        {error}
      </div>
    );
  }

  if (!diagnostics) {
    return (
      <div className="card" role="status">
        Loading diagnostics…
      </div>
    );
  }

  const flags = diagnostics.flags ?? {};
  const trackingEnvs = flagEnvironments(flags);
  const setupTrackingEnabled = flagBool(flags, "setupTrackingEnabled");
  const brokerMode = flagString(flags, "brokerMode");
  const aiEnabled = flagBool(flags, "aiEnabled");

  return (
    <div className="diagnostics-page" data-testid="diagnostics-page">
      <h1 className="brand" style={{ fontSize: "1.4rem" }}>
        Diagnostics
      </h1>
      <p className="subtitle">Pipeline health — secrets never shown</p>

      <section className="card" data-testid="diagnostics-flags">
        <h2 className="section-title">Feature flags</h2>
        <div className="price-row">
          <span>Backend</span>
          <strong>{diagnostics.backendVersion}</strong>
        </div>
        <div className="price-row">
          <span>Decision rules</span>
          <strong>{diagnostics.ruleConfigVersion}</strong>
        </div>
        <div className="price-row">
          <span>Setup rules</span>
          <strong>{diagnostics.setupRuleConfigVersion}</strong>
        </div>
        <div className="price-row">
          <span>Setup tracking</span>
          <strong data-testid="flag-setup-tracking-enabled">
            {setupTrackingEnabled === null ? "—" : setupTrackingEnabled ? "enabled" : "disabled"}
          </strong>
        </div>
        <div className="price-row">
          <span>Tracking environments</span>
          <strong data-testid="flag-setup-tracking-environments">
            {trackingEnvs ? JSON.stringify(trackingEnvs) : "—"}
          </strong>
        </div>
        <div className="price-row">
          <span>Broker mode</span>
          <strong data-testid="flag-broker-mode">{brokerMode ?? "—"}</strong>
        </div>
        <div className="price-row">
          <span>AI</span>
          <strong data-testid="flag-ai-enabled">
            {aiEnabled === null ? "—" : aiEnabled ? "enabled" : "disabled"}
          </strong>
        </div>
      </section>

      <section className="card" data-testid="diagnostics-v4-flags">
        <h2 className="section-title">V4 shadow flags</h2>
        <p className="muted">Fail-closed. Never actionable. Broker remains DISABLED.</p>
        <div className="price-row">
          <span>Stage / mode</span>
          <strong data-testid="flag-v4-stage">
            {String(diagnostics.v4?.deploymentStage ?? "—")} / {String(diagnostics.v4?.mode ?? "SHADOW")}
          </strong>
        </div>
        <div className="price-row">
          <span>Compute</span>
          <strong data-testid="flag-v4-compute">
            {String((diagnostics.v4?.flags as Record<string, unknown> | undefined)?.V4_SHADOW_COMPUTE_ENABLED ?? "—")}
          </strong>
        </div>
        <div className="price-row">
          <span>Lifecycle</span>
          <strong data-testid="flag-v4-lifecycle">
            {String((diagnostics.v4?.flags as Record<string, unknown> | undefined)?.V4_SHADOW_LIFECYCLE_ENABLED ?? "—")}
          </strong>
        </div>
        <div className="price-row">
          <span>Actionable setup</span>
          <strong data-testid="flag-v4-actionable">
            {String((diagnostics.v4?.flags as Record<string, unknown> | undefined)?.V4_ACTIONABLE_SETUP_ENABLED ?? false)}
          </strong>
        </div>
        <div className="price-row">
          <span>Notifications</span>
          <strong data-testid="flag-v4-notifications">
            {String((diagnostics.v4?.flags as Record<string, unknown> | undefined)?.V4_NOTIFICATIONS_ENABLED ?? false)}
          </strong>
        </div>
        <div className="price-row">
          <span>Engine</span>
          <strong>{String(diagnostics.v4?.engineVersion ?? "—")}</strong>
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">API</h2>
        <div className="price-row">
          <span>Health</span>
          <strong>{diagnostics.apiHealth}</strong>
        </div>
        <div className="price-row">
          <span>Pine last seen</span>
          <strong>{diagnostics.pineVersionLastReceived ?? "—"}</strong>
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">TradingView</h2>
        {diagnostics.webhookConnections.length === 0 && <p className="muted">No active connection</p>}
        {diagnostics.webhookConnections.map((c) => (
          <div key={c.webhookId}>
            <div className="price-row">
              <span>Status</span>
              <strong>{c.status}</strong>
            </div>
            <div className="price-row">
              <span>Last alert</span>
              <strong>{c.lastAlertAt ? formatWhen(c.lastAlertAt) : "—"}</strong>
            </div>
            <div className="price-row">
              <span>Secret present</span>
              <strong>{c.hasSecret ? "yes" : "no"}</strong>
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <h2 className="section-title">Latest decision</h2>
        {diagnostics.latestDecision ? (
          <>
            <div className="price-row">
              <span>Action</span>
              <strong>{diagnostics.latestDecision.decision}</strong>
            </div>
            <div className="price-row">
              <span>Env</span>
              <strong>{diagnostics.latestDecision.environment}</strong>
            </div>
            <div className="price-row">
              <span>Time</span>
              <strong>{formatWhen(diagnostics.latestDecision.generatedAt)}</strong>
            </div>
          </>
        ) : (
          <p className="muted">None</p>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">Latest setup transition</h2>
        {diagnostics.latestSetupTransition ? (
          <>
            <div className="price-row">
              <span>To</span>
              <strong>{diagnostics.latestSetupTransition.to}</strong>
            </div>
            <p className="muted">{diagnostics.latestSetupTransition.reason}</p>
          </>
        ) : (
          <p className="muted">None</p>
        )}
      </section>

      <section className="card" data-testid="plan15m-opportunity-funnel">
        <h2 className="section-title">PLAN_15M OPPORTUNITY FUNNEL</h2>
        <p className="muted">Diagnostics only — hidden from normal users. Never actionable.</p>
        {diagnostics.planOpportunityFunnel ? (
          <>
            <div className="price-row">
              <span>Signals received</span>
              <strong>{diagnostics.planOpportunityFunnel.signalsReceived}</strong>
            </div>
            <div className="price-row">
              <span>Directional candidates</span>
              <strong>{diagnostics.planOpportunityFunnel.directionalCandidates}</strong>
            </div>
            <div className="price-row">
              <span>Valid geometry</span>
              <strong>{diagnostics.planOpportunityFunnel.validGeometry}</strong>
            </div>
            <div className="price-row">
              <span>Adequate TP1 room</span>
              <strong>{diagnostics.planOpportunityFunnel.adequateTp1Room}</strong>
            </div>
            <div className="price-row">
              <span>Waiting for entry zone</span>
              <strong>{diagnostics.planOpportunityFunnel.waitingForEntryZone}</strong>
            </div>
            <div className="price-row">
              <span>Waiting for 5M confirmation</span>
              <strong>{diagnostics.planOpportunityFunnel.waitingFor5mConfirmation}</strong>
            </div>
            <div className="price-row">
              <span>Confirmed</span>
              <strong>{diagnostics.planOpportunityFunnel.confirmed}</strong>
            </div>
            <div className="price-row">
              <span>Blocked</span>
              <strong>{diagnostics.planOpportunityFunnel.blocked}</strong>
            </div>
            <div className="price-row">
              <span>Expired</span>
              <strong>{diagnostics.planOpportunityFunnel.expired}</strong>
            </div>
            <h3 className="section-title" style={{ fontSize: "1rem", marginTop: "1rem" }}>
              Top blocking reasons
            </h3>
            {diagnostics.planOpportunityFunnel.topBlockingReasons.length === 0 ? (
              <p className="muted">None</p>
            ) : (
              <ul className="list">
                {diagnostics.planOpportunityFunnel.topBlockingReasons.map((r) => (
                  <li key={r.reason}>
                    <strong>{r.reason}</strong> · {r.count}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="muted">Funnel unavailable on this backend revision.</p>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">Recent rejects</h2>
        {diagnostics.recentRejects.length === 0 && <p className="muted">None recorded</p>}
        <ul className="list">
          {diagnostics.recentRejects.map((r) => (
            <li key={r.id}>
              <strong>{r.code}</strong> · {formatWhen(r.at)}
              <div className="muted">{r.message}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2 className="section-title">Broker (mock)</h2>
        <p className="muted">Adapter: {diagnostics.mockBrokerReady}</p>
        <p className="muted">Live execution remains hard-disabled.</p>
      </section>
    </div>
  );
}
