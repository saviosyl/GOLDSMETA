import { AlertTriangle, ArrowDownRight, ArrowUpRight, Clock3, RefreshCw, ShieldCheck } from "lucide-react";
import { ConfidenceMeter } from "../components/redesign/ConfidenceMeter";
import { LiveTradeChart, type TradeChartLevel } from "../components/redesign/LiveTradeChart";
import { useGoldMetaMarketView } from "../hooks/useGoldMetaMarketView";
import { fmtPrice } from "../lib/intradayFormat";

function toneClass(action: "BUY" | "SELL" | "WAIT") {
  return `gm26-tone-${action.toLowerCase()}`;
}

function conditionLabel(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  return String(value).replace(/_/g, " ").toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

export function HomePage() {
  const market = useGoldMetaMarketView();
  const { plan, decision } = market;

  const chartLevels: TradeChartLevel[] = [
    { id: "resistance", label: "RES", price: market.resistance, tone: "sell" },
    { id: "vah", label: "VAH", price: market.vah, tone: "gold" },
    { id: "poc", label: "POC", price: market.poc, tone: "gold", emphasis: "primary" },
    { id: "val", label: "VAL", price: market.val, tone: "gold" },
    { id: "support", label: "SUP", price: market.support, tone: "buy" }
  ];

  const momentum = market.trendStrength != null
    ? market.trendStrength >= 30
      ? "Strong"
      : market.trendStrength >= 20
        ? "Moderate"
        : "Weak"
    : plan?.marketType === "HIGH_VOLATILITY"
      ? "Fast"
      : "Normal";

  const volatility = conditionLabel(plan?.marketType, decision?.marketRegime ? conditionLabel(decision.marketRegime, "Normal") : "Normal");
  const next =
    market.action === "WAIT"
      ? plan?.whyNotReady ?? plan?.trigger ?? "Wait for a verified GoldMeta trigger before acting."
      : plan?.trigger ?? market.tradeGeometry.management ?? "Follow the published setup and invalidation levels.";

  return (
    <div className="gm26-page gm26-home" data-testid="gm26-home-page">
      <div className="gm26-page-heading">
        <div>
          <span className="gm26-eyebrow">XAUUSD MARKET INTELLIGENCE</span>
          <h1>Gold right now</h1>
        </div>
        <button className="gm26-icon-action" type="button" onClick={market.refresh} disabled={market.refreshing}>
          <RefreshCw size={17} aria-hidden />
          {market.refreshing ? "Refreshing" : "Refresh"}
        </button>
      </div>

      {market.error ? (
        <div className="gm26-alert gm26-alert--warning" role="status">
          <AlertTriangle size={17} aria-hidden />
          <span>{market.error}</span>
        </div>
      ) : null}

      <section className={`gm26-hero ${toneClass(market.action)}`} aria-label={`GoldMeta decision ${market.action}`}>
        <div className="gm26-hero__market">
          <div className="gm26-live-pill">
            <span className={market.marketClosed ? "is-closed" : "is-live"} />
            {market.marketClosed ? "MARKET CLOSED" : "LIVE"}
          </div>
          <div className="gm26-hero__price-row">
            <div>
              <span>XAUUSD</span>
              <strong>{market.livePrice != null ? fmtPrice(market.livePrice) : "—"}</strong>
            </div>
            <div className="gm26-session-chip">
              <Clock3 size={15} aria-hidden />
              {market.session}
            </div>
          </div>
        </div>

        <div className="gm26-hero__decision">
          <div className="gm26-hero__signal-row">
            <div className="gm26-action-badge">
              {market.action === "BUY" ? <ArrowUpRight aria-hidden /> : market.action === "SELL" ? <ArrowDownRight aria-hidden /> : null}
              <span>{market.action}</span>
            </div>
            <div className="gm26-hero__bias">
              <span>Market direction</span>
              <strong>{market.direction}</strong>
            </div>
          </div>

          <ConfidenceMeter action={market.action} confidence={market.confidence} />

          <p className="gm26-hero__explanation">{market.explanation}</p>
        </div>
      </section>

      <section className="gm26-quick-grid" aria-label="Quick Gold summary">
        <article>
          <span>Trend</span>
          <strong>{market.direction}</strong>
        </article>
        <article>
          <span>Momentum</span>
          <strong>{momentum}</strong>
        </article>
        <article>
          <span>Volatility</span>
          <strong>{volatility}</strong>
        </article>
        <article>
          <span>Price location</span>
          <strong>{conditionLabel(plan?.valueLocation, "Unknown")}</strong>
        </article>
      </section>

      <section className="gm26-level-strip" aria-label="Essential market levels">
        <div className="is-support">
          <span>Support</span>
          <strong>{fmtPrice(market.support)}</strong>
        </div>
        <div className="is-poc">
          <span>POC</span>
          <strong>{fmtPrice(market.poc)}</strong>
        </div>
        <div className="is-resistance">
          <span>Resistance</span>
          <strong>{fmtPrice(market.resistance)}</strong>
        </div>
      </section>

      <LiveTradeChart
        title="Live Gold chart"
        subtitle="Market structure first — trade levels appear on the dedicated Short-Term and Day Trade screens."
        levels={chartLevels}
        defaultTimeframe="M15"
        currentPrice={market.livePrice}
        marketClosed={market.marketClosed}
      />

      <section className="gm26-card gm26-next-card">
        <div className="gm26-section-title">
          <div>
            <span className="gm26-eyebrow">WHAT HAPPENS NEXT?</span>
            <h2>{market.action === "WAIT" ? "What GoldMeta is waiting for" : "What to watch now"}</h2>
          </div>
          <span className={`gm26-small-signal ${toneClass(market.action)}`}>{market.action}</span>
        </div>
        <p className="gm26-next-copy">{next}</p>
        <div className="gm26-next-grid">
          <div>
            <span>Trigger</span>
            <strong>{plan?.trigger ?? "No verified trigger published"}</strong>
          </div>
          <div>
            <span>Invalidation</span>
            <strong>{market.tradeGeometry.invalidation ?? "No verified invalidation published"}</strong>
          </div>
        </div>
      </section>

      <section className="gm26-content-grid">
        <article className="gm26-card">
          <div className="gm26-section-title">
            <div>
              <span className="gm26-eyebrow">MARKET STRUCTURE</span>
              <h2>Important levels</h2>
            </div>
          </div>
          <div className="gm26-structure-list">
            <div><span>VAH</span><strong>{fmtPrice(market.vah)}</strong></div>
            <div><span>POC</span><strong>{fmtPrice(market.poc)}</strong></div>
            <div><span>VAL</span><strong>{fmtPrice(market.val)}</strong></div>
            <div><span>Nearest support</span><strong>{fmtPrice(market.support)}</strong></div>
            <div><span>Nearest resistance</span><strong>{fmtPrice(market.resistance)}</strong></div>
          </div>
        </article>

        <article className="gm26-card">
          <div className="gm26-section-title">
            <div>
              <span className="gm26-eyebrow">MARKET RISK</span>
              <h2>High-impact news</h2>
            </div>
          </div>
          <div className="gm26-news-unavailable">
            <AlertTriangle size={19} aria-hidden />
            <div>
              <strong>Economic calendar not connected</strong>
              <p>GoldMeta will not label news risk as low unless a verified calendar source confirms it.</p>
            </div>
          </div>
        </article>
      </section>

      <details className="gm26-advanced">
        <summary>Advanced market details</summary>
        <div className="gm26-advanced__body">
          <div><span>Market regime</span><strong>{conditionLabel(decision?.marketRegime, "Unavailable")}</strong></div>
          <div><span>Data quality</span><strong>{decision?.dataQuality ?? "Unavailable"}</strong></div>
          <div><span>Structure mode</span><strong>{market.marketStructureMode ?? "Unavailable"}</strong></div>
          <div><span>Quote age</span><strong>{plan?.freshness?.quoteAgeSeconds != null ? `${plan.freshness.quoteAgeSeconds}s` : "—"}</strong></div>
          <div><span>Signal age</span><strong>{plan?.freshness?.signalAgeSeconds != null ? `${plan.freshness.signalAgeSeconds}s` : "—"}</strong></div>
        </div>
      </details>

      <div className="gm26-safety-note">
        <ShieldCheck size={16} aria-hidden />
        <span>Analysis presentation only. Gold Hunter remains a separate automated system.</span>
      </div>
    </div>
  );
}
