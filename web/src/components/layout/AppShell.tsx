import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  ChevronRight,
  Gauge,
  Globe2,
  GraduationCap,
  HelpCircle,
  History,
  Home,
  Layers3,
  LineChart,
  MoreHorizontal,
  Radio,
  Settings,
  Shield,
  Target
} from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useShellQuote } from "../../lib/quoteContext";
import { useAutoTradeHeaderStatus } from "../../hooks/useAutoTradeHeaderStatus";
import { NotificationCentre } from "../decision/NotificationCentre";
import { QuoteHeader } from "../gm/QuoteHeader";

type NavItem = {
  to: string;
  label: string;
  end?: boolean;
  staffOnly?: boolean;
  icon: typeof Home;
};

const DESKTOP_GROUPS: Array<{ heading: string; items: NavItem[] }> = [
  {
    heading: "Trade",
    items: [
      { to: "/", label: "Plan", end: true, icon: Home },
      { to: "/autotrade", label: "AutoTrade", icon: Bot },
      { to: "/intelligence", label: "Markets", icon: Globe2 },
      { to: "/journal", label: "Journal", icon: BookOpen },
      { to: "/insights", label: "Insights", icon: LineChart }
    ]
  },
  {
    heading: "More / Tools",
    items: [
      { to: "/levels", label: "Levels", icon: Layers3 },
      { to: "/history-replay", label: "History & Replay", icon: History },
      { to: "/planner", label: "Risk Planner", icon: Target },
      { to: "/brokers", label: "Broker", icon: Radio }
    ]
  },
  {
    heading: "Account",
    items: [
      { to: "/settings", label: "Settings", icon: Settings },
      { to: "/learn", label: "Learn", icon: GraduationCap },
      { to: "/help", label: "Help", icon: HelpCircle },
      { to: "/alerts", label: "Alerts", icon: Bell }
    ]
  },
  {
    heading: "Advanced",
    items: [
      { to: "/tradingview", label: "TradingView setup", staffOnly: true, icon: Gauge },
      { to: "/v4", label: "Research Lab", staffOnly: true, icon: BarChart3 },
      { to: "/diagnostics", label: "Diagnostics", staffOnly: true, icon: Activity }
    ]
  },
  {
    heading: "Admin",
    items: [
      { to: "/admin/users", label: "Users", staffOnly: true, icon: Shield },
      {
        to: "/admin/tradingview-template",
        label: "TV Template",
        staffOnly: true,
        icon: Gauge
      }
    ]
  }
];

const MOBILE_PRIMARY: NavItem[] = [
  { to: "/", label: "Plan", end: true, icon: Home },
  { to: "/autotrade", label: "AutoTrade", icon: Bot },
  { to: "/intelligence", label: "Markets", icon: Globe2 },
  { to: "/journal", label: "Journal", icon: BookOpen }
];

type MoreGroup = { heading: string; items: NavItem[] };

const MOBILE_MORE_GROUPS: MoreGroup[] = [
  {
    heading: "Trading tools",
    items: [
      { to: "/levels", label: "Levels", icon: Layers3 },
      { to: "/planner", label: "Risk Planner", icon: Target },
      { to: "/brokers", label: "Broker", icon: Radio }
    ]
  },
  {
    heading: "Review",
    items: [
      { to: "/history-replay", label: "History & Replay", icon: History },
      { to: "/insights", label: "Insights", icon: LineChart }
    ]
  },
  {
    heading: "Account",
    items: [
      { to: "/alerts", label: "Alerts", icon: Bell },
      { to: "/settings", label: "Settings", icon: Settings },
      { to: "/learn", label: "Learn", icon: GraduationCap },
      { to: "/help", label: "Help", icon: HelpCircle }
    ]
  },
  {
    heading: "Advanced",
    items: [
      { to: "/tradingview", label: "TradingView setup", staffOnly: true, icon: Gauge },
      { to: "/v4", label: "Research Lab", staffOnly: true, icon: BarChart3 },
      { to: "/diagnostics", label: "Diagnostics", staffOnly: true, icon: Activity }
    ]
  },
  {
    heading: "Admin",
    items: [
      { to: "/admin/users", label: "Users", staffOnly: true, icon: Shield },
      {
        to: "/admin/tradingview-template",
        label: "TV Template",
        staffOnly: true,
        icon: Gauge
      }
    ]
  }
];

function initials(email: string | null | undefined): string {
  if (!email) return "GM";
  const local = email.split("@")[0] ?? "gm";
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

function filterStaff<T extends { staffOnly?: boolean }>(items: T[], isStaff: boolean): T[] {
  return items.filter((l) => !l.staffOnly || isStaff);
}

function headerToneClass(tone: string): string {
  switch (tone) {
    case "success":
      return "gm-autotrade-pill--success";
    case "warning":
      return "gm-autotrade-pill--warning";
    case "danger":
      return "gm-autotrade-pill--danger";
    case "info":
      return "gm-autotrade-pill--info";
    default:
      return "gm-autotrade-pill--neutral";
  }
}

export function AppShell({
  children,
  linkPrefix = ""
}: {
  children?: ReactNode;
  linkPrefix?: string;
}) {
  const { user, account } = useAuth();
  const { quote } = useShellQuote();
  const autoTradeHeader = useAutoTradeHeaderStatus();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const email = user?.email ?? "Account";
  const prefix = linkPrefix.replace(/\/$/, "");
  const isStaff = account?.role === "OWNER" || account?.role === "ADMIN";

  const withPrefix = (to: string) => {
    if (!prefix) return to;
    if (to === "/") return prefix || "/";
    return `${prefix}${to}`;
  };

  const desktopGroups = useMemo(
    () =>
      DESKTOP_GROUPS.map((g) => ({
        ...g,
        items: filterStaff(g.items, isStaff)
      })).filter((g) => g.items.length > 0),
    [isStaff]
  );

  const mobileMoreGroups = useMemo(
    () =>
      MOBILE_MORE_GROUPS.map((g) => ({
        ...g,
        items: filterStaff(g.items, isStaff)
      })).filter((g) => g.items.length > 0),
    [isStaff]
  );

  const moreActive = useMemo(() => {
    const paths = mobileMoreGroups.flatMap((g) => g.items.map((i) => withPrefix(i.to)));
    return paths.some(
      (target) => location.pathname === target || location.pathname.startsWith(`${target}/`)
    );
  }, [location.pathname, prefix, mobileMoreGroups]);

  /** Plan page owns the single premium market strip — hide duplicate mobile quote. */
  const hideMobileQuote =
    location.pathname === withPrefix("/") || location.pathname === "/";

  const isAdminSurface =
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith(withPrefix("/admin"));

  useEffect(() => {
    if (!profileOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!profileRef.current?.contains(e.target as Node)) setProfileOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProfileOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [profileOpen]);

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  return (
    <div className="gm-shell gm-premium-v2" data-testid="app-shell-redesign">
      <aside className="gm-sidebar" aria-label="Desktop navigation" data-testid="desktop-sidebar">
        <div className="gm-sidebar-brand">
          <img src="/brand/mark-official.png" alt="" width={36} height={36} />
          <div>
            <strong>GOLDMETA</strong>
            <span className="gm-meta">XAUUSD trading assistant</span>
          </div>
        </div>
        <nav className="gm-sidebar-nav">
          {desktopGroups.map((group) => (
            <div
              key={group.heading}
              className="gm-nav-group"
              data-testid={`nav-group-${group.heading.toLowerCase().replace(/\s+|\/+/g, "-")}`}
            >
              <p className="gm-nav-heading">{group.heading}</p>
              {group.items.map((link) => {
                const Icon = link.icon;
                return (
                  <NavLink
                    key={link.to}
                    to={withPrefix(link.to)}
                    end={link.end}
                    className={({ isActive }) => (isActive ? "active" : undefined)}
                  >
                    <Icon aria-hidden strokeWidth={2} />
                    <span>{link.label}</span>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="gm-sidebar-foot">
          <div className="gm-sidebar-premium">
            <p data-testid="sidebar-autotrade-summary">{autoTradeHeader.label}</p>
            <p className="gm-meta">Live execution locked</p>
          </div>
        </div>
      </aside>

      <div className="gm-main">
        <div className="gm-main-inner">
          <header className="gm-topbar" data-testid="topbar">
            <div className="gm-topbar-market" data-testid="topbar-market">
              <strong className="gm-topbar-symbol">XAUUSD</strong>
              <QuoteHeader
                className="gm-topbar-quote"
                price={quote?.price ?? null}
                updatedLabel={quote?.updatedLabel ?? "—"}
                sessionLabel={quote?.sessionLabel}
                fresh={quote?.fresh}
                freshness={quote?.freshness}
                unavailable={quote?.unavailable}
                bid={quote?.bid}
                ask={quote?.ask}
                desktopOnly
              />
            </div>

            <div className="gm-topbar-actions">
              <span
                className={`gm-badge gm-autotrade-pill ${headerToneClass(autoTradeHeader.tone)}`}
                data-testid="topbar-autotrade-status"
                data-state={autoTradeHeader.stateKey}
                title={autoTradeHeader.nextAction ?? undefined}
              >
                <Bot size={14} aria-hidden />
                {autoTradeHeader.label}
              </span>
              <NotificationCentre />
              <div className="gm-profile-menu" ref={profileRef}>
                <button
                  type="button"
                  className="gm-avatar-btn"
                  aria-expanded={profileOpen}
                  aria-controls="gm-profile-popover"
                  data-testid="profile-menu-btn"
                  onClick={() => setProfileOpen((v) => !v)}
                  aria-label="Account profile"
                >
                  <span className="gm-avatar" aria-hidden>
                    {initials(email)}
                  </span>
                </button>
                {profileOpen && (
                  <div
                    id="gm-profile-popover"
                    className="gm-profile-popover"
                    role="dialog"
                    aria-label="Account email"
                    data-testid="profile-popover"
                  >
                    <p className="gm-meta">Signed in as</p>
                    <strong data-testid="profile-email">{email}</strong>
                    <p className="gm-meta" style={{ marginTop: 8 }} data-testid="profile-autotrade">
                      {autoTradeHeader.label}
                    </p>
                    <NavLink
                      to={withPrefix("/settings")}
                      className="gm-linkish"
                      onClick={() => setProfileOpen(false)}
                    >
                      Settings <ChevronRight size={14} aria-hidden />
                    </NavLink>
                  </div>
                )}
              </div>
            </div>
          </header>

          {!hideMobileQuote ? (
            <QuoteHeader
              className="gm-mobile-quote"
              price={quote?.price ?? null}
              updatedLabel={quote?.updatedLabel ?? "—"}
              sessionLabel={quote?.sessionLabel}
              fresh={quote?.fresh}
              freshness={quote?.freshness}
              unavailable={quote?.unavailable}
              bid={quote?.bid}
              ask={quote?.ask}
            />
          ) : null}

          {children ?? <Outlet />}
        </div>
      </div>

      {isAdminSurface ? (
        <nav
          className="gm-mobile-nav gm-mobile-nav--admin"
          aria-label="Admin"
          data-testid="admin-mobile-nav"
        >
          <NavLink to={withPrefix("/")} end>
            <Home aria-hidden strokeWidth={2} />
            <span>Back to app</span>
          </NavLink>
          <NavLink to={withPrefix("/admin/users")}>
            <Shield aria-hidden strokeWidth={2} />
            <span>Users</span>
          </NavLink>
        </nav>
      ) : (
        <nav
          className="gm-mobile-nav"
          aria-label="Mobile primary"
          data-testid="mobile-bottom-nav"
        >
          {MOBILE_PRIMARY.map((link) => {
            const Icon = link.icon;
            return (
              <NavLink
                key={link.to}
                to={withPrefix(link.to)}
                end={link.end}
                className={({ isActive }) => (isActive ? "active" : undefined)}
                onClick={() => setMoreOpen(false)}
              >
                <Icon aria-hidden strokeWidth={2} />
                <span>{link.label}</span>
              </NavLink>
            );
          })}
          <button
            type="button"
            className={moreOpen || moreActive ? "active" : undefined}
            aria-expanded={moreOpen}
            aria-controls="gm-more-sheet"
            data-testid="mobile-more-btn"
            onClick={() => setMoreOpen((v) => !v)}
          >
            <MoreHorizontal aria-hidden strokeWidth={2} />
            <span>More</span>
          </button>
        </nav>
      )}

      {!isAdminSurface && moreOpen && (
        <div className="gm-more-sheet" id="gm-more-sheet" data-testid="mobile-more-sheet">
          <div className="gm-more-sheet-card">
            <div className="gm-section-head" style={{ display: "flex", justifyContent: "space-between" }}>
              <h2 className="gm-section-title">More</h2>
              <button type="button" className="gm-linkish" onClick={() => setMoreOpen(false)}>
                Close
              </button>
            </div>
            {mobileMoreGroups.map((group) => (
              <div
                key={group.heading}
                className="gm-more-group"
                data-testid={`more-group-${group.heading.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <p className="gm-nav-heading">{group.heading}</p>
                <div className="gm-more-links">
                  {group.items.map((link) => {
                    const Icon = link.icon;
                    return (
                      <NavLink
                        key={link.to}
                        to={withPrefix(link.to)}
                        onClick={() => setMoreOpen(false)}
                      >
                        <Icon size={18} aria-hidden />
                        {link.label}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
