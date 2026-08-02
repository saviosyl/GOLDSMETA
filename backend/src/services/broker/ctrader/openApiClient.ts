/**
 * cTrader Open API client — Demo read-only.
 * Uses Spotware HTTP helpers for account discovery and WebSocket for symbols/quotes.
 * Never logs tokens. Never submits orders.
 */

import { CTraderConnection } from "@reiryoku/ctrader-layer";
import type { BrokerAccount, BrokerQuote, BrokerSymbol } from "../domain";
import { hashAccountKey, maskAccountId } from "./tokenCrypto";
import {
  pickXauUsdCandidate,
  resolveXauUsdFromCatalogue,
  type RawCTraderSymbol
} from "./symbolResolver";
import {
  marketStatusFromSchedule,
  parseScheduleIntervals
} from "./marketSchedule";

const DEMO_HOST = "demo.ctraderapi.com";
const DEMO_PORT = 5035;
/** Spotware relative price unit — bid/ask are in 1/100000 of price. */
const SPOT_PRICE_SCALE = 100_000;
const SPOT_EVENT_TIMEOUT_MS = 8_000;

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function moneyFromCenti(value: unknown, moneyDigits = 2): number | null {
  const n = asNumber(value);
  if (n == null) return null;
  return n / Math.pow(10, moneyDigits);
}

function volumeFromCents(value: unknown): number | null {
  const n = asNumber(value);
  if (n == null) return null;
  return n / 100;
}

function spotPriceFromRelative(value: unknown): number | null {
  const n = asNumber(value);
  if (n == null) return null;
  return n / SPOT_PRICE_SCALE;
}

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

/**
 * Spotware HTTP account list.
 * Do NOT use CTraderConnection.getAccessTokenAccounts — that helper
 * JSON.parse's axios's already-parsed object and throws
 * `"[object Object]" is not valid JSON`.
 */
export async function fetchTradingAccountsByAccessToken(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<DiscoveredAccount[]> {
  const uri = `https://api.spotware.com/connect/tradingaccounts?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetchImpl(uri);
  if (!res.ok) {
    throw new Error(`CTRADER_ACCOUNT_LIST_FAILED status=${res.status}`);
  }
  const raw = (await res.json()) as unknown;
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { data?: unknown })?.data)
      ? ((raw as { data: unknown[] }).data as unknown[])
      : [];
  return list
    .filter((item) => {
      const row = (item ?? {}) as Record<string, unknown>;
      if (row.deleted === true) return false;
      const status = String(row.accountStatus ?? "").toUpperCase();
      if (status === "DELETED" || status === "DISABLED") return false;
      return true;
    })
    .map((item) => mapDiscovered((item ?? {}) as Record<string, unknown>))
    .filter((a) => a.ctidTraderAccountId.length > 0);
}

export function createLiveOpenApiClient(): CTraderOpenApiClient {
  return {
    async listAccountsByAccessToken(accessToken: string) {
      return fetchTradingAccountsByAccessToken(accessToken);
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
        const moneyDigits = asNumber(t.moneyDigits) ?? 2;
        const balance = moneyFromCenti(t.balance, moneyDigits);
        let freeMargin = moneyFromCenti(t.freeMargin, moneyDigits);
        let usedMargin = moneyFromCenti(t.usedMargin, moneyDigits);
        let equity =
          moneyFromCenti(t.equity, moneyDigits) ??
          balance;

        // Margin fields are often absent on ProtoOATraderRes — try reconcile.
        if (freeMargin == null || usedMargin == null) {
          try {
            const recon = (await connection.sendCommand("ProtoOAReconcileReq", {
              ctidTraderAccountId: Number(args.ctidTraderAccountId)
            })) as Record<string, unknown>;
            freeMargin =
              freeMargin ?? moneyFromCenti(recon.freeMargin, moneyDigits);
            usedMargin =
              usedMargin ?? moneyFromCenti(recon.usedMargin, moneyDigits);
            equity = moneyFromCenti(recon.equity, moneyDigits) ?? equity;
          } catch {
            /* reconcile optional */
          }
        }

        let currency: string | null =
          typeof t.depositAsset === "string" ? t.depositAsset : null;
        const depositAssetId = asNumber(t.depositAssetId);
        if (!currency && depositAssetId != null) {
          try {
            const assetsRes = (await connection.sendCommand(
              "ProtoOAAssetListReq",
              { ctidTraderAccountId: Number(args.ctidTraderAccountId) }
            )) as { asset?: Array<Record<string, unknown>>; assets?: Array<Record<string, unknown>> };
            const assets = assetsRes.asset ?? assetsRes.assets ?? [];
            const match = assets.find(
              (a) => asNumber(a.assetId) === depositAssetId
            );
            currency =
              typeof match?.name === "string"
                ? match.name
                : typeof match?.displayName === "string"
                  ? match.displayName
                  : null;
          } catch {
            /* asset list optional */
          }
        }

        const leverageInCents = asNumber(t.leverageInCents);
        return {
          balance,
          equity,
          freeMargin,
          usedMargin,
          currency,
          leverage:
            leverageInCents != null
              ? leverageInCents / 100
              : asNumber(t.leverage)
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

        const assetsRes = (await connection.sendCommand(
          "ProtoOAAssetListReq",
          { ctidTraderAccountId: Number(args.ctidTraderAccountId) }
        ).catch(() => ({ asset: [] }))) as {
          asset?: Array<Record<string, unknown>>;
          assets?: Array<Record<string, unknown>>;
        };
        const assetById = new Map<number, string>();
        for (const a of assetsRes.asset ?? assetsRes.assets ?? []) {
          const id = asNumber(a.assetId);
          const name =
            typeof a.name === "string"
              ? a.name
              : typeof a.displayName === "string"
                ? a.displayName
                : null;
          if (id != null && name) assetById.set(id, name);
        }

        const symbolsRes = (await connection.sendCommand(
          "ProtoOASymbolsListReq",
          {
            ctidTraderAccountId: Number(args.ctidTraderAccountId)
          }
        )) as { symbol?: unknown[]; symbols?: unknown[] };
        const rawList = (symbolsRes.symbol ??
          symbolsRes.symbols ??
          []) as Array<Record<string, unknown>>;
        const mapped: RawCTraderSymbol[] = rawList.map((s) => {
          const baseId = asNumber(s.baseAssetId);
          const quoteId = asNumber(s.quoteAssetId);
          return {
            symbolId: s.symbolId as number | string | undefined,
            symbolName: String(s.symbolName ?? s.name ?? ""),
            description: String(s.description ?? ""),
            baseAsset:
              s.baseAsset != null
                ? String(s.baseAsset)
                : baseId != null
                  ? assetById.get(baseId)
                  : undefined,
            quoteAsset:
              s.quoteAsset != null
                ? String(s.quoteAsset)
                : quoteId != null
                  ? assetById.get(quoteId)
                  : undefined
          };
        });

        const candidate = pickXauUsdCandidate(mapped);
        if (!candidate?.symbolId) return null;

        const detailRes = (await connection.sendCommand(
          "ProtoOASymbolByIdReq",
          {
            ctidTraderAccountId: Number(args.ctidTraderAccountId),
            symbolId: [Number(candidate.symbolId)]
          }
        )) as { symbol?: Array<Record<string, unknown>> | Record<string, unknown> };
        const detailList = Array.isArray(detailRes.symbol)
          ? detailRes.symbol
          : detailRes.symbol
            ? [detailRes.symbol]
            : [];
        const detail = detailList[0] ?? {};
        const digits = asNumber(detail.digits);
        const enriched: RawCTraderSymbol = {
          symbolId: candidate.symbolId,
          symbolName: candidate.symbolName,
          description: candidate.description,
          baseAsset: candidate.baseAsset ?? "XAU",
          quoteAsset: candidate.quoteAsset ?? "USD",
          digits: digits ?? undefined,
          pipPosition: asNumber(detail.pipPosition) ?? undefined,
          tickSize: digits != null ? Math.pow(10, -digits) : undefined,
          minVolume: volumeFromCents(detail.minVolume) ?? undefined,
          stepVolume: volumeFromCents(detail.stepVolume) ?? undefined,
          maxVolume: volumeFromCents(detail.maxVolume) ?? undefined,
          lotSize: volumeFromCents(detail.lotSize) ?? undefined,
          minStopDistance:
            asNumber(detail.slDistance) ??
            asNumber(detail.minStopDistance) ??
            undefined,
          commissionType:
            typeof detail.commissionType === "string"
              ? detail.commissionType
              : undefined,
          commission: asNumber(detail.commission) ?? undefined,
          minCommission: asNumber(detail.minCommission) ?? undefined,
          swapLong: asNumber(detail.swapLong) ?? undefined,
          swapShort: asNumber(detail.swapShort) ?? undefined,
          guaranteedStopAvailable:
            typeof detail.guaranteedStopLoss === "boolean"
              ? detail.guaranteedStopLoss
              : undefined,
          scheduleId:
            typeof detail.scheduleTimeZone === "string"
              ? detail.scheduleTimeZone
              : detail.schedule != null
                ? "schedule"
                : undefined
        };

        const resolved = resolveXauUsdFromCatalogue([enriched]);
        if (!resolved) return null;
        const tz =
          typeof detail.scheduleTimeZone === "string"
            ? detail.scheduleTimeZone
            : null;
        return {
          ...resolved,
          tradingScheduleId: tz ?? resolved.tradingScheduleId
        } satisfies BrokerSymbol;
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

        let marketStatus: BrokerQuote["marketStatus"] = "UNKNOWN";
        try {
          const detailRes = (await connection.sendCommand(
            "ProtoOASymbolByIdReq",
            {
              ctidTraderAccountId: Number(args.ctidTraderAccountId),
              symbolId: [Number(args.symbolId)]
            }
          )) as { symbol?: Array<Record<string, unknown>> | Record<string, unknown> };
          const detailList = Array.isArray(detailRes.symbol)
            ? detailRes.symbol
            : detailRes.symbol
              ? [detailRes.symbol]
              : [];
          const detail = detailList[0] ?? {};
          marketStatus = marketStatusFromSchedule({
            schedule: parseScheduleIntervals(detail.schedule),
            timeZone:
              typeof detail.scheduleTimeZone === "string"
                ? detail.scheduleTimeZone
                : "UTC"
          });
        } catch {
          marketStatus = "UNKNOWN";
        }

        const spotPromise = new Promise<Record<string, unknown>>(
          (resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error("CTRADER_QUOTE_TIMEOUT")),
              SPOT_EVENT_TIMEOUT_MS
            );
            connection.on("ProtoOASpotEvent", (event: { descriptor?: Record<string, unknown> }) => {
              const descriptor = event?.descriptor ?? {};
              if (
                asNumber(descriptor.symbolId) != null &&
                asNumber(descriptor.symbolId) !== Number(args.symbolId)
              ) {
                return;
              }
              clearTimeout(timer);
              resolve(descriptor);
            });
          }
        );

        await connection.sendCommand("ProtoOASubscribeSpotsReq", {
          ctidTraderAccountId: Number(args.ctidTraderAccountId),
          symbolId: [Number(args.symbolId)],
          subscribeToSpotTimestamp: true
        });

        const spot = await spotPromise;
        const bid = spotPriceFromRelative(spot.bid);
        const ask = spotPriceFromRelative(spot.ask);
        if (bid == null || ask == null || !(ask >= bid)) {
          throw new Error("CTRADER_QUOTE_UNAVAILABLE");
        }
        const spread = Number((ask - bid).toFixed(6));
        const tsMs = asNumber(spot.timestamp);
        const timestamp = tsMs
          ? new Date(tsMs).toISOString()
          : new Date().toISOString();
        return {
          symbolId: args.symbolId,
          symbolName: "XAUUSD",
          bid,
          ask,
          spread,
          timestamp,
          marketStatus,
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
