import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import type { AdminDiagnostics } from "../types/models";
import { formatWhen } from "../lib/format";

/**
 * Authenticated diagnostics — no webhook secrets shown.
 * Phase 3: any signed-in user can view their own pipeline health.
 */
export function DiagnosticsPage() {
  const { api } = useAuth();
  const [diagnostics, setDiagnostics] = useState<AdminDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .adminDiagnostics()
      .then(setDiagnostics)
      .catch((err) => setError(err instanceof Error ? err.message : "Access failed"));
  }, [api]);

  if (error) {
    return (
      <div className="banner error" role="alert" data-testid="diagnostics-error">
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

  return (
    <div className="diagnostics-page" data-testid="diagnostics-page">
      <h1 className="brand" style={{ fontSize: "1.4rem" }}>
        Diagnostics
      </h1>
      <p className="subtitle">Pipeline health — secrets never shown</p>

      <section className="card">
        <h2 className="section-title">API</h2>
        <div className="price-row">
          <span>Health</span>
          <strong>{diagnostics.apiHealth}</strong>
        </div>
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
