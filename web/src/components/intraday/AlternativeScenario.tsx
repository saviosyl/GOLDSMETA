import type { IntradayPlan, ScenarioPlan } from "../../types/intradayPlan";
import { primaryScenarioSide } from "../../lib/planDisplay";
import { scenarioStatus } from "../../lib/cockpitHelpers";

type Props = {
  plan: IntradayPlan;
};

function ScenarioSummary({
  side,
  scenario,
  status
}: {
  side: "bullish" | "bearish";
  scenario: ScenarioPlan;
  status: string;
}) {
  return (
    <div className="gm-alt-scenario-body" data-testid={`alt-scenario-${side}`}>
      <p className="gm-meta">
        <strong>{side === "bullish" ? "Bullish" : "Bearish"}</strong> · {status}
      </p>
      <dl>
        <div>
          <dt>Trigger</dt>
          <dd>{scenario.trigger}</dd>
        </div>
        <div>
          <dt>TP1</dt>
          <dd>{scenario.firstTarget}</dd>
        </div>
        <div>
          <dt>Invalidation</dt>
          <dd>{scenario.invalidation}</dd>
        </div>
      </dl>
      <p className="gm-meta">Research only — never an active order ticket.</p>
    </div>
  );
}

/**
 * Collapsed alternative scenario — secondary to the primary plan.
 */
export function AlternativeScenario({ plan }: Props) {
  const primary = primaryScenarioSide(plan);
  const altSide: "bullish" | "bearish" =
    primary === "bearish" ? "bullish" : "bearish";
  const scenario = altSide === "bullish" ? plan.bullishScenario : plan.bearishScenario;
  const status = scenarioStatus(
    plan,
    scenario,
    altSide === "bullish" ? "bull" : "bear"
  );

  return (
    <details
      className="gm-alt-scenario"
      data-testid="alternative-scenario"
      data-primary-side={primary}
    >
      <summary>
        <span className="gm-section-title">Alternative Scenario</span>
        <span className="gm-meta">
          {altSide === "bullish" ? "Bullish" : "Bearish"} path · collapsed
        </span>
      </summary>
      <ScenarioSummary side={altSide} scenario={scenario} status={status} />
    </details>
  );
}
