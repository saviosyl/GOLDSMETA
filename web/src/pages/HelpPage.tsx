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
        term: "Gold Hunter risk",
        detail: "Automated trading risk lives under Gold Hunter. Core AutoTrade and FAST AutoTrade were removed."
      }
    ]
  },
  {
    id: "autotrade",
    title: "Automated trading",
    items: [
      {
        id: "qual",
        term: "Core qualification (removed)",
        detail:
          "Core AutoTrade qualification and Demo Auto qualification were removed. Gold Hunter is the only AutoTrade UI."
      },
      {
        id: "demo-live",
        term: "Demo vs Live",
        detail: "Demo uses practice funds. Live money execution remains hard-locked."
      },
      {
        id: "how-autotrade",
        term: "How automated trading works",
        detail:
          "Gold Hunter is the AutoTrade UI. Core AutoTrade and FAST AutoTrade were removed. Live Auto stays locked."
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
        detail: "Connect a Demo account for broker quotes and Gold Hunter. Reconnect only when the connection is unhealthy."
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
          placeholder="Gold Hunter, risk, broker…"
          data-testid="help-search"
        />
      </label>

      <SectionCard title="Quick start">
        <p className="gm-meta" style={{ marginTop: 0 }}>
          New to trading? Start with{" "}
          <Link to="/learn" data-testid="help-to-learn">
            Learn GoldMeta
          </Link>{" "}
          — simple lessons with audio.
        </p>
        <ol className="gm-help-steps" data-testid="first-use-guide">
          <li>
            Open <Link to="/">Plan</Link> and read the decision.
          </li>
          <li>Understand BUY / SELL / HOLD / WAIT and what GoldMeta is waiting for.</li>
          <li>
            Review risk in the <Link to="/planner">Risk Planner</Link> or Gold Hunter (staff).
          </li>
          <li>
            Follow <Link to="/gold-hunter">Gold Hunter</Link> or your manual workflow. Core AutoTrade
            qualification was removed.
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
