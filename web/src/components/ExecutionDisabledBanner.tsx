import { DisclosurePanel } from "./ui/primitives";

/** Shared banner for Brokers / AutoTrade while execution remains locked. */
export function ExecutionDisabledBanner({ page }: { page: "brokers" | "autotrade" }) {
  return (
    <div className="gm-execution-disabled" data-testid="execution-disabled-banner" role="status">
      <h2 className="gm-section-title">Execution disabled</h2>
      <p>
        GoldMeta remains analysis-only. Manual planning is available. Broker orders are not submitted
        from this page.
      </p>
      <ul className="gm-help-list">
        <li>AutoTrade OFF</li>
        <li>Demo submission OFF</li>
        <li>Live execution OFF</li>
      </ul>
      <DisclosurePanel summary="Technical diagnostics">
        <p className="gm-meta" style={{ margin: 0 }} data-testid={`${page}-execution-diagnostics`}>
          {page === "autotrade"
            ? "AutoTrade controls stay locked. No martingale, grid, or averaging-down paths are enabled."
            : "Broker Control Centre is read-only / prep only. cTrader setup is not continued in this release."}
        </p>
      </DisclosurePanel>
    </div>
  );
}
