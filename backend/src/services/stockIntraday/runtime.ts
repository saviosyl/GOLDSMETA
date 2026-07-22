/**
 * Stocks Intraday AutoTrade runtime wiring.
 * Tests / explicit local memory: InMemoryStockIntradayStore.
 * All other environments: FirestoreStockIntradayStore (fail closed if unavailable).
 * Never silently use in-memory outside tests or explicitly selected local development.
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
import { InMemoryStockIntradayStore } from "./inMemoryStockIntradayStore";
import { FirestoreStockIntradayStore } from "./firestoreStockIntradayStore";
import type { StockIntradayStorePort } from "./stockIntradayStore";
import { StockIntradayService } from "./stockIntradayService";
import { logger } from "../logging/logger";

export function createStockIntradayMarketData(): MarketDataProvider {
  if (env.APP_ENV === "test" || process.env.STOCK_INTRADAY_MARKET_DATA === "mock") {
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
    store: store.constructor.name,
    paperOrders: false,
    liveOrders: false
  });
  return new StockIntradayService(store, marketData, adapterFactory);
}
