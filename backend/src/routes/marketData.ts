/**
 * Shared market intelligence routes (quote + candles).
 * Distinct from /v1/ctrader/* broker/account functionality.
 */
import { Router, type Request, type Response } from "express";
import { approvedAccountGate } from "../middleware/accountAccess";
import { requireAuth } from "../middleware/auth";
import {
  classifySharedMarketFailure,
  getSharedXauusdCandles,
  getSharedXauusdQuote,
  normalizeCandleTimeframe
} from "../services/marketFeed/sharedMarketData";

function statusFor(code: string): number {
  if (code === "UNAUTHENTICATED" || code === "CANDLE_AUTH_REQUIRED") return 401;
  if (code === "INVALID_TIMEFRAME") return 400;
  if (
    code === "MARKET_FEED_UNAVAILABLE" ||
    code === "MARKET_QUOTE_UNAVAILABLE" ||
    code === "CANDLE_ACCOUNT_NOT_FOUND" ||
    code === "CANDLE_SYMBOL_NOT_FOUND" ||
    code === "CANDLE_EMPTY_RESPONSE"
  ) {
    return 503;
  }
  if (
    code === "CANDLE_CTRADER_TIMEOUT" ||
    code === "CANDLE_UPSTREAM_ERROR" ||
    code === "CTRADER_CANDLES_UNAVAILABLE"
  ) {
    return 504;
  }
  return 502;
}

function sendMarketError(res: Response, status: number, code: string): void {
  res.status(status).json({
    error: {
      code,
      message:
        code === "INVALID_TIMEFRAME"
          ? "Use tf=M5|M15|H1|H4."
          : "Shared market data temporarily unavailable."
    },
    planIndependent: true,
    orderSubmissionEnabled: false,
    autoTrade: "OFF"
  });
}

export const buildMarketDataRouter = (): Router => {
  const router = Router();

  /**
   * Shared XAUUSD quote for every approved GoldMeta user.
   * Uses pinned market-data connection server-side — not the viewer's broker link.
   */
  router.get(
    "/v1/market/xauusd/quote",
    requireAuth,
    ...approvedAccountGate,
    async (req: Request, res: Response) => {
      const forceRefresh = String(req.query.refresh ?? "") === "1";
      try {
        const payload = await getSharedXauusdQuote({
          refreshIfNeeded: forceRefresh || true
        });
        res.json({
          ...payload,
          orderSubmissionEnabled: false,
          autoTrade: "OFF"
        });
      } catch (e) {
        const code = classifySharedMarketFailure(e);
        console.error("[market/xauusd/quote]", { code });
        sendMarketError(res, statusFor(code), code);
      }
    }
  );

  /**
   * Shared XAUUSD OHLC candles for the Plan chart.
   * Viewer cTrader connection is NOT required.
   */
  router.get(
    "/v1/market/xauusd/candles",
    requireAuth,
    ...approvedAccountGate,
    async (req: Request, res: Response) => {
      const timeframe = normalizeCandleTimeframe(
        req.query.tf ?? req.query.timeframe ?? "M15"
      );
      if (!timeframe) {
        sendMarketError(res, 400, "INVALID_TIMEFRAME");
        return;
      }
      const countRaw = Number(req.query.count ?? 120);
      const count = Number.isFinite(countRaw) ? countRaw : 120;
      try {
        const payload = await getSharedXauusdCandles({ timeframe, count });
        res.json({
          ...payload,
          orderSubmissionEnabled: false,
          autoTrade: "OFF"
        });
      } catch (e) {
        const code = classifySharedMarketFailure(e);
        console.error("[market/xauusd/candles]", { code, timeframe });
        sendMarketError(res, statusFor(code), code);
      }
    }
  );

  return router;
};
