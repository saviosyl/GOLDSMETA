/** Frontend types for Broker Control Centre / cTrader Demo preview. */

export type BrokerOptionId =
  | "manual"
  | "trading212_invest"
  | "pepperstone_ctrader"
  | "ig";

export interface BrokerControlCentreResponse {
  defaultBroker: BrokerOptionId;
  autoTrade: "OFF";
  orderSubmissionEnabled?: false;
  brokers: Array<{
    id: BrokerOptionId;
    name: string;
    status: string;
    detail: string;
    badge: string;
  }>;
  automationModes: Array<{
    id: string;
    available: boolean;
    note?: string;
  }>;
  readiness: {
    setupRequired: boolean;
    authSetupRequired: boolean;
    oauthConfigured: boolean;
    connected: false;
    demonstrationAvailable: true;
    automationMode: string;
    autoTrade: "OFF";
    orderSubmissionEnabled: false;
    liveEnabled: false;
    wizardSteps: Array<{
      step: number;
      title: string;
      status: string;
      detail: string;
    }>;
    label: string;
    auth: {
      status: string;
      brokerSetupEnabled: boolean;
      notes: string[];
    };
    qualification: {
      unlocked: boolean;
      canActivate: false;
      failed: string[];
      progress: {
        completedPreviews: number;
        requiredPreviews: number;
        approvedControlledDemoTrades: number;
        requiredTrades: number;
        daysSinceFirstTrade: number | null;
        requiredDays: number;
      };
    };
  };
}

export interface CTraderDemonstrationBundle {
  banner: string;
  notice: string;
  autoTrade: "OFF";
  orderSubmissionEnabled: false;
  account: {
    accountIdMasked: string;
    currency: string;
    balance: number | null;
    equity: number | null;
    freeMargin: number | null;
    leverage: number | null;
    brokerName: string | null;
    brokerNameSource: string;
  };
  symbol: {
    symbolName: string;
    baseAsset: string | null;
    quoteAsset: string | null;
    minVolume: number | null;
    volumeStep: number | null;
    lotSize: number | null;
    metadataComplete: boolean;
  };
  quote: {
    bid: number | null;
    ask: number | null;
    spread: number | null;
    marketStatus: string;
    source: string;
  };
  buyPreview: {
    state: string;
    action: string;
    proposedVolume: number | null;
    riskAmount: number | null;
    failedGates: string[];
    passedGates: string[];
    label: string;
  };
  sellPreview: {
    state: string;
    action: string;
    proposedVolume: number | null;
    label: string;
  };
  blockedPreview: {
    state: string;
    failedGates: string[];
    label: string;
  };
}
