import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { chartExampleIntradayPlanFixture } from "../../fixtures/intradayPlanFixture";
import { IntradayActionCard } from "./IntradayActionCard";
import { ExpectedRangeCard } from "./ExpectedRangeCard";
import { ScenarioCards } from "./ScenarioCards";
import { ResearchMatrix } from "./ResearchMatrix";
import { IndicatorChips } from "./IndicatorChips";
import { ExplainThisPage } from "./ExplainThisPage";
import { CockpitAlerts } from "./CockpitAlerts";
import { ImportantLevelsPanel } from "./ImportantLevelsPanel";
import {
  buildIndicatorChips,
  buildResearchRows,
  freshnessTone,
  levelProgressState,
  scenarioStatus,
  shortActionLabel
} from "../../lib/cockpitHelpers";

describe("Research cockpit interactions", () => {
  it("shortens PREPARE action and opens Why / waiting / checklist panels", async () => {
    const user = userEvent.setup();
    render(<IntradayActionCard plan={chartExampleIntradayPlanFixture} />);
    expect(screen.getByTestId("intraday-action-short")).toHaveTextContent("PREPARE");
    await user.click(screen.getByTestId("action-why-btn"));
    expect(screen.getByTestId("action-panel-why")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("action-panel-why")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("action-waiting-btn"));
    expect(screen.getByTestId("action-panel-waiting")).toHaveTextContent(/Trigger/i);
    await user.click(screen.getByTestId("action-checklist-btn"));
    expect(screen.getByTestId("action-panel-checklist")).toHaveTextContent(/Complete market structure/i);
  });

  it("range ladder nodes open explanations via click and keyboard escape", async () => {
    const user = userEvent.setup();
    render(<ExpectedRangeCard range={chartExampleIntradayPlanFixture.expectedRange} />);
    expect(screen.getByTestId("range-ladder")).toBeInTheDocument();
    await user.click(screen.getByTestId("range-node-probable-high"));
    expect(screen.getByTestId("range-level-explain")).toHaveTextContent(/Probable High/i);
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("range-level-explain")).not.toBeInTheDocument();
  });

  it("scenario explain dialog and status badges stay research-only", async () => {
    const user = userEvent.setup();
    render(
      <ScenarioCards
        plan={chartExampleIntradayPlanFixture}
        bullish={chartExampleIntradayPlanFixture.bullishScenario}
        bearish={chartExampleIntradayPlanFixture.bearishScenario}
      />
    );
    expect(screen.getByTestId("scenario-status-bull")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-status-bear")).toHaveTextContent(/Unavailable|Waiting|Forming|Invalid/i);
    await user.click(screen.getByTestId("scenario-explain-bull"));
    expect(screen.getByTestId("scenario-explain-panel")).toHaveTextContent(
      /never an active broker order/i
    );
  });

  it("research matrix cells open explanations and never fabricate 1H when missing", async () => {
    const user = userEvent.setup();
    const decision = {
      schemaVersion: "1",
      decisionId: "d1",
      symbol: "XAUUSD",
      generatedAt: new Date().toISOString(),
      marketDataTime: new Date().toISOString(),
      validUntil: new Date().toISOString(),
      decision: "WAIT" as const,
      confidence: 0.5,
      confidenceLabel: "Moderate",
      marketRegime: "RANGE",
      dataQuality: "GOOD" as const,
      isProvisional: false,
      setupScore: 50,
      entry: { type: "NONE", price: null, zoneLow: null, zoneHigh: null, condition: null },
      stopLoss: { price: null, reason: null },
      takeProfits: [],
      riskReward: { tp1: null, tp2: null, tp3: null },
      bullishEvidence: [],
      bearishEvidence: [],
      reasonCodes: [],
      reasonSummary: [],
      warnings: [],
      missingInputs: [],
      invalidation: "",
      disclaimer: "",
      lifecycleState: "ACTIVE",
      ruleConfigVersion: "1",
      backendVersion: "1",
      notificationSent: false,
      dataSourceLabel: "LIVE" as const,
      timeframe: "15",
      marketStructure: {
        trend: "NEUTRAL",
        poc: 4045.09,
        vah: 4049.63,
        val: 4037.308,
        confirmationClassification: "NONE"
      }
    };
    render(
      <ResearchMatrix plan={chartExampleIntradayPlanFixture} decision={decision} scoreComponents={[]} />
    );
    expect(screen.getByTestId("research-row-1H")).toHaveTextContent(/Unavailable/i);
    await user.click(screen.getByTestId("research-cell-15M-trend"));
    expect(screen.getByTestId("research-cell-explain")).toHaveTextContent(/Why it matters/i);
  });

  it("indicator chips only render verified values and support keyboard close", async () => {
    const user = userEvent.setup();
    render(
      <IndicatorChips
        plan={chartExampleIntradayPlanFixture}
        decision={null}
        poc={4045.09}
        vah={4049.63}
        val={4037.308}
        atrLabel="12.4"
      />
    );
    expect(screen.getByTestId("indicator-chip-poc")).toBeInTheDocument();
    expect(screen.queryByTestId("indicator-chip-rsi")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("indicator-chip-val"));
    expect(screen.getByTestId("indicator-explain")).toHaveTextContent(/VAL/i);
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("indicator-explain")).not.toBeInTheDocument();
  });

  it("explain this page and mismatch / live-range alerts are single-instance", async () => {
    const user = userEvent.setup();
    render(<ExplainThisPage />);
    await user.click(screen.getByTestId("explain-page-btn"));
    expect(screen.getByTestId("explain-page-panel")).toHaveTextContent(/What PREPARE means/i);
    expect(screen.getByTestId("explain-page-panel")).toHaveTextContent(/POC, VAH and VAL/i);

    const { rerender } = render(
      <CockpitAlerts marketStructureMode="MISMATCH" loading={false} />
    );
    expect(screen.getByTestId("cockpit-mismatch")).toHaveTextContent(/NO TRADE/i);
    rerender(<CockpitAlerts marketStructureMode="LIVE_RANGE_ONLY" loading={false} />);
    expect(screen.getByTestId("cockpit-live-range-only")).toHaveTextContent(/structure is missing/i);
  });

  it("important levels compact default shows nearest three and progress state", async () => {
    const user = userEvent.setup();
    const levels = chartExampleIntradayPlanFixture.importantLevels;
    render(<ImportantLevelsPanel levels={levels} allLevels={levels} compactDefault />);
    const desktop = screen.getByTestId("levels-desktop-full");
    const aboveCards = desktop.querySelectorAll(
      '[data-testid="level-group-above"] [data-testid^="level-card-"]'
    );
    expect(aboveCards.length).toBeLessThanOrEqual(3);
    const valCard = within(desktop).getByTestId("level-card-lvl-val");
    expect(valCard).toHaveTextContent(/approaching|touched|held|broken|retested/i);
    await user.click(valCard);
    expect(within(desktop).getByTestId("level-detail-lvl-val")).toHaveTextContent(/Bullish behaviour/i);
  });

  it("helper pure functions preserve safety wording", () => {
    expect(shortActionLabel("PREPARE", "PREPARE — SETUP FORMING")).toBe("PREPARE");
    expect(
      freshnessTone({
        quoteAgeSeconds: 20,
        source: "live",
        marketStructureMode: "COMPLETE"
      })
    ).toBe("fresh");
    expect(
      freshnessTone({
        quoteAgeSeconds: 20,
        source: "live",
        marketStructureMode: "MISMATCH"
      })
    ).toBe("mismatch");
    expect(
      scenarioStatus(
        chartExampleIntradayPlanFixture,
        chartExampleIntradayPlanFixture.bearishScenario,
        "bear"
      )
    ).toBe("Unavailable");
    const val = chartExampleIntradayPlanFixture.importantLevels.find((l) => l.id === "lvl-val")!;
    expect(["approaching", "touched", "held", "broken", "retested"]).toContain(
      levelProgressState(val)
    );
    const rows = buildResearchRows({
      plan: chartExampleIntradayPlanFixture,
      decision: null
    });
    expect(rows.some((r) => r.tf === "15M")).toBe(true);
    const chips = buildIndicatorChips({
      plan: chartExampleIntradayPlanFixture,
      decision: null,
      poc: 1,
      vah: null,
      val: null
    });
    expect(chips.some((c) => c.id === "poc")).toBe(true);
    expect(chips.some((c) => c.id === "vah")).toBe(false);
  });
});
