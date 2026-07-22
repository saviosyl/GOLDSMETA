/**
 * Stocks Intraday AutoTrade runtime wiring.
 * Tests / explicit local memory: InMemoryStockIntradayStore.
 * Market data: Alpaca IEX when credentials present; mock in tests; never silent mock for SHADOW alpaca.
 */

import { env } from "../../config/env";
import { getFirestoreDb } from "../firebaseAdmin";
import { FakeT212BrokerAdapter } from "./broker/fakeT212BrokerAdapter";
import { T212HttpBrokerAdapter, loadT212CredentialsFromServerEnv } from "./broker/t212HttpAdapter";
import type { T212BrokerAdapter } from "./broker/t212BrokerAdapter";
import { MockMarketDataProvider } from "./marketData/mockMarketDataProvider";
import {
  UnconfiguredMarketDataProvider,
  type MarketDataProvider
} from "./marketData/marketDataProvider";
import { AlpacaMarketDataProvider } from "./marketData/alpacaMarketDataProvider";
import { loadAlpacaMarketDataConfig } from "./marketData/alpacaConfig";
import { InMemoryStockIntradayStore } from "./inMemoryStockIntradayStore";
import { FirestoreStockIntradayStore } from "./firestoreStockIntradayStore";
import type { StockIntradayStorePort } from "./stockIntradayStore";
import { StockIntradayService } from "./stockIntradayService";
import { logger } from "../logging/logger";

export function createStockIntradayMarketData(): MarketDataProvider {
  // Explicit mock only — never a silent fallback when Alpaca is requested.
  if (process.env.STOCK_INTRADAY_MARKET_DATA === "mock") {
    return new MockMarketDataProvider();
  }

  const preferAlpaca =
    process.env.STOCK_INTRADAY_MARKET_DATA === "alpaca" ||
    process.env.STOCK_INTRADAY_MARKET_DATA === "alpaca-iex" ||
    Boolean(process.env.ALPACA_MARKET_DATA_API_KEY?.trim());

  if (preferAlpaca) {
    const config = loadAlpacaMarketDataConfig();
    if (!config) {
      throw new Error(
        "ALPACA_CREDENTIALS_REQUIRED: set ALPACA_MARKET_DATA_API_KEY and ALPACA_MARKET_DATA_API_SECRET"
      );
    }
    return new AlpacaMarketDataProvider(config);
  }

  if (env.APP_ENV === "test") {
    return new MockMarketDataProvider();
  }

  return new UnconfiguredMarketDataProvider();
}

/**
 * Resolve the stock intraday store.
 * - test OR STORAGE_BACKEND=memory (non-production): in-memory
 * - otherwise: Firestore required; throw if Admin SDK unavailable
 */
export function createStockIntradayStore(): StockIntradayStorePort {
  const allowMemory =
    env.APP_ENV === "test" ||
    (env.STORAGE_BACKEND === "memory" && env.APP_ENV !== "production");

  if (allowMemory) {
    if (env.APP_ENV === "production") {
      throw new Error("InMemoryStockIntradayStore is not allowed when APP_ENV=production");
    }
    return new InMemoryStockIntradayStore();
  }

  const firestore = getFirestoreDb();
  if (!firestore) {
    throw new Error(
      "FirestoreStockIntradayStore required; Firestore Admin unavailable. " +
        "Set STORAGE_BACKEND=memory only for explicit local development/test."
    );
  }
  return new FirestoreStockIntradayStore(firestore);
}

export function createT212AdapterFactory(): () => T212BrokerAdapter {
  return () => {
    if (env.APP_ENV === "test" || process.env.STOCK_INTRADAY_BROKER === "fake") {
      return new FakeT212BrokerAdapter({ environment: "PAPER" });
    }
    const creds = loadT212CredentialsFromServerEnv("PAPER");
    if (!creds) {
      throw new Error("T212_CREDENTIALS_NOT_CONFIGURED");
    }
    return new T212HttpBrokerAdapter({
      environment: "PAPER",
      dryRun: false
    });
  };
}

export function createStockIntradayService(options?: {
  store?: StockIntradayStorePort;
  marketData?: MarketDataProvider;
  adapterFactory?: () => T212BrokerAdapter;
}): StockIntradayService {
  const store = options?.store ?? createStockIntradayStore();
  const marketData = options?.marketData ?? createStockIntradayMarketData();
  const adapterFactory = options?.adapterFactory ?? createT212AdapterFactory();
  logger.info("Stock Intraday AutoTrade runtime configured", {
    marketData: marketData.capabilities.providerId,
    feed: marketData.capabilities.feedId ?? null,
    dataLabel: marketData.capabilities.dataLabel ?? null,
    store: store.constructor.name,
    paperOrders: false,
    liveOrders: false
  });
  return new StockIntradayService(store, marketData, adapterFactory);
}
