import type { ReactNode } from "react";

type PublicPageShellProps = {
  children: ReactNode;
  /** Stable test id for the shell wrapper. */
  testId?: string;
  /** Optional extra class names. */
  className?: string;
};

/**
 * Full-width public / auth page shell.
 *
 * Must NEVER use the authenticated dashboard sidebar grid
 * (`grid-template-columns: var(--sidebar-w) 1fr`). Auth and legal pages
 * are single-column, CSS-only, and usable without JS width measurement.
 */
export function PublicPageShell({
  children,
  testId = "public-page-shell",
  className
}: PublicPageShellProps) {
  const classes = ["gm-shell", "gm-public-shell", className].filter(Boolean).join(" ");
  return (
    <div className={classes} data-testid={testId} data-layout="public-fullwidth">
      {children}
    </div>
  );
}
