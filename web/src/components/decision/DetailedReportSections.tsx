import type { ReactNode } from "react";
import type { Decision } from "../../types/models";
import type { IntradayPlan } from "../../types/intradayPlan";
import { plainLanguageReason } from "../../lib/plainLanguage";
import { fmtPrice } from "../../lib/intradayFormat";
import { SetupChecklist } from "../intraday/SetupChecklist";
import { Confirmation5MCard } from "../intraday/Confirmation5MCard";
import { TimeframeAlignmentPanel } from "../intraday/TimeframeAlignmentPanel";
import { ExpectedRangeCard } from "../intraday/ExpectedRangeCard";
import { ImportantLevelsPanel } from "../intraday/ImportantLevelsPanel";
import { ResearchMatrix } from "../intraday/ResearchMatrix";
import { SystemStatusCollapse } from "../intraday/SystemStatusCollapse";

type Score = {
  total?: number;
  components?: Array<{ label: string; score: number; max: number; reason: string }>;
  disclaimer?: string;
};

type Props = {
  plan: IntradayPlan;
  decision?: Decision | null;
  score?: Score | null;
  marketStructureMode?: string | null;
  marketStructureDiagnostics?: Record<string, unknown> | null;
};

type SectionId =
  | "why"
  | "structure"
  | "volume"
  | "trend"
  | "levels"
  | "session"
  | "wider"
  | "safety"
  | "raw";

const STORAGE_KEY = "gm-decision-dashboard-v3-detail-open";

function loadOpenPrefs(): Partial<Record<SectionId, boolean>> {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Partial<Record<SectionId, boolean>>;
  } catch {
    return {};
  }
}

function saveOpenPref(id: SectionId, open: boolean) {
  if (typeof localStorage === "undefined") return;
  const next = { ...loadOpenPrefs(), [id]: open };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function ReportSection({
  id,
  title,
  defaultOpen = false,
  children
}: {
  id: SectionId;
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const prefs = loadOpenPrefs();
  const open = prefs[id] ?? defaultOpen;
  return (
    <details
      className="gm-detailed-report-section"
      data-testid={`detail-section-${id}`}
      open={open}
      onToggle={(e) => saveOpenPref(id, (e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>{title}</summary>
      <div className="gm-detailed-report-body">{children}</div>
    </details>
  );
}

export function DetailedReportSections({
  plan,
  decision,
  score,
  marketStructureMode,
  marketStructureDiagnostics
}: Props) {
  const upside = plan.importantLevels.filter((l) => l.side === "UPSIDE");
  const downside = plan.importantLevels.filter((l) => l.side === "DOWNSIDE");
  const levels = [...upside, ...downside];

  return (
    <section className="gm-detailed-report" data-testid="detailed-report-sections">
      <h2>Detailed report</h2>
      <ReportSection id="why" title="Why this decision" defaultOpen>
        <p>{plan.oneSentence}</p>
        <SetupChecklist plan={plan} />
        <Confirmation5MCard plan={plan} />
      </ReportSection>

      <ReportSection id="structure" title="Market structure">
        <TimeframeAlignmentPanel plan={plan} />
        <p className="gm-meta">
          Market structure mode: {marketStructureMode ?? plan.freshness.marketStructureMode ?? "unknown"}
        </p>
      </ReportSection>

      <ReportSection id="volume" title="Volume profile">
        <p>
          POC/VAH/VAL context comes from the verified market structure feed. Support and resistance
          are context only unless the plan shows entry, stop, and targets above.
        </p>
        <ExpectedRangeCard
          range={plan.expectedRange}
          zones={plan.zones}
          marketStructureMode={marketStructureMode}
        />
      </ReportSection>

      <ReportSection id="trend" title="Trend and momentum">
        <ResearchMatrix plan={plan} decision={decision ?? null} scoreComponents={score?.components} />
      </ReportSection>

      <ReportSection id="levels" title="Support and resistance">
        <div className="gm-nearest-sr">
          <div>
            <span className="gm-label">Nearest support</span>
            <strong>{fmtPrice(plan.zones?.nearestSupport)}</strong>
          </div>
          <div>
            <span className="gm-label">Nearest resistance</span>
            <strong>{fmtPrice(plan.zones?.nearestResistance)}</strong>
          </div>
        </div>
        <ImportantLevelsPanel levels={levels} allLevels={plan.importantLevels} compactDefault />
      </ReportSection>

      <ReportSection id="session" title="Session context">
        <p>
          Session: <strong>{plan.session ?? "Unknown"}</strong>. Market type:{" "}
          <strong>{plan.marketType.replace(/_/g, " ")}</strong>.
        </p>
      </ReportSection>

      <ReportSection id="wider" title="4H wider context">
        <p>
          Wider bias: <strong>{plan.directionBias.replace(/_/g, " ")}</strong>. Bias is context
          only and is not an entry signal.
        </p>
      </ReportSection>

      <ReportSection id="safety" title="Safety checks">
        <p>Manual analysis only. AutoTrade OFF. Demo OFF. Live OFF. No broker order submission.</p>
        <ul>
          <li>Geometry valid: {plan.geometryValid === true ? "yes" : plan.geometryValid === false ? "no" : "unknown"}</li>
          <li>Ordering note: {plan.tradePlan.orderingNote ?? "none"}</li>
          <li>{plan.tradePlan.maxCashRiskNote}</li>
        </ul>
      </ReportSection>

      <ReportSection id="raw" title="Raw technical diagnostics">
        <SystemStatusCollapse
          plan={plan}
          score={score ?? null}
          marketStructureMode={marketStructureMode}
          diagnostics={marketStructureDiagnostics}
          decisionId={decision?.decisionId}
        >
          <p className="gm-meta" data-testid="system-status-reasons">
            Legacy decision code: {decision?.decision ?? "WAIT"}. Reasons:{" "}
            {plainLanguageReason(
              decision?.reasonCodes ??
                (Array.isArray(decision?.reasonSummary) ? decision.reasonSummary : undefined),
              undefined
            )}
            <br />
            Raw codes: {(decision?.reasonCodes ?? []).join(", ") || "none"}
          </p>
          {(plan.geometryReasonCodes?.length ?? 0) > 0 && (
            <ul data-testid="geometry-reason-codes">
              {plan.geometryReasonCodes!.map((code) => (
                <li key={code}>
                  <code>{code}</code>
                </li>
              ))}
            </ul>
          )}
        </SystemStatusCollapse>
      </ReportSection>
    </section>
  );
}
