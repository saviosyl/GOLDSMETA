/**
 * IG Demo read-only diagnostic runner.
 * Never calls dealing endpoints (positions/otc POST/PUT/DELETE).
 */

import { maskAccountId } from "./types";
import {
  DEMO_ORDER_SUBMISSION_ENABLED,
  LIVE_EXECUTION_FEATURE_FLAG
} from "./types";
import type { AutoTradeBrokerAdapter } from "./brokerAdapter";
import type { IgDemoDiagnosticReport, IgMarketRulesDetails } from "./igDemoTypes";
import { loadIgCredentialsFromServerEnv, loadPinnedAccountIdFromServerEnv } from "./igBrokerAdapter";
import { redactSecrets } from "./redactSecrets";

export async function runIgDemoReadOnlyDiagnostics(
  adapter: AutoTradeBrokerAdapter,
  opts: { preferredEpic?: string | null } = {}
): Promise<IgDemoDiagnosticReport> {
  const errors: string[] = [];
  const notes: string[] = [];
  const configured = loadIgCredentialsFromServerEnv("DEMO");
  const pinnedAccountId = loadPinnedAccountIdFromServerEnv("DEMO");
  const configuredMasked = maskAccountId(pinnedAccountId ?? configured?.accountId ?? null);

  const report: IgDemoDiagnosticReport = {
    ok: false,
    environment: "DEMO",
    readOnly: true,
    ordersEnabled: false,
    liveExecutionEnabled: LIVE_EXECUTION_FEATURE_FLAG,
    connected: false,
    accountIdMasked: null,
    accountName: null,
    currency: null,
    balance: null,
    available: null,
    marginUsed: null,
    accountMatch: pinnedAccountId ? "unknown" : "unconfigured",
    configuredAccountIdMasked: configuredMasked,
    goldCandidates: [],
    proposedEpic: null,
    selectionRequired: false,
    selectedMarket: null,
    openPositionsCount: 0,
    openPositions: [],
    sessionRenewal: "skipped",
    heartbeatAt: null,
    dealingEndpointsCalled: false,
    errors,
    notes
  };

  if (DEMO_ORDER_SUBMISSION_ENABLED) {
    notes.push("Unexpected: DEMO_ORDER_SUBMISSION_ENABLED should be false for this stage.");
  }
  if (LIVE_EXECUTION_FEATURE_FLAG) {
    notes.push("Unexpected: LIVE_EXECUTION_FEATURE_FLAG should be false.");
  }

  try {
    await adapter.connect("server:ig-demo-diagnostics");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "IG_AUTH_FAILED");
    return redactSecrets(report);
  }

  report.connected = true;

  let account;
  try {
    const accounts = await adapter.listAccounts();
    if (!accounts.length) {
      errors.push("NO_ACCOUNTS");
      return redactSecrets(report);
    }
    const configuredId = pinnedAccountId;
    if (configuredId) {
      const match = accounts.find((a) => a.accountId === configuredId);
      if (!match) {
        report.accountMatch = "mismatch";
        errors.push("ACCOUNT_MISMATCH");
        notes.push("Configured IG_DEMO_ACCOUNT_ID does not match any demo account.");
        return redactSecrets(report);
      }
      account = await adapter.selectAccount(configuredId);
      report.accountMatch = "matched";
    } else {
      account = accounts[0]!;
      await adapter.selectAccount(account.accountId);
      report.accountMatch = "unconfigured";
      notes.push("IG_DEMO_ACCOUNT_ID not set — used first account for diagnostics only.");
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "ACCOUNT_ERROR");
    return redactSecrets(report);
  }

  report.accountIdMasked = maskAccountId(account.accountId);
  report.accountName = account.accountName;
  report.currency = account.currency;
  report.balance = account.balance;
  report.available = account.available;
  report.marginUsed = account.marginUsed;

  try {
    const candidates = await adapter.searchGoldMarkets();
    report.goldCandidates = candidates;
    const primary = candidates.filter((c) => c.proposedPrimary);
    if (candidates.length === 0) {
      errors.push("GOLD_MARKET_NOT_FOUND");
    } else if (opts.preferredEpic) {
      const found = candidates.find((c) => c.epic === opts.preferredEpic);
      if (!found) {
        errors.push("PREFERRED_EPIC_NOT_IN_CANDIDATES");
        report.selectionRequired = true;
      } else {
        report.proposedEpic = found.epic;
        report.selectedMarket = await loadMarketRules(adapter, found.epic);
      }
    } else if (candidates.length === 1 || primary.length === 1) {
      const epic = (primary[0] ?? candidates[0])!.epic;
      report.proposedEpic = epic;
      report.selectionRequired = candidates.length > 1 && primary.length !== 1;
      if (!report.selectionRequired) {
        report.selectedMarket = await loadMarketRules(adapter, epic);
      } else {
        notes.push("Multiple Gold candidates — explicit EPIC selection required before execution stage.");
      }
    } else {
      report.selectionRequired = true;
      notes.push(
        "Multiple Gold markets returned. No silent selection. Review candidates and choose Spot Gold explicitly."
      );
      if (primary[0]) {
        report.proposedEpic = primary[0].epic;
        notes.push(`Proposed (not selected): ${primary[0].epic} — ${primary[0].reason}`);
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "GOLD_DISCOVERY_FAILED");
  }

  try {
    const positions = await adapter.getOpenPositions();
    report.openPositionsCount = positions.length;
    report.openPositions = positions.map((p) => ({
      dealIdMasked: maskAccountId(p.dealId) ?? "****",
      direction: p.direction,
      size: p.size,
      epic: p.epic,
      instrumentName: p.instrumentName,
      level: p.level,
      stopLevel: p.stopLevel,
      limitLevel: p.limitLevel,
      guaranteedStop: p.guaranteedStop,
      upl: p.upl
    }));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "POSITIONS_READ_FAILED");
  }

  try {
    report.heartbeatAt = await adapter.heartbeat();
    report.sessionRenewal = "ok";
    report.heartbeatAt = await adapter.renewSession();
  } catch (error) {
    report.sessionRenewal = "failed";
    errors.push(error instanceof Error ? error.message : "SESSION_RENEW_FAILED");
  }

  report.ok = errors.length === 0;
  report.dealingEndpointsCalled = false;
  notes.push("Read-only diagnostic complete — no dealing endpoints were called.");
  return redactSecrets(report);
}

async function loadMarketRules(
  adapter: AutoTradeBrokerAdapter,
  epic: string
): Promise<IgMarketRulesDetails> {
  const market = await adapter.getMarket(epic);
  if (
    !(market.minDealSize > 0) ||
    !(market.dealSizeIncrement > 0) ||
    !(market.valueOfOnePip > 0)
  ) {
    throw new Error("MISSING_MARKET_RULES");
  }
  return {
    epic: market.epic,
    instrumentName: market.instrumentName,
    instrumentType: market.instrumentType,
    expiry: market.expiry,
    marketStatus: market.marketStatus,
    currencyCode: market.currencyCode,
    bid: market.bid,
    offer: market.offer,
    spread: Number((market.offer - market.bid).toFixed(4)),
    minDealSize: market.minDealSize,
    dealSizeIncrement: market.dealSizeIncrement,
    valueOfOnePip: market.valueOfOnePip,
    minNormalStopDistance: market.minNormalStopDistance,
    minGuaranteedStopDistance: market.minGuaranteedStopDistance,
    guaranteedStopAvailable: market.guaranteedStopAvailable,
    marginRequirement: market.marginRequirement,
    scalingFactor: market.scalingFactor,
    updateTime: market.updateTime,
    high: market.high,
    low: market.low
  };
}
