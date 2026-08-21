import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Bell,
  BookOpen,
  ChevronRight,
  Clock3,
  Crosshair,
  GraduationCap,
  HelpCircle,
  History,
  Home,
  LogOut,
  Plug,
  Settings,
  SlidersHorizontal,
  Target,
  UserRound,
  Wrench
} from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useShellQuote } from "../../lib/quoteContext";
import { fmtPrice } from "../../lib/intradayFormat";
import { NotificationCentre } from "../decision/NotificationCentre";

type NavItem = {
  to: string;
  label: string;
  shortLabel?: string;
  end?: boolean;
  icon: typeof Home;
};

const PRIMARY_NAV: NavItem[] = [
  { to: "/", label: "Home", end: true, icon: Home },
  { to: "/short-term", label: "Short-Term", shortLabel: "Short", icon: Clock3 },
  { to: "/day-trade", label: "Day Trade", shortLabel: "Day", icon: Target },
  { to: "/gold-hunter", label: "Gold Hunter", shortLabel: "Hunter", icon: Crosshair },
  { to: "/history", label: "History", icon: History }
];

function initials(email: string | null | undefined): string {
  if (!email) return "GM";
  const local = email.split("@")[0] ?? "gm";
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

export function AppShell({ children }: { children?: ReactNode; linkPrefix?: string }) {
  const { user, account, signOut } = useAuth();
  const { quote } = useShellQuote();
  const location = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const isStaff = account?.role === "OWNER" || account?.role === "ADMIN";
  const isGoldHunter = location.pathname.startsWith("/gold-hunter");

  useEffect(() => {
    setProfileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!profileOpen) return;
    const close = (event: MouseEvent) => {
      if (!profileRef.current?.contains(event.target as Node)) setProfileOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileOpen(false);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", key);
    };
  }, [profileOpen]);

  if (isGoldHunter) {
    return <div className="gm26-standalone">{children ?? <Outlet />}</div>;
  }

  const marketState = quote?.freshness === "MARKET_CLOSED" || quote?.marketStatus === "CLOSED" ? "CLOSED" : quote?.fresh ? "LIVE" : "CONNECTED";

  return (
    <div className="gm26-shell" data-testid="gm26-app-shell">
      <aside className="gm26-sidebar" aria-label="GoldMeta navigation">
        <NavLink to="/" className="gm26-brand" aria-label="GoldMeta home">
          <img src="/brand/mark-official.png" alt="" width={38} height={38} />
          <div><strong>GOLDMETA</strong><span>XAUUSD intelligence</span></div>
        </NavLink>

        <nav className="gm26-sidebar-nav">
          {PRIMARY_NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => isActive ? "active" : undefined}>
                <Icon aria-hidden />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="gm26-sidebar-foot">
          <div className="gm26-sidebar-status">
            <span className={marketState === "LIVE" ? "is-live" : ""} />
            <div><strong>XAUUSD feed</strong><small>{marketState}</small></div>
          </div>
          <button type="button" className="gm26-profile-row" onClick={() => setProfileOpen((value) => !value)}>
            <span className="gm26-avatar">{initials(user?.email)}</span>
            <div><strong>{user?.email?.split("@")[0] ?? "Account"}</strong><small>{account?.role ?? "USER"}</small></div>
            <ChevronRight aria-hidden />
          </button>
        </div>
      </aside>

      <main className="gm26-main">
        <header className="gm26-topbar">
          <div className="gm26-topbar-market">
            <span>XAUUSD</span>
            <strong>{quote?.price != null ? fmtPrice(quote.price) : "—"}</strong>
            <span className={`gm26-feed-state ${marketState === "LIVE" ? "is-live" : ""}`}>{marketState}</span>
            {quote?.sessionLabel ? <small>{quote.sessionLabel}</small> : null}
          </div>
          <div className="gm26-topbar-actions" ref={profileRef}>
            <NotificationCentre />
            <button type="button" className="gm26-avatar-button" aria-label="Open profile menu" aria-expanded={profileOpen} onClick={() => setProfileOpen((value) => !value)}>
              <span className="gm26-avatar">{initials(user?.email)}</span>
            </button>
            {profileOpen ? (
              <div className="gm26-profile-menu" role="dialog" aria-label="Profile menu">
                <div className="gm26-profile-menu__head">
                  <span className="gm26-avatar gm26-avatar--large">{initials(user?.email)}</span>
                  <div><strong>{user?.email ?? "Account"}</strong><span>{account?.role ?? "USER"}</span></div>
                </div>
                <nav>
                  <NavLink to="/settings"><UserRound aria-hidden /> Account</NavLink>
                  <NavLink to="/alerts"><Bell aria-hidden /> Notifications</NavLink>
                  <NavLink to="/brokers"><Plug aria-hidden /> Connections</NavLink>
                  <NavLink to="/planner"><SlidersHorizontal aria-hidden /> Risk planner</NavLink>
                  <NavLink to="/learn"><GraduationCap aria-hidden /> Learn</NavLink>
                  <NavLink to="/help"><HelpCircle aria-hidden /> Help</NavLink>
                  {isStaff ? <NavLink to="/advanced"><Wrench aria-hidden /> Advanced</NavLink> : null}
                  <NavLink to="/settings"><Settings aria-hidden /> Settings</NavLink>
                </nav>
                <button type="button" className="gm26-signout" onClick={() => void signOut()}><LogOut aria-hidden /> Sign out</button>
              </div>
            ) : null}
          </div>
        </header>

        <div className="gm26-main-inner">{children ?? <Outlet />}</div>
      </main>

      <nav className="gm26-bottom-nav" aria-label="GoldMeta mobile navigation">
        {PRIMARY_NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => isActive ? "active" : undefined}>
              <Icon aria-hidden />
              <span>{item.shortLabel ?? item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
