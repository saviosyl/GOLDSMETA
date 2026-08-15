import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState
} from "react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import {
  Activity,
  Crosshair,
  LayoutDashboard,
  LineChart,
  SlidersHorizontal
} from "lucide-react";
import { useAuth } from "../../lib/auth";
import type { GoldHunterStatusResponse } from "../../lib/api";
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
  { to: "/gold-hunter", end: true, label: "Dashboard", icon: LayoutDashboard },
  { to: "/gold-hunter/control", label: "Control", icon: SlidersHorizontal },
  { to: "/gold-hunter/monitor", label: "Monitor", icon: Activity },
  { to: "/gold-hunter/performance", label: "Performance", icon: LineChart }
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
      const s = await api.goldHunterStatus();
      setStatus(s);
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load Gold Hunter";
      setError(msg);
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
      <div className="gm-gold-hunter" data-testid="gold-hunter-unauthorized">
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

  if (location.pathname === "/gold-hunter/") {
    return <Navigate to="/gold-hunter" replace />;
  }

  return (
    <GoldHunterContext.Provider value={{ status, loading, error, refresh }}>
      <div className="gm-gold-hunter" data-testid="gold-hunter-shell">
        <div className="gh-brand-row">
          <div className="gh-brand">
            <strong>GOLD HUNTER</strong>
            <span>Gold Trading Intelligence</span>
          </div>
          <div className="gh-mode-stack" data-testid="gh-mode-stack">
            <span className="primary">{status?.modeLabel.primary ?? "…"}</span>
            <span className="secondary">{status?.modeLabel.secondary ?? ""}</span>
            <span className="tertiary">{status?.modeLabel.tertiary ?? ""}</span>
          </div>
        </div>

        <nav className="gh-desktop-tabs" aria-label="Gold Hunter sections">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={"end" in t ? t.end : false}>
              {t.label}
            </NavLink>
          ))}
        </nav>

        {loading && !status ? (
          <div className="gh-empty" role="status">
            Loading Gold Hunter…
          </div>
        ) : error && !status ? (
          <div className="gh-empty" role="alert">
            {error.includes("403") || /forbidden/i.test(error)
              ? "Unauthorized"
              : "Server unavailable. Retrying…"}
          </div>
        ) : (
          <Outlet />
        )}

        <nav className="gh-bottom-nav" aria-label="Gold Hunter" data-testid="gh-bottom-nav">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <NavLink key={t.to} to={t.to} end={"end" in t ? t.end : false}>
                <Icon aria-hidden strokeWidth={2} />
                <span>{t.label}</span>
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
  if (/LIVE|CONNECTED|VALID|READY|ACTIVE|NORMAL|OPEN/.test(v)) cls = "gh-badge--demo";
  if (/STALE|WAITING|PAUSED|LIMITED|UNKNOWN|CLOSED/.test(v)) cls = "gh-badge--warn";
  if (/HARD|DISCONNECTED|HALTED|INVALID|CROSSED|OFF/.test(v)) cls = "gh-badge--danger";
  return <span className={`gh-badge ${cls}`}>{value}</span>;
}
