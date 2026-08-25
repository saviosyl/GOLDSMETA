import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../lib/auth";
import type { Decision } from "../types/models";
import {
  explainReasonCode,
  formatPercent,
  formatPrice,
  formatWhen,
  primaryReason,
  recommendedActionLabel,
  tradePlanEntryLabel,
  tradePlanRrLabel,
  tradePlanStopLabel,
  tradePlanTpLabel,
  trendLabel
} from "../lib/decisionDisplay";
import { cacheKeys, loadCache, saveCache } from "../lib/offlineCache";
import { evidencePlain, isRawEngineEvidence } from "../lib/evidencePlain";
import { plainReason } from "../lib/reasonCodePlain";

function FactorCard({
  title,
  testId,
  children
}: {
  title: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <section className="gm-prem-card gm-analysis-factor" data-testid={testId}>
      <h2 className="gm-analysis-factor__title">{title}</h2>
      {children}
    </section>
  );
}

export function AnalysisPage() {
  const { api } = useAuth();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const latest = await api.latestDecision();
        setDecision(latest);
        setError(null);
        if (latest) {
          saveCache(cacheKeys.decision, latest);
        }
      } catch (err) {
        const cached = loadCache<Decision>(cacheKeys.decision);
        setDecision(cached?.value ?? null);
        setError(err instanceof Error ? err.message : "Failed to load analysis");
      }
    })();
  }, [api]);

  if (!decision) {
    return (
      <div className="analysis-page gm-prem-page">
        <h1 className="gm-prem-page-head">Full analysis</h1>
        <div className="gm-prem-card">
          <p className="muted">{error ?? "No decision available."}</p>
        </div>
      </div>
    );
  }

  const supporting =
    decision.decision === "SELL" ? decision.bearishEvidence : decision.bullishEvidence;
  const opposing =
    decision.decision === "SELL" ? decision.bullishEvidence : decision.bearishEvidence;
  const structure = decision.marketStructure;

  return (
    <div className="analysis-page gm-prem-page">
      <header className="gm-prem-page-head">
        <div>
          <h1>Full analysis</h1>
          <p>Decision factors, trade plan, and risk context for the latest signal</p>
        </div>
      </header>

      {error && (
        <div className="banner stale" role="status">
          {error} — showing cached analysis if available.
        </div>
      )}

      <section
        className="gm-prem-card gm-prem-card--hero gm-analysis-hero"
        data-testid="analysis-summary"
        aria-label="Decision summary"
      >
        <div className="gm-analysis-hero__top">
          <div>
            <p className="gm-label">{decision.symbol}</p>
            <h2 className={`gm-analysis-decision gm-analysis-decision--${decision.decision.toLowerCase()}`}>
              {decision.decision}
            </h2>
            <p className="gm-meta">{formatWhen(decision.generatedAt)}</p>
          </div>
          <div className="gm-prem-stat-grid gm-prem-stat-grid--3 gm-analysis-hero__stats">
            <div className="gm-prem-stat">
              <span>Grade</span>
              <strong>{decision.setupGrade ?? "—"}</strong>
            </div>
            <div className="gm-prem-stat">
              <span>Confidence</span>
              <strong>{formatPercent(decision.confidence)}</strong>
            </div>
            <div className="gm-prem-stat">
              <span>Action</span>
              <strong>{recommendedActionLabel(decision)}</strong>
            </div>
          </div>
        </div>
        <p className="gm-analysis-summary">{decision.explanation ?? primaryReason(decision)}</p>
      </section>

      <div className="gm-analysis-factor-grid">
        <FactorCard title="Decision drivers" testId="analysis-drivers">
          <p className="gm-label">Why this decision</p>
          <ul className="gm-analysis-chip-list">
            {decision.reasonCodes.map((code) => (
              <li key={code}>{explainReasonCode(code)}</li>
            ))}
          </ul>
          <div className="gm-analysis-evidence-grid">
            <div>
              <p className="gm-label">Supporting</p>
              <ul className="list" data-testid="analysis-supporting">
                {(supporting.length ? supporting : ["None listed"]).map((item) => (
                  <li key={item}>{evidencePlain(item)}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="gm-label">Opposing</p>
              <ul className="list" data-testid="analysis-opposing">
                {(opposing.length ? opposing : ["None listed"]).map((item) => (
                  <li key={item}>{evidencePlain(item)}</li>
                ))}
              </ul>
            </div>
          </div>
          <details className="gm-disclosure" data-testid="analysis-advanced-technical" style={{ marginTop: 12 }}>
            <summary>Advanced technical details</summary>
            <p className="gm-label">Raw reason codes</p>
            <pre className="muted">{decision.reasonCodes.join(", ") || "—"}</pre>
            <p className="gm-label">Raw engine evidence</p>
            <ul className="list">
              {[...supporting, ...opposing]
                .filter((item) => isRawEngineEvidence(item))
                .map((item) => (
                  <li key={item}>
                    <code>{item}</code>
                    <span className="gm-meta"> — {plainReason(item)}</span>
                  </li>
                ))}
              {[...supporting, ...opposing].filter((item) => isRawEngineEvidence(item)).length ===
              0 ? (
                <li className="gm-meta">None</li>
              ) : null}
            </ul>
          </details>
        </FactorCard>

        <FactorCard title="Market context" testId="analysis-market">
          <div className="gm-prem-stat-grid gm-prem-stat-grid--2">
            <div className="gm-prem-stat">
              <span>Regime</span>
              <strong>{decision.marketRegime.replace(/_/g, " ")}</strong>
            </div>
            <div className="gm-prem-stat">
              <span>Trend</span>
              <strong>{trendLabel(decision)}</strong>
            </div>
            <div className="gm-prem-stat">
              <span>Session</span>
              <strong>{decision.currentSession ?? "—"}</strong>
            </div>
            <div className="gm-prem-stat">
              <span>Data quality</span>
              <strong>{decision.dataQuality}</strong>
            </div>
          </div>
          {structure ? (
            <div className="gm-prem-stat-grid gm-prem-stat-grid--3" style={{ marginTop: 12 }}>
              <div className="gm-prem-stat">
                <span>POC</span>
                <strong>{formatPrice(structure.poc)}</strong>
              </div>
              <div className="gm-prem-stat">
                <span>VAH</span>
                <strong>{formatPrice(structure.vah)}</strong>
              </div>
              <div className="gm-prem-stat">
                <span>VAL</span>
                <strong>{formatPrice(structure.val)}</strong>
              </div>
            </div>
          ) : null}
        </FactorCard>

        <FactorCard title="Trade plan" testId="analysis-trade-plan">
          <dl className="gm-analysis-dl">
            <div>
              <dt>Entry</dt>
              <dd>{tradePlanEntryLabel(decision)}</dd>
            </div>
            <div>
              <dt>Stop loss</dt>
              <dd>{tradePlanStopLabel(decision)}</dd>
            </div>
            <div>
              <dt>TP1</dt>
              <dd>{tradePlanTpLabel(decision, "TP1")}</dd>
            </div>
            <div>
              <dt>TP2</dt>
              <dd>{tradePlanTpLabel(decision, "TP2")}</dd>
            </div>
            <div>
              <dt>TP3</dt>
              <dd>{tradePlanTpLabel(decision, "TP3")}</dd>
            </div>
            <div>
              <dt>Risk / reward</dt>
              <dd>{tradePlanRrLabel(decision)}</dd>
            </div>
          </dl>
        </FactorCard>

        <FactorCard title="Warnings & invalidation" testId="analysis-warnings">
          <p className="gm-label">Warnings</p>
          <ul className="list">
            {(decision.warnings.length ? decision.warnings : ["None"]).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p className="gm-label" style={{ marginTop: 12 }}>
            Invalidation
          </p>
          <p className="gm-meta">{decision.invalidation}</p>
          {(decision.missingInputs?.length ?? 0) > 0 ? (
            <>
              <p className="gm-label" style={{ marginTop: 12 }}>
                Missing inputs
              </p>
              <ul className="list">
                {decision.missingInputs.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}
        </FactorCard>

        <FactorCard title="Disclaimer" testId="analysis-disclaimer">
          <p className="gm-meta">{decision.disclaimer}</p>
          {decision.analysisOnly !== false ? (
            <p className="gm-meta" style={{ marginTop: 8 }}>
              Analysis only — not an executed broker order.
            </p>
          ) : null}
        </FactorCard>
      </div>
    </div>
  );
}
