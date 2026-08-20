/**
 * Pepperstone cTrader Demo orchestration.
 * Demo order submission may be enabled; Live execution stays locked.
 */

import type { AutomationMode, BrokerHealthStatus, TradePreview } from "../domain";
import { labelMissingConfiguration, loadCTraderConfig } from "./config";
import { loadTokenEncryptionSecret } from "./connectionStore";
import {
  snapshotCTraderFlags,
  CTRADER_RECOMMENDED_DEFAULTS
} from "./flags";
import {
  FIXTURE_BANNER,
  fixtureDemoAccount,
  fixtureLongPosition,
  fixtureQuote,
  fixtureXauUsdSymbol
} from "./fixtures";
import { DISABLED_ORDER_METHODS } from "./mutationGuard";
import { approveTradePreview, buildTradePreview } from "./preview";
type RetiredQualificationProgress = {
  unlocked: false;
  canActivate: false;
  passed: string[];
  failed: string[];
  progress: {
    completedPreviews: number;
    requiredPreviews: 0;
    approvedControlledDemoTrades: number;
    requiredTrades: 0;
    daysSinceFirstTrade: number | null;
    requiredDays: 0;
    source: "retired_core_autotrade";
    sourceLabel: string;
  };
};

const RETIRED_QUALIFICATION: RetiredQualificationProgress = {
  unlocked: false,
  canActivate: false,
  passed: [],
  failed: ["CORE_AUTOTRADE_RETIRED"],
  progress: {
    completedPreviews: 0,
    requiredPreviews: 0,
    approvedControlledDemoTrades: 0,
    requiredTrades: 0,
    daysSinceFirstTrade: null,
    requiredDays: 0,
    source: "retired_core_autotrade",
    sourceLabel:
      "Core / FAST AutoTrade qualification is retired. Gold Hunter is the only automatic trading engine."
  }
};
import { resolveXauUsdFromCatalogue } from "./symbolResolver";

export interface AuthHealthSnapshot {
  status: "HEALTHY" | "NOT_HEALTHY" | "UNKNOWN";
  pinnedOwnerExists: boolean | null;
  emailMapsToPinned: boolean | null;
  emailVerified: boolean | null;
  disabled: boolean | null;
  webhookOwnedByOriginal: boolean | null;
  brokerSetupEnabled: boolean;
  notes: string[];
}

export interface CTraderReadinessReport {
  setupRequired: boolean;
  authSetupRequired: boolean;
  oauthConfigured: boolean;
  /** Human-readable, non-secret missing server configuration items. */
  missingConfigurationItems: string[];
  connected: boolean;
  demonstrationAvailable: true;
  automationMode: AutomationMode;
  autoTrade: "OFF" | "READY";
  orderSubmissionEnabled: boolean;
  liveEnabled: false;
  flags: ReturnType<typeof snapshotCTraderFlags>;
  config: ReturnType<typeof loadCTraderConfig>;
  auth: AuthHealthSnapshot;
  qualification: RetiredQualificationProgress;
  wizardSteps: Array<{
    step: number;
    title: string;
    status: "COMPLETE" | "AVAILABLE" | "BLOCKED" | "SETUP_REQUIRED" | "IN_PROGRESS";
    detail: string;
  }>;
  label: string;
  connectionSummary?: {
    accountMasked: string | null;
    brokerName: string | null;
    pepperstoneConfirmed: boolean;
    symbolName: string | null;
    lastSyncAt: string | null;
    lastQuoteAt: string | null;
  };
}

export function buildAuthHealthSnapshot(
  partial?: Partial<AuthHealthSnapshot>
): AuthHealthSnapshot {
  const status = partial?.status ?? "UNKNOWN";
  const brokerSetupEnabled = status === "HEALTHY";
  return {
    status,
    pinnedOwnerExists: partial?.pinnedOwnerExists ?? null,
    emailMapsToPinned: partial?.emailMapsToPinned ?? null,
    emailVerified: partial?.emailVerified ?? null,
    disabled: partial?.disabled ?? null,
    webhookOwnedByOriginal: partial?.webhookOwnedByOriginal ?? null,
    brokerSetupEnabled,
    notes: partial?.notes ?? [
      status === "HEALTHY"
        ? "Account security verified — broker OAuth may proceed when secrets exist."
        : "Connection setup required — broker connection disabled until account security is verified."
    ]
  };
}

export function buildCTraderReadiness(args?: {
  auth?: AuthHealthSnapshot;
  connection?: {
    oauthConnected?: boolean;
    demoAccountSelected?: boolean;
    pepperstoneConfirmed?: boolean;
    goldSymbolFound?: boolean;
    liveQuoteReceived?: boolean;
    marginMetadataAvailable?: boolean;
    accountMasked?: string | null;
    brokerName?: string | null;
    symbolName?: string | null;
    lastSyncAt?: string | null;
    lastQuoteAt?: string | null;
  } | null;
}): CTraderReadinessReport {
  const config = loadCTraderConfig();
  const encryptionConfigured = Boolean(loadTokenEncryptionSecret());
  const missingCodes = [
    ...config.missing,
    ...(encryptionConfigured ? [] : ["CTRADER_TOKEN_ENCRYPTION_KEY"])
  ];
  const missingConfigurationItems = labelMissingConfiguration(missingCodes);
  const oauthConfigured = config.configured && encryptionConfigured;
  const auth = args?.auth ?? buildAuthHealthSnapshot({ status: "UNKNOWN" });
  const conn = args?.connection ?? null;
  const oauthConnected = Boolean(conn?.oauthConnected);
  const demoSelected = Boolean(conn?.demoAccountSelected);
  const pepperstone = Boolean(conn?.pepperstoneConfirmed);
  const goldFound = Boolean(conn?.goldSymbolFound);
  const quoteOk = Boolean(conn?.liveQuoteReceived);
  const marginOk = Boolean(conn?.marginMetadataAvailable);

  const demoSubmit = snapshotCTraderFlags().CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
  const qualification = RETIRED_QUALIFICATION;
  const authSetupRequired = auth.status !== "HEALTHY";

  const step4Status: CTraderReadinessReport["wizardSteps"][0]["status"] =
    authSetupRequired
      ? "BLOCKED"
      : oauthConnected
        ? "COMPLETE"
        : oauthConfigured
          ? "AVAILABLE"
          : "SETUP_REQUIRED";

  const wizardSteps: CTraderReadinessReport["wizardSteps"] = [
    {
      step: 1,
      title: "Create Pepperstone cTrader Demo account",
      status: demoSelected ? "COMPLETE" : "AVAILABLE",
      detail:
        "TradingView-linked Pepperstone access is not automatically a cTrader Open API account."
    },
    {
      step: 2,
      title: "Register cTrader Open API application",
      status: config.configured ? "COMPLETE" : "SETUP_REQUIRED",
      detail: config.configured
        ? "Open API application registered; server redirect URI configured."
        : "Create a Demo Open API app and set the GoldMeta redirect URI."
    },
    {
      step: 3,
      title: "Add secure credentials",
      status: oauthConfigured ? "COMPLETE" : "SETUP_REQUIRED",
      detail: oauthConfigured
        ? "Client credentials and token encryption key present in Secret Manager."
        : missingConfigurationItems.length
          ? `Still needed: ${missingConfigurationItems.join("; ")}.`
          : "Secure credentials still needed in Secret Manager."
    },
    {
      step: 4,
      title: "Connect account",
      status: step4Status,
      detail: authSetupRequired
        ? "Connection setup required — OAuth stays disabled until account security is verified."
        : oauthConnected
          ? "OAuth connected. Select a Demo account if not already chosen."
          : oauthConfigured
            ? "OAuth ready (state/PKCE/allowlisted redirect). Use Authorise Demo Trading or Connect cTrader — Demo only. GoldMeta never asks for your broker password."
            : "Complete the missing server configuration items before starting OAuth. GoldMeta never asks for your broker password."
    },
    {
      step: 5,
      title: "Verify XAUUSD",
      status: goldFound ? "COMPLETE" : demoSelected ? "AVAILABLE" : "SETUP_REQUIRED",
      detail: goldFound
        ? `Gold symbol resolved${conn?.symbolName ? ` (${conn.symbolName})` : ""}.`
        : "After connect: confirm Demo account, Pepperstone broker name, and XAUUSD symbol metadata."
    },
    {
      step: 6,
      title: "Run read-only checks",
      status: quoteOk
        ? marginOk
          ? "COMPLETE"
          : "IN_PROGRESS"
        : goldFound
          ? "AVAILABLE"
          : "SETUP_REQUIRED",
      detail: quoteOk
        ? marginOk
          ? "Market-data checks complete (quote, spread, volume rules). Margin metadata available."
          : "Market-data checks complete for quote/spread/volume. Margin metadata still pending — step not fully complete."
        : "Confirm bid/ask, spread, volume minimum/step, contract size, margin and market-open state."
    },
    {
      step: 7,
      title: "Run trade previews",
      status: quoteOk ? "AVAILABLE" : "SETUP_REQUIRED",
      detail: demoSubmit
        ? "Preview BUY/SELL sizing, then place controlled Demo orders when trading scope is granted."
        : "Preview BUY/SELL sizing only until Demo order submission is enabled."
    },
    {
      step: 8,
      title: "Gold Hunter AutoTrade",
      status: "AVAILABLE",
      detail:
        "Core and FAST AutoTrade are removed. Gold Hunter is the only automatic trading engine (Demo only). Live stays locked."
    }
  ];

  const setupRequired = !(oauthConnected && demoSelected && goldFound);
  const label = oauthConnected
    ? demoSubmit
      ? "Pepperstone Demo — manual Demo orders available — Live execution locked — Gold Hunter is the only AutoTrade engine"
      : "Pepperstone connected — preview mode — order submission disabled — Core AutoTrade removed"
    : oauthConfigured
      ? "Pepperstone OAuth ready — Authorise Demo Trading available — Core AutoTrade removed"
      : "Pepperstone connection required — preview mode — Core AutoTrade removed";

  return {
    setupRequired,
    authSetupRequired,
    oauthConfigured,
    missingConfigurationItems,
    connected: oauthConnected,
    demonstrationAvailable: true,
    automationMode: "OFF",
    autoTrade: "OFF",
    orderSubmissionEnabled: demoSubmit,
    liveEnabled: false,
    flags: snapshotCTraderFlags(),
    config,
    auth,
    qualification,
    wizardSteps,
    label,
    connectionSummary: {
      accountMasked: conn?.accountMasked ?? null,
      brokerName: conn?.brokerName ?? null,
      pepperstoneConfirmed: pepperstone,
      symbolName: conn?.symbolName ?? null,
      lastSyncAt: conn?.lastSyncAt ?? null,
      lastQuoteAt: conn?.lastQuoteAt ?? null
    }
  };
}

export function buildDemonstrationBundle(): {
  banner: string;
  account: ReturnType<typeof fixtureDemoAccount>;
  symbol: ReturnType<typeof fixtureXauUsdSymbol>;
  quote: ReturnType<typeof fixtureQuote>;
  buyPreview: TradePreview;
  sellPreview: TradePreview;
  blockedPreview: TradePreview;
  position: ReturnType<typeof fixtureLongPosition>;
} {
  const account = fixtureDemoAccount();
  const symbol = fixtureXauUsdSymbol();
  const quote = fixtureQuote("OPEN");
  const buyPreview = buildTradePreview({
    decisionId: "demo-buy-1",
    decision: "BUY",
    confidence: 86,
    generatedAt: new Date().toISOString(),
    candleConfirmed: true,
    stopLoss: 2340,
    takeProfits: [2365, 2380],
    symbol,
    quote,
    position: null,
    pendingOrdersCount: 0,
    equity: account.equity,
    freeMargin: account.freeMargin,
    accountCurrency: "EUR",
    riskAmountEur: 20,
    maxSpread: 1,
    demonstration: true,
    eurToAccountRate: 1,
    marginPerLot: 200
  });
  const sellPreview = buildTradePreview({
    decisionId: "demo-sell-1",
    decision: "SELL",
    confidence: 84,
    generatedAt: new Date().toISOString(),
    candleConfirmed: true,
    stopLoss: 2360,
    takeProfits: [2330],
    symbol,
    quote,
    position: null,
    pendingOrdersCount: 0,
    equity: account.equity,
    freeMargin: account.freeMargin,
    accountCurrency: "EUR",
    riskAmountEur: 20,
    maxSpread: 1,
    demonstration: true,
    eurToAccountRate: 1,
    marginPerLot: 200
  });
  const blockedPreview = buildTradePreview({
    decisionId: "demo-blocked-1",
    decision: "BUY",
    confidence: 55,
    generatedAt: new Date(Date.now() - 600_000).toISOString(),
    candleConfirmed: false,
    stopLoss: null,
    takeProfits: [],
    symbol,
    quote,
    position: null,
    pendingOrdersCount: 0,
    equity: account.equity,
    freeMargin: account.freeMargin,
    accountCurrency: "EUR",
    riskAmountEur: 20,
    maxSpread: 0.1,
    demonstration: true,
    eurToAccountRate: 1
  });
  return {
    banner: FIXTURE_BANNER,
    account,
    symbol,
    quote,
    buyPreview,
    sellPreview,
    blockedPreview,
    position: fixtureLongPosition()
  };
}

export function getBrokerControlCentreSnapshot(
  auth?: AuthHealthSnapshot,
  connection?: Parameters<typeof buildCTraderReadiness>[0] extends infer P
    ? P extends { connection?: infer C }
      ? C
      : never
    : never
) {
  const readiness = buildCTraderReadiness({ auth, connection });
  const pepperstoneStatus = readiness.connected
    ? "Connected (preview — execution disabled)"
    : readiness.authSetupRequired
      ? "Connection setup required"
      : readiness.oauthConfigured
        ? "Ready to connect"
        : "Pepperstone connection required";
  return {
    defaultBroker: "pepperstone_ctrader" as const,
    autoTrade: "OFF" as const,
    orderSubmission: false,
    brokers: [
      {
        id: "pepperstone_ctrader",
        name: "Pepperstone cTrader",
        status: pepperstoneStatus,
        detail:
          "Multi-user Demo/Live accounts — preview mode — order submission disabled — AutoTrade OFF",
        badge: readiness.connected
          ? "CONNECTED"
          : readiness.oauthConfigured
            ? "READY"
            : "PREVIEW"
      },
      {
        id: "trading212_invest",
        name: "Trading 212 Practice",
        status: "Read only",
        detail: "Separate gold-proxy path — not part of the cTrader AutoTrade workflow",
        badge: "READ_ONLY"
      },
      {
        id: "manual",
        name: "Manual",
        status: "Available",
        detail: "Analysis only — no broker execution",
        badge: "MANUAL"
      }
    ],
    automationModes: [
      { id: "OFF", available: true },
      { id: "MANUAL", available: true },
      { id: "CONFIRM", available: true, note: "Preview only — stops at PREVIEW_APPROVED" },
      {
        id: "DEMO_AUTO_LOCKED",
        available: false,
        note: "Use DEMO_AUTO when Demo submission is enabled"
      },
      {
        id: "DEMO_AUTO",
        available: snapshotCTraderFlags().CTRADER_DEMO_ORDER_SUBMISSION_ENABLED,
        note: snapshotCTraderFlags().CTRADER_DEMO_ORDER_SUBMISSION_ENABLED
          ? "Pepperstone Demo Auto — Live remains locked"
          : "Enable CTRADER_DEMO_ORDER_SUBMISSION_ENABLED to unlock"
      },
      {
        id: "LIVE_LOCKED",
        available: false,
        note: "Live execution remains hard-disabled"
      }
    ],
    limits: CTRADER_RECOMMENDED_DEFAULTS,
    readiness,
    health: {
      brokerId: "pepperstone_ctrader",
      environment: "DEMO",
      connectionState: readiness.connected
        ? "CONNECTED"
        : readiness.authSetupRequired
          ? "AUTH_SETUP_REQUIRED"
          : "SETUP_REQUIRED",
      automationMode: "OFF",
      oauthHealthy: readiness.connected ? true : null,
      authIntegrityHealthy: auth?.status === "HEALTHY",
      executionEnabled: snapshotCTraderFlags().CTRADER_DEMO_ORDER_SUBMISSION_ENABLED,
      liveEnabled: false,
      lastErrorCode: null,
      notes: snapshotCTraderFlags().CTRADER_DEMO_ORDER_SUBMISSION_ENABLED
        ? ["Pepperstone Demo order submission enabled. Live execution locked."]
        : ["No broker order may be submitted."]
    } satisfies BrokerHealthStatus
  };
}

export const cTraderOrderApi = {
  ...DISABLED_ORDER_METHODS,
  approvePreview: approveTradePreview,
  buildPreview: buildTradePreview,
  resolveSymbol: resolveXauUsdFromCatalogue
};
