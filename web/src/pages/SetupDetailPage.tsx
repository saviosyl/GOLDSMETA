import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type { Decision, SetupRecord } from "../types/models";
import { formatPrice, formatWhen } from "../lib/format";

export function SetupDetailPage() {
  const { setupId = "" } = useParams();
  const { api } = useAuth();
  const [setup, setSetup] = useState<SetupRecord | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const s = await api.getSetup(setupId);
        setSetup(s);
        if (s) {
          try {
            const d = await api.getDecision(s.decisionId);
            setDecision(d);
          } catch {
            // Setup outcomes are self-contained; decision link is optional.
            setDecision(null);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load setup");
      }
    })();
  }, [api, setupId]);

  if (error) {
    return (
      <div className="banner error" role="alert">
        {error}
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="card" role="status">
        Loading setup…
      </div>
    );
  }

  return (
    <div className="setup-detail-page">
      <p className="muted">
        <Link to="/history">← History</Link>
      </p>
      <h1 className="brand" style={{ fontSize: "1.4rem" }}>
        Setup {setup.direction}
      </h1>
      <p className="subtitle">
        {setup.environment} · {setup.session ?? "UNKNOWN"} · {setup.status.replaceAll("_", " ")}
      </p>

      <section className="card" data-testid="setup-levels">
        <h2 className="section-title">Levels</h2>
        <div className="price-row">
          <span>Entry</span>
          <strong>{formatPrice(setup.levels.entryPrice)}</strong>
        </div>
        <div className="price-row">
          <span>Stop</span>
          <strong>{formatPrice(setup.levels.stopLoss)}</strong>
        </div>
        <div className="price-row">
          <span>TP1</span>
          <strong>{formatPrice(setup.levels.tp1)}</strong>
        </div>
        <div className="price-row">
          <span>TP2</span>
          <strong>{formatPrice(setup.levels.tp2)}</strong>
        </div>
        <div className="price-row">
          <span>TP3</span>
          <strong>{formatPrice(setup.levels.tp3)}</strong>
        </div>
      </section>

      <section className="card" data-testid="setup-timeline">
        <h2 className="section-title">Status timeline</h2>
        <ul className="list timeline">
          {setup.statusHistory.map((t, i) => (
            <li key={`${t.at}-${t.to}-${i}`}>
              <strong>{t.to.replaceAll("_", " ")}</strong>
              <div className="muted">
                {formatWhen(t.at)}
                {t.barTime ? ` · bar ${formatWhen(t.barTime)}` : ""}
                {t.eventId ? ` · event ${t.eventId.slice(0, 8)}` : ""}
              </div>
              <div>{t.reason}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2 className="section-title">Excursion</h2>
        <div className="grid-2">
          <div className="metric">
            <span className="label">MFE</span>
            <span className="value">{setup.excursion.mfe ?? "—"}R</span>
          </div>
          <div className="metric">
            <span className="label">MAE</span>
            <span className="value">{setup.excursion.mae ?? "—"}R</span>
          </div>
        </div>
      </section>

      <section className="card" data-testid="setup-outcomes">
        <h2 className="section-title">Outcomes</h2>
        <div className="price-row">
          <span>Raw</span>
          <strong>
            {setup.outcome.rawResolution}
            {setup.outcome.rawRealisedR != null ? ` · ${setup.outcome.rawRealisedR}R` : ""}
          </strong>
        </div>
        <div className="price-row">
          <span>Modelled</span>
          <strong>
            {setup.outcome.modelledResolution}
            {setup.outcome.modelledRealisedR != null ? ` · ${setup.outcome.modelledRealisedR}R` : ""}
          </strong>
        </div>
        {setup.outcome.managementNotes.map((note) => (
          <p key={note} className="muted">
            {note}
          </p>
        ))}
      </section>

      <section className="card">
        <h2 className="section-title">Versions</h2>
        <p className="muted">Rules {setup.ruleConfigVersion}</p>
        <p className="muted">Backend {setup.backendVersion}</p>
        <p className="muted">Pine {setup.pineScriptVersion ?? "—"}</p>
        {decision && (
          <p>
            <Link to={`/history/${decision.decisionId}`}>Open original decision</Link>
          </p>
        )}
      </section>
    </div>
  );
}
