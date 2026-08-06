import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { NotificationCentre } from "../decision/NotificationCentre";

type NavItem = { to: string; label: string; end?: boolean; staffOnly?: boolean };

/** Desktop grouped navigation — Daily / Research / Tools / Account / Admin */
const DESKTOP_GROUPS: Array<{ heading: string; items: NavItem[] }> = [
  {
    heading: "Daily",
    items: [
      { to: "/", label: "Today's Plan", end: true },
      { to: "/levels", label: "Levels" },
      { to: "/alerts", label: "Alerts & Setup" },
      { to: "/intelligence", label: "Markets" },
      { to: "/journal", label: "Journal" }
    ]
  },
  {
    heading: "Research",
    items: [
      { to: "/v4", label: "Research" },
      { to: "/analytics", label: "Performance" },
      { to: "/replay", label: "Replay" }
    ]
  },
  {
    heading: "Tools",
    items: [
      { to: "/planner", label: "Risk Planner" },
      { to: "/tradingview", label: "TradingView", staffOnly: true }
    ]
  },
  {
    heading: "Account",
    items: [
      { to: "/settings", label: "Settings" },
      { to: "/help", label: "Help" }
    ]
  },
  {
    heading: "Admin",
    items: [
      { to: "/admin/users", label: "Users", staffOnly: true },
      { to: "/admin/tradingview-template", label: "TradingView Template", staffOnly: true },
      { to: "/diagnostics", label: "Diagnostics", staffOnly: true }
    ]
  }
];

/** Mobile primary: Plan · Markets · Journal · More */
const MOBILE_PRIMARY: NavItem[] = [
  { to: "/", label: "Plan", end: true },
  { to: "/intelligence", label: "Markets" },
  { to: "/journal", label: "Journal" }
];

type MoreGroup = { heading: string; items: NavItem[] };

const MOBILE_MORE_GROUPS: MoreGroup[] = [
  {
    heading: "Research",
    items: [
      { to: "/v4", label: "Research" },
      { to: "/analytics", label: "Analytics" },
      { to: "/signal-performance", label: "Performance" }
    ]
  },
  {
    heading: "Review",
    items: [
      { to: "/levels", label: "Levels" },
      { to: "/history", label: "History" },
      { to: "/replay", label: "Replay" }
    ]
  },
  {
    heading: "Trading tools",
    items: [
      { to: "/alerts", label: "Alerts & Setup" },
      { to: "/planner", label: "Risk Planner" },
      { to: "/tradingview", label: "TradingView Setup", staffOnly: true }
    ]
  },
  {
    heading: "Account",
    items: [
      { to: "/settings", label: "Settings" },
      { to: "/help", label: "Help" }
    ]
  },
  {
    heading: "System",
    items: [
      { to: "/brokers", label: "Brokers" },
      { to: "/autotrade", label: "AutoTrade" }
    ]
  },
  {
    heading: "Admin",
    items: [
      { to: "/admin/users", label: "Users", staffOnly: true },
      { to: "/admin/tradingview-template", label: "TradingView Template", staffOnly: true },
      { to: "/diagnostics", label: "Diagnostics", staffOnly: true }
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

export function AppShell({
  children,
  linkPrefix = ""
}: {
  children?: ReactNode;
  linkPrefix?: string;
}) {
  const { user, account } = useAuth();
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
    <div className="gm-shell" data-testid="app-shell-redesign">
      <aside className="gm-sidebar" aria-label="Desktop navigation" data-testid="desktop-sidebar">
        <div className="gm-sidebar-brand">
          <img src="/brand/mark-official.png" alt="" width={36} height={36} />
          <div>
            <strong>GOLDMETA</strong>
            <span className="gm-meta">by MetaMech Solutions</span>
          </div>
        </div>
        <nav className="gm-sidebar-nav">
          {desktopGroups.map((group) => (
            <div key={group.heading} className="gm-nav-group" data-testid={`nav-group-${group.heading.toLowerCase()}`}>
              <p className="gm-nav-heading">{group.heading}</p>
              {group.items.map((link) => (
                <NavLink
                  key={link.to}
                  to={withPrefix(link.to)}
                  end={link.end}
                  className={({ isActive }) => (isActive ? "active" : undefined)}
                >
                  {link.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="gm-sidebar-foot">
          <div className="gm-sidebar-premium">
            <p>Analysis only. Broker execution stays disabled.</p>
          </div>
        </div>
      </aside>

      <div className="gm-main">
        <div className="gm-main-inner">
          <header className="gm-topbar" data-testid="topbar">
            <div className="gm-topbar-brand">
              <img
                src="/brand/mark-official.png"
                alt=""
                width={28}
                height={28}
                className="gm-topbar-mark"
              />
              <div>
                <strong>GOLDMETA</strong>
                <span>Daily trading assistant</span>
              </div>
            </div>
            <div className="gm-topbar-actions">
              <NotificationCentre />
              <span className="gm-badge neutral" data-testid="topbar-autotrade-off">
                AutoTrade OFF
              </span>
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
                <span className="gm-meta gm-topbar-email" data-testid="topbar-email-desktop">
                  {email}
                </span>
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
                    <p className="gm-meta" style={{ marginTop: 8 }}>
                      AutoTrade OFF · Analysis only
                    </p>
                    <NavLink
                      to={withPrefix("/settings")}
                      className="gm-linkish"
                      onClick={() => setProfileOpen(false)}
                    >
                      Settings
                    </NavLink>
                  </div>
                )}
              </div>
            </div>
          </header>
          {children ?? <Outlet />}
        </div>
      </div>

      <nav
        className="gm-mobile-nav gm-mobile-nav-4"
        aria-label="Mobile primary"
        data-testid="mobile-bottom-nav"
      >
        {MOBILE_PRIMARY.map((link) => (
          <NavLink
            key={link.to}
            to={withPrefix(link.to)}
            end={link.end}
            className={({ isActive }) => (isActive ? "active" : undefined)}
            onClick={() => setMoreOpen(false)}
          >
            {link.label}
          </NavLink>
        ))}
        <button
          type="button"
          className={moreOpen || moreActive ? "active" : undefined}
          aria-expanded={moreOpen}
          aria-controls="gm-more-sheet"
          data-testid="mobile-more-btn"
          onClick={() => setMoreOpen((v) => !v)}
        >
          More
        </button>
      </nav>

      {moreOpen && (
        <div className="gm-more-sheet" id="gm-more-sheet" data-testid="mobile-more-sheet">
          <div className="gm-more-sheet-card">
            <div className="gm-section-head">
              <h2 className="gm-section-title">More</h2>
              <button type="button" className="gm-linkish" onClick={() => setMoreOpen(false)}>
                Close
              </button>
            </div>
            {mobileMoreGroups.map((group) => (
              <div key={group.heading} className="gm-more-group" data-testid={`more-group-${group.heading.toLowerCase().replace(/\s+/g, "-")}`}>
                <p className="gm-nav-heading">{group.heading}</p>
                <div className="gm-more-links">
                  {group.items.map((link) => (
                    <NavLink
                      key={link.to}
                      to={withPrefix(link.to)}
                      onClick={() => setMoreOpen(false)}
                    >
                      {link.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
