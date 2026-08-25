import { Activity, BarChart3, FlaskConical, Gauge, PlayCircle, Settings2, Users, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";

const TOOLS = [
  { to: "/advanced/research", title: "Research Lab", body: "V4 shadow strategy research and non-actionable observations.", icon: FlaskConical },
  { to: "/advanced/micro-edge", title: "Micro Edge", body: "Isolated shadow research and data collection.", icon: Zap },
  { to: "/advanced/replay", title: "Replay", body: "Review historical candles and past decisions away from everyday trading screens.", icon: PlayCircle },
  { to: "/advanced/diagnostics", title: "Diagnostics", body: "Pipeline health, feed state and engineering diagnostics.", icon: Activity },
  { to: "/advanced/tradingview", title: "TradingView Setup", body: "TradingView connection and feed configuration.", icon: Gauge },
  { to: "/advanced/analytics", title: "Signal Analytics", body: "Hypothetical signal and strategy research analytics.", icon: BarChart3 },
  { to: "/admin/users", title: "Users", body: "Account approval and administration.", icon: Users },
  { to: "/settings", title: "System Settings", body: "Account, push, risk, timezone and advanced preferences.", icon: Settings2 }
] as const;

export function AdvancedHubPage() {
  const { account } = useAuth();
  const isStaff = account?.role === "OWNER" || account?.role === "ADMIN";

  if (!isStaff) {
    return (
      <div className="gm26-page">
        <section className="gm26-card"><h1>Advanced</h1><p>Owner/admin access required.</p></section>
      </div>
    );
  }

  return (
    <div className="gm26-page gm26-advanced-hub" data-testid="gm26-advanced-hub">
      <div className="gm26-page-heading">
        <div><span className="gm26-eyebrow">OWNER / ADMIN</span><h1>Advanced</h1></div>
      </div>
      <p className="gm26-page-intro">Engineering, research and setup tools live here so they do not compete with the everyday Gold trading experience.</p>
      <div className="gm26-tool-grid">
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          return (
            <Link key={tool.to} to={tool.to} className="gm26-tool-card">
              <Icon aria-hidden />
              <div><strong>{tool.title}</strong><span>{tool.body}</span></div>
              <span aria-hidden>→</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
