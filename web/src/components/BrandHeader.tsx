import { Link } from "react-router-dom";

interface Props {
  subtitle?: string;
  environment?: "LIVE" | "TEST" | string | null;
  trackingEnvs?: string[];
}

export function BrandHeader({
  subtitle = "XAUUSD analysis · manual execution only",
  environment,
  trackingEnvs
}: Props) {
  return (
    <header className="brand-header" data-testid="brand-header">
      <div className="brand-header-row">
        <Link to="/" className="brand-lockup" aria-label="GoldMeta home">
          <img
            src="/brand/mark-dark.svg"
            alt=""
            width={40}
            height={40}
            className="brand-mark"
          />
          <span className="brand brand-wordmark">GoldMeta</span>
        </Link>
        <div className="brand-badges">
          {environment && (
            <span
              className={`env-badge ${String(environment).toUpperCase() === "TEST" ? "test" : "live"}`}
              data-testid="env-badge"
            >
              {String(environment).toUpperCase()}
            </span>
          )}
          {trackingEnvs && trackingEnvs.length > 0 && (
            <span className="env-badge tracking" data-testid="tracking-badge" title="Setup tracking environments">
              Track {trackingEnvs.join("+")}
            </span>
          )}
        </div>
      </div>
      <p className="subtitle">{subtitle}</p>
    </header>
  );
}
