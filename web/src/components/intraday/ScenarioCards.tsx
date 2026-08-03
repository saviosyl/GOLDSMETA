import type { ScenarioPlan } from "../../types/intradayPlan";

type Props = {
  bullish: ScenarioPlan;
  bearish: ScenarioPlan;
};

function ScenarioCard({ plan, tone }: { plan: ScenarioPlan; tone: "bull" | "bear" }) {
  return (
    <article
      className={`gm-intra-scenario tone-${tone}`}
      data-testid={`scenario-${tone}`}
      aria-label={plan.label}
    >
      <h3>{plan.label}</h3>
      <dl>
        <div>
          <dt>Trigger</dt>
          <dd>{plan.trigger}</dd>
        </div>
        <div>
          <dt>First target</dt>
          <dd>{plan.firstTarget}</dd>
        </div>
        <div>
          <dt>Second target</dt>
          <dd>{plan.secondTarget}</dd>
        </div>
        <div>
          <dt>Invalidation</dt>
          <dd>{plan.invalidation}</dd>
        </div>
      </dl>
    </article>
  );
}

export function ScenarioCards({ bullish, bearish }: Props) {
  return (
    <section className="gm-intra-scenarios" data-testid="scenario-cards" aria-label="Bullish and bearish scenarios">
      <ScenarioCard plan={bullish} tone="bull" />
      <ScenarioCard plan={bearish} tone="bear" />
    </section>
  );
}
