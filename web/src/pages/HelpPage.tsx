import { Link } from "react-router-dom";
import { GLOSSARY } from "../lib/glossary";
import { PageHeader, SectionCard } from "../components/ui/primitives";

/** Beginner-friendly help centre — how to use GoldMeta today. */
export function HelpPage() {
  return (
    <div className="gm-help-page" data-testid="help-page">
      <PageHeader title="Help" freshness="Beginner-friendly guide" />

      <SectionCard title="How to use GoldMeta today">
        <ol className="gm-help-steps" data-testid="first-use-guide">
          <li>
            Open <Link to="/">Plan</Link>.
          </li>
          <li>Read BUY / SELL / WAIT / NO TRADE.</li>
          <li>Check Entry, Stop and TP1 when the plan is valid.</li>
          <li>Wait for 5-minute confirmation that matches the plan.</li>
          <li>
            Calculate risk in the <Link to="/planner">Risk Planner</Link>.
          </li>
          <li>Place the trade manually only when you are personally satisfied.</li>
          <li>
            Record the outcome in <Link to="/journal">Journal</Link>.
          </li>
        </ol>
        <p className="gm-meta" data-testid="help-analysis-disclaimer">
          GoldMeta is analysis only. There is no profit guarantee. AutoTrade stays OFF. Broker
          execution stays disabled.
        </p>
      </SectionCard>

      <SectionCard title="Quick topics">
        <div className="gm-glossary" data-testid="help-topics">
          {[
            {
              id: "buy",
              term: "What BUY means",
              detail:
                "GoldMeta sees a bullish manual plan. Enter only after confirmation and your own risk check."
            },
            {
              id: "wait",
              term: "What WAIT means",
              detail: "Conditions are incomplete. Stay flat until the next verified signal."
            },
            {
              id: "no-trade",
              term: "What NO TRADE means",
              detail: "Do not enter. Data mismatch, unsafe geometry, or blocked conditions."
            },
            {
              id: "entry",
              term: "Entry zone",
              detail: "The price area where a manual entry is considered. Stay patient until price arrives."
            },
            {
              id: "stop",
              term: "Stop",
              detail: "The invalidation price. If price breaks and holds beyond it, the plan ends."
            },
            {
              id: "tp",
              term: "TP1 and TP2",
              detail: "First and second targets. TP1 should leave enough room versus the stop."
            },
            {
              id: "quality",
              term: "Plan quality",
              detail: "A/B plans may be tradeable when geometry is valid. C / incomplete plans are never actionable."
            },
            {
              id: "tf",
              term: "4H / 1H / 15M / 5M",
              detail: "Wider context, session bias, plan structure, and entry confirmation."
            },
            {
              id: "pine",
              term: "Pine setup",
              detail: "Install PLAN 15M and CONFIRM 5M alerts. QUOTE 1M is optional."
            },
            {
              id: "risk",
              term: "Risk planner",
              detail: "Size the trade from balance, risk %, entry and stop. Never places orders."
            },
            {
              id: "fail",
              term: "Why plans can fail",
              detail: "Markets move. Confirmation can fail. Stops can be hit. Treat every plan as uncertain."
            }
          ].map((item) => (
            <details key={item.id} className="gm-disclosure" data-testid={`help-topic-${item.id}`}>
              <summary>
                <span className="gm-glossary-term">{item.term}</span>
              </summary>
              <div className="gm-disclosure-body">
                <p style={{ margin: 0 }}>{item.detail}</p>
              </div>
            </details>
          ))}
        </div>
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

      <SectionCard title="What to do next">
        <ul className="gm-help-list">
          <li>
            <Link to="/">Open Plan</Link> for today’s gold decision.
          </li>
          <li>
            <Link to="/intelligence">Markets</Link> for session context.
          </li>
          <li>
            <Link to="/tradingview">TradingView Setup</Link> for alert roles.
          </li>
          <li>
            <Link to="/legal/risk">Risk disclosure</Link> — CFDs are high risk.
          </li>
        </ul>
      </SectionCard>
    </div>
  );
}
