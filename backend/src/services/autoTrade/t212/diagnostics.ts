/**
 * Trading 212 Invest read-only diagnostics.
 * Never calls order-creation endpoints.
 */

import {
  loadT212CredentialsFromServerEnv,
  T212ApiError,
  T212InvestClient,
  type T212Credentials
} from "./client";
import { searchGoldInstruments } from "./instruments";
import {
  DEFAULT_T212_RISK_LIMITS,
  T212_INITIAL_MODE,
  T212_PROXY_DISCLAIMER,
  type T212ConnectionView,
  type T212DiagnosticReport,
  type T212Environment,
  type T212HoldingView,
  type T212SelectedInstrument
} from "./types";
import {
  BROKER_EXECUTION_ENABLED,
  T212_LIVE_EXECUTION_FEATURE_FLAG,
  T212_PAPER_ORDER_SUBMISSION_ENABLED
} from "../types";
import { maskAccountId } from "../types";

export interface T212ClientFactory {
  (
    environment: T212Environment,
    credentials: T212Credentials
  ): T212InvestClient;
}

export function defaultT212ClientFactory(
  environment: T212Environment,
  credentials: T212Credentials
): T212InvestClient {
  return new T212InvestClient(environment, credentials);
}

export function assertOrderSubmissionDisabled(): void {
  if (
    BROKER_EXECUTION_ENABLED ||
    T212_PAPER_ORDER_SUBMISSION_ENABLED ||
    T212_LIVE_EXECUTION_FEATURE_FLAG
  ) {
    throw Object.assign(new Error("ORDER_SUBMISSION_DISABLED"), {
      code: "ORDER_SUBMISSION_DISABLED"
    });
  }
}

export function buildDisconnectedT212View(
  selectedInstrument: T212SelectedInstrument | null = null
): T212ConnectionView {
  return {
    connected: false,
    environment: null,
    mode: null,
    currency: null,
    freeCash: null,
    investedValue: null,
    totalValue: null,
    selectedInstrument,
    holdingQuantity: null,
    lastHeartbeatAt: null,
    connectionState: "Disconnected",
    ordersEnabled: false,
    paperOrderSubmissionEnabled: T212_PAPER_ORDER_SUBMISSION_ENABLED,
    liveExecutionFeatureEnabled: T212_LIVE_EXECUTION_FEATURE_FLAG
  };
}

export async function runT212ReadOnlyDiagnostics(args: {
  environment: T212Environment;
  selectedInstrument: T212SelectedInstrument | null;
  credentials?: T212Credentials | null;
  clientFactory?: T212ClientFactory;
  query?: string;
}): Promise<T212DiagnosticReport> {
  assertOrderSubmissionDisabled();
  const errors: string[] = [];
  const notes: string[] = [
    T212_PROXY_DISCLAIMER,
    "Read-only diagnostics only — no order endpoints called.",
    `Mode: ${args.environment === "PRACTICE" ? T212_INITIAL_MODE : "TRADING_212_LIVE_LOCKED"}`
  ];

  const creds =
    args.credentials ?? loadT212CredentialsFromServerEnv(args.environment);
  if (!creds) {
    return {
      ok: false,
      environment: args.environment,
      readOnly: true,
      ordersEnabled: false,
      paperOrderSubmissionEnabled: T212_PAPER_ORDER_SUBMISSION_ENABLED,
      liveExecutionFeatureEnabled: T212_LIVE_EXECUTION_FEATURE_FLAG,
      connected: false,
      account: null,
      holdingsCount: 0,
      goldCandidates: [],
      selectedInstrument: args.selectedInstrument,
      holdingForSelected: null,
      heartbeatAt: null,
      orderEndpointsCalled: false,
      errors: ["T212_CREDENTIALS_MISSING_SERVER_SIDE"],
      notes
    };
  }

  const factory = args.clientFactory ?? defaultT212ClientFactory;
  const client = factory(args.environment, creds);

  try {
    await client.authenticate();
    const [cash, account, portfolio, instruments] = await Promise.all([
      client.getCash(),
      client.getAccount().catch(() => ({})),
      client.getPortfolio(),
      client.getInstruments()
    ]);
    const heartbeatAt = await client.heartbeat();

    const goldCandidates = searchGoldInstruments(instruments, args.query);
    const holdingForSelected = findHolding(
      portfolio,
      args.selectedInstrument?.ticker ?? null
    );

    const accountInfo = account as { id?: number | string; currencyCode?: string };
    const currency =
      cash.currency ??
      accountInfo.currencyCode ??
      DEFAULT_T212_RISK_LIMITS.currency;

    return {
      ok: true,
      environment: args.environment,
      readOnly: true,
      ordersEnabled: false,
      paperOrderSubmissionEnabled: T212_PAPER_ORDER_SUBMISSION_ENABLED,
      liveExecutionFeatureEnabled: T212_LIVE_EXECUTION_FEATURE_FLAG,
      connected: true,
      account: {
        environment: args.environment,
        currency,
        freeCash: typeof cash.free === "number" ? cash.free : null,
        investedValue: typeof cash.invested === "number" ? cash.invested : null,
        totalValue: typeof cash.total === "number" ? cash.total : null,
        accountIdMasked: maskAccountId(
          accountInfo.id != null ? String(accountInfo.id) : null
        )
      },
      holdingsCount: portfolio.length,
      goldCandidates,
      selectedInstrument: args.selectedInstrument,
      holdingForSelected,
      heartbeatAt,
      orderEndpointsCalled: false,
      errors,
      notes
    };
  } catch (error) {
    const code =
      error instanceof T212ApiError
        ? error.code
        : error instanceof Error
          ? error.message
          : "T212_DIAGNOSTICS_FAILED";
    errors.push(code);
    return {
      ok: false,
      environment: args.environment,
      readOnly: true,
      ordersEnabled: false,
      paperOrderSubmissionEnabled: T212_PAPER_ORDER_SUBMISSION_ENABLED,
      liveExecutionFeatureEnabled: T212_LIVE_EXECUTION_FEATURE_FLAG,
      connected: false,
      account: null,
      holdingsCount: 0,
      goldCandidates: [],
      selectedInstrument: args.selectedInstrument,
      holdingForSelected: null,
      heartbeatAt: null,
      orderEndpointsCalled: false,
      errors,
      notes
    };
  }
}

export function findHolding(
  portfolio: Array<{
    ticker?: string;
    quantity?: number;
    averagePrice?: number;
    currentPrice?: number;
    currency?: string;
  }>,
  ticker: string | null
): T212HoldingView | null {
  if (!ticker) return null;
  const row = portfolio.find(
    (p) => (p.ticker ?? "").toUpperCase() === ticker.toUpperCase()
  );
  if (!row) return null;
  return {
    instrumentId: row.ticker ?? ticker,
    ticker: row.ticker ?? ticker,
    quantity: typeof row.quantity === "number" ? row.quantity : 0,
    averagePrice: typeof row.averagePrice === "number" ? row.averagePrice : null,
    currentPrice: typeof row.currentPrice === "number" ? row.currentPrice : null,
    currency: row.currency ?? null
  };
}

export function connectionViewFromReport(
  report: T212DiagnosticReport
): T212ConnectionView {
  return {
    connected: report.connected,
    environment: report.environment,
    mode:
      report.environment === "PRACTICE"
        ? T212_INITIAL_MODE
        : "TRADING_212_LIVE_LOCKED",
    currency: report.account?.currency ?? null,
    freeCash: report.account?.freeCash ?? null,
    investedValue: report.account?.investedValue ?? null,
    totalValue: report.account?.totalValue ?? null,
    selectedInstrument: report.selectedInstrument,
    holdingQuantity: report.holdingForSelected?.quantity ?? null,
    lastHeartbeatAt: report.heartbeatAt,
    connectionState: report.ok
      ? "Connected"
      : report.errors.length
        ? "Error"
        : "Disconnected",
    ordersEnabled: false,
    paperOrderSubmissionEnabled: T212_PAPER_ORDER_SUBMISSION_ENABLED,
    liveExecutionFeatureEnabled: T212_LIVE_EXECUTION_FEATURE_FLAG
  };
}
