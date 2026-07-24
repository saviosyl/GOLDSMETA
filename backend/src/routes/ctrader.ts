/**
 * Pepperstone cTrader Demo routes — read + preview only.
 * No order submission, close, or cancel mutations.
 */

import { Router } from "express";
import { getAuthenticatedUserId, requireAuth } from "../middleware/auth";
import { loadOwnerAuthConfig } from "../services/auth/ownerAuthConfig";
import { checkOwnerAuthIntegrity } from "../services/auth/authIntegrity";
import { getAuth } from "firebase-admin/auth";
import type { GoldMetaStore } from "../services/storage/types";
import {
  buildAuthHealthSnapshot,
  buildCTraderReadiness,
  buildDemonstrationBundle,
  cTraderOrderApi,
  getBrokerControlCentreSnapshot
} from "../services/broker/ctrader/cTraderService";
import { loadCTraderConfig } from "../services/broker/ctrader/config";
import { assertCTraderMutationsDisabled, snapshotCTraderFlags } from "../services/broker/ctrader/flags";
import { CTraderMutationDisabledError } from "../services/broker/ctrader/mutationGuard";
import { approveTradePreview, buildTradePreview } from "../services/broker/ctrader/preview";
import {
  fixtureQuote,
  fixtureXauUsdSymbol,
  FIXTURE_BANNER
} from "../services/broker/ctrader/fixtures";

async function resolveAuthHealth(store: GoldMetaStore) {
  try {
    const config = loadOwnerAuthConfig();
    const result = await checkOwnerAuthIntegrity({
      config,
      auth: {
        async getUserByEmail(email) {
          try {
            const u = await getAuth().getUserByEmail(email);
            return { uid: u.uid, email: u.email };
          } catch (e) {
            if ((e as { code?: string }).code === "auth/user-not-found") return null;
            throw e;
          }
        },
        async getUser(uid) {
          try {
            const u = await getAuth().getUser(uid);
            return { uid: u.uid, email: u.email };
          } catch (e) {
            if ((e as { code?: string }).code === "auth/user-not-found") return null;
            throw e;
          }
        },
        async listWebhookConnectionsForUser(userId) {
          const list = await store.listWebhookConnections(userId);
          return list.map((c) => ({ webhookId: c.webhookId, status: c.status }));
        }
      }
    });
    return buildAuthHealthSnapshot({
      status: result.status === "HEALTHY" ? "HEALTHY" : "NOT_HEALTHY",
      pinnedOwnerExists: result.originalOwnerExists,
      emailMapsToPinned:
        result.originalOwnerExists &&
        result.status === "HEALTHY",
      emailVerified: null,
      disabled: null,
      webhookOwnedByOriginal: result.webhookOwnedByOriginal,
      notes: result.notes
    });
  } catch {
    return buildAuthHealthSnapshot({
      status: "UNKNOWN",
      notes: ["Auth health probe unavailable."]
    });
  }
}

export const buildCTraderRouter = (store: GoldMetaStore): Router => {
  const router = Router();

  router.get("/v1/brokers/control-centre", requireAuth, async (_req, res) => {
    const auth = await resolveAuthHealth(store);
    res.json({
      ...getBrokerControlCentreSnapshot(auth),
      autoTrade: "OFF",
      orderSubmissionEnabled: false
    });
  });

  router.get("/v1/ctrader/status", requireAuth, async (_req, res) => {
    const auth = await resolveAuthHealth(store);
    res.json(buildCTraderReadiness({ auth }));
  });

  router.get("/v1/ctrader/config", requireAuth, async (_req, res) => {
    const config = loadCTraderConfig();
    res.json({
      ...config,
      // never echo secrets
      clientIdPresent: config.clientIdPresent,
      clientSecretPresent: config.clientSecretPresent,
      flags: snapshotCTraderFlags()
    });
  });

  router.get("/v1/ctrader/auth-health", requireAuth, async (_req, res) => {
    const auth = await resolveAuthHealth(store);
    res.json({
      auth,
      brokerSetupEnabled: auth.brokerSetupEnabled,
      oauthCallbackEnabled: auth.status === "HEALTHY" && loadCTraderConfig().configured
    });
  });

  router.get("/v1/ctrader/demonstration", requireAuth, async (_req, res) => {
    res.json({
      ...buildDemonstrationBundle(),
      notice: FIXTURE_BANNER,
      autoTrade: "OFF",
      orderSubmissionEnabled: false
    });
  });

  router.post("/v1/ctrader/oauth/start", requireAuth, async (req, res) => {
    const auth = await resolveAuthHealth(store);
    const config = loadCTraderConfig();
    if (auth.status !== "HEALTHY") {
      res.status(403).json({
        error: "AUTH_SETUP_REQUIRED",
        message:
          "OAuth is disabled until pinned-owner Auth integrity is HEALTHY."
      });
      return;
    }
    if (!config.configured) {
      res.status(503).json({
        error: "CTRADER_SETUP_REQUIRED",
        missing: config.missing,
        message: "Register a cTrader Open API application and configure secrets."
      });
      return;
    }
    // Credentials exist — still do not invent redirect; return next-step payload only.
    void getAuthenticatedUserId(req);
    res.status(501).json({
      error: "OAUTH_START_PENDING_OWNER_APP_APPROVAL",
      message:
        "Server config present. Complete cTrader app approval, then retry OAuth start.",
      redirectUri: config.redirectUri,
      environment: "DEMO"
    });
  });

  router.post("/v1/ctrader/oauth/callback", requireAuth, async (_req, res) => {
    const auth = await resolveAuthHealth(store);
    if (auth.status !== "HEALTHY") {
      res.status(403).json({ error: "AUTH_SETUP_REQUIRED" });
      return;
    }
    res.status(403).json({
      error: "OAUTH_CALLBACK_DISABLED",
      message:
        "OAuth callback remains disabled until owner completes Open API registration and explicit enablement."
    });
  });

  router.post("/v1/ctrader/preview", requireAuth, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const useFixture = Boolean(body.useDemonstrationFixture);
    const symbol = useFixture ? fixtureXauUsdSymbol() : null;
    const quote = useFixture ? fixtureQuote("OPEN") : null;
    if (!useFixture) {
      res.status(503).json({
        error: "CTRADER_SETUP_REQUIRED",
        message:
          "Live preview requires connected Demo account and quotes. Use demonstration fixture explicitly.",
        hint: "POST { useDemonstrationFixture: true } for labelled demo data only."
      });
      return;
    }
    const preview = buildTradePreview({
      decisionId: String(body.decisionId ?? "fixture-decision"),
      decision: String(body.decision ?? "BUY"),
      confidence: typeof body.confidence === "number" ? body.confidence : 85,
      generatedAt: new Date().toISOString(),
      candleConfirmed: body.candleConfirmed !== false,
      stopLoss: typeof body.stopLoss === "number" ? body.stopLoss : 2340,
      takeProfits: Array.isArray(body.takeProfits)
        ? (body.takeProfits as number[])
        : [2365],
      symbol,
      quote,
      position: null,
      pendingOrdersCount: 0,
      equity: 10000,
      freeMargin: 9500,
      accountCurrency: "EUR",
      riskAmountEur: 20,
      maxSpread: 1,
      demonstration: true,
      eurToAccountRate: 1,
      marginPerLot: 200
    });
    res.json({ preview, orderSubmissionEnabled: false, autoTrade: "OFF" });
  });

  router.post("/v1/ctrader/preview/approve", requireAuth, async (req, res) => {
    const body = (req.body ?? {}) as {
      previewId?: string;
      useDemonstrationFixture?: boolean;
      decision?: string;
    };
    // Never trust a client-supplied preview object for approval.
    // Rebuild server-side (demonstration fixture only in this phase).
    if (!body.useDemonstrationFixture && !body.previewId) {
      res.status(400).json({
        error: "SERVER_PREVIEW_REQUIRED",
        message:
          "Approval requires server-side preview rebuild. Client preview payloads are rejected."
      });
      return;
    }
    const rebuilt = buildTradePreview({
      decisionId: String(body.previewId ?? "fixture-decision-approve"),
      decision: String(body.decision ?? "BUY"),
      confidence: 85,
      generatedAt: new Date().toISOString(),
      candleConfirmed: true,
      stopLoss: 2340,
      takeProfits: [2365],
      symbol: fixtureXauUsdSymbol(),
      quote: fixtureQuote("OPEN"),
      position: null,
      pendingOrdersCount: 0,
      openPositionsCount: 0,
      tradesToday: 0,
      equity: 10000,
      freeMargin: 9500,
      accountCurrency: "EUR",
      riskAmountEur: 20,
      maxSpread: 1,
      demonstration: true,
      eurToAccountRate: 1,
      marginPerLot: 200
    });
    if (rebuilt.state === "BLOCKED") {
      res.status(409).json({
        error: "PREVIEW_BLOCKED",
        preview: rebuilt,
        submitted: false,
        orderSubmissionEnabled: false
      });
      return;
    }
    const approved = approveTradePreview(rebuilt);
    res.json({
      preview: approved,
      orderSubmissionEnabled: false,
      submitted: false,
      submitting: false,
      message: "PREVIEW_APPROVED does not submit an order and cannot transition to SUBMITTING."
    });
  });

  // Explicit mutation denials — must never succeed
  const deny = (action: string) => async (_req: unknown, res: import("express").Response) => {
    try {
      assertCTraderMutationsDisabled();
      cTraderOrderApi.placeMarketBuy();
    } catch (e) {
      const err = e as CTraderMutationDisabledError;
      res.status(403).json({
        error: err.code ?? "CTRADER_MUTATION_DISABLED",
        action,
        message: err.message,
        submitted: false
      });
    }
  };

  router.post("/v1/ctrader/orders/market", requireAuth, deny("market"));
  router.post("/v1/ctrader/orders/close", requireAuth, deny("close"));
  router.post("/v1/ctrader/orders/cancel", requireAuth, deny("cancel"));
  router.post("/v1/ctrader/positions/close", requireAuth, deny("closePosition"));

  router.post("/v1/ctrader/automation/mode", requireAuth, async (req, res) => {
    const mode = String((req.body as { mode?: string })?.mode ?? "OFF").toUpperCase();
    if (mode === "DEMO_AUTO" || mode === "LIVE_LOCKED" || mode === "DEMO_AUTO_LOCKED") {
      res.status(403).json({
        error: "AUTOMATION_MODE_LOCKED",
        mode,
        active: "OFF",
        message: "Demo Auto and Live modes cannot be activated."
      });
      return;
    }
    if (mode === "CONFIRM" || mode === "MANUAL" || mode === "OFF") {
      res.json({
        mode: mode === "CONFIRM" ? "CONFIRM" : mode === "MANUAL" ? "MANUAL" : "OFF",
        autoTrade: "OFF",
        orderSubmissionEnabled: false,
        note:
          mode === "CONFIRM"
            ? "CONFIRM allows preview approval only — no submission."
            : "AutoTrade remains OFF."
      });
      return;
    }
    res.status(400).json({ error: "UNKNOWN_MODE", active: "OFF" });
  });

  return router;
};
