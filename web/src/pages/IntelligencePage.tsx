import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { GlossaryTerm } from "../components/v5/GlossaryTerm";

type Answer = {
  question?: string;
  answer?: string;
  verifiedFacts?: string[];
  explanations?: string[];
  insufficientData?: boolean;
  disclaimer?: string;
};

/** GoldMeta Market Intelligence — not a generic chatbot. */
export function IntelligencePage() {
  const { api } = useAuth();
  const [question, setQuestion] = useState("Why are we waiting?");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [coach, setCoach] = useState<Record<string, unknown> | null>(null);
  const [personal, setPersonal] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [c, p] = await Promise.all([api.v5WeeklyCoach("LIVE"), api.v5Personal()]);
        setCoach(c);
        setPersonal(p);
      } catch {
        /* non-fatal */
      }
    })();
  }, [api]);

  const onAsk = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const a = await api.v5Ask(question, "LIVE");
      setAnswer(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ask failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="v5-page" data-testid="intelligence-page">
      <h1 className="brand" style={{ fontSize: "1.45rem" }}>
        Market Intelligence
      </h1>
      <p className="subtitle">
        GoldMeta-specific assistant. Distinguishes <em>Verified data</em> from{" "}
        <em>Explanation</em>. Never invents prices.
      </p>

      <section className="card v5-glass">
        <h2 className="section-title">Ask GoldMeta</h2>
        <form onSubmit={onAsk} className="form-grid">
          <label className="field">
            <span>Question</span>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
              aria-label="Intelligence question"
            />
          </label>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Thinking…" : "Ask"}
          </button>
        </form>
        <div className="chip-row">
          {[
            "Why are we waiting?",
            "Why was this rejected?",
            "Why is risk geometry invalid?",
            "What changed since the previous candle?",
            "How has Strategy A historically performed?"
          ].map((q) => (
            <button key={q} type="button" className="chip" onClick={() => setQuestion(q)}>
              {q}
            </button>
          ))}
        </div>
        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}
        {answer && (
          <div className="v5-answer" data-testid="intelligence-answer">
            {answer.insufficientData && (
              <div className="banner stale">Insufficient verified data</div>
            )}
            <p>{answer.answer}</p>
            <h3 className="section-title">Verified data</h3>
            <ul className="list">
              {(answer.verifiedFacts ?? []).map((f) => (
                <li key={f}>{f}</li>
              ))}
              {(answer.verifiedFacts ?? []).length === 0 && <li className="muted">None</li>}
            </ul>
            <h3 className="section-title">Explanation</h3>
            <ul className="list">
              {(answer.explanations ?? []).map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <p className="muted">{answer.disclaimer}</p>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">Screenshot compare</h2>
        <p className="muted">
          Upload observations from a TradingView screenshot. Compared to verified live data. Never
          creates a trade.
        </p>
        <ScreenshotCompare />
      </section>

      <section className="card v5-glass">
        <h2 className="section-title">Weekly coach</h2>
        {!coach ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <p>{String(coach.summary ?? "")}</p>
            {Boolean(coach.insufficientData) && (
              <div className="banner stale">Insufficient verified data</div>
            )}
            <p className="muted">{String(coach.disclaimer ?? "")}</p>
          </>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">Personal performance (private)</h2>
        {!personal ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="grid-2">
            <div className="metric">
              <span className="label">Ignored WAIT tags</span>
              <span className="value">{String(personal.ignoredWait ?? 0)}</span>
            </div>
            <div className="metric">
              <span className="label">Avg R</span>
              <span className="value">{String(personal.averageR ?? "—")}</span>
            </div>
            <div className="metric">
              <span className="label">Win streak</span>
              <span className="value">{String(personal.largestWinningStreak ?? 0)}</span>
            </div>
            <div className="metric">
              <span className="label">Lose streak</span>
              <span className="value">{String(personal.largestLosingStreak ?? 0)}</span>
            </div>
          </div>
        )}
        <p className="muted">{String(personal?.sampleWarning ?? "")}</p>
      </section>

      <section className="card">
        <h2 className="section-title">Glossary</h2>
        <p className="muted">
          Tap{" "}
          <GlossaryTerm term="POC">POC</GlossaryTerm>,{" "}
          <GlossaryTerm term="ATR">ATR</GlossaryTerm>,{" "}
          <GlossaryTerm term="VAH">VAH</GlossaryTerm>,{" "}
          <GlossaryTerm term="Failed Auction">Failed Auction</GlossaryTerm>.
        </p>
      </section>
    </div>
  );
}

function ScreenshotCompare() {
  const { api } = useAuth();
  const [trend, setTrend] = useState("bullish");
  const [session, setSession] = useState("LONDON");
  const [poc, setPoc] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const run = async () => {
    const res = await api.v5ScreenshotAnalyse({
      observations: {
        trend,
        session,
        visibleVolumeProfile: poc ? { poc: Number(poc) } : null,
        imageMeta: { filename: "tradingview.png", uploadedAt: new Date().toISOString() }
      },
      environment: "LIVE"
    });
    setResult(res);
  };

  return (
    <div className="form-grid">
      <label className="field">
        <span>Observed trend</span>
        <input value={trend} onChange={(e) => setTrend(e.target.value)} />
      </label>
      <label className="field">
        <span>Observed session</span>
        <input value={session} onChange={(e) => setSession(e.target.value)} />
      </label>
      <label className="field">
        <span>Visible POC (optional)</span>
        <input value={poc} onChange={(e) => setPoc(e.target.value)} inputMode="decimal" />
      </label>
      <button type="button" className="btn" onClick={() => void run()}>
        Compare to verified data
      </button>
      {result && (
        <div data-testid="screenshot-result">
          <p className="muted">Creates trade: {String(result.createsTrade)}</p>
          <ul className="list">
            {((result.agreements as string[]) ?? []).map((a) => (
              <li key={a}>Agree: {a}</li>
            ))}
            {((result.disagreements as string[]) ?? []).map((a) => (
              <li key={a}>Disagree: {a}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
