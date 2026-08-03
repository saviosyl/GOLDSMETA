import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { axe, toHaveNoViolations } from "jest-axe";
import { HelpPage } from "./HelpPage";
import { SignInPage } from "./SignInPage";
import {
  AwaitingApprovalPage,
  AccountSuspendedPage,
  VerifyEmailPage
} from "./auth/StatusPages";
import { BrokerControlCentrePage } from "./broker/BrokerControlCentrePage";
import { OverviewPage } from "./OverviewPage";
import { chartExampleIntradayPlanFixture } from "../fixtures/intradayPlanFixture";
import { vi } from "vitest";
import "../styles/redesign.css";

expect.extend(toHaveNoViolations);

const decisionFixture = {
  decisionId: "dec_a11y",
  decision: "WAIT",
  reasonCodes: ["CONFIRMATION"],
  currentSession: "LONDON",
  generatedAt: "2026-07-21T21:45:00.000Z",
  lastKnownPrice: 4034.82,
  ohlcv: { high: 4041.2, low: 4031.1, close: 4034.82 },
  marketStructure: { poc: 4045.09, vah: 4049.63, val: 4037.31, trend: "RANGE" },
  environment: "LIVE",
  dataSourceLabel: "LIVE"
};

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    user: { email: "user@example.com" },
    account: { role: "OWNER", profile: {} },
    signIn: vi.fn(),
    signOut: vi.fn(),
    configured: true,
    registrationEnabled: true,
    apiBaseUrl: "https://example.test",
    api: {
      resendVerification: vi.fn().mockResolvedValue({ message: "Sent" }),
      latestDecision: vi.fn().mockResolvedValue(decisionFixture),
      latestDecisionPack: vi.fn().mockResolvedValue({
        decision: decisionFixture,
        latestQuote: decisionFixture,
        latestCompleteStrategySignal: decisionFixture,
        marketStructureMode: "COMPLETE",
        marketStructureDiagnostics: null,
        structureDecisionId: decisionFixture.decisionId,
        intradayPlan: chartExampleIntradayPlanFixture
      }),
      listActiveSetups: vi.fn().mockResolvedValue([]),
      listSetups: vi.fn().mockResolvedValue([]),
      v5Briefing: vi.fn().mockResolvedValue({
        session: "LONDON",
        levels: { poc: 4045.09, vah: 4049.63, val: 4037.31 },
        insufficientData: false,
        dataTimestamp: "2026-07-21T21:45:00.000Z"
      }),
      v5Score: vi.fn().mockResolvedValue({ total: 61, components: [] }),
      getBrokerControlCentre: vi.fn().mockResolvedValue({
        defaultBroker: "manual",
        autoTrade: "OFF",
        orderSubmissionEnabled: false,
        brokers: [
          { id: "manual", name: "Manual", status: "Available", detail: "x", badge: "MANUAL" },
          {
            id: "pepperstone_ctrader",
            name: "Pepperstone cTrader Demo",
            status: "Setup required",
            detail: "Demo",
            badge: "PREVIEW"
          }
        ],
        automationModes: [],
        readiness: {
          setupRequired: true,
          authSetupRequired: false,
          oauthConfigured: false,
          connected: false,
          demonstrationAvailable: true,
          automationMode: "OFF",
          autoTrade: "OFF",
          orderSubmissionEnabled: false,
          liveEnabled: false,
          wizardSteps: [
            { step: 1, title: "Create Pepperstone cTrader Demo account", status: "AVAILABLE", detail: "x" }
          ],
          label: "Pepperstone connection required",
          auth: { status: "HEALTHY", brokerSetupEnabled: true, notes: [] },
          qualification: {
            unlocked: false,
            canActivate: false,
            failed: ["OAUTH_HEALTHY"],
            progress: {
              completedPreviews: 0,
              requiredPreviews: 20,
              approvedControlledDemoTrades: 0,
              requiredTrades: 5,
              daysSinceFirstTrade: null,
              requiredDays: 7
            }
          }
        }
      }),
      getCTraderDemonstration: vi.fn(),
      startCTraderOAuth: vi.fn()
    }
  })
}));

describe("accessibility axe audits", () => {
  it("Help page has no serious axe violations", async () => {
    const { container } = render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>
    );
    const results = await axe(container, {
      rules: {
        // jsdom has limited colour contrast fidelity for CSS variables
        "color-contrast": { enabled: false }
      }
    });
    expect(results).toHaveNoViolations();
  });

  it("Sign In page has no serious axe violations", async () => {
    const { container } = render(
      <MemoryRouter>
        <SignInPage />
      </MemoryRouter>
    );
    const results = await axe(container, {
      rules: { "color-contrast": { enabled: false } }
    });
    expect(results).toHaveNoViolations();
  });

  it("Awaiting approval / suspended / verify pages pass axe", async () => {
    for (const Page of [AwaitingApprovalPage, AccountSuspendedPage, VerifyEmailPage]) {
      const { container, unmount } = render(
        <MemoryRouter>
          <Page />
        </MemoryRouter>
      );
      const results = await axe(container, {
        rules: { "color-contrast": { enabled: false } }
      });
      expect(results).toHaveNoViolations();
      unmount();
    }
  });

  it("Broker Control Centre passes axe after load", async () => {
    const { container, findByTestId } = render(
      <MemoryRouter>
        <BrokerControlCentrePage />
      </MemoryRouter>
    );
    await findByTestId("broker-control-centre");
    const results = await axe(container, {
      rules: { "color-contrast": { enabled: false } }
    });
    expect(results).toHaveNoViolations();
  });
});
