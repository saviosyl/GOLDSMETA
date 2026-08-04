import { useEffect, useState } from "react";
import type { IntradayPlan } from "../../types/intradayPlan";
import {
  formatCountdown,
  msUntilNextPeriodClose,
  nextUpdateLabel,
  resolveNextUpdateKind
} from "../../lib/nextPlanUpdate";

type Props = {
  plan: IntradayPlan;
};

/** Informational candle-close countdown — never promises a signal. */
export function NextPlanUpdate({ plan }: Props) {
  const kind = resolveNextUpdateKind(plan);
  const periodMinutes = kind === "CONFIRM_5M" ? 5 : 15;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const remaining = msUntilNextPeriodClose(now, periodMinutes);

  return (
    <p
      className="gm-next-update"
      data-testid="next-plan-update"
      data-kind={kind}
      title="Countdown to the next candle close check. A signal is not guaranteed."
    >
      <span className="gm-label">{nextUpdateLabel(kind)}:</span>{" "}
      <strong data-testid="next-plan-update-countdown">{formatCountdown(remaining)}</strong>
      <span className="gm-sr-only">
        Informational only. Does not mean a signal will occur.
      </span>
    </p>
  );
}
