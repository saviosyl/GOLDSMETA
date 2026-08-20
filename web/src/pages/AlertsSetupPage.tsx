import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  CheckCircle2,
  ChevronLeft,
  Circle,
  Info,
  ShieldCheck
} from "lucide-react";
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

const PREF_ROWS: Array<{ key: NotificationEventGroup; label: string; description: string }> = [
  { key: "VALID_PLAN_CREATED", label: "New valid plan", description: "When a usable plan becomes ready" },
  { key: "ENTRY_ZONE_APPROACHING", label: "Entry approaching", description: "Price nears the entry zone" },
  { key: "ENTRY_ZONE_REACHED", label: "Entry zone reached", description: "Price is inside the entry zone" },
  { key: "CONFIRM_5M", label: "5M confirmation", description: "5-minute confirmation updates" },
  { key: "PLAN_INVALIDATED", label: "Plan invalidated", description: "Previous plan should not be used" },
  { key: "TARGETS_REACHED", label: "Target reached", description: "TP1 or later targets hit" }
];

type ChecklistItem = {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail" | "optional" | string;
  detail?: string | null;
};

function StandardSetupChecklist({
  checklist,
  sharedWebhookUrl,
  isStaff
}: {
  checklist: ChecklistItem[];
  sharedWebhookUrl?: string | null;
  isStaff: boolean;
}) {
  const defaults: ChecklistItem[] = [
    { id: "pine30", label: "Pine 3.0 detected", status: "warn" },
    { id: "plan15m", label: "PLAN_15M received", status: "warn" },
    { id: "confirm5m", label: "CONFIRM_5M received", status: "warn" },
    { id: "quote1m", label: "QUOTE_1M optional", status: "optional" },
    { id: "legacy", label: "No recent legacy Bridge traffic", status: "warn" }
  ];

  const normalizeLabel = (label: string) => {
    if (/pine\s*3\.0/i.test(label)) return "Pine 3.0 detected";
    if (/pine\s*2\.1|old alert|legacy/i.test(label)) return "No recent legacy Bridge traffic";
    return label;
  };
  const rows = (checklist.length > 0 ? checklist : defaults).map((item) => ({
    ...item,
    label: normalizeLabel(item.label)
  }));
  const allRequiredPass =
    checklist.length > 0 &&
    rows
      .filter((r) => r.status !== "optional" && !/optional/i.test(r.label))
      .every((r) => r.status === "pass");

  return (
    <section
      className={`gm-setup-health${allRequiredPass ? " is-healthy" : ""}`}
      data-testid="premium-setup-health"
      id="premium-setup-health"
    >
      <div className="gm-setup-health-head">
        <div>
          <h2 style={{ margin: 0, display: "flex", gap: 8, alignItems: "center", fontWeight: 800 }}>
            <ShieldCheck size={20} color="var(--success)" aria-hidden />
            {allRequiredPass ? "Setup complete" : "Setup in progress"}
          </h2>
          <p className="gm-meta" style={{ margin: "6px 0 0" }}>
            {allRequiredPass
              ? "Your GoldMeta standard setup is healthy"
              : "Complete the GoldMeta Standard setup checklist"}
          </p>
        </div>
        <span className={`gm-status-badge ${allRequiredPass ? "tone-buy" : "tone-wait"}`}>
          {allRequiredPass ? "All good" : "In progress"}
        </span>
      </div>
      <p className="gm-meta">The same webhook URL is used for all roles (1M / 5M / 15M).</p>
      {isStaff && sharedWebhookUrl ? (
        <p className="gm-meta url-break" data-testid="standard-webhook-url">
          {sharedWebhookUrl}
        </p>
      ) : null}
      <ul className="gm-setup-checklist">
        {rows.map((item) => {
          const optional = item.status === "optional" || /optional/i.test(item.label);
          const pass = item.status === "pass";
          return (
            <li key={item.id} data-status={item.status}>
              <span className="mark" aria-hidden>
                {pass ? <CheckCircle2 size={18} /> : <Circle size={18} />}
              </span>
              <div>
                <strong>{item.label}</strong>
                {item.detail ? <span className="gm-meta"> · {item.detail}</span> : null}
                {optional ? <span className="gm-meta"> · optional</span> : null}
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

  const checklistFromHealth = (feed: MarketFeedHealth | null): ChecklistItem[] => {
    if (!feed) return [];
    const green = feed.status === "green";
    const amber = feed.status === "amber";
    return [
      {
        id: "pine30",
        label: "Pine 3.0 detected",
        status: green || amber ? "pass" : "warn"
      },
      {
        id: "plan15m",
        label: "PLAN_15M received",
        status: green || amber ? "pass" : "warn"
      },
      {
        id: "confirm5m",
        label: "CONFIRM_5M received",
        status: green ? "pass" : amber ? "warn" : "fail"
      },
      {
        id: "quote1m",
        label: "QUOTE_1M optional",
        status: feed.quoteStatus === "live" ? "pass" : "optional"
      },
      {
        id: "legacy",
        label: "No recent legacy Bridge traffic",
        // Prefer verified feed health — never claim “old alert disabled” from a checkbox alone.
        status: green || amber ? "pass" : "warn"
      }
    ];
  };

  const checklist =
    (admin?.checklist as ChecklistItem[] | undefined)?.length
      ? (admin!.checklist as ChecklistItem[])
      : checklistFromHealth(health);

  const recentMeaningful = events.filter(
    (e) => !/TEST\s*NOTIFICATION/i.test(String(e.message ?? "")) && !/^TEST_/i.test(String(e.event ?? ""))
  );

  return (
    <div className="gm-premium-alerts-page gm-premium-v2" data-testid="alerts-setup-page">
      <div className="gm-page-toolbar">
        <Link to="/" className="gm-linkish">
          <ChevronLeft size={16} aria-hidden /> Plan
        </Link>
        <h1>Alerts</h1>
      </div>

      {error ? (
        <p className="gm-meta" role="alert">
          {error}
        </p>
      ) : null}

      <section className="gm-card-v2" style={{ marginBottom: 14 }} id="phone-alerts" data-testid="notification-status">
        <h2 style={{ margin: "0 0 10px", fontWeight: 800, display: "flex", gap: 8, alignItems: "center" }}>
          <Bell size={18} aria-hidden /> Notification status
        </h2>
        <PhoneAlertsControl compact={false} />
      </section>

      <section className="gm-card-v2" data-testid="alerts-preferences" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: "0 0 8px", fontWeight: 800 }}>Trading</h2>
        <p className="gm-meta">
          Get notified when a valid plan becomes ready — even if you are not watching the screen.
        </p>
        <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gap: 8 }}>
          {PREF_ROWS.map((row) => (
            <li key={row.key} className="gm-level-row" style={{ gridTemplateColumns: "1fr auto" }}>
              <div>
                <strong style={{ display: "block" }}>{row.label}</strong>
                <span className="gm-meta">{row.description}</span>
              </div>
              <label className="gm-check-row" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={Boolean(prefs?.[row.key])}
                  disabled={!prefs}
                  onChange={() => void togglePref(row.key)}
                  aria-label={row.label}
                />
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section
        className="gm-card-v2"
        style={{ marginBottom: 14, background: "var(--gold-100)", borderColor: "var(--gold-200)" }}
      >
        <h2 style={{ margin: "0 0 8px", fontWeight: 800, display: "flex", gap: 8, alignItems: "center" }}>
          <Info size={18} color="var(--gold-600)" aria-hidden /> What happens next
        </h2>
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-secondary)" }}>
          <li>GoldMeta watches for a valid plan.</li>
          <li>You can enable alerts for plan-ready and confirmation events.</li>
          <li>When a plan is ready, review entry, stop and targets yourself.</li>
          <li>Gold Hunter is the AutoTrade UI. Live execution remains locked.</li>
        </ul>
      </section>

      <section className="gm-card-v2" data-testid="recent-alerts">
        <h2 style={{ margin: "0 0 10px", fontWeight: 800 }}>Recent alerts</h2>
        {recentMeaningful.length === 0 ? (
          <p className="gm-meta">No recent alerts yet.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {recentMeaningful.map((event) => (
              <li key={event.id} className="gm-level-row">
                <strong>{String(event.event).replace(/_/g, " ")}</strong>
                <span className="gm-meta">
                  {formatCompactLocalTime(event.createdAt ?? null, tzPref)}
                </span>
                <p className="gm-level-name" style={{ fontWeight: 500 }}>
                  {event.message}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isStaff ? (
        <details className="gm-disclosure" data-testid="alerts-advanced-setup">
          <summary>Advanced · TradingView feed setup</summary>
          <StandardSetupChecklist
            checklist={checklist}
            sharedWebhookUrl={admin?.sharedWebhookUrl ?? null}
            isStaff={isStaff}
          />
          <section className="gm-card-v2" style={{ marginBottom: 14 }}>
            <h2 style={{ margin: "0 0 10px", fontWeight: 800 }}>Market feed</h2>
            <MarketFeedStatus health={health ?? admin?.health ?? null} />
          </section>
        </details>
      ) : null}
    </div>
  );
}
