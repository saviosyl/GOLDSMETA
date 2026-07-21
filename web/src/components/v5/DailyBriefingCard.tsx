import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { GlossaryTerm } from "./GlossaryTerm";

type Briefing = {
  date?: string;
  session?: string | null;
  marketRegime?: string | null;
  positionVsPoc?: string;
  atrLabel?: string;
  atrValue?: number | null;
  levels?: { poc?: number | null; vah?: number | null; val?: number | null };
  bias?: string | null;
  news?: string;
  currentState?: string;
  verifiedFacts?: string[];
  insufficientData?: boolean;
  disclaimer?: string;
};

type Score = {
  total?: number;
  components?: Array<{ label: string; score: number; max: number; reason: string }>;
  disclaimer?: string;
};

/** First-viewport daily briefing — no trade creation. */
export function DailyBriefingCard() {
  const { api } = useAuth();
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [score, setScore] = useState<Score | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [b, s] = await Promise.all([api.v5Briefing("LIVE"), api.v5Score("LIVE")]);
        setBriefing(b);
        setScore(s);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Briefing unavailable");
      }
    })();
  }, [api]);

  return (
    <section className="card v5-glass" data-testid="daily-briefing">
      <div className="v5-section-head">
        <h2 className="section-title">Today&apos;s market briefing</h2>
        <Link className="muted" to="/intelligence">
          Ask why →
        </Link>
      </div>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {briefing?.insufficientData && (
        <p className="muted">Insufficient verified data for a full briefing.</p>
      )}
      {briefing && (
        <div className="grid-2">
          <div className="metric">
            <span className="label">Session</span>
            <span className="value">{briefing.session ?? "—"}</span>
          </div>
          <div className="metric">
            <span className="label">Regime</span>
            <span className="value">{briefing.marketRegime ?? "—"}</span>
          </div>
          <div className="metric">
            <span className="label">
              vs <GlossaryTerm term="POC">POC</GlossaryTerm>
            </span>
            <span className="value">{briefing.positionVsPoc ?? "UNKNOWN"}</span>
          </div>
          <div className="metric">
            <span className="label">
              <GlossaryTerm term="ATR">ATR</GlossaryTerm>
            </span>
            <span className="value">
              {briefing.atrLabel ?? "—"}
              {briefing.atrValue != null ? ` (${briefing.atrValue})` : ""}
            </span>
          </div>
          <div className="metric">
            <span className="label">Levels</span>
            <span className="value">
              {briefing.levels?.poc ?? "—"} / {briefing.levels?.vah ?? "—"} /{" "}
              {briefing.levels?.val ?? "—"}
            </span>
          </div>
          <div className="metric">
            <span className="label">State</span>
            <span className="value">{briefing.currentState ?? "—"}</span>
          </div>
        </div>
      )}
      {score && (
        <div className="v5-score-block" data-testid="goldmeta-score">
          <div className="price-row">
            <span>GoldMeta Score</span>
            <strong>{score.total ?? "—"} / 100</strong>
          </div>
          <p className="muted">{score.disclaimer}</p>
          <ul className="list compact">
            {(score.components ?? []).slice(0, 6).map((c) => (
              <li key={c.label}>
                <strong>
                  {c.label} {c.score}/{c.max}
                </strong>
                <div className="muted">{c.reason}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="muted">{briefing?.disclaimer}</p>
    </section>
  );
}
