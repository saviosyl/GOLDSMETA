/**
 * Read-only DEMO account summary via ProtoOATraderReq (VIEW).
 * Never exposes internal account ID. No order/trading messages.
 */
import { asFiniteNumber } from "../marketData/microCTraderProtocol";
import type { MicroOpenApiTransport } from "../marketData/microCTraderTransport";

export type MicroTraderAccountSummary = {
  balance: number;
  depositCurrency: string | null;
  moneyDigits: number;
  /** Always true when parsed successfully. */
  available: true;
  /** Never include raw ctidTraderAccountId in API responses. */
  accountIdExposed: false;
};

/**
 * Fetch trader balance using an already-authenticated Micro transport.
 * Caller must ensure VIEW scope / DEMO. This function only sends TraderReq.
 */
export async function fetchMicroTraderAccountSummary(
  transport: MicroOpenApiTransport,
  ctidTraderAccountId: string | number
): Promise<MicroTraderAccountSummary | null> {
  const res = (await transport.sendReadCommand("ProtoOATraderReq", {
    ctidTraderAccountId: Number(ctidTraderAccountId)
  })) as {
    trader?: {
      balance?: unknown;
      moneyDigits?: unknown;
      depositCurrency?: unknown;
      depositAsset?: { name?: unknown; displayName?: unknown };
    };
  };
  const trader = res.trader;
  if (!trader) return null;
  const digits = asFiniteNumber(trader.moneyDigits) ?? 2;
  const rawBal = asFiniteNumber(trader.balance);
  if (rawBal == null) return null;
  const balance = rawBal / Math.pow(10, digits);
  const currency =
    typeof trader.depositCurrency === "string"
      ? trader.depositCurrency
      : typeof trader.depositAsset?.name === "string"
        ? trader.depositAsset.name
        : null;
  return {
    balance,
    depositCurrency: currency,
    moneyDigits: digits,
    available: true,
    accountIdExposed: false
  };
}
