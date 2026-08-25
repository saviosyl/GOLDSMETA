import { NavLink, Navigate, useParams } from "react-router-dom";
import { HistoryPage } from "./HistoryPage";
import { ReplayPage } from "./ReplayPage";

const TABS = [
  { id: "history", label: "History", path: "/history-replay/history" },
  { id: "replay", label: "Replay", path: "/history-replay/replay" }
] as const;

type TabId = (typeof TABS)[number]["id"];

function isTab(value: string | undefined): value is TabId {
  return value === "history" || value === "replay";
}

export function HistoryReplayPage() {
  const { tab } = useParams<{ tab?: string }>();
  const active: TabId = isTab(tab) ? tab : "history";

  if (tab && !isTab(tab)) {
    return <Navigate to="/history-replay/history" replace />;
  }

  return (
    <div className="gm-section gm-history-replay-page gm-premium-v2" data-testid="history-replay-page">
      <header className="gm-page-head">
        <h1 className="gm-page-title">History &amp; Replay</h1>
        <p className="gm-meta">Review past decisions and step through market candles.</p>
      </header>

      <div className="gm-tabs" role="tablist" aria-label="History and Replay">
        {TABS.map((t) => (
          <NavLink
            key={t.id}
            to={t.path}
            role="tab"
            aria-selected={active === t.id}
            className={({ isActive }) => (isActive || active === t.id ? "active" : undefined)}
            data-testid={`history-replay-tab-${t.id}`}
          >
            {t.label}
          </NavLink>
        ))}
      </div>

      <div data-testid={`history-replay-panel-${active}`}>
        {active === "history" ? <HistoryPage embedded /> : null}
        {active === "replay" ? <ReplayPage embedded /> : null}
      </div>
    </div>
  );
}
