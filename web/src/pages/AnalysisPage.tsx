import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import type { Decision } from "../types/models";
import { explainReasonCode, formatWhen, primaryReason } from "../lib/decisionDisplay";
import { cacheKeys, loadCache, saveCache } from "../lib/offlineCache";

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
      <div className="card">
        <h2>Full analysis</h2>
        <p className="muted">{error ?? "No decision available."}</p>
      </div>
    );
  }

  return (
    <div className="analysis-page">
      <h1 className="brand" style={{ fontSize: "1.4rem" }}>
        Full analysis
      </h1>
      {error && (
        <div className="banner stale" role="status">
          {error} — showing cached analysis if available.
        </div>
      )}
      <div className="card">
        <h2>
          {decision.decision} · {decision.setupGrade ?? "—"}
        </h2>
        <p className="muted">{formatWhen(decision.generatedAt)}</p>
        <p>{decision.explanation ?? primaryReason(decision)}</p>
        <h3>Why this decision</h3>
        <ul className="list">
          {decision.reasonCodes.map((code) => (
            <li key={code}>{explainReasonCode(code)}</li>
          ))}
        </ul>
        <h3>Warnings</h3>
        <ul className="list">
          {(decision.warnings.length ? decision.warnings : ["None"]).map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        <h3>Invalidation</h3>
        <p className="muted">{decision.invalidation}</p>
        <h3>Disclaimer</h3>
        <p className="muted">{decision.disclaimer}</p>
      </div>
    </div>
  );
}
