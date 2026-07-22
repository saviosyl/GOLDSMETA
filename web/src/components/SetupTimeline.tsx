import type { SetupRecord, SetupStatus } from "../types/models";
import { formatWhen } from "../lib/format";

const STEPS: Array<{ id: string; match: SetupStatus[] | "terminal" }> = [
  { id: "Signal", match: ["SIGNAL_CREATED"] },
  { id: "Waiting", match: ["WAITING_FOR_ENTRY"] },
  { id: "Entered", match: ["ENTRY_TRIGGERED", "TP1_HIT", "TP2_HIT", "TP3_HIT", "STOP_LOSS_HIT", "BREAKEVEN", "CLOSED"] },
  { id: "TP1", match: ["TP1_HIT", "TP2_HIT", "TP3_HIT"] },
  { id: "TP2", match: ["TP2_HIT", "TP3_HIT"] },
  { id: "Exit", match: "terminal" }
];

const TERMINAL: SetupStatus[] = [
  "TP3_HIT",
  "STOP_LOSS_HIT",
  "EXPIRED",
  "CANCELLED",
  "INVALIDATED",
  "CLOSED",
  "AMBIGUOUS_INTRABAR",
  "BREAKEVEN"
];

function stepState(
  step: (typeof STEPS)[number],
  status: SetupStatus
): "done" | "current" | "pending" | "fail" {
  if (step.match === "terminal") {
    if (TERMINAL.includes(status)) {
      if (status === "STOP_LOSS_HIT" || status === "EXPIRED" || status === "CANCELLED" || status === "INVALIDATED") {
        return "fail";
      }
      if (status === "AMBIGUOUS_INTRABAR") return "current";
      return "done";
    }
    return "pending";
  }
  if (step.match.includes(status)) return "current";
  const order = STEPS.findIndex((s) => s.id === step.id);
  const currentIdx = STEPS.findIndex((s) =>
    s.match === "terminal" ? TERMINAL.includes(status) : s.match.includes(status)
  );
  if (currentIdx > order) return "done";
  return "pending";
}

function exitLabel(status: SetupStatus): string {
  if (status === "TP3_HIT") return "TP3";
  if (status === "STOP_LOSS_HIT") return "SL";
  if (status === "EXPIRED") return "Expired";
  if (status === "AMBIGUOUS_INTRABAR") return "Ambiguous";
  if (status === "CANCELLED" || status === "INVALIDATED") return status.replaceAll("_", " ");
  return "Exit";
}

interface Props {
  setup: SetupRecord;
}

export function SetupTimeline({ setup }: Props) {
  const lastAt =
    setup.statusHistory[setup.statusHistory.length - 1]?.at ?? setup.updatedAt;

  return (
    <section className="setup-timeline card" aria-label="Setup progress" data-testid="setup-timeline-visual">
      <h2 className="section-title">Setup progress</h2>
      <ol className="timeline-track">
        {STEPS.map((step) => {
          const state = stepState(step, setup.status);
          const label = step.id === "Exit" ? exitLabel(setup.status) : step.id;
          return (
            <li key={step.id} className={`timeline-step ${state}`} data-state={state}>
              <span className="timeline-dot" aria-hidden />
              <span className="timeline-label">{label}</span>
            </li>
          );
        })}
      </ol>
      <p className="muted timeline-meta">
        {setup.status.replaceAll("_", " ")} · updated {formatWhen(lastAt)}
        {setup.environment === "LIVE" ? " · LIVE" : " · TEST"}
      </p>
    </section>
  );
}
