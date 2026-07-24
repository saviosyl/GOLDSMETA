/**
 * cTrader Open API client — Demo read-only.
 * Uses Spotware HTTP helpers for account discovery and WebSocket for symbols/quotes.
 * Never logs tokens. Never submits orders.
 */

import { CTraderConnection } from "@reiryoku/ctrader-layer";
import type { BrokerAccount, BrokerQuote, BrokerSymbol } from "../domain";
import { hashAccountKey, maskAccountId } from "./tokenCrypto";
import {
  resolveXauUsdFromCatalogue,
  type RawCTraderSymbol
} from "./symbolResolver";

const DEMO_HOST = "demo.ctraderapi.com";
const DEMO_PORT = 5035;

export type DiscoveredAccount = {
  ctidTraderAccountId: string;
  isLive: boolean;
  brokerNameTitle: string | null;
  depositCurrency: string | null;
  leverage: number | null;
  accountIdMasked: string;
  accountKeyHash: string;
};

export type AccountSnapshot = {
  balance: number | null;
  equity: number | null;
  freeMargin: number | null;
  usedMargin: number | null;
  currency: string | null;
  leverage: number | null;
};

export interface CTraderOpenApiClient {
  listAccountsByAccessToken(accessToken: string): Promise<DiscoveredAccount[]>;
  fetchAccountSnapshot(args: {
    accessToken: string;
    clientId: string;
    clientSecret: string;
    ctidTraderAccountId: string;
  }): Promise<AccountSnapshot>;
  discoverXauUsd(args: {
    accessToken: string;
    clientId: string;
    clientSecret: string;
    ctidTraderAccountId: string;
  }): Promise<BrokerSymbol | null>;
  fetchQuote(args: {
    accessToken: string;
    clientId: string;
    clientSecret: string;
    ctidTraderAccountId: string;
    symbolId: string;
  }): Promise<BrokerQuote>;
}

function mapDiscovered(raw: Record<string, unknown>): DiscoveredAccount {
  const id = String(
    raw.ctidTraderAccountId ?? raw.accountId ?? raw.traderLogin ?? ""
  );
  const isLive = Boolean(raw.isLive ?? raw.live ?? false);
  const brokerNameTitle =
    typeof raw.brokerTitle === "string"
      ? raw.brokerTitle
      : typeof raw.brokerNameTitle === "string"
        ? raw.brokerNameTitle
        : typeof raw.brokerName === "string"
          ? raw.brokerName
          : null;
  return {
    ctidTraderAccountId: id,
    isLive,
    brokerNameTitle,
    depositCurrency:
      typeof raw.depositAsset === "string"
        ? raw.depositAsset
        : typeof raw.depositCurrency === "string"
          ? raw.depositCurrency
          : typeof raw.currency === "string"
            ? raw.currency
            : null,
    leverage:
      typeof raw.leverage === "number"
        ? raw.leverage
        : typeof raw.leverageInCents === "number"
          ? raw.leverageInCents / 100
          : null,
    accountIdMasked: maskAccountId(id),
    accountKeyHash: hashAccountKey(id)
  };
}

async function withDemoConnection<T>(
  fn: (connection: InstanceType<typeof CTraderConnection>) => Promise<T>
): Promise<T> {
  const connection = new CTraderConnection({
    host: DEMO_HOST,
    port: DEMO_PORT
  });
  await connection.open();
  try {
    return await fn(connection);
  } finally {
    try {
      void connection.close();
    } catch {
      /* ignore close errors */
    }
  }
}

export function createLiveOpenApiClient(): CTraderOpenApiClient {
  return {
    async listAccountsByAccessToken(accessToken: string) {
      const raw = (await CTraderConnection.getAccessTokenAccounts(
        accessToken
      )) as unknown;
      const list = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as { data?: unknown })?.data)
          ? ((raw as { data: unknown[] }).data as unknown[])
          : [];
      return list
        .map((item) => mapDiscovered((item ?? {}) as Record<string, unknown>))
        .filter((a) => a.ctidTraderAccountId.length > 0);
    },

    async fetchAccountSnapshot(args) {
      return withDemoConnection(async (connection) => {
        await connection.sendCommand("ProtoOAApplicationAuthReq", {
          clientId: args.clientId,
          clientSecret: args.clientSecret
        });
        await connection.sendCommand("ProtoOAAccountAuthReq", {
          accessToken: args.accessToken,
          ctidTraderAccountId: Number(args.ctidTraderAccountId)
        });
        const trader = (await connection.sendCommand("ProtoOATraderReq", {
          ctidTraderAccountId: Number(args.ctidTraderAccountId)
        })) as Record<string, unknown>;
        const t = (trader.trader ?? trader) as Record<string, unknown>;
        const balance =
          typeof t.balance === "number"
            ? t.balance / 100
            : typeof t.balance === "string"
              ? Number(t.balance) / 100
              : null;
        return {
          balance,
          equity:
            typeof t.equity === "number"
              ? t.equity / 100
              : balance,
          freeMargin:
            typeof t.freeMargin === "number"
              ? t.freeMargin / 100
              : null,
          usedMargin:
            typeof t.usedMargin === "number"
              ? t.usedMargin / 100
              : null,
          currency:
            typeof t.depositAsset === "string" ? t.depositAsset : null,
          leverage:
            typeof t.leverageInCents === "number"
              ? t.leverageInCents / 100
              : typeof t.leverage === "number"
                ? t.leverage
                : null
        };
      });
    },

    async discoverXauUsd(args) {
      return withDemoConnection(async (connection) => {
        await connection.sendCommand("ProtoOAApplicationAuthReq", {
          clientId: args.clientId,
          clientSecret: args.clientSecret
        });
        await connection.sendCommand("ProtoOAAccountAuthReq", {
          accessToken: args.accessToken,
          ctidTraderAccountId: Number(args.ctidTraderAccountId)
        });
        const symbolsRes = (await connection.sendCommand(
          "ProtoOASymbolsListReq",
          {
            ctidTraderAccountId: Number(args.ctidTraderAccountId)
          }
        )) as { symbol?: unknown[]; symbols?: unknown[] };
        const rawList = (symbolsRes.symbol ??
          symbolsRes.symbols ??
          []) as Array<Record<string, unknown>>;
        const mapped: RawCTraderSymbol[] = rawList.map((s) => ({
          symbolId: s.symbolId as number | string | undefined,
          symbolName: String(s.symbolName ?? s.name ?? ""),
          description: String(s.description ?? ""),
          baseAsset: s.baseAsset != null ? String(s.baseAsset) : undefined,
          quoteAsset: s.quoteAsset != null ? String(s.quoteAsset) : undefined,
          digits: typeof s.digits === "number" ? s.digits : undefined,
          pipPosition:
            typeof s.pipPosition === "number" ? s.pipPosition : undefined,
          tickSize:
            typeof s.lotSize === "number"
              ? undefined
              : typeof s.tickSize === "number"
                ? s.tickSize
                : undefined,
          minVolume:
            typeof s.minVolume === "number" ? s.minVolume / 100 : undefined,
          stepVolume:
            typeof s.stepVolume === "number" ? s.stepVolume / 100 : undefined,
          maxVolume:
            typeof s.maxVolume === "number" ? s.maxVolume / 100 : undefined,
          lotSize: typeof s.lotSize === "number" ? s.lotSize : undefined,
          minStopDistance:
            typeof s.minStopDistance === "number"
              ? s.minStopDistance
              : undefined
        }));

        // Enrich assets from symbol name when Spotware omits them
        for (const m of mapped) {
          const n = (m.symbolName ?? "").toUpperCase();
          if (!m.baseAsset && /^XAU/.test(n)) m.baseAsset = "XAU";
          if (!m.quoteAsset && /USD/.test(n)) m.quoteAsset = "USD";
          if (!m.baseAsset && /^GOLD/.test(n)) m.baseAsset = "GOLD";
          if (!m.tickSize && m.digits != null) {
            m.tickSize = Math.pow(10, -m.digits);
          }
        }

        return resolveXauUsdFromCatalogue(mapped);
      });
    },

    async fetchQuote(args) {
      return withDemoConnection(async (connection) => {
        await connection.sendCommand("ProtoOAApplicationAuthReq", {
          clientId: args.clientId,
          clientSecret: args.clientSecret
        });
        await connection.sendCommand("ProtoOAAccountAuthReq", {
          accessToken: args.accessToken,
          ctidTraderAccountId: Number(args.ctidTraderAccountId)
        });
        // Spot request — one-shot
        const spot = (await connection.sendCommand("ProtoOASpotReq", {
          ctidTraderAccountId: Number(args.ctidTraderAccountId),
          symbolId: Number(args.symbolId)
        }).catch(async () => {
          // Fallback subscribe then read event is not available synchronously —
          // use ProtoOAGetTrendbarsReq-less path: SubscribeSpots + short wait not ideal.
          // Prefer ProtoOASpotEvent via SubscribeSpots with trySendCommand.
          await connection.sendCommand("ProtoOASubscribeSpotsReq", {
            ctidTraderAccountId: Number(args.ctidTraderAccountId),
            symbolId: [Number(args.symbolId)]
          });
          return null;
        })) as Record<string, unknown> | null;

        const bid =
          typeof spot?.bid === "number"
            ? spot.bid
            : typeof spot?.bid === "string"
              ? Number(spot.bid)
              : null;
        const ask =
          typeof spot?.ask === "number"
            ? spot.ask
            : typeof spot?.ask === "string"
              ? Number(spot.ask)
              : null;

        if (bid == null || ask == null) {
          throw new Error("CTRADER_QUOTE_UNAVAILABLE");
        }
        const spread = Number((ask - bid).toFixed(6));
        return {
          symbolId: args.symbolId,
          symbolName: "XAUUSD",
          bid,
          ask,
          spread,
          timestamp: new Date().toISOString(),
          marketStatus: "OPEN",
          stale: false,
          source: "LIVE"
        } satisfies BrokerQuote;
      });
    }
  };
}

/** Test double — never used in production routes unless CTRADER_OPENAPI_TRANSPORT=mock */
export function createMockOpenApiClient(opts?: {
  accounts?: DiscoveredAccount[];
  symbol?: BrokerSymbol | null;
  quote?: BrokerQuote;
  snapshot?: AccountSnapshot;
}): CTraderOpenApiClient {
  const accounts =
    opts?.accounts ??
    ([
      {
        ctidTraderAccountId: "123456",
        isLive: false,
        brokerNameTitle: "Pepperstone",
        depositCurrency: "EUR",
        leverage: 100,
        accountIdMasked: maskAccountId("123456"),
        accountKeyHash: hashAccountKey("123456")
      }
    ] satisfies DiscoveredAccount[]);
  return {
    async listAccountsByAccessToken() {
      return accounts;
    },
    async fetchAccountSnapshot() {
      return (
        opts?.snapshot ?? {
          balance: 10000,
          equity: 10000,
          freeMargin: 9500,
          usedMargin: 500,
          currency: "EUR",
          leverage: 100
        }
      );
    },
    async discoverXauUsd() {
      return (
        opts?.symbol ??
        resolveXauUsdFromCatalogue([
          {
            symbolId: 41,
            symbolName: "XAUUSD",
            description: "Gold vs US Dollar",
            baseAsset: "XAU",
            quoteAsset: "USD",
            digits: 2,
            pipPosition: 1,
            tickSize: 0.01,
            minVolume: 0.01,
            stepVolume: 0.01,
            maxVolume: 100,
            lotSize: 100,
            minStopDistance: 0.3
          }
        ])
      );
    },
    async fetchQuote() {
      return (
        opts?.quote ?? {
          symbolId: "41",
          symbolName: "XAUUSD",
          bid: 2350.1,
          ask: 2350.4,
          spread: 0.3,
          timestamp: new Date().toISOString(),
          marketStatus: "OPEN",
          stale: false,
          source: "LIVE"
        }
      );
    }
  };
}

export function createOpenApiClient(
  source: NodeJS.ProcessEnv = process.env
): CTraderOpenApiClient {
  if ((source.CTRADER_OPENAPI_TRANSPORT ?? "").toLowerCase() === "mock") {
    return createMockOpenApiClient();
  }
  return createLiveOpenApiClient();
}

export function toSafeBrokerAccount(
  discovered: DiscoveredAccount,
  snap?: AccountSnapshot | null
): BrokerAccount {
  return {
    brokerId: "pepperstone_ctrader",
    environment: discovered.isLive ? "LIVE" : "DEMO",
    accountIdMasked: discovered.accountIdMasked,
    accountKeyHash: discovered.accountKeyHash,
    currency: snap?.currency ?? discovered.depositCurrency ?? "—",
    balance: snap?.balance ?? null,
    equity: snap?.equity ?? null,
    freeMargin: snap?.freeMargin ?? null,
    usedMargin: snap?.usedMargin ?? null,
    leverage: snap?.leverage ?? discovered.leverage,
    accountType: discovered.isLive ? "LIVE" : "DEMO",
    positionMode: "UNKNOWN",
    brokerName: discovered.brokerNameTitle,
    brokerNameSource: discovered.brokerNameTitle ? "API" : "UNKNOWN",
    isDemo: !discovered.isLive
  };
}

export function isPepperstoneBrokerName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /pepperstone/i.test(name);
}
