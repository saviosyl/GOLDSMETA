import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../lib/auth";

const DESKTOP_LINKS = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/intelligence", label: "Markets", end: false },
  { to: "/analytics", label: "Analytics", end: false },
  { to: "/replay", label: "Replay", end: false },
  { to: "/journal", label: "Journal", end: false }
];

const DESKTOP_SECONDARY = [
  { to: "/history", label: "History" },
  { to: "/planner", label: "Risk planner" },
  { to: "/v4", label: "Research" },
  { to: "/settings", label: "Settings" }
];

const MOBILE_PRIMARY = [
  { to: "/", label: "Home", end: true },
  { to: "/intelligence", label: "Markets", end: false },
  { to: "/analytics", label: "Analytics", end: false },
  { to: "/replay", label: "Replay", end: false }
];

const MOBILE_MORE = [
  { to: "/journal", label: "Journal" },
  { to: "/history", label: "History" },
  { to: "/planner", label: "Risk planner" },
  { to: "/v4", label: "Research" },
  { to: "/settings", label: "Settings" }
];

function initials(email: string | null | undefined): string {
  if (!email) return "GM";
  const local = email.split("@")[0] ?? "gm";
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

export function AppShell({
  children,
  linkPrefix = ""
}: {
  children?: ReactNode;
  linkPrefix?: string;
}) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const email = user?.email ?? "Account";
  const prefix = linkPrefix.replace(/\/$/, "");

  const withPrefix = (to: string) => {
    if (!prefix) return to;
    if (to === "/") return prefix || "/";
    return `${prefix}${to}`;
  };

  const moreActive = useMemo(
    () =>
      MOBILE_MORE.some((l) => {
        const target = withPrefix(l.to);
        return location.pathname === target || location.pathname.startsWith(`${target}/`);
      }),
    [location.pathname, prefix]
  );

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!accountRef.current?.contains(e.target as Node)) setAccountOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

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
          {DESKTOP_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={withPrefix(link.to)}
              end={link.end}
              className={({ isActive }) => (isActive ? "active" : undefined)}
            >
              {link.label}
            </NavLink>
          ))}
          <p className="gm-meta" style={{ margin: "16px 8px 6px" }}>
            More
          </p>
          {DESKTOP_SECONDARY.map((link) => (
            <NavLink
              key={link.to}
              to={withPrefix(link.to)}
              className={({ isActive }) => (isActive ? "active" : undefined)}
            >
              {link.label}
            </NavLink>
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
              <img src="/brand/mark-official.png" alt="" width={28} height={28} className="gm-topbar-mark" />
              <div>
                <strong>GOLDMETA</strong>
                <span>Gold market intelligence</span>
              </div>
            </div>
            <div className="gm-topbar-actions">
              <span className="gm-badge gold" title="Live market environment">
                LIVE
              </span>
              <div className="gm-account-menu" ref={accountRef} data-testid="account-menu">
                <button
                  type="button"
                  className="gm-avatar-btn"
                  aria-haspopup="menu"
                  aria-expanded={accountOpen}
                  aria-label="Account menu"
                  data-testid="account-menu-button"
                  onClick={() => setAccountOpen((v) => !v)}
                >
                  <span className="gm-avatar" aria-hidden>
                    {initials(email)}
                  </span>
                </button>
                {accountOpen && (
                  <div className="gm-account-dropdown" role="menu" data-testid="account-dropdown">
                    <p className="gm-meta" data-testid="account-email">
                      {email}
                    </p>
                    <Link role="menuitem" to={withPrefix("/settings")} onClick={() => setAccountOpen(false)}>
                      Settings
                    </Link>
                    {signOut && (
                      <button
                        type="button"
                        role="menuitem"
                        className="gm-linkish"
                        onClick={() => {
                          setAccountOpen(false);
                          void signOut();
                        }}
                      >
                        Sign out
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </header>
          {children ?? <Outlet />}
        </div>
      </div>

      <nav className="gm-mobile-nav" aria-label="Mobile primary" data-testid="mobile-bottom-nav">
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
            <div className="gm-more-links">
              {MOBILE_MORE.map((link) => (
                <NavLink key={link.to} to={withPrefix(link.to)} onClick={() => setMoreOpen(false)}>
                  {link.label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
