import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { GlossaryTerm } from "../components/v5/GlossaryTerm";
import { VerifiedDataMeta } from "../components/v5/VerifiedDataMeta";

type Answer = {
  question?: string;
  answer?: string;
  verifiedFacts?: string[];
  explanations?: string[];
  insufficientData?: boolean;
  disclaimer?: string;
  implementationType?: string;
  symbol?: string;
  timeframe?: string;
  dataTimestamp?: string;
  environment?: string;
  strategyVersion?: string;
  mode?: string;
  freshness?: string;
};

const SCREENSHOT_ENABLED =
  String(import.meta.env.VITE_V5_SCREENSHOT_COMPARISON_ENABLED ?? "true").toLowerCase() !==
  "false";

/** GoldMeta Market Intelligence — deterministic rules/templated retrieval (not an LLM). */
export function IntelligencePage() {
  const { api } = useAuth();
  const [question, setQuestion] = useState("Why are we waiting?");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [coach, setCoach] = useState<Record<string, unknown> | null>(null);
  const [personal, setPersonal] = useState<Record<string, unknown> | null>(null);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const [c, p] = await Promise.all([api.v5WeeklyCoach("LIVE"), api.v5Personal()]);
        if (ac.signal.aborted) return;
        setCoach(c);
        setPersonal(p);
      } catch {
        /* non-fatal */
      }
    })();
    return () => ac.abort();
  }, [api]);

  const onAsk = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const a = await api.v5Ask(question, "LIVE");
      setAnswer(a as Answer);
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
        Deterministic GoldMeta explanations — rules-based retrieval and templated answers. Distinguishes{" "}
        <em>Verified data</em> from <em>Explanation</em>. Never invents prices. Not an AI chatbot (
        <code>AI_ENABLED=false</code>).
      </p>
      {!online && (
        <div className="banner stale" role="status" data-testid="offline-status">
          Offline — LIVE verification unavailable. Any cached answers may be stale.
        </div>
      )}

      <section className="card v5-glass">
        <h2 className="section-title">Ask GoldMeta</h2>
        <p className="muted" data-testid="intelligence-impl-type">
          Implementation: deterministic / rules-based / templated (no external AI model).
        </p>
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
          <button className="btn primary" type="submit" disabled={busy || !online}>
            {busy ? "Working…" : "Ask"}
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
            <VerifiedDataMeta
              symbol={answer.symbol ?? "XAUUSD"}
              timeframe={answer.timeframe}
              dataTimestamp={answer.dataTimestamp}
              environment={answer.environment ?? "LIVE"}
              strategyVersion={answer.strategyVersion}
              mode={answer.mode ?? "SHADOW"}
              freshness={
                !online
                  ? "OFFLINE"
                  : answer.insufficientData
                    ? "PARTIAL"
                    : ((answer.freshness as "VERIFIED") ?? "VERIFIED")
              }
              sources={["V3 decision", "V4 shadow analysis"]}
              missingWarning={
                answer.insufficientData ? "Insufficient verified data." : null
              }
            />
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

      {SCREENSHOT_ENABLED ? (
        <section className="card" data-testid="screenshot-section">
          <h2 className="section-title">Screenshot Comparison — Beta</h2>
          <p className="muted" data-testid="screenshot-beta-copy">
            This does <strong>not</strong> automatically read exact prices from the image. It does{" "}
            <strong>not</strong> use screenshot values as verified market data. It compares
            user-provided context against verified GoldMeta data. It cannot create or modify a
            setup. Vision OCR / automatic TradingView chart analysis remains future work.
          </p>
          <ScreenshotCompare />
        </section>
      ) : (
        <section className="card" data-testid="screenshot-disabled">
          <h2 className="section-title">Screenshot Comparison</h2>
          <p className="muted">Disabled (`VITE_V5_SCREENSHOT_COMPARISON_ENABLED=false`).</p>
        </section>
      )}

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
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
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
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-grid">
      <label className="field">
        <span>Observed trend (user-provided)</span>
        <input value={trend} onChange={(e) => setTrend(e.target.value)} aria-label="Observed trend" />
      </label>
      <label className="field">
        <span>Observed session (user-provided)</span>
        <input value={session} onChange={(e) => setSession(e.target.value)} aria-label="Observed session" />
      </label>
      <label className="field">
        <span>Visible POC (optional, user-provided)</span>
        <input
          value={poc}
          onChange={(e) => setPoc(e.target.value)}
          inputMode="decimal"
          aria-label="Visible POC"
        />
      </label>
      <button type="button" className="btn" disabled={busy} onClick={() => void run()}>
        Compare to verified data
      </button>
      {result && (
        <div data-testid="screenshot-result">
          <p className="muted">Creates trade: {String(result.createsTrade)}</p>
          <p className="muted" data-testid="screenshot-no-vision">
            No automatic vision OCR was performed.
          </p>
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
