import { Activity, Bot, CheckCircle2, CircleDollarSign, ShieldCheck, Target, XCircle } from "lucide-react";
import { formatEur, GhStatusTone, useGoldHunter } from "./GoldHunterShell";
import {
  goldHunterDisplayBrainVersion,
  goldHunterDisplayStrategyVariant,
  goldHunterRevisionFromSoftwareRevision,
  goldHunterVariantFromSoftwareRevision
} from "../../lib/goldHunterIdentity";
import { formatResearchLocalTime } from "../../lib/formatResearchLocalTime";

function money(value: number | null | undefined, currency: string | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("en-IE", {
      style: "currency",
      currency: (currency ?? "EUR").toUpperCase(),
      maximumFractionDigits: 2
    }).format(value);
  } catch {
    return `${currency ?? "EUR"} ${value.toFixed(2)}`;
  }
}

export function GoldHunterOverviewV2Page() {
  const { status } = useGoldHunter();
  if (!status) return null;

  const softwareRevision = status.strategyVersions.softwareRevision;
  const brain = goldHunterDisplayBrainVersion(status.strategyVersions.brainVersion);
  const revision = status.strategyVersions.brainRevision ?? goldHunterRevisionFromSoftwareRevision(softwareRevision) ?? "—";
  const strategy = goldHunterDisplayStrategyVariant(
    status.strategyVersions.strategyVariant ?? goldHunterVariantFromSoftwareRevision(softwareRevision) ?? null
  );
  const open = status.openTrades[0] ?? null;
  const demoOn = status.config.demoAutoTradeEnabled;
  const blocked = status.gates.blockers[0] ?? null;
  const currentState = open
    ? "IN DEMO TRADE"
    : demoOn
      ? blocked
        ? "ARMED — TEMPORARILY BLOCKED"
        : "ARMED — WAITING FOR SIGNAL"
      : status.arming?.ready
        ? "READY TO ARM"
        : "NOT READY";

  return (
    <div className="gh26-page" data-testid="gh26-overview">
      <section className="gh26-hero">
        <div className="gh26-hero__top">
          <div>
            <span className="gh26-eyebrow">AUTOMATED GOLD SYSTEM</span>
            <h1>Gold Hunter</h1>
          </div>
          <div className="gh26-mode-pills">
            <span className={demoOn ? "is-on" : "is-off"}>DEMO {demoOn ? "ON" : "OFF"}</span>
            <span className="is-locked">LIVE LOCKED</span>
          </div>
        </div>

        <div className="gh26-market-row">
          <div>
            <span>XAUUSD</span>
            <strong>{status.market.mid != null ? status.market.mid.toFixed(2) : "—"}</strong>
          </div>
          <div className="gh26-market-meta">
            <span>Bid <strong>{status.market.bid?.toFixed(2) ?? "—"}</strong></span>
            <span>Ask <strong>{status.market.ask?.toFixed(2) ?? "—"}</strong></span>
            <span>Spread <strong>{status.market.spread?.toFixed(2) ?? "—"}</strong></span>
            <GhStatusTone value={status.market.marketStatus} />
          </div>
        </div>

        <div className="gh26-state-card">
          <span>Current state</span>
          <strong>{currentState}</strong>
          <p>{open ? "Gold Hunter has a broker-confirmed Demo position under management." : blocked ? blocked : status.signal.note || "Waiting for the next valid Gold Hunter setup."}</p>
        </div>
      </section>

      <section className="gh26-identity">
        <article><Bot aria-hidden /><span>Trading Brain</span><strong>{brain}</strong></article>
        <article><Activity aria-hidden /><span>Revision</span><strong>{revision}</strong></article>
        <article><Target aria-hidden /><span>Strategy</span><strong>{strategy}</strong></article>
      </section>

      <section className="gh26-grid-2">
        <article className="gh26-card">
          <div className="gh26-card-head">
            <div><span className="gh26-eyebrow">CURRENT SETUP</span><h2>{status.signal.present ? `${status.signal.setup ?? "—"} · ${status.signal.side ?? "—"}` : "Waiting"}</h2></div>
            {status.signal.quality != null ? <span className="gh26-quality">{Math.round(status.signal.quality * 100)}%</span> : null}
          </div>
          <p>{status.signal.present ? "Selected by the Gold Hunter strategy pipeline." : status.signal.note || "No setup selected."}</p>
          <div className="gh26-inline-status">
            <span>Strategy</span><GhStatusTone value={status.health.strategy} />
            <span>Risk</span><GhStatusTone value={status.health.risk} />
          </div>
        </article>

        <article className="gh26-card">
          <div className="gh26-card-head">
            <div><span className="gh26-eyebrow">OPEN TRADE</span><h2>{open ? `${open.side} · ${open.setup ?? "—"}` : "No open trade"}</h2></div>
            {open ? <span className={open.netPnlEur != null && open.netPnlEur < 0 ? "gh26-pnl is-negative" : "gh26-pnl is-positive"}>{formatEur(open.netPnlEur)}</span> : null}
          </div>
          {open ? (
            <div className="gh26-trade-grid">
              <div><span>Entry</span><strong>{open.entry?.toFixed(2) ?? "—"}</strong></div>
              <div><span>Protection</span><strong>{open.stop?.toFixed(2) ?? "—"}</strong></div>
              <div><span>Status</span><strong>{open.status}</strong></div>
              <div><span>Filled</span><strong>{formatResearchLocalTime(open.fillTs)}</strong></div>
            </div>
          ) : <p>When Gold Hunter enters a Demo position, broker-confirmed entry, protection and P/L appear here.</p>}
        </article>
      </section>

      <section className="gh26-kpis">
        <article><CircleDollarSign aria-hidden /><span>Today P/L</span><strong className={status.capital.todayPnlEur < 0 ? "is-negative" : status.capital.todayPnlEur > 0 ? "is-positive" : ""}>{formatEur(status.capital.todayPnlEur)}</strong></article>
        <article><span>Trades</span><strong>{status.performanceToday.trades}</strong></article>
        <article><span>Win rate</span><strong>{status.performanceToday.winRate != null ? `${Math.round(status.performanceToday.winRate * 100)}%` : "—"}</strong></article>
        <article><span>Profit factor</span><strong>{status.performanceToday.profitFactor != null ? status.performanceToday.profitFactor.toFixed(2) : "—"}</strong></article>
      </section>

      <section className="gh26-grid-2">
        <article className="gh26-card">
          <div className="gh26-card-head"><div><span className="gh26-eyebrow">CAPITAL</span><h2>Gold Hunter allocation</h2></div></div>
          <div className="gh26-trade-grid">
            <div><span>Allocated</span><strong>€{status.capital.allocatedEur.toLocaleString()}</strong></div>
            <div><span>Available</span><strong>{status.capital.availableEur == null ? "—" : `€${status.capital.availableEur.toLocaleString()}`}</strong></div>
            <div><span>Risk / trade</span><strong>{formatEur(status.capital.riskBudgetEur).replace("+", "")}</strong></div>
            <div><span>Demo equity</span><strong>{money(status.broker.equity, status.broker.currency)}</strong></div>
          </div>
        </article>

        <article className="gh26-card">
          <div className="gh26-card-head"><div><span className="gh26-eyebrow">SAFETY STATE</span><h2>{status.gates.ok ? "Ready" : "Protected / blocked"}</h2></div><ShieldCheck aria-hidden /></div>
          <div className="gh26-safety-list">
            {[
              ["Market feed", status.health.marketFeed],
              ["Broker transport", status.health.transport],
              ["Depth", status.health.depth],
              ["Risk", status.health.risk],
              ["AutoTrade", status.health.autoTrade]
            ].map(([label, value]) => (
              <div key={label}><span>{String(value).match(/LIVE|READY|VALID|NORMAL|CONNECTED|ON/i) ? <CheckCircle2 aria-hidden /> : <XCircle aria-hidden />}{label}</span><GhStatusTone value={String(value)} /></div>
            ))}
          </div>
        </article>
      </section>

      {status.gates.blockers.length > 0 ? (
        <section className="gh26-card gh26-blockers">
          <span className="gh26-eyebrow">WHY NO NEW ORDER?</span>
          <h2>{status.gates.blockers[0]}</h2>
          {status.gates.blockers.length > 1 ? <p>{status.gates.blockers.slice(1).join(" · ")}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
