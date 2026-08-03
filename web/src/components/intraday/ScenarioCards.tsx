import { useEffect, useId, useState } from "react";
import type { IntradayPlan, ScenarioPlan } from "../../types/intradayPlan";
import { scenarioStatus, type ScenarioStatus } from "../../lib/cockpitHelpers";

type Props = {
  plan: IntradayPlan;
  bullish: ScenarioPlan;
  bearish: ScenarioPlan;
};

function statusTone(status: ScenarioStatus): string {
  switch (status) {
    case "Confirmed":
      return "positive";
    case "Forming":
      return "warning";
    case "Invalid":
      return "negative";
    case "Unavailable":
      return "neutral";
    default:
      return "neutral";
  }
}

function ScenarioBody({
  plan,
  status,
  side,
  onExplain
}: {
  plan: ScenarioPlan;
  status: ScenarioStatus;
  side: "bull" | "bear";
  onExplain: () => void;
}) {
  return (
    <>
      <div className="gm-scenario-head">
        <h3>{side === "bull" ? "Bullish" : "Bearish"}</h3>
        <span
          className={`gm-badge ${statusTone(status)}`}
          data-testid={`scenario-status-${side}`}
        >
          {status}
        </span>
      </div>
      <p className="gm-meta gm-scenario-label">{plan.label}</p>
      <dl>
        <div>
          <dt>Trigger</dt>
          <dd>{plan.trigger}</dd>
        </div>
        <div>
          <dt>Confirmation</dt>
          <dd>
            {(plan.confirmationRequired?.length ?? 0) > 0
              ? plan.confirmationRequired!.join("; ")
              : "—"}
          </dd>
        </div>
        <div>
          <dt>TP1</dt>
          <dd data-testid="scenario-target-1">{plan.firstTarget}</dd>
        </div>
        <div>
          <dt>TP2</dt>
          <dd data-testid="scenario-target-2">{plan.secondTarget}</dd>
        </div>
        <div>
          <dt>Invalidation</dt>
          <dd>{plan.invalidation}</dd>
        </div>
        <div>
          <dt>Reason</dt>
          <dd className="gm-scenario-why">
            {plan.firstTargetWhy ?? "Conditional research path only — not an active order."}
          </dd>
        </div>
      </dl>
      <p className="gm-meta" data-testid={`scenario-setup-status-${side}`}>
        Setup status: {status}
      </p>
      <button
        type="button"
        className="gm-chip-btn"
        data-testid={`scenario-explain-${side}`}
        onClick={onExplain}
      >
        Explain scenario
      </button>
    </>
  );
}

export function ScenarioCards({ plan, bullish, bearish }: Props) {
  const [tab, setTab] = useState<"bull" | "bear">("bull");
  const [explain, setExplain] = useState<"bull" | "bear" | null>(null);
  const panelId = useId();
  const bullStatus = scenarioStatus(plan, bullish, "bull");
  const bearStatus = scenarioStatus(plan, bearish, "bear");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExplain(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const explained = explain === "bull" ? bullish : explain === "bear" ? bearish : null;

  return (
    <section
      className="gm-intra-scenarios"
      data-testid="scenario-cards"
      aria-label="Trade scenarios"
    >
      <div className="gm-section-head">
        <h2 className="gm-section-title">Trade Scenarios</h2>
        <span className="gm-meta">Research only — not order tickets</span>
      </div>

      <div className="gm-scenario-tabs gm-mobile-only" role="tablist" aria-label="Scenario direction">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "bull"}
          className={tab === "bull" ? "active" : undefined}
          onClick={() => setTab("bull")}
          data-testid="scenario-tab-bull"
        >
          Bullish
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "bear"}
          className={tab === "bear" ? "active" : undefined}
          onClick={() => setTab("bear")}
          data-testid="scenario-tab-bear"
        >
          Bearish
        </button>
      </div>

      <div className="gm-intra-scenarios-grid" data-testid="scenario-grid">
        <article
          className={`gm-intra-scenario tone-bull ${tab === "bull" ? "is-active" : ""}`}
          data-testid="scenario-bull"
          aria-label={bullish.label}
        >
          <ScenarioBody
            plan={bullish}
            status={bullStatus}
            side="bull"
            onExplain={() => setExplain("bull")}
          />
        </article>
        <article
          className={`gm-intra-scenario tone-bear ${tab === "bear" ? "is-active" : ""}`}
          data-testid="scenario-bear"
          aria-label={bearish.label}
        >
          <ScenarioBody
            plan={bearish}
            status={bearStatus}
            side="bear"
            onExplain={() => setExplain("bear")}
          />
        </article>
      </div>

      {explained && (
        <div
          id={panelId}
          className="gm-action-drawer"
          role="dialog"
          aria-label="Scenario explanation"
          data-testid="scenario-explain-panel"
        >
          <strong>{explained.label}</strong>
          <p>
            This is a conditional research path. It becomes interesting only if the trigger happens
            and confirmation holds. It is never an active broker order.
          </p>
          <p>
            <strong>Trigger:</strong> {explained.trigger}
          </p>
          <p>
            <strong>Invalidation:</strong> {explained.invalidation}
          </p>
          {explained.firstTargetWhy && <p className="gm-meta">{explained.firstTargetWhy}</p>}
          <button
            type="button"
            className="gm-btn-outline gm-drawer-close"
            onClick={() => setExplain(null)}
          >
            Close
          </button>
        </div>
      )}
    </section>
  );
}
