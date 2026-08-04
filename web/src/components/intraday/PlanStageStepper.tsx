import type { IntradayPlan } from "../../types/intradayPlan";
import { resolveAuthoritativeConfirmation } from "../../lib/confirmationAuthority";
import { isNoValidIntradayPlan } from "../../lib/planTextFormat";

type Stage = {
  id: string;
  label: string;
  status: "done" | "current" | "pending" | "blocked";
  detail: string;
};

function stageMark(status: Stage["status"]): string {
  if (status === "done") return "✓";
  if (status === "blocked") return "✕";
  if (status === "current") return "○";
  return "—";
}

/**
 * Four-stage visual: CONTEXT → ENTRY ZONE → 5M CONFIRMATION → TRADE MANAGEMENT
 */
export function PlanStageStepper({
  plan,
  marketStructureMode
}: {
  plan: IntradayPlan;
  marketStructureMode?: string | null;
}) {
  const noValid = isNoValidIntradayPlan(plan, marketStructureMode);
  const auth = resolveAuthoritativeConfirmation({
    confirmationState: plan.confirmation5m?.state,
    direction: plan.tradePlan.direction || plan.action
  });
  const inZone = plan.setupProgress?.items?.some(
    (i) => i.id === "location" && (i.mark === "pass" || i.complete)
  );
  const contextOk = plan.setupProgress?.items?.some(
    (i) =>
      (i.id === "structure" || i.id === "bias" || i.id === "htf") &&
      (i.mark === "pass" || i.complete)
  );
  const managing =
    String(plan.planStatus ?? "").toUpperCase() === "CONFIRMED" ||
    String(plan.action).includes("NOW");

  const stages: Stage[] = [
    {
      id: "context",
      label: "Context",
      status: noValid ? "blocked" : contextOk ? "done" : "current",
      detail: noValid
        ? "Context incomplete"
        : contextOk
          ? "Context aligned"
          : "Waiting for wider context"
    },
    {
      id: "zone",
      label: "Entry zone",
      status: noValid
        ? "blocked"
        : inZone
          ? "done"
          : contextOk
            ? "current"
            : "pending",
      detail: inZone ? "Price entered zone" : "Waiting for entry zone"
    },
    {
      id: "confirm",
      label: "5M confirmation",
      status: noValid
        ? "blocked"
        : auth.supportsPlan
          ? "done"
          : inZone
            ? "current"
            : "pending",
      detail: auth.supportsPlan
        ? "Confirmation passed"
        : auth.meaningful
          ? "Confirmation does not support plan"
          : "Waiting for 5M confirmation"
    },
    {
      id: "manage",
      label: "Trade management",
      status: managing && auth.supportsPlan ? "current" : "pending",
      detail: managing && auth.supportsPlan ? "Manage the manual plan" : "Management not started"
    }
  ];

  return (
    <section className="gm-stage-stepper" data-testid="plan-stage-stepper" aria-label="Plan stages">
      <h3 className="gm-section-title">Current stage</h3>
      <ol className="gm-stage-list">
        {stages.map((s) => (
          <li key={s.id} data-status={s.status} data-testid={`plan-stage-${s.id}`}>
            <span className="gm-stage-mark" aria-hidden="true">
              {stageMark(s.status)}
            </span>
            <div>
              <strong>{s.label}</strong>
              <p className="gm-meta">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
