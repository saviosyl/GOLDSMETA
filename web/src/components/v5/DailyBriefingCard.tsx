import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { GlossaryTerm } from "./GlossaryTerm";
import { GoldMetaScoreCard } from "./GoldMetaScoreCard";
import { VerifiedDataMeta } from "./VerifiedDataMeta";

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
  symbol?: string;
  timeframe?: string;
  dataTimestamp?: string;
  environment?: string;
  strategyVersion?: string;
  mode?: string;
  freshness?: string;
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
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);

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
        const [b, s] = await Promise.all([api.v5Briefing("LIVE"), api.v5Score("LIVE")]);
        if (ac.signal.aborted) return;
        setBriefing(b as Briefing);
        setScore(s as Score | null);
        setLoadedAt(new Date().toISOString());
      } catch (err) {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Briefing unavailable");
      }
    })();
    return () => ac.abort();
  }, [api]);

  const freshness = !online
    ? "OFFLINE"
    : briefing?.insufficientData
      ? "PARTIAL"
      : ((briefing?.freshness as "VERIFIED") ?? "VERIFIED");

  return (
    <section className="card v5-glass" data-testid="daily-briefing">
      <div className="v5-section-head">
        <h2 className="section-title">Today&apos;s market briefing</h2>
        <Link className="muted" to="/intelligence">
          Ask why →
        </Link>
      </div>
      {!online && (
        <div className="banner stale" role="status" data-testid="briefing-offline">
          Offline — LIVE verification unavailable. Last stored data
          {loadedAt ? ` from ${loadedAt}` : ""} may be stale and must not be treated as current LIVE
          information.
        </div>
      )}
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {briefing?.insufficientData && (
        <p className="muted">Insufficient verified data for a full briefing.</p>
      )}
      {briefing && (
        <>
          <VerifiedDataMeta
            symbol={briefing.symbol ?? "XAUUSD"}
            timeframe={briefing.timeframe}
            dataTimestamp={briefing.dataTimestamp ?? loadedAt}
            environment={briefing.environment ?? "LIVE"}
            strategyVersion={briefing.strategyVersion}
            mode={briefing.mode ?? "SHADOW"}
            freshness={freshness}
            sources={["V3 latest decision", "V4 shadow analysis"]}
          />
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
        </>
      )}
      <GoldMetaScoreCard
        total={score?.total}
        components={score?.components}
        disclaimer={
          score?.disclaimer ??
          "GoldMeta Score is a rules-based setup-quality measurement. It is not the probability of a profitable trade."
        }
        dataTimestamp={briefing?.dataTimestamp ?? loadedAt}
        environment={briefing?.environment ?? "LIVE"}
        strategyVersion={briefing?.strategyVersion}
        mode="SHADOW"
        freshness={!online ? "OFFLINE" : "SHADOW"}
        insufficientData={!score || score.total == null}
      />
      <p className="muted">{briefing?.disclaimer}</p>
    </section>
  );
}
