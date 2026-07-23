import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import type {
  BrokerControlCentreResponse,
  CTraderDemonstrationBundle
} from "../../lib/broker/ctraderTypes";

/**
 * Broker Control Centre — MANUAL / T212 / Pepperstone cTrader / IG parked.
 * AutoTrade remains OFF. No order submission. Demonstration data clearly labelled.
 */
export function BrokerControlCentrePage() {
  const { api } = useAuth();
  const [centre, setCentre] = useState<BrokerControlCentreResponse | null>(null);
  const [demo, setDemo] = useState<CTraderDemonstrationBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDemo, setShowDemo] = useState(false);
  const [selected, setSelected] = useState<string>("manual");
  const selectionTouchedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getBrokerControlCentre();
      setCentre(data);
      if (!selectionTouchedRef.current) {
        setSelected(data.defaultBroker ?? "manual");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load broker centre");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDemo = async () => {
    setShowDemo(true);
    try {
      const data = await api.getCTraderDemonstration();
      setDemo(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load demonstration");
    }
  };

  const readiness = centre?.readiness;
  const authBlocked = Boolean(readiness?.authSetupRequired);

  return (
    <div className="gm-broker-centre" data-testid="broker-control-centre">
      <header className="gm-broker-hero">
        <p className="gm-meta">Broker Control Centre</p>
        <h1 className="gm-section-title">Choose how GoldMeta connects to markets</h1>
        <p className="gm-broker-lead">
          Manual analysis stays available. Broker automation remains off. No order can be
          submitted from this screen.
        </p>
        <div className="gm-broker-status-row" aria-live="polite">
          <span className="gm-badge gm-badge-off" data-testid="autotrade-off-badge">
            AUTO TRADE OFF
          </span>
          <span className="gm-badge gm-badge-warn" data-testid="no-order-badge">
            NO ORDER SUBMISSION
          </span>
          <span className="gm-badge gm-badge-demo">DEMO PREVIEW ARCHITECTURE</span>
        </div>
      </header>

      {loading ? (
        <div className="gm-section" role="status" data-testid="broker-centre-loading">
          <div className="gm-skeleton" />
          <p>Loading broker options…</p>
        </div>
      ) : null}

      {error ? (
        <div className="gm-section gm-broker-error" role="alert">
          <p>{error}</p>
          <button type="button" className="gm-btn" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : null}

      <section className="gm-section" aria-labelledby="broker-options-heading">
        <h2 id="broker-options-heading" className="gm-section-title">
          Broker options
        </h2>
        <div className="gm-broker-grid">
          {(centre?.brokers ?? []).map((b) => (
            <button
              key={b.id}
              type="button"
              className={`gm-broker-card${selected === b.id ? " is-selected" : ""}`}
              data-testid={`broker-card-${b.id}`}
              aria-pressed={selected === b.id}
              onClick={() => {
                selectionTouchedRef.current = true;
                setSelected(b.id);
              }}
            >
              <span className={`gm-badge gm-badge-${b.badge.toLowerCase()}`}>{b.badge}</span>
              <strong>{b.name}</strong>
              <span className="gm-broker-card-status">{b.status}</span>
              <span className="gm-meta">{b.detail}</span>
            </button>
          ))}
        </div>
        <p className="gm-meta">
          Switching brokers forces AutoTrade OFF. Reconnecting never enables AutoTrade.
        </p>
      </section>

      {selected === "pepperstone_ctrader" ? (
        <section
          className="gm-section gm-ctrader-panel"
          data-testid="ctrader-setup-panel"
          aria-labelledby="ctrader-heading"
        >
          <div className="gm-demo-watermark" aria-hidden="true">
            DEMO
          </div>
          <h2 id="ctrader-heading" className="gm-section-title">
            Pepperstone cTrader CFD
          </h2>
          <p className="gm-broker-lead">
            Your existing TradingView connection can be used for manual Demo trading, but
            GoldMeta requires cTrader Open API authorization for secure automation.
          </p>

          {authBlocked ? (
            <div
              className="gm-auth-setup-required"
              data-testid="auth-setup-required"
              role="status"
            >
              <strong>AUTH SETUP REQUIRED</strong>
              <p>
                Broker connection buttons that need owner identity are disabled until
                pinned-owner Auth integrity is restored. The rest of GoldMeta remains
                usable.
              </p>
            </div>
          ) : null}

          <ol className="gm-wizard-steps">
            {(readiness?.wizardSteps ?? []).map((step) => (
              <li key={step.step} data-testid={`wizard-step-${step.step}`}>
                <span className={`gm-wizard-status gm-wizard-${step.status.toLowerCase()}`}>
                  {step.status}
                </span>
                <div>
                  <strong>
                    Step {step.step}: {step.title}
                  </strong>
                  <p className="gm-meta">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="gm-broker-actions">
            <button
              type="button"
              className="gm-btn"
              disabled={authBlocked}
              data-testid="ctrader-connect-btn"
              title={
                authBlocked
                  ? "AUTH SETUP REQUIRED"
                  : "Connect requires cTrader Open API credentials"
              }
              onClick={() => {
                void api.startCTraderOAuth().catch((e: unknown) => {
                  setError(e instanceof Error ? e.message : "OAuth start blocked");
                });
              }}
            >
              Connect cTrader ID
            </button>
            <button
              type="button"
              className="gm-btn gm-btn-secondary"
              data-testid="ctrader-demo-btn"
              onClick={() => void loadDemo()}
            >
              Open labelled demonstration
            </button>
            <Link className="gm-btn gm-btn-secondary" to="/autotrade">
              Open existing AutoTrade (T212 / IG)
            </Link>
          </div>

          <section aria-labelledby="risk-heading" className="gm-risk-box">
            <h3 id="risk-heading">Demo risk hard caps (server)</h3>
            <ul>
              <li>Max risk per trade €20</li>
              <li>Max one open XAUUSD position</li>
              <li>Max three trades per day</li>
              <li>Confidence ≥ 80% · signal age ≤ 90s</li>
              <li>Stop loss required · confirmed candle required</li>
              <li>No martingale / averaging / grid / pyramiding / blind retry</li>
            </ul>
          </section>

          <section aria-labelledby="qual-heading">
            <h3 id="qual-heading">Demo Auto qualification</h3>
            <p className="gm-meta">
              Visible progress only — Demo Auto cannot be activated in this phase.
            </p>
            <ul className="gm-qual-list">
              {(readiness?.qualification.failed ?? []).slice(0, 8).map((g) => (
                <li key={g}>
                  <span className="gm-badge gm-badge-warn">LOCKED</span> {g}
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="emergency-heading">
            <h3 id="emergency-heading">Emergency controls</h3>
            <p className="gm-meta">
              STOP AUTOMATION disables new entries only. It does not silently liquidate.
              Close / cancel actions remain future controlled operations.
            </p>
            <div className="gm-broker-actions">
              <button type="button" className="gm-btn gm-btn-danger" disabled>
                Stop Automation (future)
              </button>
              <button type="button" className="gm-btn gm-btn-secondary" disabled>
                Disconnect Broker (future)
              </button>
            </div>
          </section>
        </section>
      ) : null}

      {selected === "manual" ? (
        <section className="gm-section" data-testid="manual-broker-panel">
          <h2 className="gm-section-title">Manual mode</h2>
          <p>
            GoldMeta continues to provide BUY / SELL / WAIT analysis without any broker
            execution. Use Signal History, Outcomes and Performance as usual.
          </p>
          <Link className="gm-btn" to="/">
            Back to Dashboard
          </Link>
        </section>
      ) : null}

      {selected === "trading212_invest" ? (
        <section className="gm-section" data-testid="t212-broker-panel">
          <h2 className="gm-section-title">Trading 212 Invest</h2>
          <p>
            Practice read-only / dry-run remains on the existing AutoTrade page. Order
            automation (PR #32) stays unmerged.
          </p>
          <Link className="gm-btn" to="/autotrade">
            Open AutoTrade
          </Link>
        </section>
      ) : null}

      {selected === "ig" ? (
        <section className="gm-section" data-testid="ig-broker-panel">
          <h2 className="gm-section-title">IG — Parked</h2>
          <p>IG is not active. Existing IG Demo preview tooling remains isolated.</p>
        </section>
      ) : null}

      {showDemo && demo ? (
        <section
          className="gm-section gm-demo-fixture"
          data-testid="ctrader-demonstration"
          aria-labelledby="demo-heading"
        >
          <p className="gm-demo-banner">{demo.banner || demo.notice}</p>
          <h2 id="demo-heading" className="gm-section-title">
            Demonstration mode
          </h2>
          <p className="gm-meta">
            DEMONSTRATION DATA — NO BROKER CONNECTION — NO ORDER PLACED
          </p>
          <div className="gm-demo-grid">
            <article>
              <h3>Sample Demo account</h3>
              <p>ID {demo.account.accountIdMasked}</p>
              <p>
                {demo.account.currency} equity {demo.account.equity} · free margin{" "}
                {demo.account.freeMargin}
              </p>
              <p>
                Broker {demo.account.brokerName} ({demo.account.brokerNameSource})
              </p>
            </article>
            <article>
              <h3>Sample XAUUSD</h3>
              <p>
                {demo.symbol.symbolName} · lot {demo.symbol.lotSize} · min{" "}
                {demo.symbol.minVolume} step {demo.symbol.volumeStep}
              </p>
              <p>
                Bid {demo.quote.bid} / Ask {demo.quote.ask} · spread {demo.quote.spread} ·{" "}
                {demo.quote.marketStatus} · source {demo.quote.source}
              </p>
            </article>
            <article>
              <h3>Sample BUY preview</h3>
              <p>
                {demo.buyPreview.state} · vol {demo.buyPreview.proposedVolume} · risk €
                {demo.buyPreview.riskAmount}
              </p>
              <p className="gm-meta">{demo.buyPreview.label}</p>
            </article>
            <article>
              <h3>Sample SELL preview</h3>
              <p>
                {demo.sellPreview.state} · vol {demo.sellPreview.proposedVolume}
              </p>
            </article>
            <article>
              <h3>Blocked trade example</h3>
              <p>{demo.blockedPreview.failedGates.join(", ")}</p>
            </article>
          </div>
        </section>
      ) : null}

      <section className="gm-section" aria-labelledby="help-heading">
        <h2 id="help-heading" className="gm-section-title">
          Help
        </h2>
        <ul className="gm-help-list">
          <li>TradingView alone cannot place API-authorised cTrader orders.</li>
          <li>Create a Pepperstone cTrader Demo account, then register an Open API app.</li>
          <li>GoldMeta never collects your cTrader password.</li>
          <li>Live trading is locked and cannot be activated here.</li>
        </ul>
        <p className="gm-meta">
          See docs/CTRADER_PEPPERSTONE_SETUP.md in the repository for full setup steps.
        </p>
      </section>
    </div>
  );
}
