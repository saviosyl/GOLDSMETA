/**
 * Runtime AutoTrade broker + store wiring.
 * Fake adapter is for TEST/LOCAL only. Production DEMO uses IgBrokerAdapter.
 * LIVE remains blocked.
 */

import { hostname } from "os";
import { randomUUID } from "crypto";
import { env } from "../../config/env";
import { getFirestoreDb } from "../firebaseAdmin";
import type { AutoTradeBrokerAdapter } from "./brokerAdapter";
import { FakeIgBrokerAdapter } from "./fakeIgBrokerAdapter";
import { IgBrokerAdapter, loadIgCredentialsFromServerEnv } from "./igBrokerAdapter";
import { AutoTradeService } from "./autoTradeService";
import type { AutoTradeStorePort } from "./autoTradeStore";
import { FirestoreAutoTradeStore } from "./firestoreAutoTradeStore";
import { InMemoryAutoTradeStore } from "./inMemoryAutoTradeStore";
import { LIVE_EXECUTION_FEATURE_FLAG, type BrokerEnvironment } from "./types";
import { logger } from "../logging/logger";

export type AutoTradeBrokerMode = "fake" | "ig_demo";

export function resolveAutoTradeBrokerMode(
  source: NodeJS.ProcessEnv = process.env
): AutoTradeBrokerMode {
  const explicit = (source.AUTOTRADE_BROKER ?? "").trim().toLowerCase();
  if (explicit === "fake" || explicit === "ig_demo") return explicit;

  if (env.APP_ENV === "test" || env.STORAGE_BACKEND === "memory") {
    return "fake";
  }

  // Fail closed to fake only outside production/firestore; production requires explicit config.
  if (env.APP_ENV === "production" || env.STORAGE_BACKEND === "firestore") {
    if (loadIgCredentialsFromServerEnv("DEMO")) {
      return "ig_demo";
    }
    // No DEMO secrets → do not silently pretend Fake is production broker.
    // Service still starts; connect DEMO will fail closed until secrets exist.
    return "ig_demo";
  }

  return "fake";
}

export function createAutoTradeStore(): AutoTradeStorePort {
  if (env.APP_ENV === "test" || env.STORAGE_BACKEND === "memory") {
    return new InMemoryAutoTradeStore();
  }
  const db = getFirestoreDb();
  if (!db) {
    if (env.APP_ENV === "production") {
      throw new Error("Firestore Admin is required for AutoTrade when APP_ENV=production");
    }
    logger.warn("Firestore unavailable for AutoTrade; using in-memory store (non-production only)");
    return new InMemoryAutoTradeStore();
  }
  return new FirestoreAutoTradeStore(db);
}

export function createBrokerAdapterFactory(
  mode: AutoTradeBrokerMode = resolveAutoTradeBrokerMode()
): (environment: BrokerEnvironment) => AutoTradeBrokerAdapter {
  return (environment: BrokerEnvironment) => {
    if (environment === "LIVE") {
      if (!LIVE_EXECUTION_FEATURE_FLAG) {
        throw new Error("LIVE_EXECUTION_FEATURE_DISABLED");
      }
      throw new Error("LIVE_ADAPTER_BLOCKED");
    }

    if (mode === "fake") {
      return new FakeIgBrokerAdapter({ environment: "DEMO" });
    }

    // ig_demo — require server secrets; fail closed
    const creds = loadIgCredentialsFromServerEnv("DEMO");
    if (!creds) {
      throw new Error("IG_DEMO_CREDENTIALS_NOT_CONFIGURED");
    }
    return new IgBrokerAdapter({
      environment: "DEMO",
      dryRun: false
    });
  };
}

export function createAutoTradeService(options?: {
  store?: AutoTradeStorePort;
  brokerMode?: AutoTradeBrokerMode;
  ownerId?: string;
}): AutoTradeService {
  const store = options?.store ?? createAutoTradeStore();
  const mode = options?.brokerMode ?? resolveAutoTradeBrokerMode();
  const ownerId =
    options?.ownerId ?? `fn-${hostname().slice(0, 24)}-${randomUUID().slice(0, 8)}`;
  logger.info("AutoTrade runtime configured", {
    brokerMode: mode,
    store: store.constructor.name,
    ownerId,
    liveFlag: LIVE_EXECUTION_FEATURE_FLAG
  });
  return new AutoTradeService(store, createBrokerAdapterFactory(mode), { ownerId });
}
