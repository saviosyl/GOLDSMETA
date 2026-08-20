/**
 * Compact system health for Plan / AutoTrade dashboards.
 */

import { getConnection } from "./connectionStore";
import { getUserAutoTradeSettings } from "./userAutoTradeSettings";
import { loadNewsProviderKind } from "./newsGuard";

export type HealthTone = "green" | "amber" | "red";

export type SystemHealthView = {
  marketFeed: { tone: HealthTone; label: string };
  strategyFeed: { tone: HealthTone; label: string };
  broker: { tone: HealthTone; label: string };
  autoTradeEngine: { tone: HealthTone; label: string };
  riskEngine: { tone: HealthTone; label: string };
  notifications: { tone: HealthTone; label: string };
  qualificationWorker: { tone: HealthTone; label: string };
  overall: HealthTone;
  plainSummary: string;
};

export async function buildSystemHealth(args: {
  uid: string;
  marketFeedOk?: boolean | null;
  marketFeedLabel?: string | null;
  strategyFeedOk?: boolean | null;
}): Promise<SystemHealthView> {
  const connection = await getConnection(args.uid);
  const settings = await getUserAutoTradeSettings(args.uid, "demo");

  const tokenOk =
    connection?.tokens?.accessExpiresAt != null &&
    Date.parse(connection.tokens.accessExpiresAt) > Date.now() + 30_000;

  const broker: SystemHealthView["broker"] = !connection
    ? { tone: "red", label: "Broker not connected" }
    : settings.emergencyStopActive
      ? { tone: "red", label: "Emergency Stop active" }
      : !tokenOk
        ? { tone: "amber", label: "Broker reconnecting" }
        : { tone: "green", label: "Broker connected" };

  const marketFeed: SystemHealthView["marketFeed"] =
    args.marketFeedOk === false
      ? { tone: "red", label: args.marketFeedLabel || "Market data issue" }
      : args.marketFeedOk === true
        ? { tone: "green", label: "Market feed OK" }
        : { tone: "amber", label: "Market feed status pending" };

  const strategyFeed: SystemHealthView["strategyFeed"] =
    args.strategyFeedOk === false
      ? { tone: "red", label: "Strategy feed issue" }
      : args.strategyFeedOk === true
        ? { tone: "green", label: "Strategy feed OK" }
        : { tone: "amber", label: "Strategy feed status pending" };

  const autoTradeEngine: SystemHealthView["autoTradeEngine"] = settings.emergencyStopActive
    ? { tone: "red", label: "Broker emergency stop active" }
    : {
        tone: "green",
        label: "Gold Hunter is the only AutoTrade engine"
      };

  const riskEngine: SystemHealthView["riskEngine"] =
    settings.maxDailyLoss > 0 && settings.maxTradesPerDay > 0
      ? { tone: "green", label: "Risk engine ready" }
      : { tone: "red", label: "Risk settings incomplete" };

  const notifications: SystemHealthView["notifications"] = {
    tone: "green",
    label: "Notifications available"
  };

  const qualificationWorker: SystemHealthView["qualificationWorker"] = {
    tone: "green",
    label: "Core qualification retired"
  };

  const tones = [
    marketFeed.tone,
    strategyFeed.tone,
    broker.tone,
    autoTradeEngine.tone,
    riskEngine.tone,
    notifications.tone,
    qualificationWorker.tone
  ];
  const overall: HealthTone = tones.includes("red")
    ? "red"
    : tones.includes("amber")
      ? "amber"
      : "green";

  let plainSummary = "All systems healthy";
  if (broker.tone === "red") plainSummary = broker.label;
  else if (settings.emergencyStopActive) plainSummary = "Emergency Stop — AutoTrade paused for safety";
  else if (broker.tone === "amber") plainSummary = "Broker reconnecting — AutoTrade paused for safety";
  else if (marketFeed.tone === "red") plainSummary = marketFeed.label;
  else if (overall === "amber") plainSummary = "Some systems need attention";

  void loadNewsProviderKind;
  return {
    marketFeed,
    strategyFeed,
    broker,
    autoTradeEngine,
    riskEngine,
    notifications,
    qualificationWorker,
    overall,
    plainSummary
  };
}
