import { useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";
import type { AdminMarketFeedStatus as AdminMarketFeedStatusType } from "../../types/models";
import { MarketFeedStatus } from "./MarketFeedStatus";

export function AdminMarketFeedStatus() {
  const { api, account } = useAuth();
  const isAdmin = account?.role === "OWNER" || account?.role === "ADMIN";
  const [status, setStatus] = useState<AdminMarketFeedStatusType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    void api
      .adminMarketFeedStatus()
      .then((next) => {
        setStatus(next);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Admin feed status unavailable."));
  }, [api, isAdmin]);

  if (!isAdmin) return null;

  return (
    <section className="gm-admin-feed-status" data-testid="admin-market-feed-status">
      <h2>Admin market-feed status</h2>
      <MarketFeedStatus health={status?.health ?? null} error={error} />
      {status?.sharedWebhookUrl && (
        <p className="gm-meta url-break" data-testid="admin-shared-webhook">
          Shared webhook URL for 1M / 5M / 15M: {status.sharedWebhookUrl}
        </p>
      )}
      {status?.checklist?.length ? (
        <ul className="gm-admin-feed-checklist">
          {status.checklist.map((item) => (
            <li key={item.id} data-status={item.status}>
              <strong>{item.label}</strong>
              {item.detail && <span>{item.detail}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="gm-meta">Admin checklist will appear when the feed API returns details.</p>
      )}
      {status?.legacyTraffic && (
        <p className="gm-meta" data-testid="legacy-traffic-status">
          {status.legacyTraffic.recentDetected
            ? status.legacyTraffic.label ?? "Recent legacy traffic detected"
            : "No recent legacy traffic detected"}
        </p>
      )}
    </section>
  );
}
