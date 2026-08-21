import { AlertTriangle, ArrowRight, Ban, CheckCircle2 } from "lucide-react";
import { ConfidenceMeter } from "../components/redesign/ConfidenceMeter";
import { LiveTradeChart, type TradeChartLevel } from "../components/redesign/LiveTradeChart";
import { useGoldMetaMarketView } from "../hooks/useGoldMetaMarketView";
import { fmtPrice } from "../lib/intradayFormat";

function pretty(value: string | null | undefined, fallback = "—") {
  if (!value) return fallback;
  return String(value).replace(/_/g, " ").toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

function dailyBias(direction: string): "BUY" | "SELL" | "WAIT" {
  const d = direction.toUpperCase();
  if (d.includes("BULL")) return "BUY";
  if (d.includes("BEAR")) return "SELL";
  return "WAIT";
}

export function DayTradePage() {
  const market = useGoldMetaMarketView();
  const plan = market.plan;
  const geometry = market.tradeGeometry;
  const biasAction = dailyBias(market.direction);
  const primaryScenario = plan?.primaryScenarioSide === "bearish" ? plan?.bearishScenario : plan?.bullishScenario;
  const alternativeScenario = plan?.primaryScenarioSide === "bearish" ? plan?.bullishScenario : plan?.bearishScenario;

  const chartLevels: TradeChartLevel[] = [
    { id: "res", label: "RES", price: market.resistance, tone: "sell", emphasis: "primary" },
    { id: "vah", label: "VAH", price: market.vah, tone: "gold" },
    { id: "poc", label: "POC", price: market.poc, tone: "gold", emphasis: "primary" },
    { id: "val", label: "VAL", price: market.val, tone: "gold" },
    { id: "sup", label: "SUP", price: market.support, tone: "buy", emphasis: "primary" },
    { id: "entry", label: "ENTRY", price: geometry.entry, tone: biasAction === "SELL" ? "sell" : "buy", emphasis: "primary" },
    { id: "sl", label: "INVALID", price: geometry.stop, tone: "sell" },
    { id: "tp1", label: "T1", price: geometry.tp1, tone: "buy" },
    { id: "tp2", label: "T2", price: geometry.tp2, tone: "buy" },
    { id: "tp3", label: "T3", price: geometry.tp3, tone: "buy" }
  ];

  const alignment = plan?.timeframeAlignment?.cells ?? [];
  const range = plan?.expectedRange ?? null;

  return (
    <div className="gm26-page gm26-day-page" data-testid="gm26-day-trade-page">
      <div className="gm26-page-heading">
        <div>
          <span className="gm26-eyebrow">SAME-DAY XAUUSD PLAN</span>
          <h1>Day Trade</h1>
        </div>
        <div className={`gm26-status-chip gm26-tone-${biasAction.toLowerCase()}`}>{market.direction}</div>
      </div>

      {market.error ? <div className="gm26-alert gm26-alert--warning"><AlertTriangle size={17} aria-hidden />{market.error}</div> : null}

      <section className={`gm26-day-hero gm26-tone-${biasAction.toLowerCase()}`}>
        <div className="gm26-day-hero__lead">
          <span className="gm26-eyebrow">DAILY BIAS</span>
          <strong>{market.direction.toUpperCase()}</strong>
          <p>{plan?.oneSentence ?? market.explanation}</p>
        </div>
        <div className="gm26-day-hero__signal">
          <span>Preferred setup</span>
          <strong>{geometry.actionable ? `${geometry.direction} SETUP` : market.action === "WAIT" ? "WAIT" : market.action}</strong>
        </div>
        <ConfidenceMeter action={biasAction} confidence={market.confidence} />

        <div className="gm26-day-geometry">
          <div><span>Entry zone</span><strong>{geometry.entryLabel ?? "—"}</strong></div>
          <div className="is-danger"><span>Stop / invalidation</span><strong>{fmtPrice(geometry.stop)}</strong></div>
          <div className="is-target"><span>Target 1</span><strong>{fmtPrice(geometry.tp1)}</strong></div>
          <div className="is-target"><span>Target 2</span><strong>{fmtPrice(geometry.tp2)}</strong></div>
          <div className="is-target"><span>Major target</span><strong>{fmtPrice(geometry.tp3)}</strong></div>
          <div><span>Risk / reward</span><strong>{geometry.riskReward ?? "—"}</strong></div>
        </div>
      </section>

      <LiveTradeChart
        title="Day Trade structure"
        subtitle="15M / 1H context with value levels, entry, invalidation and verified targets."
        levels={chartLevels}
        defaultTimeframe="H1"
        currentPrice={market.livePrice}
        marketClosed={market.marketClosed}
      />

      <section className="gm26-content-grid">
        <article className="gm26-card">
          <div className="gm26-section-title"><div><span className="gm26-eyebrow">TODAY'S STRUCTURE</span><h2>Timeframe alignment</h2></div></div>
          {alignment.length ? (
            <div className="gm26-timeframes">
              {alignment.map((cell) => (
                <div key={cell.timeframe} data-tone={cell.tone ?? "info"}>
                  <span>{cell.timeframe}</span>
                  <strong>{pretty(cell.direction)}</strong>
                  <small>{pretty(cell.label)}</small>
                </div>
              ))}
            </div>
          ) : <p className="gm26-muted">No verified timeframe alignment published.</p>}
          {plan?.timeframeAlignment?.conclusion ? <p className="gm26-card-note">{plan.timeframeAlignment.conclusion}</p> : null}
        </article>

        <article className="gm26-card">
          <div className="gm26-section-title"><div><span className="gm26-eyebrow">EXPECTED RANGE</span><h2>Today's working area</h2></div></div>
          <div className="gm26-range-grid">
            <div><span>Probable low</span><strong>{fmtPrice(range?.probableLow)}</strong></div>
            <div><span>Probable high</span><strong>{fmtPrice(range?.probableHigh)}</strong></div>
            <div><span>Stretch low</span><strong>{fmtPrice(range?.stretchLow)}</strong></div>
            <div><span>Stretch high</span><strong>{fmtPrice(range?.stretchHigh)}</strong></div>
          </div>
          <p className="gm26-card-note">{range?.estimateDisclaimer ?? "No verified expected-range estimate is available."}</p>
        </article>
      </section>

      <section className="gm26-card gm26-scenario-card">
        <div className="gm26-section-title"><div><span className="gm26-eyebrow">PRIMARY SCENARIO</span><h2>{primaryScenario?.label ?? "No primary scenario published"}</h2></div></div>
        {primaryScenario ? (
          <div className="gm26-scenario-flow">
            <div><span>Trigger</span><strong>{primaryScenario.trigger}</strong></div>
            <ArrowRight aria-hidden />
            <div><span>First target</span><strong>{primaryScenario.firstTarget}</strong></div>
            <ArrowRight aria-hidden />
            <div><span>Second target</span><strong>{primaryScenario.secondTarget}</strong></div>
          </div>
        ) : null}
      </section>

      <section className="gm26-card gm26-invalidation-card">
        <Ban size={20} aria-hidden />
        <div>
          <span className="gm26-eyebrow">SETUP FAILS IF</span>
          <h2>{geometry.invalidation ?? primaryScenario?.invalidation ?? "No verified invalidation published"}</h2>
        </div>
      </section>

      {alternativeScenario ? (
        <details className="gm26-advanced">
          <summary>Alternative scenario</summary>
          <div className="gm26-alternative">
            <h3>{alternativeScenario.label}</h3>
            <p><strong>Trigger:</strong> {alternativeScenario.trigger}</p>
            <p><strong>Target:</strong> {alternativeScenario.firstTarget}</p>
            <p><strong>Invalidation:</strong> {alternativeScenario.invalidation}</p>
          </div>
        </details>
      ) : null}

      <div className="gm26-day-reasons">
        {[plan?.oneSentence, plan?.timeframeAlignment?.conclusion, range?.reasons?.[0]]
          .filter((v): v is string => Boolean(v))
          .map((reason, index) => <span key={`${reason}-${index}`}><CheckCircle2 size={15} aria-hidden />{reason}</span>)}
      </div>
    </div>
  );
}
