/**
 * Pepperstone cTrader Demo orchestration — read/preview only.
 * AutoTrade remains OFF. Order submission impossible.
 */

import type { AutomationMode, BrokerHealthStatus, TradePreview } from "../domain";
import { loadCTraderConfig } from "./config";
import { snapshotCTraderFlags, CTRADER_DEMO_SERVER_LIMITS } from "./flags";
import {
  FIXTURE_BANNER,
  fixtureDemoAccount,
  fixtureLongPosition,
  fixtureQuote,
  fixtureXauUsdSymbol
} from "./fixtures";
import { DISABLED_ORDER_METHODS } from "./mutationGuard";
import { approveTradePreview, buildTradePreview } from "./preview";
import {
  evaluateDemoAutoQualification,
  type DemoAutoQualificationState
} from "./qualification";
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
  connected: boolean;
  demonstrationAvailable: true;
  automationMode: AutomationMode;
  autoTrade: "OFF";
  orderSubmissionEnabled: false;
  liveEnabled: false;
  flags: ReturnType<typeof snapshotCTraderFlags>;
  config: ReturnType<typeof loadCTraderConfig>;
  auth: AuthHealthSnapshot;
  qualification: ReturnType<typeof evaluateDemoAutoQualification>;
  wizardSteps: Array<{
    step: number;
    title: string;
    status: "COMPLETE" | "AVAILABLE" | "BLOCKED" | "SETUP_REQUIRED";
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

const DEFAULT_QUAL: DemoAutoQualificationState = {
  authHealthy: false,
  pinnedOwnerVerified: false,
  oauthHealthy: false,
  pepperstoneDemoConfirmed: false,
  xauusdMetadataComplete: false,
  completedPreviews: 0,
  approvedControlledDemoTrades: 0,
  firstDemoTradeAt: null,
  unresolvedUnknownOrders: 0,
  duplicateOrders: 0,
  restartRecoveryTested: false,
  emergencyStopTested: false,
  dailyLossLockTested: false,
  ownerUnlockedDemoAuto: false
};

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
  qualification?: Partial<DemoAutoQualificationState>;
  connection?: {
    oauthConnected?: boolean;
    demoAccountSelected?: boolean;
    pepperstoneConfirmed?: boolean;
    goldSymbolFound?: boolean;
    liveQuoteReceived?: boolean;
    accountMasked?: string | null;
    brokerName?: string | null;
    symbolName?: string | null;
    lastSyncAt?: string | null;
    lastQuoteAt?: string | null;
  } | null;
}): CTraderReadinessReport {
  const config = loadCTraderConfig();
  const auth = args?.auth ?? buildAuthHealthSnapshot({ status: "UNKNOWN" });
  const conn = args?.connection ?? null;
  const oauthConnected = Boolean(conn?.oauthConnected);
  const demoSelected = Boolean(conn?.demoAccountSelected);
  const pepperstone = Boolean(conn?.pepperstoneConfirmed);
  const goldFound = Boolean(conn?.goldSymbolFound);
  const quoteOk = Boolean(conn?.liveQuoteReceived);

  const qualState: DemoAutoQualificationState = {
    ...DEFAULT_QUAL,
    ...args?.qualification,
    authHealthy: auth.status === "HEALTHY",
    pinnedOwnerVerified: Boolean(auth.pinnedOwnerExists && auth.emailMapsToPinned),
    oauthHealthy: oauthConnected,
    pepperstoneDemoConfirmed: pepperstone && demoSelected,
    xauusdMetadataComplete: goldFound
  };
  const qualification = evaluateDemoAutoQualification(qualState);
  const authSetupRequired = auth.status !== "HEALTHY";

  const step4Status: CTraderReadinessReport["wizardSteps"][0]["status"] =
    authSetupRequired
      ? "BLOCKED"
      : oauthConnected
        ? "COMPLETE"
        : config.configured
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
      status: config.configured ? "COMPLETE" : "SETUP_REQUIRED",
      detail: config.configured
        ? "Client credentials present in Secret Manager."
        : `Secure credentials still needed (${config.missing.join(", ") || "client id/secret/redirect"}). Store only in Secret Manager.`
    },
    {
      step: 4,
      title: "Connect account",
      status: step4Status,
      detail: authSetupRequired
        ? "Connection setup required — OAuth stays disabled until account security is verified."
        : oauthConnected
          ? "OAuth connected. Select a Demo account if not already chosen."
          : config.configured
            ? "OAuth ready (state/PKCE/allowlisted redirect). Owner can start connection."
            : "Add secure credentials before starting OAuth. GoldMeta never asks for your broker password."
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
      status: quoteOk ? "COMPLETE" : goldFound ? "AVAILABLE" : "SETUP_REQUIRED",
      detail: quoteOk
        ? "Live Demo bid/ask received."
        : "Confirm live bid/ask, spread, volume minimum/step, contract size, margin and market-open state."
    },
    {
      step: 7,
      title: "Run trade previews",
      status: quoteOk ? "AVAILABLE" : "SETUP_REQUIRED",
      detail: "Preview BUY/SELL sizing only. No Demo or Live order is submitted."
    },
    {
      step: 8,
      title: "Request Demo trading approval",
      status: "BLOCKED",
      detail: "Execution disabled. AutoTrade off. Demo trading stays locked until separate approval."
    }
  ];

  const setupRequired = !(oauthConnected && demoSelected && goldFound);
  const label = oauthConnected
    ? "Pepperstone Demo connected — Trading locked — AutoTrade OFF"
    : "Pepperstone connection required — Trading locked — AutoTrade OFF";

  return {
    setupRequired,
    authSetupRequired,
    oauthConfigured: config.configured,
    connected: oauthConnected,
    demonstrationAvailable: true,
    automationMode: "OFF",
    autoTrade: "OFF",
    orderSubmissionEnabled: false,
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
    ? "Connected (Demo read-only)"
    : readiness.authSetupRequired
      ? "Connection setup required"
      : "Pepperstone connection required";
  return {
    defaultBroker: "manual" as const,
    autoTrade: "OFF" as const,
    orderSubmission: false,
    brokers: [
      {
        id: "manual",
        name: "Manual",
        status: "Available",
        detail: "Analysis only — no broker execution",
        badge: "MANUAL"
      },
      {
        id: "trading212_invest",
        name: "Trading 212 Practice",
        status: "Read only",
        detail: "Practice / read-only gold proxy — order automation not enabled",
        badge: "READ_ONLY"
      },
      {
        id: "pepperstone_ctrader",
        name: "Pepperstone cTrader Demo",
        status: pepperstoneStatus,
        detail: "Demo setup — AutoTrade off — Live locked",
        badge: readiness.connected ? "CONNECTED" : "DEMO_PREVIEW"
      },
      {
        id: "ig",
        name: "IG — Coming later",
        status: "Coming later",
        detail: "Not active yet",
        badge: "PARKED"
      }
    ],
    automationModes: [
      { id: "OFF", available: true },
      { id: "MANUAL", available: true },
      { id: "CONFIRM", available: true, note: "Preview only — stops at PREVIEW_APPROVED" },
      { id: "DEMO_AUTO_LOCKED", available: false, note: "Visible but locked" },
      { id: "DEMO_AUTO", available: false, note: "Impossible to activate" },
      { id: "LIVE_LOCKED", available: false, note: "Impossible to activate" }
    ],
    limits: CTRADER_DEMO_SERVER_LIMITS,
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
      executionEnabled: false,
      liveEnabled: false,
      lastErrorCode: null,
      notes: ["No broker order may be submitted."]
    } satisfies BrokerHealthStatus
  };
}

export const cTraderOrderApi = {
  ...DISABLED_ORDER_METHODS,
  approvePreview: approveTradePreview,
  buildPreview: buildTradePreview,
  resolveSymbol: resolveXauUsdFromCatalogue
};
