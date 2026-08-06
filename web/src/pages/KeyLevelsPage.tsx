import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, Info, Lightbulb, Shield, Target } from "lucide-react";
import { useAuth } from "../lib/auth";
import { applyStablePlanToIntraday } from "../lib/sessionPlanBridge";
import { fmtPrice } from "../lib/intradayFormat";
import { strengthBadgeLabel } from "../lib/premiumDecisionCopy";
import { deriveDecisionDashboardState } from "../lib/decisionDashboardState";
import { formatCompactLocalTime, loadTimezonePreference } from "../lib/timezone";
import { useShellQuote } from "../lib/quoteContext";
import type { IntradayPlan, ImportantLevel } from "../types/intradayPlan";
import type { Decision } from "../types/models";
import { PremiumLevelMap } from "../components/premium/PremiumLevelMap";
import { FriendlyErrorBanner } from "../components/FriendlyErrorBanner";
import { describeClientError } from "../lib/errors";

function LevelRows({
  title,
  tone,
  levels
}: {
  title: string;
  tone: "up" | "down";
  levels: ImportantLevel[];
}) {
  return (
    <section className={`gm-levels-block tone-${tone}`} data-testid={`levels-${tone}`}>
      <h2>
        {tone === "up" ? "↑ Upside Levels" : "↓ Downside Levels"}
      </h2>
      {levels.length === 0 ? (
        <p className="gm-meta">No {title.toLowerCase()} published yet.</p>
      ) : (
        levels.map((level) => {
          const badge = strengthBadgeLabel(level.strength);
          return (
            <article key={level.id} className="gm-level-row">
              <strong>{fmtPrice(level.price)}</strong>
              <span className={`gm-strength badge-${badge.toLowerCase()}`}>{badge}</span>
              <p className="gm-level-name">
                {level.shortMeaning || level.kind.replace(/_/g, " ")}
              </p>
              <p className="gm-meta">
                {level.simpleExplanation ||
                  level.reasons[0]?.explanation ||
                  "Key reference level."}
              </p>
            </article>
          );
        })
      )}
    </section>
  );
}

export function KeyLevelsPage() {
  const { api } = useAuth();
  const { setQuote } = useShellQuote();
  const tzPref = loadTimezonePreference();
  const [plan, setPlan] = useState<IntradayPlan | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<ReturnType<typeof describeClientError> | null>(
    null
  );
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

  useEffect(() => {
    setQuote({
      price: livePrice,
      updatedLabel: updated,
      fresh: livePrice != null
    });
    return () => setQuote(null);
  }, [livePrice, updated, setQuote]);

  return (
    <div className="gm-premium-levels-page gm-premium-v2" data-testid="key-levels-page">
      <header className="gm-page-hero-navy" data-testid="levels-page-hero">
        <div>
          <span className="gm-label" style={{ color: "rgba(255,255,255,0.65)" }}>
            XAUUSD
          </span>
          <strong data-testid="levels-live-price" style={{ fontSize: "1.6rem", fontWeight: 800 }}>
            {livePrice != null ? fmtPrice(livePrice) : "—"}
          </strong>
        </div>
        <div>
          <span className="gm-premium-fresh is-fresh" style={{ color: "rgba(255,255,255,0.85)" }}>
            <span className="gm-fresh-dot is-fresh" aria-hidden />
            Updated {updated}
          </span>
        </div>
      </header>

      <div className="gm-page-toolbar">
        <Link to="/" className="gm-linkish" data-testid="levels-back">
          <ChevronLeft size={16} aria-hidden /> Plan
        </Link>
        <h1>All Key Levels</h1>
        <details className="gm-premium-why-levels">
          <summary>
            <Info size={14} aria-hidden /> Why these levels?
          </summary>
          <p>
            These are structured reference levels from the GoldMeta plan — not automatic entry
            orders. Use them with the current decision on Today&apos;s Plan.
          </p>
        </details>
      </div>

      {errorDetail && <FriendlyErrorBanner detail={errorDetail} onRetry={() => void load()} />}
      {loading && !plan && <div className="gm-skeleton" style={{ height: 180 }} />}

      {plan && (
        <>
          <LevelRows title="Upside Levels" tone="up" levels={upside} />
          <LevelRows title="Downside Levels" tone="down" levels={downside} />
          <PremiumLevelMap livePrice={livePrice} upside={upside} downside={downside} />

          {state && (
            <section className="gm-card-v2" data-testid="levels-trade-summary">
              <div className="gm-premium-trade-summary-head">
                <h2 style={{ margin: 0, fontWeight: 800 }}>Trade Plan Summary</h2>
                <Link to="/" className="gm-linkish">
                  View full plan
                </Link>
              </div>
              <div className="gm-plan-summary-grid" style={{ marginTop: 12 }}>
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
                  <strong className={`gm-status-badge tone-${state.tone}`}>
                    {state.mode === "WAIT" ? "WAIT" : state.primaryDecision}
                  </strong>
                </div>
              </div>
            </section>
          )}

          <section className="gm-card-v2" data-testid="levels-howto" style={{ marginTop: 14 }}>
            <h2 style={{ margin: "0 0 10px", fontWeight: 800 }}>How to use this</h2>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 10 }}>
              <li style={{ display: "flex", gap: 10 }}>
                <Target size={18} color="var(--gold-600)" aria-hidden />
                Use levels to plan entries and exits, not to predict direction.
              </li>
              <li style={{ display: "flex", gap: 10 }}>
                <Shield size={18} color="var(--gold-600)" aria-hidden />
                Respect the stop loss to manage risk.
              </li>
              <li style={{ display: "flex", gap: 10 }}>
                <Lightbulb size={18} color="var(--gold-600)" aria-hidden />
                Focus on price reaction and confirmation.
              </li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
