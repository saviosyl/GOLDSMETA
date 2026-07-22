/**
 * Spot Gold / XAUUSD market candidate from IG search (read-only discovery).
 */

export interface IgGoldMarketCandidate {
  epic: string;
  instrumentName: string;
  instrumentType: string | null;
  expiry: string | null;
  marketStatus: "OPEN" | "CLOSED" | "TRADEABLE" | "UNKNOWN";
  currencyCode: string | null;
  bid: number | null;
  offer: number | null;
  /** Ranking hint only — never auto-selected when multiple remain. */
  proposedPrimary: boolean;
  reason: string;
}

export interface IgMarketRulesDetails {
  epic: string;
  instrumentName: string;
  instrumentType: string | null;
  expiry: string | null;
  marketStatus: "OPEN" | "CLOSED" | "TRADEABLE" | "UNKNOWN";
  currencyCode: string;
  bid: number;
  offer: number;
  spread: number;
  minDealSize: number;
  dealSizeIncrement: number;
  valueOfOnePip: number;
  minNormalStopDistance: number | null;
  minGuaranteedStopDistance: number | null;
  guaranteedStopAvailable: boolean;
  marginRequirement: number | null;
  scalingFactor: number;
  updateTime: string;
  high: number | null;
  low: number | null;
}

export interface IgDemoDiagnosticReport {
  ok: boolean;
  environment: "DEMO";
  readOnly: true;
  ordersEnabled: false;
  liveExecutionEnabled: false;
  connected: boolean;
  accountIdMasked: string | null;
  accountName: string | null;
  currency: string | null;
  balance: number | null;
  available: number | null;
  marginUsed: number | null;
  accountMatch: "matched" | "mismatch" | "unconfigured" | "unknown";
  configuredAccountIdMasked: string | null;
  goldCandidates: IgGoldMarketCandidate[];
  proposedEpic: string | null;
  selectionRequired: boolean;
  selectedMarket: IgMarketRulesDetails | null;
  openPositionsCount: number;
  openPositions: Array<{
    dealIdMasked: string;
    direction: "BUY" | "SELL";
    size: number;
    epic: string;
    instrumentName: string;
    level: number;
    stopLevel: number | null;
    limitLevel: number | null;
    guaranteedStop: boolean;
    upl: number | null;
  }>;
  sessionRenewal: "ok" | "failed" | "skipped";
  heartbeatAt: string | null;
  dealingEndpointsCalled: false;
  errors: string[];
  notes: string[];
}
