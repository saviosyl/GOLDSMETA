import { useMemo, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../lib/auth";

const DESKTOP_LINKS = [
  { to: "/", label: "Overview", end: true },
  { to: "/intelligence", label: "Intelligence", end: false },
  { to: "/analytics", label: "Analytics", end: false },
  { to: "/replay", label: "Replay", end: false },
  { to: "/history", label: "History", end: false },
  { to: "/journal", label: "Journal", end: false },
  { to: "/planner", label: "Risk planner", end: false },
  { to: "/v4", label: "V4 Research", end: false },
  { to: "/settings", label: "Settings", end: false },
  { to: "/brand", label: "Brand preview", end: false }
];

const MOBILE_PRIMARY = [
  { to: "/", label: "Home", end: true },
  { to: "/intelligence", label: "Intel", end: false },
  { to: "/analytics", label: "Analytics", end: false },
  { to: "/replay", label: "Replay", end: false }
];

const MOBILE_MORE = [
  { to: "/history", label: "History" },
  { to: "/journal", label: "Journal" },
  { to: "/planner", label: "Risk planner" },
  { to: "/v4", label: "V4 Research" },
  { to: "/settings", label: "Settings" },
  { to: "/brand", label: "Brand preview" }
];

export function AppShell({
  children,
  linkPrefix = ""
}: {
  children?: ReactNode;
  linkPrefix?: string;
}) {
  const { user } = useAuth();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
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

  return (
    <div className="gm-shell" data-testid="app-shell-redesign">
      <aside className="gm-sidebar" aria-label="Desktop navigation" data-testid="desktop-sidebar">
        <div className="gm-sidebar-brand">
          <img src="/brand/mark-dark.svg" alt="" width={28} height={28} />
          <div>
            <strong>GoldMeta</strong>
            <span className="gm-meta">Market intelligence</span>
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
        </nav>
        <div className="gm-sidebar-foot">
          <span className="gm-meta">{email}</span>
          <span className="gm-meta">Analysis only · broker off</span>
        </div>
      </aside>

      <div className="gm-main">
        <div className="gm-main-inner">{children ?? <Outlet />}</div>
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
        </div>
      )}
    </div>
  );
}
