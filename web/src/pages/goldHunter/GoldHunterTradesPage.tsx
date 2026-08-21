import { useEffect, useState } from "react";
import type { GoldHunterTrade } from "../../lib/api";
import { formatResearchLocalTime } from "../../lib/formatResearchLocalTime";
import { formatEur, useGoldHunter } from "./GoldHunterShell";

function px(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

export function GoldHunterTradesPage() {
  const { status } = useGoldHunter();
  const [trades, setTrades] = useState<GoldHunterTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const { api } = requireAuthApi();

  useEffect(() => {
    let cancelled = false;
    void api.goldHunterTrades()
      .then((result) => {
        if (!cancelled) setTrades(result.trades);
      })
      .catch(() => {
        if (!cancelled) setTrades([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, status?.openTrades.length]);

  if (!status) return null;
  const open = status.openTrades[0] ?? null;

  return (
    <div className="gh26-page" data-testid="gh26-trades">
      <div className="gh26-page-head">
        <div><span className="gh26-eyebrow">BROKER-CONFIRMED DEMO ACTIVITY</span><h1>Trades</h1></div>
        <span className="gh26-mode-badge">DEMO ONLY</span>
      </div>

      <section className="gh26-card gh26-open-trade">
        <div className="gh26-card-head">
          <div><span className="gh26-eyebrow">CURRENT POSITION</span><h2>{open ? `${open.side} · Setup ${open.setup ?? "—"}` : "No open Gold Hunter trade"}</h2></div>
          {open ? <strong className={open.netPnlEur != null && open.netPnlEur < 0 ? "gh26-pnl is-negative" : "gh26-pnl is-positive"}>{formatEur(open.netPnlEur)}</strong> : null}
        </div>
        {open ? (
          <div className="gh26-trade-detail-grid">
            <div><span>Entry</span><strong>{px(open.entry)}</strong></div>
            <div><span>Protected stop</span><strong>{px(open.stop)}</strong></div>
            <div><span>Status</span><strong>{open.status}</strong></div>
            <div><span>Filled</span><strong>{formatResearchLocalTime(open.fillTs)}</strong></div>
            <div><span>Broker position</span><strong>{open.brokerPositionId ? `…${open.brokerPositionId.slice(-6)}` : "—"}</strong></div>
            <div><span>Net P/L</span><strong>{formatEur(open.netPnlEur)}</strong></div>
          </div>
        ) : <p className="gh26-muted">Gold Hunter has no broker-confirmed Demo position open.</p>}
      </section>

      <section className="gh26-card">
        <div className="gh26-card-head"><div><span className="gh26-eyebrow">RECENT TRADES</span><h2>Demo trade history</h2></div></div>
        {loading ? <p className="gh26-muted">Loading trades…</p> : trades.length === 0 ? <p className="gh26-muted">No Gold Hunter Demo trades yet.</p> : (
          <div className="gh26-trade-list">
            {trades.map((trade) => (
              <article key={trade.goldHunterTradeId}>
                <div className="gh26-trade-list__head">
                  <div><span className="gh26-side">{trade.side}</span><strong>Setup {trade.setup ?? "—"}</strong></div>
                  <span className={`gh26-result ${trade.result === "WIN" ? "is-win" : trade.result === "LOSS" ? "is-loss" : ""}`}>{trade.result ?? trade.status}</span>
                </div>
                <div className="gh26-trade-list__grid">
                  <div><span>Entry</span><strong>{px(trade.entry)}</strong></div>
                  <div><span>Exit</span><strong>{px(trade.exit)}</strong></div>
                  <div><span>Net P/L</span><strong>{formatEur(trade.netPnlEur)}</strong></div>
                  <div><span>Filled</span><strong>{formatResearchLocalTime(trade.fillTs)}</strong></div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

import { useAuth } from "../../lib/auth";
function requireAuthApi() {
  return useAuth();
}
