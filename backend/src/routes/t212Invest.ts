/**
 * Trading 212 General Invest — owner-only read-only + paper routes.
 * AutoTrade remains OFF. Order mutation endpoints are explicitly denied.
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { loadOwnerAuthConfig } from "../services/auth/ownerAuthConfig";
import {
  createT212InvestReadService,
  isOwnerOnlyUid,
  type T212InvestReadService
} from "../services/autoTrade/t212/investReadService";
import { T212_ORDER_CREATE_PATHS } from "../services/autoTrade/t212/client";

function requirePinnedOwner(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction
): void {
  if (!req.userId) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } });
    return;
  }
  const pinned = loadOwnerAuthConfig().pinnedOwnerUid;
  // Fail closed: only the exact pinned owner UID may access owner T212 data.
  if (!pinned || req.userId !== pinned || !isOwnerOnlyUid(req.userId)) {
    res.status(403).json({
      error: {
        code: "OWNER_ONLY",
        message: "Trading 212 General Invest data is restricted to the pinned owner."
      }
    });
    return;
  }
  next();
}

export const buildT212InvestRouter = (
  service: T212InvestReadService = createT212InvestReadService()
): Router => {
  const router = Router();
  const ownerGate = [requireAuth, requirePinnedOwner] as const;

  router.get("/v1/t212/invest/flags", ...ownerGate, (_req, res) => {
    res.status(200).json({ flags: service.flags() });
  });

  router.get("/v1/t212/invest/portfolio", ...ownerGate, async (req, res) => {
    const portfolio = await service.getPortfolio(req.userId!);
    res.status(200).json({ portfolio });
  });

  router.get("/v1/t212/invest/instruments/search", ...ownerGate, async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const result = await service.searchInstruments(q);
    res.status(200).json(result);
  });

  router.get("/v1/t212/invest/watchlist", ...ownerGate, async (req, res) => {
    const items = await service.getWatchlist(req.userId!);
    res.status(200).json({ items });
  });

  router.post("/v1/t212/invest/watchlist", ...ownerGate, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ticker = typeof body.ticker === "string" ? body.ticker.trim() : "";
    if (!ticker) {
      res.status(400).json({ error: { code: "INVALID_TICKER", message: "Ticker is required" } });
      return;
    }
    try {
      const items = await service.addWatchlistItem(req.userId!, {
        ticker,
        name: typeof body.name === "string" ? body.name : ticker,
        currency: typeof body.currency === "string" ? body.currency : null,
        exchange: typeof body.exchange === "string" ? body.exchange : null
      });
      res.status(200).json({ items });
    } catch (e) {
      const code = (e as { code?: string }).code ?? "WATCHLIST_REJECTED";
      res.status(400).json({
        error: { code, message: "Instrument rejected for General Invest watchlist" }
      });
    }
  });

  router.delete("/v1/t212/invest/watchlist/:ticker", ...ownerGate, async (req, res) => {
    const ticker = Array.isArray(req.params.ticker) ? req.params.ticker[0] : req.params.ticker;
    const items = await service.removeWatchlistItem(req.userId!, ticker ?? "");
    res.status(200).json({ items });
  });

  router.get("/v1/t212/invest/paper", ...ownerGate, (req, res) => {
    res.status(200).json({ paper: service.getPaperPortfolio(req.userId!) });
  });

  router.post("/v1/t212/invest/paper/buy", ...ownerGate, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ticker = typeof body.ticker === "string" ? body.ticker : "";
    const quantity = Number(body.quantity);
    const price = Number(body.price);
    if (!ticker || !(quantity > 0) || !(price > 0)) {
      res.status(400).json({
        error: { code: "INVALID_PAPER_BUY", message: "ticker, quantity and price required" }
      });
      return;
    }
    const result = service.paperBuy(req.userId!, {
      ticker,
      name: typeof body.name === "string" ? body.name : ticker,
      quantity,
      price,
      currency: typeof body.currency === "string" ? body.currency : undefined,
      signalRef: typeof body.signalRef === "string" ? body.signalRef : null,
      priceTimestamp: typeof body.priceTimestamp === "string" ? body.priceTimestamp : null,
      marketOpen: typeof body.marketOpen === "boolean" ? body.marketOpen : undefined
    });
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.post("/v1/t212/invest/paper/sell-owned", ...ownerGate, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ticker = typeof body.ticker === "string" ? body.ticker : "";
    const quantity = Number(body.quantity);
    const price = Number(body.price);
    if (!ticker || !(quantity > 0) || !(price > 0)) {
      res.status(400).json({
        error: { code: "INVALID_PAPER_SELL", message: "ticker, quantity and price required" }
      });
      return;
    }
    const result = service.paperSellOwned(req.userId!, {
      ticker,
      quantity,
      price,
      signalRef: typeof body.signalRef === "string" ? body.signalRef : null,
      priceTimestamp: typeof body.priceTimestamp === "string" ? body.priceTimestamp : null,
      marketOpen: typeof body.marketOpen === "boolean" ? body.marketOpen : undefined
    });
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.post("/v1/t212/invest/paper/emergency-stop", ...ownerGate, (req, res) => {
    res.status(200).json({ paper: service.paperEmergencyStop(req.userId!) });
  });

  router.post("/v1/t212/invest/preview", ...ownerGate, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ticker = typeof body.ticker === "string" ? body.ticker.trim() : "";
    const currentPrice = Number(body.currentPrice);
    if (!ticker || !(currentPrice > 0)) {
      res.status(400).json({
        error: { code: "INVALID_PREVIEW", message: "ticker and currentPrice required" }
      });
      return;
    }
    const preview = service.preview({
      ticker,
      name: typeof body.name === "string" ? body.name : ticker,
      currentPrice,
      currency: typeof body.currency === "string" ? body.currency : undefined,
      ownedQuantity: Number(body.ownedQuantity) || 0,
      averagePurchasePrice:
        typeof body.averagePurchasePrice === "number" ? body.averagePurchasePrice : null,
      proposedInvestmentAmount:
        typeof body.proposedInvestmentAmount === "number"
          ? body.proposedInvestmentAmount
          : undefined,
      marketOpen: typeof body.marketOpen === "boolean" ? body.marketOpen : undefined,
      priceTimestamp: typeof body.priceTimestamp === "string" ? body.priceTimestamp : undefined,
      signalScore: typeof body.signalScore === "number" ? body.signalScore : null,
      earningsWarning: Boolean(body.earningsWarning),
      companyNewsWarning: Boolean(body.companyNewsWarning),
      fxWarning: Boolean(body.fxWarning),
      duplicateSignal: Boolean(body.duplicateSignal)
    });
    res.status(200).json({ preview });
  });

  // Explicit mutation denials — never reach Trading 212 order endpoints.
  for (const path of T212_ORDER_CREATE_PATHS) {
    const suffix = path.replace(/^\//, "");
    router.post(`/v1/t212/invest/orders/${suffix.split("/").pop()}`, ...ownerGate, (_req, res) => {
      res.status(403).json({
        error: {
          code: "ORDER_ENDPOINT_BLOCKED",
          message: "Trading 212 order submission is disabled. Paper preview only."
        }
      });
    });
  }

  router.post("/v1/t212/invest/orders", ...ownerGate, (_req, res) => {
    res.status(403).json({
      error: {
        code: "ORDER_ENDPOINT_BLOCKED",
        message: "Trading 212 order submission is disabled. Paper preview only."
      }
    });
  });

  router.all(
    "/v1/t212/invest/orders/:orderAction",
    ...ownerGate,
    (_req, res) => {
      res.status(403).json({
        error: {
          code: "ORDER_ENDPOINT_BLOCKED",
          message: "Trading 212 order submission is disabled. Paper preview only."
        }
      });
    }
  );

  return router;
};
