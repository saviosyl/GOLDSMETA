import { useState } from "react";
import type { ScenarioPlan } from "../../types/intradayPlan";

type Props = {
  bullish: ScenarioPlan;
  bearish: ScenarioPlan;
};

function ScenarioBody({ plan }: { plan: ScenarioPlan }) {
  return (
    <dl>
      <div>
        <dt>Trigger</dt>
        <dd>{plan.trigger}</dd>
      </div>
      {(plan.confirmationRequired?.length ?? 0) > 0 && (
        <div>
          <dt>Confirmation required</dt>
          <dd>{plan.confirmationRequired!.join("; ")}</dd>
        </div>
      )}
      <div>
        <dt>Target 1</dt>
        <dd data-testid="scenario-target-1">{plan.firstTarget}</dd>
      </div>
      {plan.firstTargetWhy && (
        <div>
          <dt>Why this target</dt>
          <dd className="gm-scenario-why">{plan.firstTargetWhy}</dd>
        </div>
      )}
      <div>
        <dt>Target 2</dt>
        <dd data-testid="scenario-target-2">{plan.secondTarget}</dd>
      </div>
      <div>
        <dt>Invalidation</dt>
        <dd>{plan.invalidation}</dd>
      </div>
    </dl>
  );
}

export function ScenarioCards({ bullish, bearish }: Props) {
  const [tab, setTab] = useState<"bull" | "bear">("bull");

  return (
    <section
      className="gm-intra-scenarios"
      data-testid="scenario-cards"
      aria-label="Bullish and bearish scenarios"
    >
      <div className="gm-scenario-tabs gm-mobile-only" role="tablist" aria-label="Scenario direction">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "bull"}
          className={tab === "bull" ? "active" : undefined}
          onClick={() => setTab("bull")}
          data-testid="scenario-tab-bull"
        >
          If price rises
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "bear"}
          className={tab === "bear" ? "active" : undefined}
          onClick={() => setTab("bear")}
          data-testid="scenario-tab-bear"
        >
          If price falls
        </button>
      </div>

      <div className="gm-intra-scenarios-grid" data-testid="scenario-grid">
        <article
          className={`gm-intra-scenario tone-bull ${tab === "bull" ? "is-active" : ""}`}
          data-testid="scenario-bull"
          aria-label={bullish.label}
        >
          <h3>{bullish.label}</h3>
          <ScenarioBody plan={bullish} />
        </article>
        <article
          className={`gm-intra-scenario tone-bear ${tab === "bear" ? "is-active" : ""}`}
          data-testid="scenario-bear"
          aria-label={bearish.label}
        >
          <h3>{bearish.label}</h3>
          <ScenarioBody plan={bearish} />
        </article>
      </div>
    </section>
  );
}
