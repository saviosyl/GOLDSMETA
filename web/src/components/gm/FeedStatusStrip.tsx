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

  // Amber = normal wait; red = genuine feed/service fault.
  const title =
    status === "red" ? "Plan feed unavailable" : "Waiting for next verified plan";
  const detail =
    health?.subtitle ||
    (status === "red"
      ? "Strategy plan feed needs attention."
      : "Price feed connected. Waiting for the next verified strategy plan.");

  return (
    <div
      className={`gm-feed-strip gm-feed-strip--compact${
        status === "amber" ? " gm-feed-strip--wait" : ""
      }`}
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
