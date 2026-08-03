import type { ReactNode } from "react";
import type { IntradayPlan } from "../../types/intradayPlan";
import { ScoreBreakdown } from "../v5/ScoreBreakdown";

type Score = {
  total?: number;
  components?: Array<{ label: string; score: number; max: number; reason: string }>;
  disclaimer?: string;
};

type Props = {
  plan: IntradayPlan | null;
  score: Score | null;
  marketStructureMode: string | null;
  diagnostics: Record<string, unknown> | null;
  decisionId?: string | null;
  children?: ReactNode;
};

export function SystemStatusCollapse({
  plan,
  score,
  marketStructureMode,
  diagnostics,
  decisionId,
  children
}: Props) {
  return (
    <details className="gm-system-status" data-testid="system-status-collapse">
      <summary>
        System status
        <span className="gm-meta">
          {marketStructureMode ?? "—"} · {plan?.freshness.sourceLabel ?? "—"}
        </span>
      </summary>
      <div className="gm-system-status-body">
        <p className="gm-meta" data-testid="system-status-safety">
          AutoTrade {plan?.safety.autoTrade ?? "OFF"} · Demo orders{" "}
          {plan?.safety.demoOrderSubmission ? "ON" : "OFF"} · Live trading{" "}
          {plan?.safety.liveTrading ? "ON" : "OFF"} · Analysis only
        </p>
        <p className="gm-meta">
          Mode: {marketStructureMode ?? "—"}
          <br />
          Quote age: {plan?.freshness.quoteAgeSeconds ?? "—"}s · Signal age:{" "}
          {plan?.freshness.signalAgeSeconds ?? "—"}s
          <br />
          Data quality: {plan?.freshness.dataQuality ?? "—"}
          <br />
          Decision ID: {decisionId ?? "—"}
        </p>
        {diagnostics && (
          <pre className="gm-system-diagnostics" data-testid="system-diagnostics">
            {JSON.stringify(diagnostics, null, 2)}
          </pre>
        )}
        <ScoreBreakdown
          total={score?.total}
          components={score?.components}
          disclaimer={score?.disclaimer}
          compact
        />
        {children}
      </div>
    </details>
  );
}
