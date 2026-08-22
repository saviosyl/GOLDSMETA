import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3, History as HistoryIcon, TrendingUp } from "lucide-react";
import { useAuth } from "../lib/auth";
import type { SetupAnalyticsSummary } from "../types/models";
import { HistoryPage } from "./HistoryPage";

function pct(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : `${Math.round(value * 100)}%`;
}

function r(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}R`;
}

export function HistoryHubPage() {
  const { api, account } = useAuth();
  const [analytics, setAnalytics] = useState<SetupAnalyticsSummary | null>(null);
  const isStaff = account?.role === "OWNER" || account?.role === "ADMIN";

  useEffect(() => {
    let cancelled = false;
    void api.setupAnalytics("LIVE")
      .then((value) => {
        if (!cancelled) setAnalytics(value);
      })
      .catch(() => {
        if (!cancelled) setAnalytics(null);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return (
    <div className="gm26-page gm26-history-page" data-testid="gm26-history-page">
      <div className="gm26-page-heading">
        <div>
          <span className="gm26-eyebrow">PERFORMANCE & REVIEW</span>
          <h1>History</h1>
        </div>
      </div>

      <section className="gm26-history-kpis" aria-label="Signal performance summary">
        <article>
          <HistoryIcon aria-hidden />
          <span>Completed setups</span>
          <strong>{analytics?.completedSetups ?? "—"}</strong>
        </article>
        <article>
          <TrendingUp aria-hidden />
          <span>Win rate</span>
          <strong>{pct(analytics?.winRate)}</strong>
        </article>
        <article>
          <BarChart3 aria-hidden />
          <span>Expectancy</span>
          <strong>{r(analytics?.expectancyR)}</strong>
        </article>
        <article>
          <span>Profit factor</span>
          <strong>{analytics?.profitFactorR != null ? analytics.profitFactorR.toFixed(2) : "—"}</strong>
        </article>
      </section>

      <div className="gm26-history-context">
        <div>
          <strong>GoldMeta signal history</strong>
          <span>Hypothetical/manual signal outcomes are kept separate from broker-confirmed Gold Hunter Demo P/L.</span>
        </div>
        {isStaff ? <Link to="/gold-hunter/performance">Gold Hunter performance →</Link> : null}
      </div>

      <section className="gm26-card gm26-history-shell">
        <HistoryPage embedded />
      </section>
    </div>
  );
}
