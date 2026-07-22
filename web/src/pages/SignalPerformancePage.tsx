import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type { SignalPerformanceSummary } from "../types/models";

function fmt(n: number | null | undefined, suffix = ""): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n}${suffix}`;
}

export function SignalPerformancePage() {
  const { api } = useAuth();
  const [summary, setSummary] = useState<SignalPerformanceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setSummary(await api.signalPerformance());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load performance");
      }
    })();
  }, [api]);

  return (
    <div className="signal-perf-page" data-testid="signal-performance-page">
      <Link to="/history" className="muted">
        ← Signal history
      </Link>
      <h1 className="brand" style={{ fontSize: "1.4rem", marginTop: "0.75rem" }}>
        Hypothetical signal performance
      </h1>
      <p className="muted" data-testid="perf-disclaimer">
        {summary?.disclaimer ??
          "Past hypothetical results do not guarantee future trading performance."}
      </p>
      <p className="muted">
        Confidence is a setup-confidence score, not the probability of profit. WAIT signals are
        excluded from trade statistics. Ambiguous intrabar results are shown separately.
      </p>
      {error && (
        <div className="banner stale" role="alert">
          {error}
        </div>
      )}
      {!summary ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="signal-perf-grid" data-testid="signal-perf-grid">
          {(
            [
              ["Confirmed BUY/SELL", summary.totalConfirmedBuySell],
              ["Pending entries", summary.pendingEntries],
              ["Open", summary.openSignals],
              ["Closed", summary.closedSignals],
              ["Wins", summary.wins],
              ["Losses", summary.losses],
              ["Breakeven", summary.breakeven],
              ["Expired", summary.expired],
              ["Cancelled", summary.cancelled],
              ["Ambiguous", summary.ambiguousIntrabar],
              ["Data unavailable", summary.dataUnavailable],
              ["WAIT only", summary.waitOnly],
              ["Win rate", fmt(summary.winRate, "%")],
              ["Net points", summary.netPoints],
              ["Net R", summary.netR],
              ["Avg win", fmt(summary.averageWin)],
              ["Avg loss", fmt(summary.averageLoss)],
              ["Profit factor", fmt(summary.profitFactor)],
              ["Max DD (R)", summary.maximumDrawdownR],
              ["Max loss streak", summary.maximumConsecutiveLosses],
              ["TP1 hit rate", fmt(summary.tp1HitRate, "%")],
              ["TP2 hit rate", fmt(summary.tp2HitRate, "%")],
              ["TP3 hit rate", fmt(summary.tp3HitRate, "%")],
              ["Stop rate", fmt(summary.stopLossRate, "%")],
              ["BUY count", summary.byDirection.BUY],
              ["SELL count", summary.byDirection.SELL]
            ] as Array<[string, string | number]>
          ).map(([label, value]) => (
            <div className="signal-perf-card" key={label}>
              <div className="muted">{label}</div>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      )}
      <p className="muted" style={{ marginTop: "1rem" }}>
        Label: {summary?.label ?? "HYPOTHETICAL SIGNAL PERFORMANCE"}
      </p>
    </div>
  );
}
