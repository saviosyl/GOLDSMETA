import { Shield } from "lucide-react";
import { DisclosurePanel } from "./ui/primitives";

/**
 * Compact intentional safety notice — not a failure banner.
 * Live execution locked is expected product behaviour.
 */
export function ExecutionDisabledBanner({ page }: { page: "brokers" | "autotrade" }) {
  return (
    <div
      className="gm-execution-disabled gm-safety-notice"
      data-testid="execution-disabled-banner"
      role="status"
    >
      <div className="gm-safety-notice__head">
        <Shield size={16} aria-hidden />
        <h2 className="gm-section-title">Safety mode</h2>
      </div>
      <p>
        Live execution locked · Live Auto locked · No live orders can be submitted
      </p>
      <DisclosurePanel summary="Technical details">
        <p className="gm-meta" style={{ margin: 0 }} data-testid={`${page}-execution-diagnostics`}>
          {page === "autotrade"
            ? "AutoTrade controls stay locked for live. No martingale, grid, or averaging-down paths are enabled."
            : "Broker Control Centre keeps live order submission locked. Demo prep and account connection remain available."}
        </p>
      </DisclosurePanel>
    </div>
  );
}
