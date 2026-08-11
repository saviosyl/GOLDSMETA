import { Link } from "react-router-dom";
import type { QualificationPublicView } from "../../lib/broker/qualificationTypes";

type Props = {
  view: QualificationPublicView;
  busy?: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onEnableDemoAuto: () => void;
  onAuthoriseTrading: () => void;
};

function barPct(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function toneFor(done: number, total: number, active: boolean): string {
  if (done >= total) return "is-done";
  if (active && done > 0) return "is-progress";
  if (active) return "is-progress";
  return "is-locked";
}

export function QualificationDashboard({
  view,
  busy,
  onStart,
  onPause,
  onResume,
  onEnableDemoAuto,
  onAuthoriseTrading
}: Props) {
  const state = view.state;
  const previewActive = state === "PREVIEW_QUALIFICATION";
  const controlledActive =
    state === "CONTROLLED_DEMO_QUALIFICATION" || state === "OBSERVATION_PERIOD";
  const obsActive = Boolean(view.observation.firstTradeAt);
  const safetyActive = state !== "SETUP_REQUIRED";

  return (
    <section
      className="gm-qual-dash"
      data-testid="autotrade-qualification"
      aria-label="AutoTrade qualification"
    >
      <div className="gm-qual-dash__head">
        <div>
          <p className="gm-label">AutoTrade qualification</p>
          <h2 data-testid="qual-overall">{view.overallLabel}</h2>
        </div>
        <span
          className={`gm-qual-pill gm-qual-pill--${state === "DEMO_AUTO_READY" || state === "LIVE_AUTO_ELIGIBLE" ? "ok" : state === "BLOCKED" ? "bad" : "amber"}`}
          data-testid="qual-state"
        >
          {view.state.replace(/_/g, " ")}
        </span>
      </div>

      <div className="gm-qual-next" data-testid="qual-next-action">
        <span className="gm-label">Next action</span>
        <strong>{view.nextAction}</strong>
        <p className="gm-meta">{view.nextRequirement}</p>
      </div>

      {state === "SETUP_REQUIRED" || (!view.canStart && !view.startedAt) ? (
        <ul className="gm-prem-check-list" data-testid="qual-setup-blockers">
          {view.blockers.map((b) => (
            <li key={b.id}>
              <span
                className={`gm-prem-check-ico ${b.ok ? "gm-prem-check-ico--ok" : "gm-prem-check-ico--warn"}`}
                aria-hidden
              >
                {b.ok ? "✓" : "○"}
              </span>
              <div>
                <strong>{b.label}</strong>
                {!b.ok && b.action ? <span>{b.action}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="gm-qual-meters">
        <Meter
          label="Preview qualification"
          done={view.preview.completed}
          total={view.preview.required}
          tone={toneFor(view.preview.completed, view.preview.required, previewActive)}
          testId="qual-preview"
        />
        <Meter
          label="Controlled Demo trades"
          done={view.controlledDemo.completed}
          total={view.controlledDemo.required}
          tone={toneFor(
            view.controlledDemo.completed,
            view.controlledDemo.required,
            controlledActive
          )}
          testId="qual-controlled"
          detail={`Open ${view.controlledDemo.open} · Blocked ${view.controlledDemo.blockedAttempts}`}
        />
        <Meter
          label="Observation period"
          done={view.observation.day ?? 0}
          total={view.observation.requiredDays}
          tone={toneFor(
            view.observation.day ?? 0,
            view.observation.requiredDays,
            obsActive
          )}
          testId="qual-observation"
          detail={
            view.observation.day != null
              ? `Day ${view.observation.day} / ${view.observation.requiredDays}`
              : "Not started"
          }
        />
        <Meter
          label="Safety checks"
          done={view.safety.completed}
          total={view.safety.required}
          tone={toneFor(view.safety.completed, view.safety.required, safetyActive)}
          testId="qual-safety"
        />
      </div>

      {view.todayActivity ? (
        <div className="gm-qual-today" data-testid="qual-today-activity">
          <h3>Today&apos;s qualification activity</h3>
          <p>
            Setups evaluated: {view.todayActivity.evaluated} · Qualified:{" "}
            {view.todayActivity.qualified} · Rejected: {view.todayActivity.rejected}
          </p>
        </div>
      ) : null}

      {(state === "DEMO_AUTO_ENABLED" ||
        state === "LIVE_QUALIFICATION" ||
        state === "LIVE_AUTO_ELIGIBLE" ||
        state === "LIVE_ACTIVATION_REQUIRED") && (
        <div className="gm-qual-live" data-testid="qual-live-eligibility">
          <h3>Live eligibility</h3>
          <p>
            Automated Demo trades {view.liveEligibility.demoAutoTrades} /{" "}
            {view.liveEligibility.requiredTrades}
          </p>
          <p>
            Observation{" "}
            {view.liveEligibility.observationDay != null
              ? `Day ${view.liveEligibility.observationDay}`
              : "—"}{" "}
            / {view.liveEligibility.requiredDays}
          </p>
          <p>Critical safety failures {view.liveEligibility.criticalSafetyFailures}</p>
          <p>
            Status: <strong>{view.liveEligibility.status}</strong>
          </p>
          <p className="gm-meta">Live orders remain locked until explicit activation.</p>
        </div>
      )}

      <div className="gm-qual-actions">
        {view.blockers.some((b) => b.id === "trading_scope" && !b.ok) ? (
          <button
            type="button"
            className="gm-btn gm-btn-primary"
            disabled={busy}
            data-testid="qual-authorise-trading"
            onClick={onAuthoriseTrading}
          >
            Authorise Demo Trading
          </button>
        ) : null}
        {view.canStart ? (
          <button
            type="button"
            className="gm-btn gm-btn-primary"
            disabled={busy}
            data-testid="qual-start"
            onClick={onStart}
          >
            Start Demo Auto qualification
          </button>
        ) : null}
        {view.canEnableDemoAuto ? (
          <button
            type="button"
            className="gm-btn gm-btn-primary"
            disabled={busy}
            data-testid="qual-enable-demo-auto"
            onClick={onEnableDemoAuto}
          >
            Enable Demo Auto
          </button>
        ) : null}
        {view.canBeginLiveActivation ? (
          <Link className="gm-btn" to="/brokers" data-testid="qual-begin-live">
            Begin Live activation
          </Link>
        ) : null}
        {view.canPause ? (
          <button
            type="button"
            className="gm-btn"
            disabled={busy}
            data-testid="qual-pause"
            onClick={onPause}
          >
            Pause qualification
          </button>
        ) : null}
        {view.canResume ? (
          <button
            type="button"
            className="gm-btn gm-btn-primary"
            disabled={busy}
            data-testid="qual-resume"
            onClick={onResume}
          >
            Resume qualification
          </button>
        ) : null}
        {!view.accountIdPresent ? (
          <Link className="gm-btn" to="/brokers" data-testid="qual-open-broker">
            Open Broker
          </Link>
        ) : null}
      </div>

      <details className="gm-qual-history" data-testid="qual-history">
        <summary>View qualification history</summary>
        <ul>
          {(view.recentEvaluations ?? []).slice(0, 12).map((e, i) => (
            <li key={`${e.at}-${i}`} data-testid="qual-eval-row">
              {e.direction} · {e.outcome === "QUALIFIED" ? "Passed" : "Blocked"} ·{" "}
              {e.reasonLabel}
              {e.confidence != null ? ` · ${Math.round(e.confidence)}%` : ""}
              {e.failed?.includes("SPREAD_TOO_WIDE") && e.spread != null && e.maxSpread != null
                ? ` · Spread ${e.spread} (max ${e.maxSpread})`
                : ""}
            </li>
          ))}
          {view.recentPreviews.map((p, i) => (
            <li key={p.id}>
              Preview #{view.preview.completed - i} {p.direction} Passed
              {p.confidence != null ? ` · ${Math.round(p.confidence)}% confidence` : ""}
            </li>
          ))}
          {view.recentControlledTrades.map((t, i) => (
            <li key={t.id}>
              Trade #{view.controlledDemo.completed - i || i + 1} {t.direction}{" "}
              {t.status === "CLOSED" ? "Closed" : t.status}
              {t.pnl != null ? ` · Demo P/L ${t.pnl}` : ""}
            </li>
          ))}
          {(view.recentEvaluations?.length ?? 0) === 0 &&
          view.recentPreviews.length === 0 &&
          view.recentControlledTrades.length === 0 ? (
            <li>No qualifying Pepperstone events yet</li>
          ) : null}
        </ul>
      </details>
    </section>
  );
}

function Meter(props: {
  label: string;
  done: number;
  total: number;
  tone: string;
  testId: string;
  detail?: string;
}) {
  const pct = barPct(props.done, props.total);
  return (
    <div className={`gm-qual-meter ${props.tone}`} data-testid={props.testId}>
      <div className="gm-qual-meter__row">
        <span>{props.label}</span>
        <strong>
          {props.done} / {props.total}
        </strong>
      </div>
      <div className="gm-qual-meter__track" aria-hidden>
        <div className="gm-qual-meter__fill" style={{ width: `${pct}%` }} />
      </div>
      {props.detail ? <p className="gm-meta">{props.detail}</p> : null}
    </div>
  );
}
