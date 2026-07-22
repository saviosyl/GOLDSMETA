/**
 * Stocks Intraday AutoTrade runtime wiring.
 * Tests use FakeT212 + MockMarketData. Real modes fail closed without secrets/provider.
 */

import { env } from "../../config/env";
import { FakeT212BrokerAdapter } from "./broker/fakeT212BrokerAdapter";
import { T212HttpBrokerAdapter, loadT212CredentialsFromServerEnv } from "./broker/t212HttpAdapter";
import type { T212BrokerAdapter } from "./broker/t212BrokerAdapter";
import { MockMarketDataProvider } from "./marketData/mockMarketDataProvider";
import {
  UnconfiguredMarketDataProvider,
  type MarketDataProvider
} from "./marketData/marketDataProvider";
import { InMemoryStockIntradayStore, type StockIntradayStorePort } from "./stockIntradayStore";
import { StockIntradayService } from "./stockIntradayService";
import { logger } from "../logging/logger";

export function createStockIntradayMarketData(): MarketDataProvider {
  if (env.APP_ENV === "test" || process.env.STOCK_INTRADAY_MARKET_DATA === "mock") {
    return new MockMarketDataProvider();
  }
  return new UnconfiguredMarketDataProvider();
}

export function createStockIntradayStore(): StockIntradayStorePort {
  // First delivery: in-memory for local/test; Firestore port can replace without API change.
  return new InMemoryStockIntradayStore();
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
    paperOrders: false,
    liveOrders: false
  });
  return new StockIntradayService(store, marketData, adapterFactory);
}
