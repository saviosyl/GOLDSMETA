import { Activity, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { MarketFeedHealth } from "../../types/models";

type Props = {
  health?: MarketFeedHealth | null;
  detailsHref?: string;
};

export function FeedStatusStrip({ health, detailsHref = "/alerts" }: Props) {
  const status = health?.status ?? "unknown";
  const Icon =
    status === "green" ? CheckCircle2 : status === "amber" ? AlertTriangle : Activity;
  const title =
    status === "green"
      ? "Market feed connected"
      : status === "amber"
        ? "Market feed partially available"
        : status === "red"
          ? "Market feed unavailable"
          : "Market feed status unavailable";
  const detail =
    health?.subtitle ||
    (status === "green"
      ? "15M plan and quotes active"
      : status === "amber"
        ? "Some plan or confirmation data may be stale"
        : "Waiting for a verified feed update");

  return (
    <div className="gm-feed-strip" data-testid="premium-feed-bar" data-status={status}>
      <Icon size={18} aria-hidden />
      <strong>{title}</strong>
      <span>{detail}</span>
      <a href={detailsHref} data-testid="premium-feed-details">
        View details
      </a>
    </div>
  );
}
