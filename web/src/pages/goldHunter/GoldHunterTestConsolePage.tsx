import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../lib/auth";
import type { GoldHunterStatusResponse, GoldHunterTrade } from "../../lib/api";
import {
  goldHunterDisplayBrainVersion,
  goldHunterDisplayStrategyVariant,
  goldHunterRevisionFromSoftwareRevision,
  goldHunterVariantFromSoftwareRevision
} from "../../lib/goldHunterIdentity";

const POLL_MS = 3000;

function eur(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}€${value.toFixed(2)}`;
}

function price(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

function time(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-IE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function duration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

function tone(value: string | null | undefined): "good" | "warn" | "bad" | "neutral" {
  const v = String(value ?? "").toUpperCase();
  if (/LIVE|CONNECTED|VALID|READY|ACTIVE|NORMAL|OPEN|AUTHORISED/.test(v)) return "good";
  if (/WAIT|PAUSED|STALE|LIMITED|CLOSED|UNKNOWN/.test(v)) return "warn";
  if (/ERROR|INVALID|HALT|DISCONNECT|CROSSED|STOP/.test(v)) return "bad";
  return "neutral";
}

function shortWait(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  if (!text) return "Waiting for a valid setup";
  return text.replace(/^WAIT\s*[—-]\s*/i, "");
}

function tradeSortTime(trade: GoldHunterTrade): number {
  const value = trade.closeTs ?? trade.fillTs ?? trade.orderTs ?? trade.signalTs;
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusLabel(status: GoldHunterStatusResponse): {
  eyebrow: string;
  title: string;
  detail: string;
  kind: "good" | "warn" | "bad" | "neutral";
} {
  const demoOn = status.config.demoAutoTradeEnabled;
  const open = status.openTrades[0] ?? null;

  if (open) {
    return {
      eyebrow: "ACTIVE DEMO POSITION",
      title: `${open.side} · SETUP ${open.setup ?? "—"}`,
      detail: `Entry ${price(open.entry)} · ${open.status}`,
      kind: "good"
    };
  }

  if (!demoOn) {
    return {
      eyebrow: "DEMO AUTOTRADE",
      title: "OFF",
      detail: "No new Gold Hunter orders can be submitted.",
      kind: "neutral"
    };
  }

  if (status.signal.present && status.signal.side) {
    return {
      eyebrow: "CURRENT SIGNAL",
      title: `${status.signal.side} · SETUP ${status.signal.setup ?? "—"}`,
      detail: status.signal.note || "Signal selected and moving through safety gates.",
      kind: "good"
    };
  }

  const blocker = status.gates.blockers.find(
    (item) => item !== "WAIT — NO SETUP SELECTED" && item !== "WAIT — AUTOTRADE OFF"
  );
  if (blocker) {
    return {
      eyebrow: "DEMO ARMED",
      title: "TEMPORARILY BLOCKED",
      detail: shortWait(blocker),
      kind: "warn"
    };
  }

  return {
    eyebrow: "DEMO ARMED",
    title: "SCANNING FOR A VALID SETUP",
    detail: shortWait(status.signal.note || "WAIT — NO SETUP SELECTED"),
    kind: "warn"
  };
}

export function GoldHunterTestConsolePage() {
  const { account, api } = useAuth();
  const [status, setStatus] = useState<GoldHunterStatusResponse | null>(null);
  const [trades, setTrades] = useState<GoldHunterTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const isStaff = account?.role === "OWNER" || account?.role === "ADMIN";

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextTrades] = await Promise.all([
        api.goldHunterStatus(),
        api.goldHunterTrades()
      ]);
      setStatus(nextStatus);
      setTrades(nextTrades.trades);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gold Hunter test data unavailable");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!isStaff) return;
    void refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [isStaff, refresh]);

  const recentTrades = useMemo(
    () => [...trades].sort((a, b) => tradeSortTime(b) - tradeSortTime(a)).slice(0, 6),
    [trades]
  );

  async function setDemoEnabled(enabled: boolean) {
    setActionBusy(true);
    setActionMessage(null);
    try {
      await api.goldHunterUpdateConfig(
        enabled
          ? { demoAutoTradeEnabled: true, confirmDemoAutoTrade: true }
          : { demoAutoTradeEnabled: false }
      );
      await refresh();
      setActionMessage(
        enabled
          ? "Demo AutoTrade is armed. LIVE remains locked."
          : "Demo AutoTrade is OFF. No new Gold Hunter entries will be submitted."
      );
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Unable to update Demo AutoTrade");
    } finally {
      setActionBusy(false);
    }
  }

  if (!isStaff) {
    return <div className="ght-unauthorized">Gold Hunter test console requires admin access.</div>;
  }

  if (loading && !status) {
    return <div className="ght-unauthorized">Loading Gold Hunter test console…</div>;
  }

  if (!status) {
    return (
      <div className="ght-unauthorized">
        Gold Hunter test console is unavailable.{error ? ` ${error}` : ""}
      </div>
    );
  }

  const hero = statusLabel(status);
  const openTrade = status.openTrades[0] ?? null;
  const versions = status.strategyVersions;
  const softwareRevision = versions.softwareRevision ?? null;
  const brain = goldHunterDisplayBrainVersion(versions.brainVersion ?? null);
  const revision =
    versions.brainRevision ?? goldHunterRevisionFromSoftwareRevision(softwareRevision) ?? "—";
  const variant = goldHunterDisplayStrategyVariant(
    versions.strategyVariant ?? goldHunterVariantFromSoftwareRevision(softwareRevision) ?? null
  );
  const demoOn = status.config.demoAutoTradeEnabled;
  const telemetryAge = versions.telemetryAgeMs;

  return (
    <div className="ght-page" data-testid="gold-hunter-test-console">
      <style>{`
        .ght-page{--bg:#080b11;--panel:#111722;--panel2:#151d29;--line:rgba(255,255,255,.08);--muted:#8d98aa;--text:#f7f8fa;--gold:#e1b85b;--green:#39d98a;--red:#ff6675;--amber:#f6bd5b;background:radial-gradient(circle at 12% -8%,rgba(225,184,91,.16),transparent 28%),linear-gradient(180deg,#0a0e15,#07090e 70%);color:var(--text);min-height:100vh;margin:-16px;padding:18px 16px 84px;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
        .ght-page *{box-sizing:border-box}.ght-wrap{max-width:1120px;margin:0 auto}.ght-top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:16px}.ght-kicker{color:var(--gold);font-size:.72rem;letter-spacing:.18em;font-weight:800}.ght-title{font-size:clamp(1.55rem,4vw,2.4rem);margin:4px 0 3px;letter-spacing:-.035em}.ght-sub{color:var(--muted);font-size:.84rem}.ght-lock{display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(57,217,138,.3);background:rgba(57,217,138,.08);color:var(--green);padding:8px 11px;border-radius:999px;font-size:.72rem;font-weight:800;white-space:nowrap}.ght-dot{width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 14px currentColor}.ght-hero{display:grid;grid-template-columns:1.15fr .85fr;gap:12px;margin-bottom:12px}.ght-card{background:linear-gradient(180deg,rgba(20,27,39,.96),rgba(13,18,27,.98));border:1px solid var(--line);border-radius:22px;box-shadow:0 18px 55px rgba(0,0,0,.22)}.ght-market{padding:22px}.ght-market-top{display:flex;justify-content:space-between;gap:18px;align-items:flex-start}.ght-symbol{font-size:.76rem;letter-spacing:.16em;color:var(--muted);font-weight:800}.ght-price{font-size:clamp(2.55rem,9vw,4.8rem);line-height:.95;font-weight:850;letter-spacing:-.06em;margin:9px 0 17px}.ght-quote{display:flex;gap:18px;flex-wrap:wrap;color:var(--muted);font-size:.78rem}.ght-quote strong{display:block;color:var(--text);font-size:.95rem;margin-top:2px}.ght-live{display:flex;gap:8px;align-items:center;color:var(--green);font-size:.72rem;font-weight:800}.ght-state{padding:22px;display:flex;flex-direction:column;justify-content:space-between;min-height:215px}.ght-eyebrow{font-size:.7rem;letter-spacing:.16em;font-weight:800;color:var(--muted)}.ght-state-title{font-size:clamp(1.35rem,4vw,2.05rem);line-height:1.04;margin:10px 0 8px;letter-spacing:-.035em}.ght-state-detail{color:#c2c9d4;line-height:1.45;font-size:.88rem}.ght-state.good{box-shadow:inset 0 3px 0 rgba(57,217,138,.8)}.ght-state.warn{box-shadow:inset 0 3px 0 rgba(246,189,91,.8)}.ght-state.bad{box-shadow:inset 0 3px 0 rgba(255,102,117,.8)}.ght-controls{display:flex;gap:9px;margin-top:20px;flex-wrap:wrap}.ght-btn{appearance:none;border:1px solid var(--line);background:#171d28;color:var(--text);font-weight:800;border-radius:14px;padding:12px 16px;min-height:44px;cursor:pointer}.ght-btn:disabled{opacity:.55;cursor:not-allowed}.ght-btn.primary{border-color:rgba(225,184,91,.55);background:linear-gradient(180deg,#e9c46c,#c99a3e);color:#151008}.ght-btn.stop{border-color:rgba(255,102,117,.36);background:rgba(255,102,117,.08);color:#ff8c97}.ght-message{margin-top:9px;color:var(--muted);font-size:.78rem}.ght-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:12px;margin-bottom:12px}.ght-section{padding:18px}.ght-section h2{font-size:.78rem;letter-spacing:.13em;color:var(--muted);margin:0 0 14px;text-transform:uppercase}.ght-open{grid-column:span 7}.ght-guard{grid-column:span 5}.ght-empty{border:1px dashed rgba(255,255,255,.12);border-radius:16px;padding:22px;color:var(--muted);text-align:center}.ght-side{font-size:1.6rem;font-weight:850;letter-spacing:-.035em}.ght-side.buy{color:var(--green)}.ght-side.sell{color:#ff9f67}.ght-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:14px}.ght-metric{background:rgba(255,255,255,.028);border:1px solid rgba(255,255,255,.055);border-radius:14px;padding:11px}.ght-metric span{display:block;color:var(--muted);font-size:.66rem;text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px}.ght-metric strong{font-size:.94rem}.ght-guard-row{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.055);font-size:.82rem}.ght-guard-row:last-child{border-bottom:0}.ght-guard-row span{color:var(--muted)}.ght-badge{display:inline-flex;align-items:center;border:1px solid var(--line);padding:5px 8px;border-radius:999px;font-size:.66rem;font-weight:800}.ght-badge.good{color:var(--green);border-color:rgba(57,217,138,.28);background:rgba(57,217,138,.07)}.ght-badge.warn{color:var(--amber);border-color:rgba(246,189,91,.28);background:rgba(246,189,91,.07)}.ght-badge.bad{color:var(--red);border-color:rgba(255,102,117,.28);background:rgba(255,102,117,.07)}.ght-badge.neutral{color:#aeb6c4}.ght-health{grid-column:span 12}.ght-health-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}.ght-health-item{background:rgba(255,255,255,.026);border:1px solid rgba(255,255,255,.055);border-radius:14px;padding:11px;text-align:center}.ght-health-item span{display:block;color:var(--muted);font-size:.62rem;letter-spacing:.08em;margin-bottom:7px}.ght-history{margin-bottom:12px;padding:18px}.ght-trades{display:grid;gap:8px}.ght-trade{display:grid;grid-template-columns:1.15fr .75fr .75fr .8fr .9fr;gap:10px;align-items:center;padding:12px;border-radius:15px;border:1px solid rgba(255,255,255,.055);background:rgba(255,255,255,.022)}.ght-trade-id{font-size:.76rem;font-weight:750}.ght-trade-id small{display:block;color:var(--muted);font-weight:500;margin-top:3px}.ght-trade-cell span{display:block;color:var(--muted);font-size:.61rem;text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px}.ght-trade-cell strong{font-size:.8rem}.ght-pnl.pos{color:var(--green)}.ght-pnl.neg{color:var(--red)}.ght-runtime{padding:16px 18px}.ght-runtime-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.ght-runtime-item{padding:8px 0}.ght-runtime-item span{display:block;color:var(--muted);font-size:.62rem;text-transform:uppercase;letter-spacing:.08em}.ght-runtime-item strong{display:block;font-size:.78rem;margin-top:4px;overflow-wrap:anywhere}.ght-note{margin-top:12px;color:#7e899a;font-size:.7rem;line-height:1.45}.ght-error{margin:0 0 12px;padding:10px 12px;border-radius:12px;color:#ff9aa4;background:rgba(255,102,117,.08);border:1px solid rgba(255,102,117,.2);font-size:.76rem}.ght-unauthorized{padding:28px;color:#fff;background:#0b0f16;min-height:60vh}.ght-refresh{background:transparent;border:0;color:var(--muted);font-size:.7rem;cursor:pointer;padding:5px}.ght-refresh:hover{color:var(--text)}
        @media(max-width:820px){.ght-page{margin:-12px;padding:14px 12px 84px}.ght-top{align-items:center}.ght-hero{grid-template-columns:1fr}.ght-state{min-height:auto}.ght-open,.ght-guard{grid-column:span 12}.ght-health-grid{grid-template-columns:repeat(3,1fr)}.ght-metrics{grid-template-columns:repeat(2,1fr)}.ght-trade{grid-template-columns:1.3fr .8fr .8fr}.ght-trade .hide-mobile{display:none}.ght-runtime-grid{grid-template-columns:repeat(2,1fr)}}
        @media(max-width:480px){.ght-lock{padding:7px 9px}.ght-market{padding:18px}.ght-state{padding:18px}.ght-price{font-size:3.4rem}.ght-health-grid{grid-template-columns:repeat(2,1fr)}.ght-trade{grid-template-columns:1fr .7fr .8fr}.ght-title{font-size:1.7rem}}
      `}</style>

      <div className="ght-wrap">
        <header className="ght-top">
          <div>
            <div className="ght-kicker">GOLDMETA · TEST CONSOLE</div>
            <h1 className="ght-title">Gold Hunter</h1>
            <div className="ght-sub">One page. Demo only. Live execution is not available here.</div>
          </div>
          <div className="ght-lock"><span className="ght-dot" /> LIVE LOCKED</div>
        </header>

        {error ? <div className="ght-error">Last refresh failed: {error}. Retrying automatically.</div> : null}

        <div className="ght-hero">
          <section className="ght-card ght-market">
            <div className="ght-market-top">
              <div>
                <div className="ght-symbol">XAUUSD · GOLD / US DOLLAR</div>
                <div className="ght-price">{price(status.market.mid)}</div>
              </div>
              <div className="ght-live"><span className="ght-dot" /> {status.market.feedState}</div>
            </div>
            <div className="ght-quote">
              <div>Bid<strong>{price(status.market.bid)}</strong></div>
              <div>Ask<strong>{price(status.market.ask)}</strong></div>
              <div>Spread<strong>{price(status.market.spread)}</strong></div>
              <div>Market<strong>{status.market.marketStatus}</strong></div>
              <div>Feed age<strong>{status.market.ageMs == null ? "—" : `${Math.round(status.market.ageMs)} ms`}</strong></div>
            </div>
          </section>

          <section className={`ght-card ght-state ${hero.kind}`}>
            <div>
              <div className="ght-eyebrow">{hero.eyebrow}</div>
              <div className="ght-state-title">{hero.title}</div>
              <div className="ght-state-detail">{hero.detail}</div>
            </div>
            <div>
              <div className="ght-controls">
                {demoOn ? (
                  <button className="ght-btn stop" disabled={actionBusy} onClick={() => void setDemoEnabled(false)}>
                    {actionBusy ? "WORKING…" : "STOP DEMO AUTO"}
                  </button>
                ) : (
                  <button
                    className="ght-btn primary"
                    disabled={actionBusy}
                    onClick={() => {
                      if (window.confirm("Start Gold Hunter Demo AutoTrade? This can place orders on cTrader DEMO only. LIVE remains locked.")) {
                        void setDemoEnabled(true);
                      }
                    }}
                  >
                    {actionBusy ? "WORKING…" : "START DEMO AUTO"}
                  </button>
                )}
                <button className="ght-btn" disabled={actionBusy} onClick={() => void refresh()}>REFRESH</button>
              </div>
              {actionMessage ? <div className="ght-message">{actionMessage}</div> : null}
            </div>
          </section>
        </div>

        <div className="ght-grid">
          <section className="ght-card ght-section ght-open">
            <h2>Current Trade</h2>
            {openTrade ? (
              <>
                <div className={`ght-side ${openTrade.side.toLowerCase()}`}>
                  {openTrade.side} · Setup {openTrade.setup ?? "—"}
                </div>
                <div className="ght-metrics">
                  <div className="ght-metric"><span>Entry</span><strong>{price(openTrade.entry)}</strong></div>
                  <div className="ght-metric"><span>Stop</span><strong>{price(openTrade.stop)}</strong></div>
                  <div className="ght-metric"><span>Status</span><strong>{openTrade.status}</strong></div>
                  <div className="ght-metric"><span>Filled</span><strong>{time(openTrade.fillTs)}</strong></div>
                  <div className="ght-metric"><span>MFE</span><strong>{price(openTrade.mfe)}</strong></div>
                  <div className="ght-metric"><span>MAE</span><strong>{price(openTrade.mae)}</strong></div>
                  <div className="ght-metric"><span>Duration</span><strong>{duration(openTrade.durationMs)}</strong></div>
                  <div className="ght-metric"><span>Trade ID</span><strong>{openTrade.goldHunterTradeId}</strong></div>
                </div>
              </>
            ) : (
              <div className="ght-empty">No open Gold Hunter Demo position.</div>
            )}
          </section>

          <section className="ght-card ght-section ght-guard">
            <h2>V6 Test Guardrails</h2>
            <div className="ght-guard-row"><span>Consecutive losses</span><strong>{versions.consecutiveLosses}</strong></div>
            <div className="ght-guard-row"><span>Loss streak guard</span><strong>{versions.lossStreakGuardActive ? "ACTIVE" : "CLEAR"}</strong></div>
            <div className="ght-guard-row"><span>Circuit breaker</span><strong>{versions.lossCircuitBreakerActive ? "ACTIVE" : "CLEAR"}</strong></div>
            <div className="ght-guard-row"><span>Rolling realised R</span><strong>{Number.isFinite(versions.rollingRealisedR) ? versions.rollingRealisedR.toFixed(2) : "—"}</strong></div>
            <div className="ght-guard-row"><span>Entry integrity</span><strong>{versions.entryIntegrityHealthy ? "HEALTHY" : "CHECK"}</strong></div>
            <div className="ght-guard-row"><span>Today P/L</span><strong className={status.performanceToday.netPnl < 0 ? "ght-pnl neg" : "ght-pnl pos"}>{eur(status.performanceToday.netPnl)}</strong></div>
          </section>

          <section className="ght-card ght-section ght-health">
            <h2>System Now</h2>
            <div className="ght-health-grid">
              {[
                ["FEED", status.health.marketFeed],
                ["BROKER", status.broker.connected ? "CONNECTED" : "DISCONNECTED"],
                ["DEPTH", status.strategyPipeline?.depth ?? status.health.depth],
                ["SELECTOR", status.strategyPipeline?.state ?? status.health.strategy],
                ["RISK", status.health.risk],
                ["DEMO", demoOn ? "ACTIVE" : "OFF"]
              ].map(([label, value]) => (
                <div className="ght-health-item" key={label}>
                  <span>{label}</span>
                  <div className={`ght-badge ${tone(value)}`}>{value}</div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="ght-card ght-history">
          <h2 style={{fontSize: ".78rem", letterSpacing: ".13em", color: "var(--muted)", margin: "0 0 14px", textTransform: "uppercase"}}>Latest Demo Trades</h2>
          <div className="ght-trades">
            {recentTrades.length === 0 ? <div className="ght-empty">No Demo trades recorded.</div> : recentTrades.map((trade) => (
              <div className="ght-trade" key={trade.goldHunterTradeId}>
                <div className="ght-trade-id">
                  {trade.side} · {trade.setup ?? "—"}
                  <small>{trade.goldHunterTradeId}</small>
                </div>
                <div className="ght-trade-cell"><span>Result</span><strong className={`ght-pnl ${(trade.netPnlEur ?? 0) < 0 ? "neg" : (trade.netPnlEur ?? 0) > 0 ? "pos" : ""}`}>{trade.result ?? trade.status}</strong></div>
                <div className="ght-trade-cell"><span>Net P/L</span><strong className={`ght-pnl ${(trade.netPnlEur ?? 0) < 0 ? "neg" : (trade.netPnlEur ?? 0) > 0 ? "pos" : ""}`}>{eur(trade.netPnlEur)}</strong></div>
                <div className="ght-trade-cell hide-mobile"><span>Entry → Exit</span><strong>{price(trade.entry)} → {price(trade.exit)}</strong></div>
                <div className="ght-trade-cell"><span>Time</span><strong>{time(trade.fillTs ?? trade.orderTs)}</strong></div>
              </div>
            ))}
          </div>
        </section>

        <section className="ght-card ght-runtime">
          <div className="ght-runtime-grid">
            <div className="ght-runtime-item"><span>Execution worker</span><strong>{versions.workerRevision ?? "—"}</strong></div>
            <div className="ght-runtime-item"><span>Worker telemetry</span><strong>{versions.telemetrySource ?? "—"}{telemetryAge == null ? "" : ` · ${Math.round(telemetryAge / 1000)}s`}</strong></div>
            <div className="ght-runtime-item"><span>API brain identity</span><strong>{brain} · {revision}</strong></div>
            <div className="ght-runtime-item"><span>API strategy identity</span><strong>{variant}</strong></div>
          </div>
          <div className="ght-note">
            Test console intentionally separates the execution-worker revision from the API-reported brain identity so a stale API label cannot be mistaken for the worker that is actually producing telemetry. Runtime API: {status.runtimeSha ?? "—"}. LIVE execution: {status.liveExecutionEnabled ? "ENABLED" : "LOCKED"}.
          </div>
        </section>
      </div>
    </div>
  );
}
