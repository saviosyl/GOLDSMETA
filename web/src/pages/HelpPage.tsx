import { Link } from "react-router-dom";
import { GLOSSARY } from "../lib/glossary";
import { PageHeader, SectionCard } from "../components/ui/primitives";

/** First-use guide + beginner glossary. */
export function HelpPage() {
  return (
    <div className="gm-help-page" data-testid="help-page">
      <PageHeader title="Help" freshness="Beginner-friendly guide" />

      <SectionCard title="Welcome to GoldMeta">
        <ol className="gm-help-steps" data-testid="first-use-guide">
          <li>Check the market decision (BUY, SELL, or WAIT).</li>
          <li>Read the reasons in plain language.</li>
          <li>Review entry, stop loss and targets when a plan exists.</li>
          <li>Keep trading in Manual mode initially.</li>
          <li>Connect a Demo broker only when ready.</li>
          <li>Never risk money you cannot afford to lose.</li>
        </ol>
        <p className="gm-meta" data-testid="help-analysis-disclaimer">
          GoldMeta provides trading analysis, not guaranteed results.
        </p>
        <p className="gm-meta" style={{ marginBottom: 0 }}>
          GoldMeta is analysis-first. Broker trading stays locked until a separate, approved setup is
          complete. AutoTrade remains OFF.
        </p>
      </SectionCard>

      <SectionCard title="What to do next">
        <ul className="gm-help-list">
          <li>
            <Link to="/">Open the Dashboard</Link> for today’s gold decision.
          </li>
          <li>
            <Link to="/brokers">Broker Control Centre</Link> — connect Demo later; no orders from
            setup screens.
          </li>
          <li>
            <Link to="/settings">Profile &amp; settings</Link> — account preferences and alerts.
          </li>
          <li>
            <Link to="/legal/risk">Risk disclosure</Link> — CFDs are high risk.
          </li>
        </ul>
      </SectionCard>

      <SectionCard title="Plain-language glossary">
        <div className="gm-glossary" data-testid="help-glossary">
          {GLOSSARY.map((item) => (
            <details key={item.id} className="gm-disclosure" data-testid={`glossary-${item.id}`}>
              <summary>
                <span className="gm-glossary-term">{item.term}</span>
                <span className="gm-meta"> — {item.short}</span>
              </summary>
              <div className="gm-disclosure-body">
                <p style={{ margin: 0 }}>{item.detail}</p>
              </div>
            </details>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Pepperstone connection (read-only prep)">
        <p>
          TradingView alone is not enough for secure broker automation. A Pepperstone{" "}
          <strong>cTrader Demo</strong> account and a registered <strong>cTrader Open API</strong>{" "}
          application are required before GoldMeta can run read-only checks.
        </p>
        <ul className="gm-help-list">
          <li>Never paste your broker password into GoldMeta.</li>
          <li>Never commit API secrets to GitHub.</li>
          <li>Secrets belong in Secret Manager on the server only.</li>
          <li>Read-only verification happens before any Demo trading approval.</li>
        </ul>
        <p className="gm-meta" style={{ marginBottom: 0 }}>
          Owners: open Broker Control Centre → Pepperstone for the step-by-step setup checklist.
        </p>
      </SectionCard>
    </div>
  );
}
