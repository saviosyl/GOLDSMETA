import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../lib/auth";
import type { GoldHunterPerformanceBucket, GoldHunterStatusResponse, GoldHunterTrade } from "../../lib/api";
import {
  goldHunterBuildShort,
  goldHunterDisplayBrainVersion,
  goldHunterDisplayStrategyVariant,
  goldHunterRevisionFromSoftwareRevision,
  goldHunterVariantFromSoftwareRevision
} from "../../lib/goldHunterIdentity";
import "../../styles/goldHunterTest.css";

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}€${value.toFixed(2)}`;
}

function price(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

function time(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function ageLabel(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

function toneForTrade(trade: GoldHunterTrade): string {
  if (trade.status !== "CLOSED" || trade.result === "OPEN") return "open";
  if ((trade.netPnlEur ?? 0) > 0) return "win";
  if ((trade.netPnlEur ?? 0) < 0) return "loss";
  return "flat";
}

function performanceTone(p: GoldHunterPerformanceBucket | null): string {
  if (!p || p.netPnl === 0) return "neutral";
  return p.netPnl > 0 ? "good" : "bad";
}

export function GoldHunterTestPage() {
  const { account, api } = useAuth();
  const isStaff = account?.role === "OWNER" || account?.role === "ADMIN";
  const [status, setStatus] = useState<GoldHunterStatusResponse | null>(null);
  const [trades, setTrades] = useState<GoldHunterTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, tradeResponse] = await Promise.all([api.goldHunterStatus(), api.goldHunterTrades()]);
      setStatus(nextStatus);
      setTrades(tradeResponse.trades ?? []);
      setError(null);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load Gold Hunter test data");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!isStaff) return;
    void refresh();
    const id = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(id);
  }, [isStaff, refresh]);

  const action = useCallback(async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api.goldHunterUpdateConfig(patch);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Control action failed");
    } finally {
      setBusy(false);
    }
  }, [api, refresh]);

  const sortedTrades = useMemo(
    () => [...trades].sort((a, b) => (b.orderTs ?? b.fillTs ?? "").localeCompare(a.orderTs ?? a.fillTs ?? "")),
    [trades]
  );
  const latestTrades = sortedTrades.slice(0, 8);
  const openTrades = status?.openTrades ?? sortedTrades.filter((t) => t.result === "OPEN" || t.status !== "CLOSED").slice(0, 2);
  const perf = status?.performanceToday ?? null;
  const demoOn = status?.config.demoAutoTradeEnabled ?? false;
  const paused = status?.config.pauseNewEntries ?? false;
  const stopped = status?.config.emergencyStopActive ?? false;
  const currentReason = status?.gates.blockers?.[0] ?? status?.signal.note ?? "READY";
  const softwareRevision = status?.strategyVersions.softwareRevision ?? null;
  const brain = goldHunterDisplayBrainVersion(status?.strategyVersions.brainVersion);
  const revision = status?.strategyVersions.brainRevision ?? goldHunterRevisionFromSoftwareRevision(softwareRevision) ?? "—";
  const variant = goldHunterDisplayStrategyVariant(
    status?.strategyVersions.strategyVariant ?? goldHunterVariantFromSoftwareRevision(softwareRevision)
  );

  if (!isStaff) return <div className="ght-page"><div className="ght-panel"><h1>Gold Hunter Test</h1><p>Admin access required.</p></div></div>;
  if (loading && !status) return <div className="ght-page"><div className="ght-panel"><h1>Gold Hunter Test</h1><p>Loading live test data…</p></div></div>;

  return (
    <div className="ght-page" data-testid="gold-hunter-test-page">
      <header className="ght-hero">
        <div>
          <div className="ght-eyebrow">GOLD HUNTER · TEST CONSOLE</div>
          <h1>XAUUSD Demo AutoTrade</h1>
          <p>Runtime identity and Demo test information from the deployed Gold Hunter service.</p>
        </div>
        <div className={`ght-live-pill ${demoOn ? "on" : "off"}`}><span className="ght-dot" />{demoOn ? "DEMO ON" : "DEMO OFF"}</div>
      </header>

      {error ? <div className="ght-alert danger">{error}</div> : null}

      <section className="ght-price-panel">
        <div><span className="ght-label">XAUUSD</span><strong className="ght-price">{price(status?.market.mid)}</strong></div>
        <div className="ght-market-grid">
          <div><span>Bid</span><strong>{price(status?.market.bid)}</strong></div>
          <div><span>Ask</span><strong>{price(status?.market.ask)}</strong></div>
          <div><span>Spread</span><strong>{price(status?.market.spread)}</strong></div>
          <div><span>Feed age</span><strong>{ageLabel(status?.market.ageMs)}</strong></div>
        </div>
      </section>

      <section className="ght-status-strip">
        <div className="ght-status-main"><span className="ght-label">CURRENT STATE</span><strong>{stopped ? "EMERGENCY STOP" : paused ? "PAUSED" : demoOn ? "ARMED" : "RESEARCH"}</strong><p>{currentReason}</p></div>
        <div className="ght-actions">
          {demoOn ? (
            <button disabled={busy} className="ght-button secondary" onClick={() => void action({ demoAutoTradeEnabled: false })}>Turn Demo OFF</button>
          ) : (
            <button disabled={busy || stopped} className="ght-button primary" onClick={() => {
              if (window.confirm("Enable Gold Hunter DEMO AutoTrade? Live trading remains locked.")) void action({ demoAutoTradeEnabled: true, confirmDemoAutoTrade: true });
            }}>Enable Demo</button>
          )}
          <button disabled={busy || stopped} className="ght-button secondary" onClick={() => void action({ pauseNewEntries: !paused })}>{paused ? "Resume Entries" : "Pause Entries"}</button>
          <button disabled={busy || stopped} className="ght-button danger" onClick={() => {
            if (window.confirm("Emergency stop Gold Hunter Demo? Existing positions are not automatically closed.")) void action({ emergencyStopActive: true });
          }}>Emergency Stop</button>
        </div>
      </section>

      <section className="ght-grid four" aria-label="Runtime identity">
        <div className="ght-card"><span>Trading brain</span><strong>{brain}</strong><small>{revision}</small></div>
        <div className="ght-card"><span>Strategy variant</span><strong>{variant}</strong><small>{softwareRevision ?? "—"}</small></div>
        <div className="ght-card"><span>API revision</span><strong>{status?.runtimeSha ?? "—"}</strong><small>Runtime · not web build</small></div>
        <div className="ght-card"><span>Trading worker</span><strong>{status?.strategyVersions.workerRevision ?? "—"}</strong><small>{status?.strategyVersions.telemetrySource ?? "—"}</small></div>
        <div className="ght-card"><span>Broker</span><strong>{status?.broker.connected ? "CONNECTED" : "DISCONNECTED"}</strong><small>{status?.broker.environment ?? "—"} · {status?.broker.accountMasked ?? "—"}</small></div>
        <div className="ght-card"><span>Web build</span><strong>{goldHunterBuildShort()}</strong><small>Presentation build only</small></div>
      </section>

      <section className="ght-section">
        <div className="ght-section-head"><div><span className="ght-label">OPEN POSITION</span><h2>{openTrades.length ? "Trade in progress" : "No open trade"}</h2></div><button className="ght-refresh" onClick={() => void refresh()} disabled={busy}>Refresh</button></div>
        {openTrades.length ? openTrades.map((trade) => (
          <div className="ght-open-trade" key={trade.goldHunterTradeId}>
            <div className={`ght-side ${trade.side.toLowerCase()}`}>{trade.side}</div>
            <div><span>Entry</span><strong>{price(trade.entry)}</strong></div>
            <div><span>Stop</span><strong>{price(trade.stop)}</strong></div>
            <div><span>Filled</span><strong>{time(trade.fillTs)}</strong></div>
            <div><span>Setup</span><strong>{trade.setup ?? "—"}</strong></div>
            <div className="ght-trade-id">{trade.goldHunterTradeId}</div>
          </div>
        )) : <div className="ght-empty">Waiting for the next valid runtime setup.</div>}
      </section>

      <section className="ght-grid four">
        <div className={`ght-card metric ${performanceTone(perf)}`}><span>Today P/L</span><strong>{money(perf?.netPnl)}</strong></div>
        <div className="ght-card metric"><span>Trades</span><strong>{perf?.trades ?? 0}</strong></div>
        <div className="ght-card metric"><span>Wins / Losses</span><strong>{perf ? `${perf.wins} / ${perf.losses}` : "—"}</strong></div>
        <div className="ght-card metric"><span>Avg loss</span><strong>{money(perf?.avgLoss)}</strong></div>
      </section>

      <section className="ght-section">
        <div className="ght-section-head"><div><span className="ght-label">LATEST TRADES</span><h2>Demo results</h2></div><small>Newest first</small></div>
        <div className="ght-trades">
          {latestTrades.map((trade) => (
            <article className={`ght-trade ${toneForTrade(trade)}`} key={trade.goldHunterTradeId}>
              <div className="ght-trade-top"><div><span className={`ght-side ${trade.side.toLowerCase()}`}>{trade.side}</span><strong>{trade.result ?? trade.status}</strong></div><strong className="ght-pnl">{money(trade.netPnlEur)}</strong></div>
              <div className="ght-trade-data">
                <div><span>Entry</span><strong>{price(trade.entry)}</strong></div>
                <div><span>Exit</span><strong>{price(trade.exit)}</strong></div>
                <div><span>Filled</span><strong>{time(trade.fillTs)}</strong></div>
                <div><span>Exit reason</span><strong>{trade.exitReason ?? "—"}</strong></div>
              </div>
              <small>{trade.goldHunterTradeId} · Setup {trade.setup ?? "—"}</small>
            </article>
          ))}
          {!latestTrades.length ? <div className="ght-empty">No Demo trades found.</div> : null}
        </div>
      </section>

      <section className="ght-section compact">
        <span className="ght-label">TEST HEALTH</span>
        <div className="ght-health-grid">
          <div><span>Feed</span><strong>{status?.health.marketFeed ?? "—"}</strong></div>
          <div><span>Selector</span><strong>{status?.strategyPipeline?.selector ?? "—"}</strong></div>
          <div><span>Depth</span><strong>{status?.strategyPipeline?.depth ?? status?.health.depth ?? "—"}</strong></div>
          <div><span>Arming</span><strong>{status?.arming?.ready ? "READY" : "BLOCKED"}</strong></div>
          <div><span>Signal</span><strong>{status?.signal.present ? `${status.signal.side ?? ""} ${status.signal.setup ?? ""}`.trim() : "NONE"}</strong></div>
          <div><span>Telemetry</span><strong>{status?.strategyVersions.telemetrySource ?? "—"}</strong></div>
        </div>
        <details className="ght-details"><summary>Diagnostics</summary><pre>{JSON.stringify({ runtimeSha: status?.runtimeSha, brain: status?.strategyVersions.brainVersion, brainRevision: status?.strategyVersions.brainRevision, strategyVariant: status?.strategyVersions.strategyVariant, softwareRevision: status?.strategyVersions.softwareRevision, workerRevision: status?.strategyVersions.workerRevision, telemetryAgeMs: status?.strategyVersions.telemetryAgeMs, gates: status?.gates, signal: status?.signal, strategyPipeline: status?.strategyPipeline, execution: status?.execution }, null, 2)}</pre></details>
      </section>

      <footer className="ght-footer">Last refreshed {lastRefresh ? lastRefresh.toLocaleTimeString() : "—"} · DEMO ONLY · LIVE LOCKED</footer>
    </div>
  );
}
