import { Link } from "react-router-dom";
import { ExplainThisPage } from "./ExplainThisPage";

type Props = {
  onRefresh: () => void;
  refreshing?: boolean;
  validPlan?: boolean;
};

/**
 * Sticky mobile actions above bottom nav.
 * Notify scrolls to the phone-alerts control (permission is never requested automatically).
 */
export function StickyMobileActionBar({
  onRefresh,
  refreshing = false,
  validPlan = false
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
      ) : (
        <button
          type="button"
          className="gm-btn-outline gm-action-bar-btn"
          data-testid="action-bar-notify"
          title="Jump to phone alerts"
          onClick={() => {
            const el = document.querySelector('[data-testid="phone-alerts-control"]');
            el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            if (el instanceof HTMLElement) {
              el.focus();
            }
          }}
        >
          Enable alerts
        </button>
      )}
      <ExplainThisPage compact />
    </div>
  );
}
