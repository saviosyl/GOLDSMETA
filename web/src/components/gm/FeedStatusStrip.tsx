import { AlertTriangle } from "lucide-react";
import type { MarketFeedHealth } from "../../types/models";

type Props = {
  health?: MarketFeedHealth | null;
  detailsHref?: string;
};

/**
 * Compact plan-feed notice — never dominates the Plan screen.
 * Quote / chart data are communicated separately.
 */
export function FeedStatusStrip({ health, detailsHref = "/alerts" }: Props) {
  const status = health?.status ?? "unknown";
  if (status === "green" || status === "unknown") {
    return (
      <p className="gm-sr-only" data-testid="premium-feed-bar" data-status={status}>
        {status === "green" ? "Plan feed connected" : "Plan feed status loading"}
      </p>
    );
  }

  const title =
    status === "amber" ? "Plan feed waiting" : "Plan feed waiting";
  const detail =
    health?.subtitle ||
    "Latest verified 15M plan is not available.";

  return (
    <div
      className="gm-feed-strip gm-feed-strip--compact"
      data-testid="premium-feed-bar"
      data-status={status}
    >
      <AlertTriangle size={14} aria-hidden />
      <strong>{title}</strong>
      <span>{detail}</span>
      <a href={detailsHref} data-testid="premium-feed-details">
        Details
      </a>
    </div>
  );
}
