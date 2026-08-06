import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { PhoneAlertsControl } from "../components/decision/PhoneAlertsControl";
import { MarketFeedStatus } from "../components/decision/MarketFeedStatus";
import type {
  AdminMarketFeedStatus,
  InAppNotification,
  MarketFeedHealth,
  NotificationEventGroup,
  NotificationPreferences
} from "../types/models";
import { formatCompactLocalTime, loadTimezonePreference } from "../lib/timezone";

const PREF_ROWS: Array<{ key: NotificationEventGroup; label: string }> = [
  { key: "VALID_PLAN_CREATED", label: "Valid plan ready" },
  { key: "ENTRY_ZONE_REACHED", label: "Entry zone reached" },
  { key: "CONFIRM_5M", label: "5m confirmation received" },
  { key: "PLAN_INVALIDATED", label: "Plan invalidated" },
  { key: "TARGETS_REACHED", label: "TP1 reached" }
];

type ChecklistItem = {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail" | "optional" | string;
  detail?: string | null;
};

function StandardSetupChecklist({
  checklist,
  sharedWebhookUrl
}: {
  checklist: ChecklistItem[];
  sharedWebhookUrl?: string | null;
}) {
  const defaults: ChecklistItem[] = [
    { id: "pine30", label: "Pine 3.0 installed", status: "warn" },
    { id: "plan15m", label: "PLAN_15M received", status: "warn" },
    { id: "confirm5m", label: "CONFIRM_5M received", status: "warn" },
    { id: "quote1m", label: "QUOTE_1M optional", status: "optional" },
    { id: "legacy", label: "Old Pine 2.1 alert disabled", status: "warn" }
  ];

  const rows = checklist.length > 0 ? checklist : defaults;

  const allRequiredPass =
    checklist.length > 0 &&
    rows
      .filter((r) => r.status !== "optional" && !/optional/i.test(r.label))
      .every((r) => r.status === "pass");

  return (
    <section
      className={`gm-premium-setup-card${allRequiredPass ? " is-healthy" : ""}`}
      data-testid="premium-setup-health"
      id="premium-setup-health"
    >
      <div className="gm-premium-setup-head">
        <h2>GoldMeta Standard setup</h2>
        <span className={`gm-premium-chip ${allRequiredPass ? "tone-buy" : "tone-wait"}`}>
          {allRequiredPass ? "Setup complete" : "Setup in progress"}
        </span>
      </div>
      <p className="gm-meta">Same webhook URL is used for all roles (1M / 5M / 15M).</p>
      {sharedWebhookUrl ? (
        <p className="gm-meta url-break" data-testid="standard-webhook-url">
          {sharedWebhookUrl}
        </p>
      ) : null}
      <ul className="gm-premium-setup-checklist">
        {rows.map((item) => {
          const mark =
            item.status === "pass"
              ? "✓"
              : item.status === "optional" || /optional/i.test(item.label)
                ? "○"
                : "○";
          return (
            <li key={item.id} data-status={item.status}>
              <span className="gm-premium-check-mark" aria-hidden>
                {mark}
              </span>
              <div>
                <strong>{item.label}</strong>
                {item.detail ? <span>{item.detail}</span> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function AlertsSetupPage() {
  const { api, account } = useAuth();
  const isStaff = account?.role === "OWNER" || account?.role === "ADMIN";
  const tzPref = loadTimezonePreference();
  const [health, setHealth] = useState<MarketFeedHealth | null>(null);
  const [admin, setAdmin] = useState<AdminMarketFeedStatus | null>(null);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [events, setEvents] = useState<InAppNotification[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [feed, notifications, preferences] = await Promise.all([
        api.marketFeedHealth().catch(() => null),
        api.listNotifications(8).catch(() => [] as InAppNotification[]),
        api.notificationPreferences().catch(() => null)
      ]);
      setHealth(feed);
      setEvents(notifications);
      setPrefs(preferences);
      if (isStaff) {
        const adminStatus = await api.adminMarketFeedStatus().catch(() => null);
        setAdmin(adminStatus);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load alerts setup");
    }
  }, [api, isStaff]);

  useEffect(() => {
    void load();
  }, [load]);

  const togglePref = async (key: NotificationEventGroup) => {
    if (!prefs) return;
    const previous = prefs;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    try {
      const saved = await api.updateNotificationPreferences({ [key]: next[key] });
      setPrefs(saved);
    } catch {
      setPrefs(previous);
    }
  };

  const checklist = (admin?.checklist as ChecklistItem[] | undefined) ?? [];

  return (
    <div className="gm-premium-alerts-page" data-testid="alerts-setup-page">
      <div className="gm-premium-page-toolbar">
        <Link to="/" className="gm-linkish">
          ← Plan
        </Link>
        <h1>Alerts & Setup</h1>
      </div>

      {error ? (
        <p className="gm-meta" role="alert">
          {error}
        </p>
      ) : null}

      <StandardSetupChecklist
        checklist={checklist}
        sharedWebhookUrl={admin?.sharedWebhookUrl ?? null}
      />

      <section className="gm-premium-alerts-health">
        <h2>Market feed</h2>
        <MarketFeedStatus health={health ?? admin?.health ?? null} />
      </section>

      <section className="gm-premium-alerts-phone">
        <h2>Phone alerts</h2>
        <PhoneAlertsControl compact={false} />
      </section>

      <section className="gm-premium-alerts-prefs" data-testid="alerts-preferences">
        <h2>Notification preferences</h2>
        <p className="gm-meta">
          Get notified when a valid plan becomes ready — even if you are not watching the screen.
        </p>
        <ul>
          {PREF_ROWS.map((row) => (
            <li key={row.key}>
              <label className="gm-check-row">
                <input
                  type="checkbox"
                  checked={Boolean(prefs?.[row.key])}
                  disabled={!prefs}
                  onChange={() => void togglePref(row.key)}
                />
                <span>{row.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="gm-premium-recent-alerts" data-testid="recent-alerts">
        <h2>Recent alerts</h2>
        {events.length === 0 ? (
          <p className="gm-meta">No recent alerts yet.</p>
        ) : (
          <ul>
            {events.map((event) => (
              <li key={event.id}>
                <strong>{String(event.event).replace(/_/g, " ")}</strong>
                <p>{event.message}</p>
                <span className="gm-meta">
                  {formatCompactLocalTime(event.createdAt ?? null, tzPref)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
