import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { ArrowLeft, Crosshair, Gauge, LineChart, ListOrdered, SlidersHorizontal } from "lucide-react";
import { useAuth } from "../../lib/auth";
import type { GoldHunterStatusResponse } from "../../lib/api";
import { GOLD_HUNTER_PRODUCT_LABEL } from "../../lib/goldHunterIdentity";
import "../../styles/goldHunter.css";

type GhCtx = {
  status: GoldHunterStatusResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const GoldHunterContext = createContext<GhCtx | null>(null);

export function useGoldHunter(): GhCtx {
  const ctx = useContext(GoldHunterContext);
  if (!ctx) throw new Error("useGoldHunter outside provider");
  return ctx;
}

function formatEur(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}€${n.toFixed(digits)}`;
}

export { formatEur };

const TABS = [
  { to: "/gold-hunter", end: true, label: "Overview", icon: Gauge },
  { to: "/gold-hunter/trades", label: "Trades", icon: ListOrdered },
  { to: "/gold-hunter/performance", label: "Performance", icon: LineChart },
  { to: "/gold-hunter/control", label: "Controls", icon: SlidersHorizontal }
] as const;

export function GoldHunterShell() {
  const { account, api } = useAuth();
  const location = useLocation();
  const isStaff = account?.role === "OWNER" || account?.role === "ADMIN";
  const [status, setStatus] = useState<GoldHunterStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.goldHunterStatus();
      setStatus(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Gold Hunter");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!isStaff) return;
    void refresh();
    const id = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(id);
  }, [isStaff, refresh]);

  if (!isStaff) {
    return (
      <div className="gm-gold-hunter gh26-shell" data-testid="gold-hunter-unauthorized">
        <div className="gh-unauthorized">
          <Crosshair aria-hidden size={28} color="#d4af5f" />
          <h1>Gold Hunter</h1>
          <p>Admin access required. This tool is not available for your account.</p>
          <NavLink to="/" className="gh-btn" style={{ display: "inline-grid", marginTop: 16 }}>
            Back to GoldMeta
          </NavLink>
        </div>
      </div>
    );
  }

  if (location.pathname === "/gold-hunter/") return <Navigate to="/gold-hunter" replace />;

  return (
    <GoldHunterContext.Provider value={{ status, loading, error, refresh }}>
      <div className="gm-gold-hunter gh26-shell" data-testid="gold-hunter-shell">
        <header className="gh26-shell-head">
          <NavLink to="/" className="gh26-back"><ArrowLeft size={16} aria-hidden /> GoldMeta</NavLink>
          <div className="gh26-shell-brand">
            <span className="gh26-mark"><Crosshair aria-hidden /></span>
            <div>
              <strong>{GOLD_HUNTER_PRODUCT_LABEL}</strong>
              <span>Automated XAUUSD system</span>
            </div>
          </div>
          <div className="gh26-shell-state">
            <span className={status?.config.demoAutoTradeEnabled ? "is-demo-on" : "is-demo-off"}>
              DEMO {status?.config.demoAutoTradeEnabled ? "ON" : "OFF"}
            </span>
            <span className="is-live-locked">LIVE LOCKED</span>
          </div>
        </header>

        <nav className="gh26-tabs" aria-label="Gold Hunter sections">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <NavLink key={tab.to} to={tab.to} end={"end" in tab ? tab.end : false}>
                <Icon size={16} aria-hidden />
                {tab.label}
              </NavLink>
            );
          })}
        </nav>

        {loading && !status ? (
          <div className="gh-empty" role="status">Loading Gold Hunter…</div>
        ) : error && !status ? (
          <div className="gh-empty" role="alert">{error.includes("403") || /forbidden/i.test(error) ? "Unauthorized" : "Server unavailable. Retrying…"}</div>
        ) : (
          <Outlet />
        )}

        <nav className="gh26-bottom-nav" aria-label="Gold Hunter mobile navigation">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <NavLink key={tab.to} to={tab.to} end={"end" in tab ? tab.end : false}>
                <Icon aria-hidden />
                <span>{tab.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>
    </GoldHunterContext.Provider>
  );
}

export function GhStatusTone({ value }: { value: string }) {
  const v = value.toUpperCase();
  let cls = "gh-badge--muted";
  if (/LIVE|CONNECTED|VALID|READY|ACTIVE|NORMAL|OPEN|ON/.test(v)) cls = "gh-badge--demo";
  if (/STALE|WAITING|PAUSED|LIMITED|UNKNOWN|CLOSED/.test(v)) cls = "gh-badge--warn";
  if (/HARD|DISCONNECTED|HALTED|INVALID|CROSSED|OFF|BLOCKED/.test(v)) cls = "gh-badge--danger";
  return <span className={`gh-badge ${cls}`}>{value}</span>;
}
