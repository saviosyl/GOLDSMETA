import type { ReactNode } from "react";

export function PageHeader({
  title,
  environment,
  freshness,
  accountLabel
}: {
  title: string;
  environment?: string | null;
  freshness?: string | null;
  accountLabel?: string | null;
}) {
  return (
    <header className="gm-page-header" data-testid="page-header">
      <div>
        <h1 className="gm-page-title">{title}</h1>
      </div>
      <div className="gm-page-header-meta">
        {environment && (
          <span className={`gm-badge env ${String(environment).toLowerCase()}`}>{environment}</span>
        )}
        {freshness && (
          <span className="gm-meta" data-testid="data-freshness">
            {freshness}
          </span>
        )}
        {accountLabel && <span className="gm-meta">{accountLabel}</span>}
      </div>
    </header>
  );
}

export function StatusBadge({
  tone = "neutral",
  children
}: {
  tone?: "neutral" | "positive" | "warning" | "negative" | "gold";
  children: ReactNode;
}) {
  return <span className={`gm-badge ${tone}`}>{children}</span>;
}

export function MetricCard({
  label,
  value,
  hint
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="gm-metric" data-testid="metric-card">
      <span className="gm-label">{label}</span>
      <span className="gm-metric-value">{value}</span>
      {hint && <span className="gm-meta">{hint}</span>}
    </div>
  );
}

export function SectionCard({
  title,
  action,
  children,
  className = ""
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`gm-section ${className}`.trim()} data-testid="section-card">
      {(title || action) && (
        <div className="gm-section-head">
          {title && <h2 className="gm-section-title">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({
  title,
  body,
  icon
}: {
  title: string;
  body?: string;
  icon?: ReactNode;
}) {
  return (
    <div
      className={`gm-empty${icon ? " gm-empty-state" : ""}`.trim()}
      data-testid="empty-state"
      role="status"
    >
      {icon}
      <strong>{title}</strong>
      {body && <p className="gm-meta">{body}</p>}
    </div>
  );
}

export function DisclosurePanel({
  summary,
  children,
  defaultOpen = false
}: {
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="gm-disclosure" data-testid="disclosure-panel" open={defaultOpen || undefined}>
      <summary>{summary}</summary>
      <div className="gm-disclosure-body">{children}</div>
    </details>
  );
}

export function Tabs({
  items,
  value,
  onChange
}: {
  items: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="gm-tabs" role="tablist" data-testid="tabs">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          className={value === item.id ? "active" : undefined}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
