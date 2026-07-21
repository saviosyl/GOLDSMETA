import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ManualRiskPlanner } from "../components/ManualRiskPlanner";
import type { ManualRiskSettings, SetupRecord } from "../types/models";
import { PageHeader, SectionCard } from "../components/ui/primitives";
import { formatClientError } from "../lib/errors";

const DEFAULT_RISK: ManualRiskSettings = {
  currency: "EUR",
  maxCashRiskPerTrade: 20,
  maxDailyRealisedLoss: 40,
  stopAfterConsecutiveLosses: 3,
  maxSimultaneousManualTrades: 1,
  valuePerPoint: null,
  estimatedSpreadPoints: null,
  noAveragingDown: true,
  noMartingale: true,
  noAutomaticRecovery: true
};

/** Dedicated manual trade / risk planner — never places broker orders. */
export function RiskPlannerPage() {
  const { api } = useAuth();
  const [risk, setRisk] = useState<ManualRiskSettings>(DEFAULT_RISK);
  const [setup, setSetup] = useState<SetupRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [settings, active] = await Promise.all([
          api.getSettings(),
          api.listActiveSetups().catch(() => [] as SetupRecord[])
        ]);
        if (settings.manualRisk) setRisk(settings.manualRisk);
        setSetup(active[0] ?? null);
      } catch (err) {
        setError(formatClientError(err, "Unable to load risk preferences"));
      }
    })();
  }, [api]);

  return (
    <div data-testid="risk-planner-page">
      <PageHeader title="Risk planner" environment="LIVE" freshness="Manual only" />
      <p className="gm-meta" style={{ marginTop: -8, marginBottom: 16 }}>
        Progressive calculator for position sizing. GoldMeta never places trades.{" "}
        <Link className="gm-linkish" to="/settings">
          Edit risk preferences
        </Link>
      </p>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      <SectionCard>
        <ManualRiskPlanner risk={risk} setup={setup} />
      </SectionCard>
    </div>
  );
}
