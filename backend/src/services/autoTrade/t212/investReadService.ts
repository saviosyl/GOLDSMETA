/**
 * Trading 212 General Invest — owner-only read-only + isolated paper surface.
 * No real order submission. No CFD. No XAUUSD broker routing.
 */

import { getFirestoreDb } from "../../firebaseAdmin";
import {
  BROKER_EXECUTION_ENABLED,
  T212_LIVE_EXECUTION_FEATURE_FLAG,
  T212_PAPER_ORDER_SUBMISSION_ENABLED
} from "../types";
import {
  loadT212CredentialsFromServerEnv,
  resolveT212InvestReadEnvironment,
  T212InvestClient,
  T212_ORDER_CREATE_PATHS,
  type T212InstrumentResponse,
  type T212PositionResponse
} from "./client";
import {
  createT212InvestPaperPortfolio,
  T212_PAPER_DISCLAIMER,
  type T212InvestPaperPortfolio
} from "./investPaperPortfolio";
import { buildT212StockPreview, type T212StockPreviewInput } from "./investPreview";
import { loadOwnerAuthConfig } from "../../auth/ownerAuthConfig";

/** Explicit aliases requested by ops — always false. */
export const T212_ORDER_SUBMISSION_ENABLED = false;
export const T212_LIVE_ORDER_SUBMISSION_ENABLED = false;

const CFD_OR_LEVERAGE_RE =
  /\b(cfd|spread\s*bet|leveraged|short\s*sell|xau|gold\s*cfd|pepperstone|ctrader|sipp)\b/i;
const XAU_RE = /\bxau|xauusd|gold\s*spot\b/i;

const recentSignalKeys = new Map<string, number>();

export function assertT212InvestReadOnlyFlags(): void {
  if (
    T212_ORDER_SUBMISSION_ENABLED ||
    T212_LIVE_ORDER_SUBMISSION_ENABLED ||
    T212_PAPER_ORDER_SUBMISSION_ENABLED ||
    T212_LIVE_EXECUTION_FEATURE_FLAG ||
    BROKER_EXECUTION_ENABLED
  ) {
    throw new Error("T212_INVEST_ORDER_FLAGS_MUST_REMAIN_FALSE");
  }
}

export function isOwnerOnlyUid(uid: string, source: NodeJS.ProcessEnv = process.env): boolean {
  const pinned = loadOwnerAuthConfig(source).pinnedOwnerUid;
  return Boolean(pinned && uid === pinned);
}

export type T212WatchlistItem = {
  ticker: string;
  name: string;
  currency: string | null;
  exchange: string | null;
  addedAt: string;
};

export type T212InvestPortfolioView = {
  accountType: "GENERAL_INVEST";
  environment: "PRACTICE" | "LIVE_READ_ONLY";
  accountIdMasked: string | null;
  currency: string | null;
  availableCash: number | null;
  investedValue: number | null;
  portfolioValue: number | null;
  unrealisedPnl: number | null;
  realisedPnl: number | null;
  dividends: null;
  positions: Array<{
    ticker: string;
    name: string | null;
    quantity: number | null;
    averagePrice: number | null;
    currentPrice: number | null;
    currency: string | null;
    unrealisedPnl: number | null;
  }>;
  historicalOrders: unknown[];
  lastSyncAt: string;
  connectionStatus: "CONNECTED" | "CREDENTIALS_MISSING" | "ERROR";
  stale: boolean;
  ordersEnabled: false;
  autoTrade: "OFF";
  paperOnly: true;
  disclaimer: string;
};

function maskAccountId(id: string | number | null | undefined): string | null {
  if (id == null) return null;
  const s = String(id);
  if (s.length < 6) return `${s.slice(0, 1)}…`;
  return `${s.slice(0, 2)}…${s.slice(-2)}`;
}

export function classifyInvestInstrument(instrument: T212InstrumentResponse): {
  allowed: boolean;
  reason?: string;
} {
  const blob = `${instrument.ticker ?? ""} ${instrument.name ?? ""} ${instrument.type ?? ""} ${instrument.shortName ?? ""}`;
  if (XAU_RE.test(blob)) return { allowed: false, reason: "XAUUSD_NOT_SUPPORTED" };
  if (CFD_OR_LEVERAGE_RE.test(blob)) return { allowed: false, reason: "CFD_OR_LEVERAGE_REJECTED" };
  const type = (instrument.type ?? "").toUpperCase();
  if (type.includes("CFD") || type.includes("LEVERAGE") || type.includes("SIPP")) {
    return { allowed: false, reason: "CFD_OR_LEVERAGE_REJECTED" };
  }
  return { allowed: true };
}

export function createT212InvestReadService(opts?: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** In-memory watchlist (tests / when Firestore unavailable). */
  watchlistStore?: Map<string, T212WatchlistItem[]>;
}) {
  const source = opts?.env ?? process.env;
  assertT212InvestReadOnlyFlags();

  const paperByUser = new Map<string, T212InvestPaperPortfolio>();
  const memoryWatchlists = opts?.watchlistStore ?? new Map<string, T212WatchlistItem[]>();

  function getPaper(uid: string) {
    let p = paperByUser.get(uid);
    if (!p) {
      p = createT212InvestPaperPortfolio();
      paperByUser.set(uid, p);
    }
    return p;
  }

  function clientOrNull(): T212InvestClient | null {
    const environment = resolveT212InvestReadEnvironment(source);
    const creds = loadT212CredentialsFromServerEnv(environment, source);
    if (!creds) return null;
    return new T212InvestClient(environment, creds, { fetchImpl: opts?.fetchImpl });
  }

  async function readWatchlist(uid: string): Promise<T212WatchlistItem[]> {
    const mem = memoryWatchlists.get(uid);
    if (mem) return [...mem];
    const db = getFirestoreDb();
    if (!db) return [];
    try {
      const snap = await db.doc(`users/${uid}/t212Invest/watchlist`).get();
      const items = (snap.data()?.items as T212WatchlistItem[] | undefined) ?? [];
      memoryWatchlists.set(uid, items);
      return [...items];
    } catch {
      return [];
    }
  }

  async function writeWatchlist(uid: string, items: T212WatchlistItem[]): Promise<void> {
    memoryWatchlists.set(uid, items);
    const db = getFirestoreDb();
    if (!db) return;
    try {
      await db
        .doc(`users/${uid}/t212Invest/watchlist`)
        .set({ items, updatedAt: new Date().toISOString() }, { merge: true });
    } catch {
      // Memory remains source of truth for this process when Firestore write fails.
    }
  }

  return {
    flags() {
      return {
        T212_ORDER_SUBMISSION_ENABLED,
        T212_LIVE_ORDER_SUBMISSION_ENABLED,
        T212_PAPER_ORDER_SUBMISSION_ENABLED,
        T212_LIVE_EXECUTION_FEATURE_FLAG,
        BROKER_EXECUTION_ENABLED,
        AutoTrade: "OFF" as const,
        accountType: "GENERAL_INVEST" as const,
        paperOnly: true as const,
        ordersEnabled: false as const,
        cfdSupported: false as const,
        xauusdSupported: false as const
      };
    },

    blockedOrderPaths(): readonly string[] {
      return T212_ORDER_CREATE_PATHS;
    },

    async getPortfolio(uid: string): Promise<T212InvestPortfolioView> {
      assertT212InvestReadOnlyFlags();
      void uid;
      const environment = resolveT212InvestReadEnvironment(source);
      const client = clientOrNull();
      const disclaimer =
        "Trading 212 General Invest read-only. Paper preview only — no Trading 212 order will be submitted. AutoTrade remains OFF.";
      const envLabel = environment === "LIVE" ? "LIVE_READ_ONLY" : "PRACTICE";
      if (!client) {
        return {
          accountType: "GENERAL_INVEST",
          environment: envLabel,
          accountIdMasked: null,
          currency: null,
          availableCash: null,
          investedValue: null,
          portfolioValue: null,
          unrealisedPnl: null,
          realisedPnl: null,
          dividends: null,
          positions: [],
          historicalOrders: [],
          lastSyncAt: new Date().toISOString(),
          connectionStatus: "CREDENTIALS_MISSING",
          stale: true,
          ordersEnabled: false,
          autoTrade: "OFF",
          paperOnly: true,
          disclaimer
        };
      }
      try {
        const [summary, positions, historicalOrders] = await Promise.all([
          client.getAccountSummary(),
          client.getPositions(),
          client.getHistoricalOrders().catch(() => [])
        ]);
        const list = Array.isArray(positions) ? positions : [];
        return {
          accountType: "GENERAL_INVEST",
          environment: envLabel,
          accountIdMasked: maskAccountId(summary.id),
          currency: summary.currency ?? null,
          availableCash: summary.cash?.availableToTrade ?? null,
          investedValue: summary.investments?.currentValue ?? null,
          portfolioValue: summary.totalValue ?? null,
          unrealisedPnl: summary.investments?.unrealizedProfitLoss ?? null,
          realisedPnl: summary.investments?.realizedProfitLoss ?? null,
          dividends: null,
          positions: list.map((p: T212PositionResponse) => ({
            ticker: p.ticker ?? p.instrument?.ticker ?? "UNKNOWN",
            name: p.instrument?.name ?? null,
            quantity: p.quantity ?? null,
            averagePrice: p.averagePricePaid ?? p.averagePrice ?? null,
            currentPrice: p.currentPrice ?? null,
            currency: p.currency ?? p.instrument?.currency ?? null,
            unrealisedPnl: null
          })),
          historicalOrders: Array.isArray(historicalOrders) ? historicalOrders.slice(0, 20) : [],
          lastSyncAt: new Date().toISOString(),
          connectionStatus: "CONNECTED",
          stale: false,
          ordersEnabled: false,
          autoTrade: "OFF",
          paperOnly: true,
          disclaimer
        };
      } catch {
        return {
          accountType: "GENERAL_INVEST",
          environment: envLabel,
          accountIdMasked: null,
          currency: null,
          availableCash: null,
          investedValue: null,
          portfolioValue: null,
          unrealisedPnl: null,
          realisedPnl: null,
          dividends: null,
          positions: [],
          historicalOrders: [],
          lastSyncAt: new Date().toISOString(),
          connectionStatus: "ERROR",
          stale: true,
          ordersEnabled: false,
          autoTrade: "OFF",
          paperOnly: true,
          disclaimer
        };
      }
    },

    async searchInstruments(query: string): Promise<{
      query: string;
      candidates: Array<{
        ticker: string;
        name: string;
        currency: string | null;
        type: string | null;
        exchange: string | null;
        allowed: boolean;
        rejectReason: string | null;
        fractionalShareSupport: boolean | null;
      }>;
    }> {
      assertT212InvestReadOnlyFlags();
      const q = query.trim().toLowerCase();
      const client = clientOrNull();
      if (!client || q.length < 1) {
        return { query, candidates: [] };
      }
      const all = await client.getInstruments();
      const filtered = (Array.isArray(all) ? all : [])
        .filter((i) => {
          const blob = `${i.ticker ?? ""} ${i.name ?? ""} ${i.isin ?? ""}`.toLowerCase();
          return blob.includes(q);
        })
        .slice(0, 40)
        .map((i) => {
          const c = classifyInvestInstrument(i);
          const minQty = i.minTradeQuantity;
          return {
            ticker: i.ticker ?? "",
            name: i.name ?? i.shortName ?? i.ticker ?? "",
            currency: i.currencyCode ?? null,
            type: i.type ?? null,
            exchange: null,
            allowed: c.allowed,
            rejectReason: c.reason ?? null,
            fractionalShareSupport:
              typeof minQty === "number" ? minQty > 0 && minQty < 1 : null
          };
        })
        .filter((i) => i.ticker);
      return { query, candidates: filtered };
    },

    async getWatchlist(uid: string): Promise<T212WatchlistItem[]> {
      return readWatchlist(uid);
    },

    async addWatchlistItem(
      uid: string,
      item: Omit<T212WatchlistItem, "addedAt">
    ): Promise<T212WatchlistItem[]> {
      const classed = classifyInvestInstrument({
        ticker: item.ticker,
        name: item.name,
        currencyCode: item.currency ?? undefined
      });
      if (!classed.allowed) {
        throw Object.assign(new Error(classed.reason ?? "INSTRUMENT_REJECTED"), {
          code: classed.reason ?? "INSTRUMENT_REJECTED"
        });
      }
      const existing = await readWatchlist(uid);
      if (existing.some((e) => e.ticker === item.ticker)) return existing;
      const next: T212WatchlistItem[] = [
        ...existing,
        { ...item, addedAt: new Date().toISOString() }
      ].slice(0, 50);
      await writeWatchlist(uid, next);
      return next;
    },

    async removeWatchlistItem(uid: string, ticker: string): Promise<T212WatchlistItem[]> {
      const next = (await readWatchlist(uid)).filter((e) => e.ticker !== ticker);
      await writeWatchlist(uid, next);
      return next;
    },

    getPaperPortfolio(uid: string) {
      assertT212InvestReadOnlyFlags();
      return getPaper(uid).getState();
    },

    paperBuy(
      uid: string,
      args: {
        ticker: string;
        name?: string;
        quantity: number;
        price: number;
        currency?: string;
        signalRef?: string | null;
        priceTimestamp?: string | null;
        marketOpen?: boolean;
      }
    ) {
      assertT212InvestReadOnlyFlags();
      if (args.signalRef) {
        const key = `${uid}:${args.signalRef}`;
        const last = recentSignalKeys.get(key) ?? 0;
        if (Date.now() - last < 60_000) {
          return {
            ok: false as const,
            reason: "DUPLICATE_SIGNAL",
            paper: this.getPaperPortfolio(uid),
            disclaimer: T212_PAPER_DISCLAIMER
          };
        }
        recentSignalKeys.set(key, Date.now());
      }
      const result = getPaper(uid).buy(args);
      return {
        ok: result.ok,
        reason: result.reason,
        entry: result.entry,
        paper: this.getPaperPortfolio(uid),
        disclaimer: T212_PAPER_DISCLAIMER
      };
    },

    paperSellOwned(
      uid: string,
      args: {
        ticker: string;
        quantity: number;
        price: number;
        signalRef?: string | null;
        priceTimestamp?: string | null;
        marketOpen?: boolean;
      }
    ) {
      assertT212InvestReadOnlyFlags();
      const result = getPaper(uid).sellOwned(args);
      return {
        ok: result.ok,
        reason: result.reason,
        entry: result.entry,
        paper: this.getPaperPortfolio(uid),
        disclaimer: T212_PAPER_DISCLAIMER
      };
    },

    paperEmergencyStop(uid: string) {
      getPaper(uid).engageEmergencyStop();
      return this.getPaperPortfolio(uid);
    },

    preview(input: T212StockPreviewInput) {
      assertT212InvestReadOnlyFlags();
      return buildT212StockPreview(input);
    }
  };
}

export type T212InvestReadService = ReturnType<typeof createT212InvestReadService>;
