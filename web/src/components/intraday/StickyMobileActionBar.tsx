import { Link } from "react-router-dom";
import { ExplainThisPage } from "./ExplainThisPage";

type Props = {
  onRefresh: () => void;
  refreshing?: boolean;
  validPlan?: boolean;
  notifySupported?: boolean;
};

/**
 * Sticky mobile actions above bottom nav.
 * Notify opens an in-app preference note only — never claims push is active.
 */
export function StickyMobileActionBar({
  onRefresh,
  refreshing = false,
  validPlan = false,
  notifySupported = false
}: Props) {
  return (
    <div
      className="gm-mobile-action-bar"
      data-testid="mobile-action-bar"
      role="toolbar"
      aria-label="Plan actions"
    >
      <button
        type="button"
        className="gm-btn-outline gm-action-bar-btn"
        data-testid="action-bar-refresh"
        onClick={onRefresh}
        disabled={refreshing}
        aria-busy={refreshing}
      >
        {refreshing ? "Refreshing…" : "Refresh"}
      </button>
      {validPlan ? (
        <Link
          className="gm-btn-outline gm-action-bar-btn"
          to="/planner"
          data-testid="action-bar-risk-planner"
        >
          Open Risk Planner
        </Link>
      ) : notifySupported ? (
        <Link
          className="gm-btn-outline gm-action-bar-btn"
          to="/settings"
          data-testid="action-bar-notify"
        >
          Notify me
        </Link>
      ) : (
        <button
          type="button"
          className="gm-btn-outline gm-action-bar-btn"
          data-testid="action-bar-notify"
          title="In-app reminder preferences — push notifications are not active."
          onClick={() => {
            const el = document.querySelector('[data-testid="notify-preference-note"]');
            el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            if (el instanceof HTMLElement) {
              el.hidden = false;
              el.focus();
            }
          }}
        >
          Notify me
        </button>
      )}
      <ExplainThisPage compact />
    </div>
  );
}
