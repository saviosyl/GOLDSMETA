import { useEffect, useState } from "react";
import { Activity, ChevronDown, FlaskConical, Layers3 } from "lucide-react";
import { useAuth } from "../lib/auth";

type AnyRec = Record<string, unknown>;

/** V4 Stage B research panel — LIVE SHADOW ONLY. Never actionable. */
export function V4ResearchPage() {
  const { api } = useAuth();
  const [status, setStatus] = useState<AnyRec | null>(null);
  const [analyses, setAnalyses] = useState<AnyRec[]>([]);
  const [candidates, setCandidates] = useState<AnyRec[]>([]);
  const [plans, setPlans] = useState<AnyRec[]>([]);
  const [openPlan, setOpenPlan] = useState<AnyRec | null>(null);
  const [analytics, setAnalytics] = useState<AnyRec | null>(null);
  const [gc, setGc] = useState<AnyRec | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [s, a, c, p, an, g] = await Promise.all([
          api.v4Status(),
          api.v4Analyses("LIVE", 20),
          api.v4Candidates("LIVE", 20),
          api.v4Plans("LIVE", 20),
          api.v4Analytics("LIVE"),
          api.v4GcStatus()
        ]);
        setStatus(s as AnyRec);
        setAnalyses(a as AnyRec[]);
        setCandidates(c as AnyRec[]);
        setPlans(p.plans as AnyRec[]);
        setOpenPlan((p.openPlan as AnyRec | null) ?? null);
        setAnalytics(an);
        setGc(g.gc);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load V4 research status");
      }
    })();
  }, [api]);

  const latest = analyses[0] ?? null;
  const flags = (status?.flags as AnyRec | undefined) ?? {};

  return (
    <div className="v4-research-page gm-premium-v2" data-testid="v4-research-page">
      <h1 className="gm-page-title">Research</h1>
      <p className="gm-meta" style={{ marginBottom: 16 }}>
        Separate strategyVersion=4 research engine. Production remains V3. AutoTrade OFF.
      </p>

      <div className="banner stale" role="status" data-testid="v4-shadow-banner">
        V4 RESEARCH — LIVE SHADOW ONLY
        <br />
        NOT A TRADE RECOMMENDATION
      </div>

      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      <section className="gm-card-v2" data-testid="v4-status">
        <h2 className="gm-section-title">Summary · Shadow deployment</h2>
        <div className="grid-2">
          <div className="metric">
            <span className="label">Strategy</span>
            <span className="value">{String(status?.strategyVersion ?? "4")}</span>
          </div>
          <div className="metric">
            <span className="label">Stage</span>
            <span className="value">{String(status?.deploymentStage ?? "LIVE_SHADOW")}</span>
          </div>
          <div className="metric">
            <span className="label">Mode</span>
            <span className="value">{String(status?.mode ?? "SHADOW")}</span>
          </div>
          <div className="metric">
            <span className="label">Actionable</span>
            <span className="value">false</span>
          </div>
          <div className="metric">
            <span className="label">Shadow compute</span>
            <span className="value">{String(status?.shadowComputeEnabled ?? flags.V4_SHADOW_COMPUTE_ENABLED ?? "—")}</span>
          </div>
          <div className="metric">
            <span className="label">Lifecycle</span>
            <span className="value">{String(status?.shadowLifecycleEnabled ?? flags.V4_SHADOW_LIFECYCLE_ENABLED ?? "—")}</span>
          </div>
          <div className="metric">
            <span className="label">Broker</span>
            <span className="value">{String(status?.brokerExecution ?? "DISABLED")}</span>
          </div>
          <div className="metric">
            <span className="label">Engine</span>
            <span className="value">{String(status?.engineVersion ?? "—")}</span>
          </div>
        </div>
        <p className="muted">{String(status?.note ?? "")}</p>
      </section>

      <section className="gm-card-v2" data-testid="v4-latest-analysis">
        <h2 className="gm-section-title">Latest V4 analysis</h2>
        {!latest ? (
          <p className="muted">No LIVE shadow analyses yet. Waiting for confirmed market events.</p>
        ) : (
          <div className="grid-2">
            <div className="metric">
              <span className="label">Bar</span>
              <span className="value">{String(latest.barTime ?? "—")}</span>
            </div>
            <div className="metric">
              <span className="label">Session</span>
              <span className="value">{String(latest.session ?? "—")}</span>
            </div>
            <div className="metric">
              <span className="label">Regime</span>
              <span className="value">{String(latest.regime ?? "—")}</span>
            </div>
            <div className="metric">
              <span className="label">Bias</span>
              <span className="value">{String(latest.bias ?? "—")}</span>
            </div>
            <div className="metric">
              <span className="label">GC</span>
              <span className="value">{String(latest.gcConfirmation ?? "UNAVAILABLE")}</span>
            </div>
            <div className="metric">
              <span className="label">ATR</span>
              <span className="value">{String(latest.atr ?? "—")}</span>
            </div>
          </div>
        )}
        {latest && Array.isArray(latest.gateFailures) && (latest.gateFailures as string[]).length > 0 && (
          <p className="muted">
            Gates: {(latest.gateFailures as string[]).slice(0, 6).join(" · ")}
          </p>
        )}
        {latest && Array.isArray(latest.rejectionReasons) && (latest.rejectionReasons as string[]).length > 0 && (
          <p className="muted">
            Rejected: {(latest.rejectionReasons as string[]).slice(0, 4).join(" · ")}
          </p>
        )}
      </section>

      <details className="gm-accordion-card" data-testid="v4-candidates">
        <summary>
          <Layers3 aria-hidden />
          Strategy A/B candidates
          <ChevronDown className="gm-chevron" aria-hidden />
        </summary>
        <div className="gm-collapse-body">
          <p className="muted">Non-actionable. Expire / cancel without creating trades.</p>
          {candidates.length === 0 ? (
            <p className="muted">No candidates.</p>
          ) : (
            <ul className="list">
              {candidates.slice(0, 8).map((c) => (
                <li key={String(c.candidateId)}>
                  <strong>
                    {String(c.strategyFamily)} · {String(c.direction)} · {String(c.status)}
                  </strong>
                  <div className="muted">
                    confirm {String(c.confirmationBarsSeen)}/{String(c.confirmationBarsRequired)} ·{" "}
                    {c.cancelReason ? String(c.cancelReason) : "open"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>

      <details className="gm-accordion-card" data-testid="v4-locked-plan" open>
        <summary>
          <FlaskConical aria-hidden />
          Shadow locked plan
          <ChevronDown className="gm-chevron" aria-hidden />
        </summary>
        <div className="gm-collapse-body">
          <p className="muted">Immutable levels. Not a trade ticket. No BUY NOW / SELL NOW.</p>
          {!openPlan ? (
            <p className="muted">No open shadow plan.</p>
          ) : (
            <div className="grid-2">
              <div className="metric">
                <span className="label">Status</span>
                <span className="value">{String(openPlan.status)}</span>
              </div>
              <div className="metric">
                <span className="label">Family</span>
                <span className="value">{String(openPlan.strategyFamily)}</span>
              </div>
              <div className="metric">
                <span className="label">Direction</span>
                <span className="value">{String(openPlan.direction)}</span>
              </div>
              <div className="metric">
                <span className="label">Entry</span>
                <span className="value">{String(openPlan.entry)}</span>
              </div>
              <div className="metric">
                <span className="label">Stop</span>
                <span className="value">{String(openPlan.stopLoss)}</span>
              </div>
              <div className="metric">
                <span className="label">TP1 / TP2 / TP3</span>
                <span className="value">
                  {String(openPlan.tp1)} / {String(openPlan.tp2)} / {String(openPlan.tp3)}
                </span>
              </div>
              <div className="metric">
                <span className="label">Risk distance</span>
                <span className="value">{String(openPlan.riskDistance)}</span>
              </div>
              <div className="metric">
                <span className="label">Quality</span>
                <span className="value">
                  {String((openPlan.quality as AnyRec | undefined)?.total ?? "—")}
                </span>
              </div>
              <div className="metric">
                <span className="label">Gross / Net R</span>
                <span className="value">
                  {String(openPlan.grossR ?? "—")} / {String(openPlan.netR ?? "—")}
                </span>
              </div>
              <div className="metric">
                <span className="label">Est. costs (R)</span>
                <span className="value">
                  {String((openPlan.costs as AnyRec | undefined)?.totalCostR ?? "—")}
                </span>
              </div>
            </div>
          )}
          {plans.filter((p) => p.resolvedAt).length > 0 && (
            <p className="muted">
              Resolved plans in view: {plans.filter((p) => p.resolvedAt).length} (shadow lifecycle
              only)
            </p>
          )}
        </div>
      </details>

      <details className="gm-accordion-card" data-testid="v4-analytics">
        <summary>
          <Activity aria-hidden />
          Shadow analytics (separate from V3)
          <ChevronDown className="gm-chevron" aria-hidden />
        </summary>
        <div className="gm-collapse-body">
          {!analytics ? (
            <p className="muted">No analytics yet.</p>
          ) : (
            <>
              <div className="banner stale" role="status">
                {String(analytics.sampleSizeWarning ?? "Sample too small for conclusions.")}
              </div>
              <div className="grid-2">
                <div className="metric">
                  <span className="label">Analyses</span>
                  <span className="value">{String(analytics.totalAnalyses ?? 0)}</span>
                </div>
                <div className="metric">
                  <span className="label">Candidates</span>
                  <span className="value">{String(analytics.candidates ?? 0)}</span>
                </div>
                <div className="metric">
                  <span className="label">Rejected</span>
                  <span className="value">{String(analytics.rejectedCandidates ?? 0)}</span>
                </div>
                <div className="metric">
                  <span className="label">Validated plans</span>
                  <span className="value">{String(analytics.validatedShadowPlans ?? 0)}</span>
                </div>
                <div className="metric">
                  <span className="label">Resolved sample</span>
                  <span className="value">{String(analytics.sampleSize ?? 0)}</span>
                </div>
                <div className="metric">
                  <span className="label">Entries</span>
                  <span className="value">{String(analytics.entriesTriggered ?? 0)}</span>
                </div>
                <div className="metric">
                  <span className="label">TP1 / TP2 / TP3</span>
                  <span className="value">
                    {String(analytics.tp1 ?? 0)} / {String(analytics.tp2 ?? 0)} /{" "}
                    {String(analytics.tp3 ?? 0)}
                  </span>
                </div>
                <div className="metric">
                  <span className="label">SL / Ambiguous</span>
                  <span className="value">
                    {String(analytics.stopLosses ?? 0)} / {String(analytics.ambiguous ?? 0)}
                  </span>
                </div>
                <div className="metric">
                  <span className="label">Gross / Net expectancy R</span>
                  <span className="value">
                    {String(analytics.grossExpectancyR ?? "—")} /{" "}
                    {String(analytics.netExpectancyR ?? "—")}
                  </span>
                </div>
                <div className="metric">
                  <span className="label">Profit factor</span>
                  <span className="value">{String(analytics.profitFactor ?? "—")}</span>
                </div>
                <div className="metric">
                  <span className="label">Unsafe-plan count</span>
                  <span className="value">{String(analytics.unsafePlanCount ?? 0)}</span>
                </div>
                <div className="metric">
                  <span className="label">Mutation-attempt count</span>
                  <span className="value">{String(analytics.planMutationCount ?? 0)}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </details>

      <details className="gm-accordion-card" data-testid="v4-gc">
        <summary>
          COMEX GC profile
          <ChevronDown className="gm-chevron" aria-hidden />
        </summary>
        <div className="gm-collapse-body">
          <p className="muted">
            {gc?.profileQuality === "UNAVAILABLE"
              ? "GC CONFIRMATION UNAVAILABLE — quality penalty applied; analysis continues."
              : String(gc?.note ?? "GC status")}
          </p>
          <div className="grid-2">
            <div className="metric">
              <span className="label">Provider</span>
              <span className="value">{String(gc?.provider ?? "none")}</span>
            </div>
            <div className="metric">
              <span className="label">Quality</span>
              <span className="value">{String(gc?.profileQuality ?? "UNAVAILABLE")}</span>
            </div>
          </div>
        </div>
      </details>

      <details className="gm-accordion-card" data-testid="v4-v3-compare">
        <summary>
          V3 versus V4
          <ChevronDown className="gm-chevron" aria-hidden />
        </summary>
        <div className="gm-collapse-body">
          <p className="muted">
            V3 remains the production decision path (strategyVersion=3). V4 runs after V3 is stored,
            in SHADOW mode only. V4 errors never change the webhook response or V3 records. Broker
            execution stays DISABLED.
          </p>
        </div>
      </details>

      <p className="disclaimer-footer">
        Do not enable broker execution. Do not treat early V4 shadow results as proof of edge. Manual
        €20 testing is not recommended until acceptance gates are met.
      </p>
    </div>
  );
}
