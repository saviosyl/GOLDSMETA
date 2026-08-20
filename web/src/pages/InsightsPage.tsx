import { Link, NavLink, Navigate, useParams } from "react-router-dom";
import { SignalPerformancePage } from "./SignalPerformancePage";
import { V4ResearchPage } from "./V4ResearchPage";

/** Insights hub — Performance / Signals / Strategy (chunk-recovery friendly). */
const TABS = [
  { id: "performance", label: "Performance", path: "/insights/performance" },
  { id: "signals", label: "Signals", path: "/insights/signals" },
  { id: "strategy", label: "Strategy", path: "/insights/strategy" }
] as const;

type TabId = (typeof TABS)[number]["id"];

function isTab(value: string | undefined): value is TabId {
  return value === "performance" || value === "signals" || value === "strategy";
}

export function InsightsPage() {
  const { tab } = useParams<{ tab?: string }>();
  const active: TabId = isTab(tab) ? tab : "performance";

  if (tab && !isTab(tab)) {
    return <Navigate to="/insights/performance" replace />;
  }

  return (
    <div className="gm-section gm-insights-page gm-premium-v2" data-testid="insights-page">
      <header className="gm-page-head">
        <h1 className="gm-page-title">Insights</h1>
        <p className="gm-meta">
          Performance, signal research, and strategy observation — clearly separated.
        </p>
      </header>

      <div className="gm-tabs gm-insights-tabs" role="tablist" aria-label="Insights sections">
        {TABS.map((t) => (
          <NavLink
            key={t.id}
            to={t.path}
            role="tab"
            aria-selected={active === t.id}
            className={({ isActive }) => (isActive || active === t.id ? "active" : undefined)}
            data-testid={`insights-tab-${t.id}`}
          >
            {t.label}
          </NavLink>
        ))}
      </div>

      <div className="gm-insights-panel" data-testid={`insights-panel-${active}`}>
        {active === "performance" ? (
          <div className="gm-insights-signals" data-testid="insights-autotrade-retired">
            <div className="gm-banner gm-banner-info">
              <strong>Gold Hunter is the AutoTrade UI</strong>
              <p>
                Core AutoTrade and FAST AutoTrade were removed. Automated trading performance lives
                in Gold Hunter.
              </p>
              <p>
                <Link to="/gold-hunter/performance">Open Gold Hunter performance</Link>
              </p>
            </div>
          </div>
        ) : null}
        {active === "signals" ? (
          <div className="gm-insights-signals">
            <div className="gm-banner gm-banner-info" data-testid="hypothetical-signal-banner">
              <strong>Hypothetical signal results</strong>
              <p>
                These figures are research outcomes from GoldMeta signals — not broker Demo or Live
                P/L.
              </p>
            </div>
            <SignalPerformancePage embedded />
          </div>
        ) : null}
        {active === "strategy" ? <V4ResearchPage embedded /> : null}
      </div>
    </div>
  );
}
