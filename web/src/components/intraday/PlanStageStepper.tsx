import { useId, useState } from "react";
import type { IntradayPlan } from "../../types/intradayPlan";
import { resolveAuthoritativeConfirmation } from "../../lib/confirmationAuthority";
import { isNoValidIntradayPlan } from "../../lib/planTextFormat";

type StageStatus = "done" | "current" | "pending" | "failed";

type Stage = {
  id: string;
  label: string;
  shortLabel: string;
  status: StageStatus;
  detail: string;
};

function stageMark(status: StageStatus): string {
  if (status === "done") return "✓";
  if (status === "failed") return "✕";
  if (status === "current") return "○";
  return "○";
}

/**
 * Compact four-stage progress: CONTEXT → ENTRY → 5M CONFIRM → MANAGE
 * Red crosses only for genuine failure / unsafe — never for ordinary waiting.
 */
export function PlanStageStepper({
  plan,
  marketStructureMode
}: {
  plan: IntradayPlan;
  marketStructureMode?: string | null;
}) {
  const noValid = isNoValidIntradayPlan(plan, marketStructureMode);
  const isNoTrade =
    String(plan.action).toUpperCase() === "NO_TRADE" ||
    String(plan.planStatus ?? "").toUpperCase() === "NO_TRADE";
  const auth = resolveAuthoritativeConfirmation({
    confirmationState: plan.confirmation5m?.state,
    direction: plan.tradePlan.direction || plan.action
  });
  const confirmFailed =
    /CONFIRMATION_FAILED|RETEST_FAILED/i.test(String(plan.confirmation5m?.state ?? "")) ||
    (auth.meaningful && !auth.supportsPlan && !noValid);
  const inZone = plan.setupProgress?.items?.some(
    (i) => i.id === "location" && (i.mark === "pass" || i.complete)
  );
  const contextOk =
    !noValid &&
    plan.setupProgress?.items?.some(
      (i) =>
        (i.id === "structure" || i.id === "bias" || i.id === "htf") &&
        (i.mark === "pass" || i.complete)
    );
  const managing =
    String(plan.planStatus ?? "").toUpperCase() === "CONFIRMED" ||
    String(plan.planStatus ?? "").toUpperCase() === "IN_PROGRESS" ||
    String(plan.planStatus ?? "").toUpperCase() === "TP1_REACHED" ||
    String(plan.action).includes("NOW");
  const unsafe =
    isNoTrade ||
    String(plan.planStatus ?? "").toUpperCase() === "INVALIDATED" ||
    plan.geometryValid === false;

  const stages: Stage[] = [
    {
      id: "context",
      label: "Context",
      shortLabel: "CONTEXT",
      status: unsafe && noValid
        ? "current"
        : contextOk
          ? "done"
          : noValid
            ? "current"
            : "current",
      detail: noValid
        ? "Waiting for a complete 15-minute structure — not a failure."
        : contextOk
          ? "Wider context is aligned."
          : "Waiting for wider context to align."
    },
    {
      id: "zone",
      label: "Entry",
      shortLabel: "ENTRY",
      status: noValid
        ? "pending"
        : inZone
          ? "done"
          : contextOk
            ? "current"
            : "pending",
      detail: noValid
        ? "Entry zone appears only after a valid plan."
        : inZone
          ? "Price is inside the entry zone."
          : "Waiting for price to reach the entry zone."
    },
    {
      id: "confirm",
      label: "5M confirm",
      shortLabel: "5M CONFIRM",
      status: noValid
        ? "pending"
        : confirmFailed
          ? "failed"
          : auth.supportsPlan
            ? "done"
            : inZone
              ? "current"
              : "pending",
      detail: noValid
        ? "5M confirmation is not active without a valid plan."
        : confirmFailed
          ? "Confirmation does not support this plan."
          : auth.supportsPlan
            ? "5M confirmation supports the plan."
            : "Waiting for a verified 5-minute confirmation."
    },
    {
      id: "manage",
      label: "Manage",
      shortLabel: "MANAGE",
      status: unsafe && isNoTrade
        ? "failed"
        : managing && auth.supportsPlan
          ? "current"
          : "pending",
      detail: isNoTrade
        ? "No trade — management does not start."
        : managing && auth.supportsPlan
          ? "Manage the manual plan. AutoTrade stays OFF."
          : "Trade management has not started."
    }
  ];

  const [openId, setOpenId] = useState<string | null>(null);
  const tipId = useId();

  const openStage = stages.find((s) => s.id === openId) ?? null;

  return (
    <section
      className="gm-stage-stepper gm-stage-compact"
      data-testid="plan-stage-stepper"
      aria-label="Plan stages"
    >
      <ol className="gm-stage-rail">
        {stages.map((s) => {
          const expanded = openId === s.id;
          return (
            <li key={s.id} data-status={s.status} data-testid={`plan-stage-${s.id}`}>
              <button
                type="button"
                className="gm-stage-node"
                aria-expanded={expanded}
                aria-controls={expanded ? tipId : undefined}
                onClick={() => setOpenId(expanded ? null : s.id)}
              >
                <span className="gm-stage-mark" aria-hidden="true">
                  {stageMark(s.status)}
                </span>
                <span className="gm-stage-label">{s.shortLabel}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {openStage && (
        <p
          id={tipId}
          className="gm-stage-tip"
          data-testid={`plan-stage-tip-${openStage.id}`}
          role="status"
        >
          {openStage.detail}
        </p>
      )}
    </section>
  );
}
