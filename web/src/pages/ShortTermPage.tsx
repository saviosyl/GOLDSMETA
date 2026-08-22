import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, ShieldAlert, Target } from "lucide-react";
import { ConfidenceMeter } from "../components/redesign/ConfidenceMeter";
import { LiveTradeChart, type TradeChartLevel } from "../components/redesign/LiveTradeChart";
import { useGoldMetaMarketView } from "../hooks/useGoldMetaMarketView";
import { useAuth } from "../lib/auth";
import { fmtPrice } from "../lib/intradayFormat";
import type { SetupRecord } from "../types/models";

function friendly(value: string | null | undefined, fallback = "—") {
  if (!value) return fallback;
  return String(value).replace(/_/g, " ").toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

export function ShortTermPage() {
  const market = useGoldMetaMarketView();
  const { api } = useAuth();
  const [activeSetup, setActiveSetup] = useState<SetupRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const setups = await api.listActiveSetups();
        if (!cancelled) setActiveSetup(setups[0] ?? null);
      } catch {
        if (!cancelled) setActiveSetup(null);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api]);

  const geometry = market.tradeGeometry;
  const setupDirection = geometry.direction === "BUY" || geometry.direction === "SELL" ? geometry.direction : market.action;
  const tone = setupDirection === "BUY" ? "buy" : setupDirection === "SELL" ? "sell" : "wait";

  const chartLevels: TradeChartLevel[] = [
    { id: "sl", label: "SL", price: geometry.stop, tone: "sell", emphasis: "primary" },
    { id: "entry", label: "ENTRY", price: geometry.entry, tone: setupDirection === "SELL" ? "sell" : "buy", emphasis: "primary" },
    { id: "tp1", label: "TP1", price: geometry.tp1, tone: "buy", emphasis: "primary" },
    { id: "tp2", label: "TP2", price: geometry.tp2, tone: "buy" },
    { id: "tp3", label: "TP3", price: geometry.tp3, tone: "buy" },
    { id: "support", label: "SUP", price: market.support, tone: "muted" },
    { id: "resistance", label: "RES", price: market.resistance, tone: "muted" }
  ];

  const status = activeSetup?.status ?? market.plan?.planStatus ?? (geometry.actionable ? "READY" : "WATCHING");
  const reasons = [
    market.plan?.oneSentence,
    market.plan?.confirmation5m?.detail,
    market.plan?.timeframeAlignment?.conclusion
  ].filter((v): v is string => Boolean(v)).slice(0, 3);

  return (
    <div className="gm26-page gm26-trade-page" data-testid="gm26-short-term-page">
      <div className="gm26-page-heading">
        <div>
          <span className="gm26-eyebrow">MINUTES TO A FEW HOURS</span>
          <h1>Short-Term</h1>
        </div>
        <div className="gm26-status-chip" data-tone={tone}>{friendly(status)}</div>
      </div>

      {market.error ? (
        <div className="gm26-alert gm26-alert--warning"><AlertTriangle size={17} aria-hidden />{market.error}</div>
      ) : null}

      <section className={`gm26-trade-hero gm26-tone-${tone === "wait" ? "wait" : setupDirection.toLowerCase()}`}>
        <div className="gm26-trade-hero__top">
          <div>
            <span className="gm26-eyebrow">SHORT-TERM SIGNAL</span>
            <div className="gm26-trade-hero__signal">{setupDirection}</div>
            <p>{market.explanation}</p>
          </div>
          <div className="gm26-trade-hero__price">
            <span>Gold now</span>
            <strong>{fmtPrice(market.livePrice)}</strong>
            <small><Clock3 size={13} aria-hidden /> {market.session}</small>
          </div>
        </div>

        <ConfidenceMeter action={setupDirection === "BUY" || setupDirection === "SELL" ? setupDirection : "WAIT"} confidence={market.confidence} />

        <div className="gm26-trade-levels">
          <div className="is-entry"><span>Entry</span><strong>{geometry.entryLabel ?? "—"}</strong></div>
          <div className="is-stop"><span>Stop loss</span><strong>{fmtPrice(geometry.stop)}</strong></div>
          <div className="is-target"><span>TP1</span><strong>{fmtPrice(geometry.tp1)}</strong></div>
          <div className="is-target"><span>TP2</span><strong>{fmtPrice(geometry.tp2)}</strong></div>
          <div className="is-target"><span>TP3</span><strong>{fmtPrice(geometry.tp3)}</strong></div>
          <div><span>Risk / reward</span><strong>{geometry.riskReward ?? "—"}</strong></div>
          <div><span>Holding period</span><strong>Short-term</strong><small>Exact hold time not published by engine</small></div>
        </div>
      </section>

      <LiveTradeChart
        title="Short-Term live trade chart"
        subtitle="The setup stays on this chart from entry through targets or invalidation."
        levels={chartLevels}
        defaultTimeframe="M5"
        currentPrice={market.livePrice}
        marketClosed={market.marketClosed}
      />

      <section className="gm26-trade-progress gm26-card">
        <div className="gm26-section-title">
          <div><span className="gm26-eyebrow">LIVE TRADE PROGRESS</span><h2>{friendly(status)}</h2></div>
          <span className={`gm26-small-signal gm26-tone-${tone === "wait" ? "wait" : setupDirection.toLowerCase()}`}>{setupDirection}</span>
        </div>
        <div className="gm26-progress-rail" aria-label="Short-term setup lifecycle">
          {[
            ["Watching", ["WATCHING", "BUILDING", "WAITING_FOR_ENTRY_ZONE"]],
            ["Entry zone", ["ENTRY_TRIGGERED", "ARMED"]],
            ["Confirmed", ["CONFIRMED"]],
            ["In trade", ["IN_PROGRESS"]],
            ["TP1", ["TP1_REACHED", "TP1_HIT"]],
            ["TP2", ["TP2_REACHED", "TP2_HIT"]],
            ["Closed", ["CLOSED", "TP3_HIT", "STOP_LOSS_HIT", "INVALIDATED"]]
          ].map(([label, states], index) => {
            const active = (states as string[]).includes(String(status).toUpperCase());
            return <div key={label as string} className={active ? "is-current" : index === 0 ? "is-start" : ""}><i /><span>{label as string}</span></div>;
          })}
        </div>
        <div className="gm26-progress-grid">
          <div><span>Entry</span><strong>{activeSetup?.levels.entryPrice != null ? fmtPrice(activeSetup.levels.entryPrice) : geometry.entryLabel ?? "—"}</strong></div>
          <div><span>Current</span><strong>{fmtPrice(market.livePrice)}</strong></div>
          <div><span>Protection</span><strong>{fmtPrice(activeSetup?.levels.stopLoss ?? geometry.stop)}</strong></div>
          <div><span>Next target</span><strong>{fmtPrice(geometry.tp1)}</strong></div>
        </div>
      </section>

      <section className="gm26-content-grid">
        <article className="gm26-card">
          <div className="gm26-section-title"><div><span className="gm26-eyebrow">WHY THIS TRADE?</span><h2>Verified reasoning</h2></div></div>
          {reasons.length ? (
            <ul className="gm26-reason-list">
              {reasons.map((reason, index) => <li key={`${reason}-${index}`}><CheckCircle2 size={17} aria-hidden /> <span>{reason}</span></li>)}
            </ul>
          ) : <p className="gm26-muted">No additional verified reasoning published yet.</p>}
        </article>

        <article className="gm26-card gm26-guidance-card">
          <div className="gm26-section-title"><div><span className="gm26-eyebrow">GUIDANCE</span><h2>{geometry.management ? friendly(geometry.management) : "No management guidance"}</h2></div></div>
          <p>{geometry.management ?? "GoldMeta has not published a verified Hold / Book Profit / Exit instruction for this setup. The UI will not invent one."}</p>
          <div className="gm26-guidance-row">
            <Target size={18} aria-hidden />
            <span>Invalidation</span>
            <strong>{geometry.invalidation ?? "Not published"}</strong>
          </div>
        </article>
      </section>

      {!geometry.actionable ? (
        <div className="gm26-alert gm26-alert--info">
          <ShieldAlert size={17} aria-hidden />
          <span>No verified actionable Short-Term trade is published right now. GoldMeta is showing market context without inventing trade geometry.</span>
        </div>
      ) : null}
    </div>
  );
}
