import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { GLOSSARY } from "../lib/glossary";
import { PageHeader, SectionCard } from "../components/ui/primitives";

const TOPIC_GROUPS: Array<{
  id: string;
  title: string;
  items: Array<{ id: string; term: string; detail: string }>;
}> = [
  {
    id: "decisions",
    title: "Trading decisions",
    items: [
      {
        id: "buy",
        term: "What BUY means",
        detail:
          "GoldMeta sees a bullish plan. Enter only after confirmation and your own risk check."
      },
      {
        id: "wait",
        term: "What WAIT / HOLD means",
        detail: "Conditions are incomplete. Stay flat until the next verified signal."
      },
      {
        id: "entry",
        term: "Entry, stop and targets",
        detail: "Entry is the area to consider. Stop is invalidation. TP levels are targets, not guarantees."
      }
    ]
  },
  {
    id: "risk",
    title: "Risk",
    items: [
      {
        id: "planner",
        term: "Risk Planner",
        detail: "Manual calculator for position size. It never places orders."
      },
      {
        id: "auto-risk",
        term: "AutoTrade risk",
        detail: "Daily trade limits, loss limits and cooldowns live under AutoTrade → Risk."
      }
    ]
  },
  {
    id: "autotrade",
    title: "AutoTrade & qualification",
    items: [
      {
        id: "qual",
        term: "Qualification",
        detail:
          "Preview setups, controlled Demo trades, then observation before Demo Auto can be enabled. Live stays locked until separate activation."
      },
      {
        id: "demo-live",
        term: "Demo vs Live",
        detail: "Demo uses practice funds. Live money execution remains hard-locked until you complete activation."
      },
      {
        id: "how-autotrade",
        term: "How AutoTrade works",
        detail:
          "GoldMeta evaluates verified strategy plans against your risk rules. Qualification previews setups, then controlled Demo trades, then observation. Demo Auto can place practice orders only after you enable it. Live Auto stays locked until separate activation."
      }
    ]
  },
  {
    id: "broker",
    title: "Broker",
    items: [
      {
        id: "pepperstone",
        term: "Pepperstone cTrader",
        detail: "Connect a Demo account for qualification. Reconnect only when the connection is unhealthy."
      }
    ]
  },
  {
    id: "charts",
    title: "Charts & levels",
    items: [
      {
        id: "levels",
        term: "Support, resistance and value",
        detail: "Plan shows key levels on the chart. Full level maps live under More → Levels."
      }
    ]
  },
  {
    id: "notifications",
    title: "Notifications",
    items: [
      {
        id: "alerts",
        term: "Alerts",
        detail: "Use the bell icon for notification preferences. TradingView feed setup is for owners/admins."
      }
    ]
  },
  {
    id: "account",
    title: "Account & security",
    items: [
      {
        id: "settings",
        term: "Settings",
        detail: "Profile, appearance, security and legal links live under Settings."
      }
    ]
  }
];

/** Beginner-friendly help centre — how to use GoldMeta today. */
export function HelpPage() {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    if (!q) return TOPIC_GROUPS;
    return TOPIC_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter(
        (i) => i.term.toLowerCase().includes(q) || i.detail.toLowerCase().includes(q)
      )
    })).filter((g) => g.items.length > 0);
  }, [q]);

  return (
    <div className="gm-help-page" data-testid="help-page">
      <PageHeader title="Help" freshness="How can we help?" />

      <label className="gm-help-search" htmlFor="help-search">
        <span className="gm-label">Search help</span>
        <input
          id="help-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Qualification, risk, broker…"
          data-testid="help-search"
        />
      </label>

      <SectionCard title="Quick start">
        <ol className="gm-help-steps" data-testid="first-use-guide">
          <li>
            Open <Link to="/">Plan</Link> and read the decision.
          </li>
          <li>Understand BUY / SELL / HOLD / WAIT and what GoldMeta is waiting for.</li>
          <li>
            Review risk in the <Link to="/planner">Risk Planner</Link> or AutoTrade risk settings.
          </li>
          <li>
            Follow <Link to="/autotrade">AutoTrade</Link> qualification or your manual workflow.
          </li>
          <li>
            Review the outcome in <Link to="/journal">Journal</Link> and{" "}
            <Link to="/insights">Insights</Link>.
          </li>
        </ol>
        <p className="gm-meta" data-testid="help-analysis-disclaimer">
          GoldMeta is a trading assistant. There is no profit guarantee. Live execution remains
          locked until separately activated. Always apply your own risk management.
        </p>
      </SectionCard>

      {groups.map((group) => (
        <SectionCard key={group.id} title={group.title}>
          <div className="gm-glossary" data-testid={`help-topics-${group.id}`}>
            {group.items.map((item) => (
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
      ))}

      <SectionCard title="Glossary">
        <details className="gm-disclosure" data-testid="help-glossary" open={Boolean(q)}>
          <summary>Plain-language glossary</summary>
          <div className="gm-glossary">
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
        </details>
      </SectionCard>
    </div>
  );
}
