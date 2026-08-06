import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { applyStablePlanToIntraday } from "../lib/sessionPlanBridge";
import { fmtPrice } from "../lib/intradayFormat";
import { strengthBadgeLabel } from "../lib/premiumDecisionCopy";
import { deriveDecisionDashboardState } from "../lib/decisionDashboardState";
import { formatCompactLocalTime, loadTimezonePreference } from "../lib/timezone";
import type { IntradayPlan, ImportantLevel } from "../types/intradayPlan";
import type { Decision } from "../types/models";
import { PremiumLevelMap } from "../components/premium/PremiumLevelMap";
import { FriendlyErrorBanner } from "../components/FriendlyErrorBanner";
import { describeClientError } from "../lib/errors";

function LevelRows({ title, tone, levels }: { title: string; tone: "up" | "down"; levels: ImportantLevel[] }) {
  return (
    <section className={`gm-premium-levels-block tone-${tone}`} data-testid={`levels-${tone}`}>
      <h2>
        <span aria-hidden>{tone === "up" ? "↑" : "↓"}</span> {title}
      </h2>
      {levels.length === 0 ? (
        <p className="gm-meta">No {title.toLowerCase()} published yet.</p>
      ) : (
        <ul>
          {levels.map((level) => {
            const badge = strengthBadgeLabel(level.strength);
            return (
              <li key={level.id}>
                <div className="gm-premium-level-row-main">
                  <strong>{fmtPrice(level.price)}</strong>
                  <span className={`gm-premium-strength badge-${badge.toLowerCase()}`}>{badge}</span>
                </div>
                <p className="gm-premium-level-name">
                  {level.shortMeaning || level.kind.replace(/_/g, " ")}
                </p>
                <p className="gm-meta">
                  {level.simpleExplanation || level.reasons[0]?.explanation || "Key reference level."}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function KeyLevelsPage() {
  const { api } = useAuth();
  const tzPref = loadTimezonePreference();
  const [plan, setPlan] = useState<IntradayPlan | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<ReturnType<typeof describeClientError> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setErrorDetail(null);
    try {
      const pack = await api.latestDecisionPack();
      setDecision(pack?.decision ?? null);
      setMode(pack?.marketStructureMode ?? null);
      setPlan(
        applyStablePlanToIntraday(
          (pack?.intradayPlan as IntradayPlan | null | undefined) ?? null,
          pack?.stablePlan ?? pack?.sessionPlan ?? null
        )
      );
    } catch (err) {
      setErrorDetail(describeClientError(err, "Unable to load key levels"));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const livePrice = decision?.lastKnownPrice ?? decision?.ohlcv?.close ?? null;
  const updated = formatCompactLocalTime(decision?.generatedAt ?? null, tzPref);
  const upside = plan?.importantLevels.filter((l) => l.side === "UPSIDE") ?? [];
  const downside = plan?.importantLevels.filter((l) => l.side === "DOWNSIDE") ?? [];
  const state = plan
    ? deriveDecisionDashboardState({ plan, marketStructureMode: mode, livePrice })
    : null;

  return (
    <div className="gm-premium-levels-page" data-testid="key-levels-page">
      <header className="gm-premium-page-hero" data-testid="levels-page-hero">
        <div>
          <span className="gm-label">XAUUSD</span>
          <strong data-testid="levels-live-price">{livePrice != null ? fmtPrice(livePrice) : "—"}</strong>
        </div>
        <div className="gm-premium-page-hero-meta">
          <span className="gm-premium-fresh is-fresh">
            <span className="gm-premium-dot" aria-hidden />
            Updated {updated}
          </span>
        </div>
      </header>

      <div className="gm-premium-page-toolbar">
        <Link to="/" className="gm-linkish" data-testid="levels-back">
          ← Plan
        </Link>
        <h1>All Key Levels</h1>
        <details className="gm-premium-why-levels">
          <summary>Why these levels?</summary>
          <p>
            These are structured reference levels from the GoldMeta plan — not automatic entry
            orders. Use them with the current decision on Today&apos;s Plan.
          </p>
        </details>
      </div>

      {errorDetail && <FriendlyErrorBanner detail={errorDetail} onRetry={() => void load()} />}
      {loading && !plan && <p className="gm-meta">Loading levels…</p>}

      {plan && (
        <>
          <LevelRows title="Upside Levels" tone="up" levels={upside} />
          <LevelRows title="Downside Levels" tone="down" levels={downside} />
          <PremiumLevelMap livePrice={livePrice} upside={upside} downside={downside} />

          {state && (
            <section className="gm-premium-trade-summary" data-testid="levels-trade-summary">
              <div className="gm-premium-trade-summary-head">
                <h2>Trade Plan Summary</h2>
                <Link to="/" className="gm-linkish">
                  View full plan
                </Link>
              </div>
              <div className="gm-premium-trade-grid">
                <div>
                  <span className="gm-label">Entry Zone</span>
                  <strong>{state.levels.entry ?? "—"}</strong>
                </div>
                <div>
                  <span className="gm-label">Stop Loss</span>
                  <strong className="tone-red">{fmtPrice(state.levels.stop)}</strong>
                </div>
                <div>
                  <span className="gm-label">TP1</span>
                  <strong className="tone-green">{fmtPrice(state.levels.tp1)}</strong>
                </div>
                <div>
                  <span className="gm-label">TP2</span>
                  <strong className="tone-green">
                    {state.levels.tp2 != null ? fmtPrice(state.levels.tp2) : "—"}
                  </strong>
                </div>
                <div>
                  <span className="gm-label">Risk/Reward</span>
                  <strong>{state.levels.rr ?? "—"}</strong>
                </div>
                <div>
                  <span className="gm-label">Plan Status</span>
                  <strong className={`gm-premium-chip tone-${state.tone}`}>
                    {state.mode === "WAIT" ? "WAIT" : state.primaryDecision}
                  </strong>
                </div>
              </div>
            </section>
          )}

          <section className="gm-premium-howto" data-testid="levels-howto">
            <h2>How to use this</h2>
            <ul>
              <li>Treat upside levels as resistance / targets above price.</li>
              <li>Treat downside levels as support / invalidation below price.</li>
              <li>Only act when Today&apos;s Plan shows a valid BUY or SELL setup.</li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
