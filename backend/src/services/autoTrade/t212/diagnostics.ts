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
  assertLiveExecutionDisabled,
  isBrokerExecutionEnabled,
  isPracticeOrderSubmissionAllowed,
  isT212LiveExecutionFeatureFlag,
  isT212PaperOrderSubmissionEnabled
} from "../executionFlags";
// isPracticeOrderSubmissionAllowed used by assertOrderSubmissionDisabled
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
  // Read-only clients never enable mutations unless practice submission is allowed
  // AND caller explicitly uses the order factory. Default stays mutation-off for safety.
  return new T212InvestClient(environment, credentials, {
    mutationsEnabled: false
  });
}

/**
 * Blocks Live execution always. When Practice paper submission is intentionally
 * enabled (apiT212OrderPreview only), read-only paths may proceed.
 * Production keeps all flags false → still fail-closed for accidental submits.
 */
export function assertOrderSubmissionDisabled(): void {
  assertLiveExecutionDisabled();
  // Production / dry-run: paper+broker must remain false.
  // Order preview enables them intentionally — submit paths use assertPracticeOrderSubmissionAllowed.
  if (
    !isPracticeOrderSubmissionAllowed() &&
    (isBrokerExecutionEnabled() ||
      isT212PaperOrderSubmissionEnabled() ||
      isT212LiveExecutionFeatureFlag())
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
    paperOrderSubmissionEnabled: isT212PaperOrderSubmissionEnabled(),
    liveExecutionFeatureEnabled: isT212LiveExecutionFeatureFlag()
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
      paperOrderSubmissionEnabled: isT212PaperOrderSubmissionEnabled(),
      liveExecutionFeatureEnabled: isT212LiveExecutionFeatureFlag(),
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
    // Single official summary call covers auth + cash/account fields; avoid hammering 1/5s limit.
    const summary = await client.getAccountSummary();
    const [positions, instruments] = await Promise.all([
      client.getPositions(),
      client.getInstruments()
    ]);
    const heartbeatAt = new Date().toISOString();

    const goldCandidates = searchGoldInstruments(instruments, args.query);
    const holdingForSelected = findHolding(
      positions,
      args.selectedInstrument?.ticker ?? null
    );

    const currency = summary.currency ?? DEFAULT_T212_RISK_LIMITS.currency;
    const freeCash =
      typeof summary.cash?.availableToTrade === "number"
        ? summary.cash.availableToTrade
        : null;
    const investedValue =
      typeof summary.investments?.currentValue === "number"
        ? summary.investments.currentValue
        : null;
    const totalValue = typeof summary.totalValue === "number" ? summary.totalValue : null;

    return {
      ok: true,
      environment: args.environment,
      readOnly: true,
      ordersEnabled: false,
      paperOrderSubmissionEnabled: isT212PaperOrderSubmissionEnabled(),
      liveExecutionFeatureEnabled: isT212LiveExecutionFeatureFlag(),
      connected: true,
      account: {
        environment: args.environment,
        currency,
        freeCash,
        investedValue,
        totalValue,
        accountIdMasked: maskAccountId(
          summary.id != null ? String(summary.id) : null
        )
      },
      holdingsCount: positions.length,
      goldCandidates,
      selectedInstrument: args.selectedInstrument,
      holdingForSelected,
      heartbeatAt,
      orderEndpointsCalled: false,
      errors,
      notes: [
        ...notes,
        "Uses official GET /equity/account/summary and GET /equity/positions.",
        "Heartbeat is application-level (summary timestamp), not a T212 heartbeat API."
      ]
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
      paperOrderSubmissionEnabled: isT212PaperOrderSubmissionEnabled(),
      liveExecutionFeatureEnabled: isT212LiveExecutionFeatureFlag(),
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
    quantityAvailableForTrading?: number;
    averagePrice?: number;
    averagePricePaid?: number;
    currentPrice?: number;
    currency?: string;
    instrument?: { ticker?: string; currency?: string };
  }>,
  ticker: string | null
): T212HoldingView | null {
  if (!ticker) return null;
  const row = portfolio.find((p) => {
    const t = (p.instrument?.ticker ?? p.ticker ?? "").toUpperCase();
    return t === ticker.toUpperCase();
  });
  if (!row) return null;
  const resolvedTicker = row.instrument?.ticker ?? row.ticker ?? ticker;
  const qty =
    typeof row.quantityAvailableForTrading === "number"
      ? row.quantityAvailableForTrading
      : typeof row.quantity === "number"
        ? row.quantity
        : 0;
  return {
    instrumentId: resolvedTicker,
    ticker: resolvedTicker,
    quantity: qty,
    averagePrice:
      typeof row.averagePricePaid === "number"
        ? row.averagePricePaid
        : typeof row.averagePrice === "number"
          ? row.averagePrice
          : null,
    currentPrice: typeof row.currentPrice === "number" ? row.currentPrice : null,
    currency: row.instrument?.currency ?? row.currency ?? null
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
    paperOrderSubmissionEnabled: isT212PaperOrderSubmissionEnabled(),
    liveExecutionFeatureEnabled: isT212LiveExecutionFeatureFlag()
  };
}
