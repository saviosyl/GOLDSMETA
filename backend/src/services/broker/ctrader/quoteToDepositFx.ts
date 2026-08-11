/**
 * Quote→deposit FX resolution for Demo risk sizing.
 * Fail closed when conversion is unavailable or stale.
 * Does not hardcode EUR/USD = 1.
 */

import type { CTraderOpenApiClient } from "./openApiClient";

export const DEFAULT_FX_MAX_AGE_MS = 5 * 60 * 1000;

export type QuoteToDepositFxResult =
  | {
      ok: true;
      rate: number;
      source: string;
      quoteCurrency: string;
      depositCurrency: string;
      asOfMs: number;
    }
  | {
      ok: false;
      reason: "CURRENCY_CONVERSION_UNAVAILABLE" | "CURRENCY_CONVERSION_STALE";
      detail: string;
    };

export function normalizeCurrency(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase();
}

/** EURUSD mid (USD per 1 EUR) → EUR per 1 USD. */
export function usdToDepositFromEurUsdMid(eurUsdMid: number): number {
  if (!(eurUsdMid > 0) || !Number.isFinite(eurUsdMid)) {
    throw new Error("EURUSD_MID_INVALID");
  }
  return 1 / eurUsdMid;
}

export function assessFxQuoteFreshness(args: {
  asOfMs: number;
  nowMs: number;
  maxAgeMs: number;
}): { ok: true } | { ok: false; reason: "CURRENCY_CONVERSION_STALE"; detail: string } {
  if (!Number.isFinite(args.asOfMs) || args.asOfMs <= 0) {
    return {
      ok: false,
      reason: "CURRENCY_CONVERSION_STALE",
      detail: "FX quote timestamp missing"
    };
  }
  const age = args.nowMs - args.asOfMs;
  if (age > args.maxAgeMs) {
    return {
      ok: false,
      reason: "CURRENCY_CONVERSION_STALE",
      detail: `FX quote age ${age}ms exceeds ${args.maxAgeMs}ms`
    };
  }
  return { ok: true };
}

/**
 * Resolve quote→deposit conversion for cash-risk sizing.
 * Proven Demo path: XAUUSD (USD) → EUR deposit via live EURUSD mid inverse.
 */
export async function resolveQuoteToDepositFx(params: {
  openApiClient: CTraderOpenApiClient;
  accessToken: string;
  clientId: string;
  clientSecret: string;
  ctidTraderAccountId: string;
  quoteCurrency: string;
  depositCurrency: string;
  isLive?: boolean;
  maxAgeMs?: number;
  nowMs?: number;
}): Promise<QuoteToDepositFxResult> {
  const quoteCcy = normalizeCurrency(params.quoteCurrency);
  const depositCcy = normalizeCurrency(params.depositCurrency);
  const maxAgeMs = params.maxAgeMs ?? DEFAULT_FX_MAX_AGE_MS;
  const nowMs = params.nowMs ?? Date.now();

  if (!quoteCcy || !depositCcy) {
    return {
      ok: false,
      reason: "CURRENCY_CONVERSION_UNAVAILABLE",
      detail: "quote or deposit currency missing"
    };
  }

  if (quoteCcy === depositCcy) {
    return {
      ok: true,
      rate: 1,
      source: "same_currency",
      quoteCurrency: quoteCcy,
      depositCurrency: depositCcy,
      asOfMs: nowMs
    };
  }

  if (quoteCcy === "USD" && depositCcy === "EUR") {
    return resolveUsdToEurViaEurUsd({
      openApiClient: params.openApiClient,
      accessToken: params.accessToken,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      ctidTraderAccountId: params.ctidTraderAccountId,
      isLive: Boolean(params.isLive),
      maxAgeMs,
      nowMs
    });
  }

  return {
    ok: false,
    reason: "CURRENCY_CONVERSION_UNAVAILABLE",
    detail: `unsupported quote→deposit pair ${quoteCcy}/${depositCcy}`
  };
}

async function resolveUsdToEurViaEurUsd(params: {
  openApiClient: CTraderOpenApiClient;
  accessToken: string;
  clientId: string;
  clientSecret: string;
  ctidTraderAccountId: string;
  isLive: boolean;
  maxAgeMs: number;
  nowMs: number;
}): Promise<QuoteToDepositFxResult> {
  try {
    if (
      !params.openApiClient.findSymbolIdByName ||
      typeof params.openApiClient.findSymbolIdByName !== "function"
    ) {
      return {
        ok: false,
        reason: "CURRENCY_CONVERSION_UNAVAILABLE",
        detail: "findSymbolIdByName unavailable on Open API client"
      };
    }

    const symbolId = await params.openApiClient.findSymbolIdByName({
      accessToken: params.accessToken,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      ctidTraderAccountId: params.ctidTraderAccountId,
      symbolName: "EURUSD",
      isLive: params.isLive
    });
    if (symbolId == null || !String(symbolId).trim()) {
      return {
        ok: false,
        reason: "CURRENCY_CONVERSION_UNAVAILABLE",
        detail: "EURUSD symbol not found on broker"
      };
    }

    const quote = await params.openApiClient.fetchQuote({
      accessToken: params.accessToken,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      ctidTraderAccountId: params.ctidTraderAccountId,
      symbolId: String(symbolId),
      isLive: params.isLive
    });

    if (quote.stale) {
      return {
        ok: false,
        reason: "CURRENCY_CONVERSION_STALE",
        detail: "EURUSD quote marked stale"
      };
    }

    const bid = Number(quote.bid);
    const ask = Number(quote.ask);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
      return {
        ok: false,
        reason: "CURRENCY_CONVERSION_UNAVAILABLE",
        detail: "EURUSD bid/ask unavailable"
      };
    }

    const mid = (bid + ask) / 2;
    let usdToEur: number;
    try {
      usdToEur = usdToDepositFromEurUsdMid(mid);
    } catch {
      return {
        ok: false,
        reason: "CURRENCY_CONVERSION_UNAVAILABLE",
        detail: "EURUSD mid invalid"
      };
    }

    const asOfMs = quote.timestamp ? Date.parse(quote.timestamp) : NaN;
    const freshness = assessFxQuoteFreshness({
      asOfMs,
      nowMs: params.nowMs,
      maxAgeMs: params.maxAgeMs
    });
    if (!freshness.ok) {
      return freshness;
    }

    return {
      ok: true,
      rate: usdToEur,
      source: "broker_eurusd_mid_inverse",
      quoteCurrency: "USD",
      depositCurrency: "EUR",
      asOfMs
    };
  } catch (err) {
    return {
      ok: false,
      reason: "CURRENCY_CONVERSION_UNAVAILABLE",
      detail: err instanceof Error ? err.message : String(err)
    };
  }
}
