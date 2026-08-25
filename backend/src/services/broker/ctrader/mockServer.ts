/**
 * Local cTrader protocol simulator for tests/development ONLY.
 * Never expose in production. Never call real brokers.
 *
 * TEST FIXTURE — NOT LIVE BROKER DATA
 */

import { fixtureDemoAccount, fixtureQuote, fixtureXauUsdSymbol, TEST_FIXTURE_LABEL } from "./fixtures";
import type { BrokerAccount, BrokerQuote, BrokerSymbol } from "../domain";

export type MockScenario =
  | "oauth_success"
  | "oauth_failure"
  | "token_expired"
  | "demo_accounts"
  | "live_account_rejected"
  | "market_open"
  | "market_closed"
  | "spread_wide"
  | "partial_fill"
  | "reject_order"
  | "timeout_then_fill"
  | "disconnect";

export interface CTraderMockServer {
  label: typeof TEST_FIXTURE_LABEL;
  scenario: MockScenario;
  setScenario(s: MockScenario): void;
  authorize(state: string): { ok: boolean; code?: string; error?: string };
  listAccounts(): BrokerAccount[];
  getSymbol(): BrokerSymbol;
  getQuote(): BrokerQuote;
  /** Mutation simulation — for tests only; never wired to production routes */
  simulateSubmit(orderId: string): {
    status: "ACCEPTED" | "REJECTED" | "UNKNOWN" | "PARTIAL";
    note: string;
  };
}

export function createCTraderMockServer(
  initial: MockScenario = "demo_accounts"
): CTraderMockServer {
  let scenario = initial;
  return {
    label: TEST_FIXTURE_LABEL,
    get scenario() {
      return scenario;
    },
    setScenario(s) {
      scenario = s;
    },
    authorize(state: string) {
      if (!state) return { ok: false, error: "OAUTH_STATE_MISSING" };
      if (scenario === "oauth_failure") return { ok: false, error: "OAUTH_DENIED" };
      return { ok: true, code: "mock-auth-code" };
    },
    listAccounts() {
      if (scenario === "live_account_rejected") {
        return [];
      }
      return [fixtureDemoAccount()];
    },
    getSymbol() {
      return fixtureXauUsdSymbol();
    },
    getQuote() {
      if (scenario === "market_closed") return fixtureQuote("CLOSED");
      if (scenario === "spread_wide") {
        const q = fixtureQuote("OPEN");
        return { ...q, ask: (q.bid ?? 0) + 5, spread: 5 };
      }
      return fixtureQuote("OPEN");
    },
    simulateSubmit(orderId: string) {
      if (scenario === "reject_order") {
        return { status: "REJECTED", note: `mock reject ${orderId}` };
      }
      if (scenario === "partial_fill") {
        return { status: "PARTIAL", note: `mock partial ${orderId}` };
      }
      if (scenario === "timeout_then_fill") {
        return { status: "UNKNOWN", note: `mock timeout ${orderId}` };
      }
      return { status: "ACCEPTED", note: `mock accept ${orderId}` };
    }
  };
}
