import { describe, expect, it } from "vitest";
import {
  buildAutoTradeActivityFeed,
  deriveAutoTradeSyncSummary
} from "./autoTradeSyncState";
import type {
  BrokerControlCentreResponse,
  CTraderDiagnosticsReport
} from "./ctraderTypes";

const connectedCentre = {
  readiness: {
    connected: true,
    setupRequired: false,
    authSetupRequired: false,
    oauthConfigured: true,
    connectionSummary: {
      accountMasked: "****4810",
      brokerName: "Pepperstone",
      pepperstoneConfirmed: true,
      symbolName: "XAUUSD",
      lastSyncAt: new Date().toISOString(),
      lastQuoteAt: new Date().toISOString()
    }
  }
} as unknown as BrokerControlCentreResponse;

const diagnosticsClosed = {
  oauthConnected: true,
  accountSelected: true,
  demoAccountSelected: true,
  selectedAccountIsLive: false,
  goldSymbolFound: true,
  liveQuoteReceived: true,
  marketStatusAvailable: true,
  environment: "DEMO",
  connection: {
    accountMasked: "****4810",
    brokerName: "Pepperstone",
    currency: "EUR",
    symbolName: "XAUUSD",
    tokenRefreshHealthy: true
  },
  symbol: { symbolName: "XAUUSD" },
  quote: {
    bid: 4046.35,
    ask: 4046.64,
    spread: 0.29,
    marketStatus: "CLOSED",
    stale: true
  }
} as unknown as CTraderDiagnosticsReport;

describe("autoTradeSyncState", () => {
  it("resolves Demo account from Broker/control-centre sources even if diagnostics omit flags", () => {
    const sync = deriveAutoTradeSyncSummary({
      mode: "demo",
      centre: connectedCentre,
      diagnostics: {
        ...diagnosticsClosed,
        accountSelected: false,
        demoAccountSelected: false,
        connection: { ...diagnosticsClosed.connection, accountMasked: null }
      } as CTraderDiagnosticsReport,
      accounts: [
        {
          ctidTraderAccountId: "demo-4810",
          accountIdMasked: "****4810",
          isLive: false,
          selected: true,
          brokerNameTitle: "Pepperstone"
        } as never
      ],
      settings: { selectedAccountId: "demo-4810" } as never
    });
    expect(sync.accountSelected).toBe(true);
    expect(sync.connected).toBe(true);
    expect(sync.accountLabel).toMatch(/Pepperstone Demo · \*\*\*\*4810/);
    expect(sync.connectionLabel).toBe("Connected");
    expect(sync.accountLabel).not.toMatch(/No Demo account selected/);
  });

  it("transfers market closed + previous-session quote from Broker diagnostics", () => {
    const sync = deriveAutoTradeSyncSummary({
      mode: "demo",
      centre: connectedCentre,
      diagnostics: diagnosticsClosed,
      accounts: [],
      settings: null
    });
    expect(sync.marketLabel).toBe("XAUUSD · Market closed");
    expect(sync.quoteLabel).toBe("Previous-session quote");
    expect(sync.executionLabel).toMatch(/market closed/i);
    expect(sync.bid).toBe(4046.35);
    expect(sync.ask).toBe(4046.64);
    expect(sync.spread).toBe(0.29);
    expect(sync.goldOk).toBe(true);
    expect(sync.checksOk).toBe(true);
  });

  it("does not let stale reconnect activity lead when currently connected", () => {
    const sync = deriveAutoTradeSyncSummary({
      mode: "demo",
      centre: connectedCentre,
      diagnostics: diagnosticsClosed,
      accounts: [],
      settings: null
    });
    const feed = buildAutoTradeActivityFeed({
      activity: [
        {
          id: "old",
          at: "2026-08-01T00:00:00.000Z",
          message: "Broker set to PEPPERSTONE_CTRADER. AutoTrade OFF — reconnect required.",
          level: "warn"
        }
      ],
      summary: sync
    });
    expect(feed[0]?.message).toMatch(/Demo account \*\*\*\*4810 connected\. AutoTrade OFF/);
    expect(feed[0]?.message).not.toMatch(/reconnect required/i);
    expect(feed.some((i) => /reconnect required/i.test(i.message))).toBe(true);
  });

  it("never uses IG-null market status when diagnostics quote is present", () => {
    const sync = deriveAutoTradeSyncSummary({
      mode: "demo",
      centre: connectedCentre,
      diagnostics: diagnosticsClosed,
      accounts: [],
      settings: null
    });
    expect(sync.marketLabel).not.toMatch(/status unknown/i);
  });

  it("keeps Demo connected from control-centre alone when diagnostics is null (gateway timeout)", () => {
    const sync = deriveAutoTradeSyncSummary({
      mode: "demo",
      centre: connectedCentre,
      diagnostics: null,
      accounts: [
        {
          ctidTraderAccountId: "demo-4810",
          accountIdMasked: "****4810",
          isLive: false,
          selected: true,
          brokerNameTitle: "Pepperstone"
        } as never
      ],
      settings: null
    });
    expect(sync.connected).toBe(true);
    expect(sync.accountSelected).toBe(true);
    expect(sync.accountMasked).toBe("****4810");
    expect(sync.connectionLabel).toBe("Connected");
    expect(sync.checksOk).toBe(true);
    expect(sync.goldOk).toBe(true);
    expect(sync.quoteLabel).toBe("Previous-session quote");
  });
});
