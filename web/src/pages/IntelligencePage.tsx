import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Clock3, TrendingDown, TrendingUp } from "lucide-react";
import { useAuth } from "../lib/auth";
import { GlossaryTerm } from "../components/v5/GlossaryTerm";
import { VerifiedDataMeta } from "../components/v5/VerifiedDataMeta";
import {
  DisclosurePanel,
  PageHeader,
  SectionCard,
  StatusBadge
} from "../components/ui/primitives";
import { fmtPrice } from "../lib/intradayFormat";
import { formatSession } from "../lib/plainLanguage";
import type { Decision } from "../types/models";

type Answer = {
  question?: string;
  answer?: string;
  verifiedFacts?: string[];
  explanations?: string[];
  insufficientData?: boolean;
  disclaimer?: string;
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
  const [decision, setDecision] = useState<Decision | null>(null);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    const reviewOffline = document.documentElement.dataset.uiReviewOffline === "1";
    if (reviewOffline) {
      setOnline(false);
      return;
    }
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
        const [c, p, pack] = await Promise.all([
          api.v5WeeklyCoach("LIVE"),
          api.v5Personal(),
          typeof api.latestDecisionPack === "function"
            ? api.latestDecisionPack().catch(() => null)
            : Promise.resolve(null)
        ]);
        if (ac.signal.aborted) return;
        setCoach(c);
        setPersonal(p);
        setDecision((pack as { decision?: Decision } | null)?.decision ?? null);
      } catch {
        /* non-fatal */
      }
    })();
    return () => ac.abort();
  }, [api]);

  const livePrice = decision?.lastKnownPrice ?? decision?.ohlcv?.close ?? null;
  const openPrice = decision?.ohlcv?.open ?? null;
  const changePts =
    livePrice != null && openPrice != null && Number.isFinite(livePrice) && Number.isFinite(openPrice)
      ? livePrice - openPrice
      : null;
  const changePct =
    changePts != null && openPrice != null && openPrice !== 0
      ? (changePts / openPrice) * 100
      : null;
  const sessionLabel = formatSession(decision?.currentSession);
  const changeTone =
    changePts == null ? "" : changePts > 0 ? "tone-green" : changePts < 0 ? "tone-red" : "";

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
    <div className="v5-page gm-markets-page gm-premium-v2" data-testid="intelligence-page">
      <PageHeader title="Markets" environment="LIVE" freshness={online ? "Online" : "Offline"} />

      <header className="gm-page-hero-navy gm-markets-summary" data-testid="markets-xauusd-summary">
        <div>
          <span className="gm-label" style={{ color: "rgba(255,255,255,0.65)" }}>
            XAUUSD
          </span>
          <strong data-testid="markets-live-price" style={{ fontSize: "1.6rem", fontWeight: 800 }}>
            {livePrice != null ? fmtPrice(livePrice) : "—"}
          </strong>
          <p
            className={`gm-markets-change ${changeTone}`.trim()}
            data-testid="markets-price-change"
            style={{ margin: "6px 0 0", fontWeight: 700 }}
          >
            {changePts != null && changePct != null ? (
              <>
                {changePts > 0 ? (
                  <TrendingUp size={16} aria-hidden />
                ) : changePts < 0 ? (
                  <TrendingDown size={16} aria-hidden />
                ) : null}{" "}
                {changePts > 0 ? "+" : ""}
                {changePts.toFixed(2)} ({changePct > 0 ? "+" : ""}
                {changePct.toFixed(2)}%)
              </>
            ) : (
              "Change unavailable"
            )}
          </p>
        </div>
        <div className="gm-markets-session" data-testid="markets-session">
          <Clock3 size={16} aria-hidden />
          <span>{sessionLabel}</span>
        </div>
      </header>

      <SectionCard title="Market in plain English" className="gm-card-v2">
        <p data-testid="markets-plain-english" style={{ marginTop: 0 }}>
          {answer?.answer
            ? answer.answer
            : "Ask a verified question below, or open Today’s Plan for the actionable levels."}
        </p>
        <p className="gm-meta" style={{ marginBottom: 12 }}>
          XAUUSD · session context · 4H / 1H / 15M bias. Unavailable fields stay Unavailable — never
          estimated as fact.
        </p>
        <Link className="gm-btn-outline" to="/" data-testid="view-todays-plan-btn">
          View today&apos;s plan
        </Link>
      </SectionCard>
      <p className="gm-meta" style={{ marginTop: 8, marginBottom: 16 }} data-testid="intelligence-impl-type">
        Deterministic market context (not an AI chatbot). Analysis only · AutoTrade OFF.
      </p>
      {!online && (
        <div className="banner stale" role="status" data-testid="offline-status">
          Offline — LIVE verification unavailable. Any cached answers may be stale.
        </div>
      )}

      <div className="gm-two-col">
        <SectionCard title="Ask GoldMeta">
          <form onSubmit={onAsk} className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
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
              {answer.insufficientData && (
                <div className="banner stale">Insufficient verified data</div>
              )}
              <p>{answer.answer}</p>
              <h3 className="gm-section-title">Explanation</h3>
              <ul className="list">
                {(answer.explanations ?? []).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <p className="gm-meta">{answer.disclaimer}</p>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Verified context">
          {answer ? (
            <>
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
                missingWarning={answer.insufficientData ? "Insufficient verified data." : null}
              />
              <h3 className="gm-section-title">Verified data</h3>
              <ul className="list">
                {(answer.verifiedFacts ?? []).map((f) => (
                  <li key={f}>{f}</li>
                ))}
                {(answer.verifiedFacts ?? []).length === 0 && <li className="gm-meta">None</li>}
              </ul>
            </>
          ) : (
            <p className="gm-meta">Ask a question to load verified context for this session.</p>
          )}
          <p className="gm-meta" style={{ marginTop: 12 }}>
            Glossary: <GlossaryTerm term="POC">POC</GlossaryTerm>,{" "}
            <GlossaryTerm term="ATR">ATR</GlossaryTerm>, <GlossaryTerm term="VAH">VAH</GlossaryTerm>
          </p>
        </SectionCard>
      </div>

      <SectionCard title="Weekly coach & personal stats">
        {!coach ? (
          <p className="gm-meta">Loading coach…</p>
        ) : (
          <>
            <p>{String(coach.summary ?? "")}</p>
            {Boolean(coach.insufficientData) && (
              <StatusBadge tone="warning">Insufficient verified data</StatusBadge>
            )}
          </>
        )}
        {personal && (
          <div className="gm-metrics-grid" style={{ marginTop: 12 }}>
            <div className="gm-metric">
              <span className="gm-label">Ignored WAIT tags</span>
              <span className="gm-metric-value">{String(personal.ignoredWait ?? 0)}</span>
            </div>
            <div className="gm-metric">
              <span className="gm-label">Avg R</span>
              <span className="gm-metric-value">{String(personal.averageR ?? "—")}</span>
            </div>
          </div>
        )}
      </SectionCard>

      {SCREENSHOT_ENABLED ? (
        <div data-testid="screenshot-section">
          <SectionCard title="Screenshot Comparison — Beta">
            <DisclosurePanel summary="Open screenshot comparison (Beta)">
              <p className="gm-meta" data-testid="screenshot-beta-copy">
                This does <strong>not</strong> automatically read exact prices from the image. It does{" "}
                <strong>not</strong> use screenshot values as verified market data. It compares
                user-provided context against verified GoldMeta data. It cannot create or modify a
                setup. Vision OCR remains future work.
              </p>
              <ScreenshotCompare />
            </DisclosurePanel>
          </SectionCard>
        </div>
      ) : (
        <section className="gm-section" data-testid="screenshot-disabled">
          <p className="gm-meta">Screenshot comparison disabled.</p>
        </section>
      )}
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
        <input
          value={session}
          onChange={(e) => setSession(e.target.value)}
          aria-label="Observed session"
        />
      </label>
      <label className="field">
        <span>Visible POC (optional)</span>
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
          <p className="gm-meta">Creates trade: {String(result.createsTrade)}</p>
          <p className="gm-meta" data-testid="screenshot-no-vision">
            No automatic vision OCR was performed.
          </p>
        </div>
      )}
    </div>
  );
}
