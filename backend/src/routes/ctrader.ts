/**
 * Pepperstone cTrader routes — per-user Demo/Live account selection, read + preview.
 * Order submission remains hard-disabled. AutoTrade remains OFF for this phase.
 */

import { Router } from "express";
import { getAuthenticatedUserId, requireAuth } from "../middleware/auth";
import { brokerGate } from "../middleware/accountAccess";
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
import {
  assertBrokerUser,
  buildDiagnostics,
  buildLiveDemoPreview,
  completeOAuthCallback,
  disconnectOwner,
  listAuthorisedAccountsForUser,
  readQuoteForOwner,
  selectBrokerAccountForUser,
  startOAuthForOwner
} from "../services/broker/ctrader/connectionService";
import { getConnection } from "../services/broker/ctrader/connectionStore";
import {
  buildOAuthFrontendRedirect
} from "../services/broker/ctrader/oauth";
import { sendFriendlyError } from "../services/broker/ctrader/friendlyErrors";
import { loadTokenEncryptionSecret } from "../services/broker/ctrader/connectionStore";
import {
  confirmLiveActivation,
  getUserAutoTradeSettings,
  recommendedAutoTradeSettings,
  saveUserAutoTradeSettings,
  setEmergencyStop,
  type AutoTradeEnvironment,
  type UserAutoTradeSettingsPatch
} from "../services/broker/ctrader/userAutoTradeSettings";

function codeOf(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    return String((err as { code?: string }).code ?? "CTRADER_UNAVAILABLE");
  }
  if (err instanceof Error) {
    const m = err.message;
    if (/^[A-Z0-9_]+$/.test(m)) return m;
    if (/TOKEN_EXCHANGE/i.test(m)) return "OAUTH_STATE_EXPIRED";
    if (/RATE|429/i.test(m)) return "CTRADER_RATE_LIMITED";
  }
  return "CTRADER_UNAVAILABLE";
}

function statusFor(code: string): number {
  if (code === "UNAUTHENTICATED") return 401;
  if (code === "CTRADER_OWNER_ONLY") return 403;
  if (code === "AUTH_SETUP_REQUIRED") return 403;
  if (code === "CTRADER_LIVE_SELECTION_CONFIRMATION_REQUIRED") return 409;
  if (code === "LIVE_ACTIVATION_REQUIRED" || code === "LIVE_CONFIRMATION_PHRASE_MISMATCH") {
    return 409;
  }
  if (code === "SETTINGS_VALIDATION_FAILED") return 400;
  if (code.includes("LIVE_ACCOUNT")) return 403;
  if (code.includes("SETUP") || code.includes("MISSING") || code.includes("NOT_CONNECTED")) {
    return 503;
  }
  if (code.includes("STALE") || code.includes("SYMBOL") || code.includes("ACCOUNT")) {
    return 409;
  }
  if (code.includes("OAUTH") || code.includes("REPLAY") || code.includes("EXPIRED")) {
    return 400;
  }
  return 400;
}

function requireUid(req: { userId?: string | null }, res: import("express").Response): string | null {
  const uid = getAuthenticatedUserId(req as never);
  if (!uid) {
    sendFriendlyError(res, 401, "UNAUTHENTICATED");
    return null;
  }
  try {
    assertBrokerUser(uid);
  } catch {
    sendFriendlyError(res, 401, "UNAUTHENTICATED");
    return null;
  }
  return uid;
}

function parseEnvironment(raw: unknown): AutoTradeEnvironment | null {
  const v = String(raw ?? "").toLowerCase();
  if (v === "demo" || v === "live") return v;
  return null;
}

function publicAccount(a: {
  ctidTraderAccountId: string;
  accountIdMasked: string;
  brokerNameTitle: string | null;
  depositCurrency: string | null;
  leverage: number | null;
  isLive: boolean;
}) {
  return {
    ctidTraderAccountId: a.ctidTraderAccountId,
    accountIdMasked: a.accountIdMasked,
    brokerNameTitle: a.brokerNameTitle,
    depositCurrency: a.depositCurrency,
    leverage: a.leverage,
    isLive: a.isLive,
    accountType: a.isLive ? "Live" : "Demo",
    fundsLabel: a.isLive ? "Real money" : "Demo funds"
  };
}

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

/** Per-user connection summary — never reads another UID's tokens. */
async function connectionArgsForUser(ownerUid: string | null) {
  if (!ownerUid) return null;
  try {
    const connection = await getConnection(ownerUid);
    if (!connection) return { oauthConnected: false };
    return {
      oauthConnected: true,
      demoAccountSelected: Boolean(
        connection.selectedAccountId && !connection.selectedAccountIsLive
      ),
      accountSelected: Boolean(connection.selectedAccountId),
      selectedAccountIsLive: Boolean(connection.selectedAccountIsLive),
      pepperstoneConfirmed: connection.brokerConfirmedPepperstone,
      goldSymbolFound: Boolean(connection.symbolId),
      liveQuoteReceived: Boolean(connection.lastQuoteAt),
      accountMasked: connection.selectedAccountMasked,
      brokerName: connection.brokerName,
      symbolName: connection.symbolName,
      lastSyncAt: connection.lastSyncAt,
      lastQuoteAt: connection.lastQuoteAt,
      environment: connection.environment,
      balance: connection.balance,
      currency: connection.currency
    };
  } catch {
    return null;
  }
}

function webOrigin(): string {
  return (
    process.env.GOLDMETA_WEB_ORIGIN ??
    process.env.WEB_ORIGIN ??
    "https://goldmeta.metamechsolutions.com"
  ).replace(/\/$/, "");
}

export const buildCTraderRouter = (store: GoldMetaStore): Router => {
  const router = Router();

  router.get("/v1/brokers/control-centre", requireAuth, ...brokerGate, async (req, res) => {
    const auth = await resolveAuthHealth(store);
    const uid = getAuthenticatedUserId(req);
    const connection = await connectionArgsForUser(uid);
    res.json({
      ...getBrokerControlCentreSnapshot(auth, connection),
      autoTrade: "OFF",
      orderSubmissionEnabled: false
    });
  });

  router.get("/v1/ctrader/status", requireAuth, ...brokerGate, async (req, res) => {
    const auth = await resolveAuthHealth(store);
    const uid = getAuthenticatedUserId(req);
    const connection = await connectionArgsForUser(uid);
    res.json(buildCTraderReadiness({ auth, connection }));
  });

  router.get("/v1/ctrader/config", requireAuth, ...brokerGate, async (_req, res) => {
    const config = loadCTraderConfig();
    res.json({
      ...config,
      clientIdPresent: config.clientIdPresent,
      clientSecretPresent: config.clientSecretPresent,
      tokenEncryptionConfigured: Boolean(loadTokenEncryptionSecret()),
      flags: snapshotCTraderFlags()
    });
  });

  router.get("/v1/ctrader/auth-health", requireAuth, ...brokerGate, async (_req, res) => {
    const auth = await resolveAuthHealth(store);
    res.json({
      auth,
      brokerSetupEnabled: auth.brokerSetupEnabled,
      oauthCallbackEnabled: auth.status === "HEALTHY" && loadCTraderConfig().configured
    });
  });

  router.get("/v1/ctrader/demonstration", requireAuth, ...brokerGate, async (_req, res) => {
    res.json({
      ...buildDemonstrationBundle(),
      notice: FIXTURE_BANNER,
      autoTrade: "OFF",
      orderSubmissionEnabled: false
    });
  });

  router.post("/v1/ctrader/oauth/start", requireAuth, ...brokerGate, async (req, res) => {
    // Per-user OAuth: credentials must be configured. Owner-auth integrity is informational.
    if (!loadCTraderConfig().configured || !loadTokenEncryptionSecret()) {
      sendFriendlyError(res, 503, "CTRADER_SETUP_REQUIRED");
      return;
    }
    const uid = requireUid(req, res);
    if (!uid) return;
    try {
      const started = await startOAuthForOwner(uid);
      res.json({
        authorizationUrl: started.authorizationUrl,
        state: started.state,
        expiresAt: started.expiresAt,
        // App credentials may still target Demo Open API hosts in preview —
        // selected account type is resolved from OAuth-returned accounts.
        environment: started.environment,
        clientIdPresent: true,
        message:
          "Open the authorization URL to connect your cTrader broker account. You can then choose Demo or Live."
      });
    } catch (e) {
      sendFriendlyError(res, statusFor(codeOf(e)), codeOf(e));
    }
  });

  /**
   * Browser redirect callback from Spotware — NO Bearer auth.
   * Exchanges code server-side; redirects to frontend WITHOUT tokens.
   */
  router.get("/v1/ctrader/oauth/callback", async (req, res) => {
    const errorParam = typeof req.query.error === "string" ? req.query.error : null;
    if (errorParam) {
      res.redirect(
        302,
        buildOAuthFrontendRedirect({
          webOrigin: webOrigin(),
          status: "error",
          code: "OAUTH_CANCELLED"
        })
      );
      return;
    }
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!code || !state) {
      res.redirect(
        302,
        buildOAuthFrontendRedirect({
          webOrigin: webOrigin(),
          status: "error",
          code: "OAUTH_STATE_MISSING"
        })
      );
      return;
    }
    try {
      await completeOAuthCallback({ code, state });
      res.redirect(
        302,
        buildOAuthFrontendRedirect({
          webOrigin: webOrigin(),
          status: "ok"
        })
      );
    } catch (e) {
      res.redirect(
        302,
        buildOAuthFrontendRedirect({
          webOrigin: webOrigin(),
          status: "error",
          code: codeOf(e)
        })
      );
    }
  });

  /** Authenticated JSON callback kept for tests — still no tokens in response. */
  router.post("/v1/ctrader/oauth/callback", requireAuth, ...brokerGate, async (req, res) => {
    const uid = requireUid(req, res);
    if (!uid) return;
    try {
      const body = (req.body ?? {}) as { code?: string; state?: string };
      if (!body.code || !body.state) {
        sendFriendlyError(res, 400, "OAUTH_STATE_MISSING");
        return;
      }
      const result = await completeOAuthCallback({
        code: body.code,
        state: body.state
      });
      if (result.ownerUid !== uid) {
        sendFriendlyError(res, 403, "OAUTH_STATE_OWNER_MISMATCH");
        return;
      }
      res.json({
        connected: true,
        accountCount: result.accounts.length,
        accounts: result.accounts.map(publicAccount),
        orderSubmissionEnabled: false,
        autoTrade: "OFF"
      });
    } catch (e) {
      sendFriendlyError(res, statusFor(codeOf(e)), codeOf(e));
    }
  });

  router.get("/v1/ctrader/accounts", requireAuth, ...brokerGate, async (req, res) => {
    const uid = requireUid(req, res);
    if (!uid) return;
    try {
      const accounts = await listAuthorisedAccountsForUser(uid);
      const existing = await getConnection(uid);
      // Auto-select only when exactly one Pepperstone Demo — never auto-select Live.
      let autoSelected: {
        accountIdMasked: string;
        brokerNameTitle: string | null;
        accountType: "Demo" | "Live";
      } | null = null;
      const pepperstoneDemos = accounts.filter(
        (a) => !a.isLive && /pepperstone/i.test(a.brokerNameTitle ?? "")
      );
      if (pepperstoneDemos.length === 1) {
        const only = pepperstoneDemos[0]!;
        if (
          !existing?.selectedAccountId ||
          existing.selectedAccountId !== only.ctidTraderAccountId
        ) {
          const selected = await selectBrokerAccountForUser({
            ownerUid: uid,
            ctidTraderAccountId: only.ctidTraderAccountId,
            confirmPepperstone: true,
            confirmLiveSelection: false
          });
          autoSelected = {
            accountIdMasked: selected.account.accountIdMasked,
            brokerNameTitle: selected.account.brokerName,
            accountType: "Demo"
          };
        } else {
          autoSelected = {
            accountIdMasked: existing.selectedAccountMasked ?? only.accountIdMasked,
            brokerNameTitle: existing.brokerName,
            accountType: existing.selectedAccountIsLive ? "Live" : "Demo"
          };
        }
      }
      const selectedId = (await getConnection(uid))?.selectedAccountId ?? null;
      res.json({
        accounts: accounts.map((a) => ({
          ...publicAccount(a),
          selected: selectedId === a.ctidTraderAccountId,
          connectionStatus: "Connected",
          tradingPermission: "Read only"
        })),
        autoSelected,
        orderSubmissionEnabled: false,
        autoTrade: "OFF"
      });
    } catch (e) {
      sendFriendlyError(res, statusFor(codeOf(e)), codeOf(e));
    }
  });

  router.post("/v1/ctrader/accounts/select", requireAuth, ...brokerGate, async (req, res) => {
    const uid = requireUid(req, res);
    if (!uid) return;
    const body = (req.body ?? {}) as {
      ctidTraderAccountId?: string;
      confirmPepperstone?: boolean;
      confirmLiveSelection?: boolean;
    };
    if (!body.ctidTraderAccountId) {
      sendFriendlyError(res, 400, "CTRADER_ACCOUNT_NOT_AUTHORISED");
      return;
    }
    try {
      const selected = await selectBrokerAccountForUser({
        ownerUid: uid,
        ctidTraderAccountId: body.ctidTraderAccountId,
        confirmPepperstone: body.confirmPepperstone,
        confirmLiveSelection: Boolean(body.confirmLiveSelection)
      });
      if (!selected.account.brokerName || !/pepperstone/i.test(selected.account.brokerName)) {
        if (!body.confirmPepperstone) {
          sendFriendlyError(res, 409, "PEPPERSTONE_NOT_CONFIRMED", {
            account: selected.account,
            symbol: selected.symbol
          });
          return;
        }
      }
      const isLive = !selected.account.isDemo;
      // Persist selected account into the matching Demo/Live settings doc
      await saveUserAutoTradeSettings(uid, isLive ? "live" : "demo", {
        selectedAccountId: body.ctidTraderAccountId
      });
      res.json({
        account: selected.account,
        symbol: selected.symbol,
        environment: isLive ? "LIVE" : "DEMO",
        accountType: isLive ? "Live" : "Demo",
        fundsLabel: isLive ? "Real money" : "Demo funds",
        orderSubmissionEnabled: false,
        autoTrade: "OFF",
        label: isLive
          ? "Live account selected — confirmation required before Live AutoTrade"
          : "Demo account selected — read-only"
      });
    } catch (e) {
      sendFriendlyError(res, statusFor(codeOf(e)), codeOf(e));
    }
  });

  router.post("/v1/ctrader/disconnect", requireAuth, ...brokerGate, async (req, res) => {
    const uid = requireUid(req, res);
    if (!uid) return;
    try {
      await disconnectOwner(uid);
      res.json({
        disconnected: true,
        orderSubmissionEnabled: false,
        autoTrade: "OFF"
      });
    } catch (e) {
      sendFriendlyError(res, statusFor(codeOf(e)), codeOf(e));
    }
  });

  router.get("/v1/ctrader/diagnostics", requireAuth, ...brokerGate, async (req, res) => {
    const uid = requireUid(req, res);
    if (!uid) return;
    try {
      const report = await buildDiagnostics(uid);
      res.json({
        ...report,
        orderSubmissionEnabled: false,
        label: "cTrader connection diagnostics — read-only"
      });
    } catch (e) {
      sendFriendlyError(res, statusFor(codeOf(e)), codeOf(e));
    }
  });

  router.get("/v1/ctrader/quote", requireAuth, ...brokerGate, async (req, res) => {
    const uid = requireUid(req, res);
    if (!uid) return;
    try {
      const quote = await readQuoteForOwner(uid);
      const connection = await getConnection(uid);
      res.json({
        quote,
        label: connection?.selectedAccountIsLive ? "Live account quote" : "Demo account quote",
        orderSubmissionEnabled: false,
        autoTrade: "OFF"
      });
    } catch (e) {
      const code = codeOf(e);
      const extra =
        code === "CTRADER_QUOTE_STALE" && e && typeof e === "object" && "quote" in e
          ? { quote: (e as { quote: unknown }).quote, stale: true }
          : undefined;
      sendFriendlyError(res, statusFor(code), code, extra);
    }
  });

  router.get("/v1/ctrader/autotrade-settings/:environment", requireAuth, ...brokerGate, async (req, res) => {
    const uid = requireUid(req, res);
    if (!uid) return;
    const environment = parseEnvironment(req.params.environment);
    if (!environment) {
      res.status(400).json({
        error: "INVALID_ENVIRONMENT",
        message: "Use demo or live.",
        orderSubmissionEnabled: false,
        autoTrade: "OFF"
      });
      return;
    }
    const settings = await getUserAutoTradeSettings(uid, environment);
    res.json({
      settings,
      recommended: recommendedAutoTradeSettings(),
      orderSubmissionEnabled: false,
      autoTrade: "OFF",
      executionNote:
        "Settings are saved per user and environment. Order submission remains disabled in this preview."
    });
  });

  router.put("/v1/ctrader/autotrade-settings/:environment", requireAuth, ...brokerGate, async (req, res) => {
    const uid = requireUid(req, res);
    if (!uid) return;
    const environment = parseEnvironment(req.params.environment);
    if (!environment) {
      res.status(400).json({
        error: "INVALID_ENVIRONMENT",
        message: "Use demo or live.",
        orderSubmissionEnabled: false,
        autoTrade: "OFF"
      });
      return;
    }
    try {
      // Reject browser-forged account IDs — must match this user's OAuth accounts when provided.
      const patch = { ...(req.body ?? {}) } as UserAutoTradeSettingsPatch;
      if (patch.selectedAccountId) {
        const authorised = await listAuthorisedAccountsForUser(uid);
        const match = authorised.find((a) => a.ctidTraderAccountId === patch.selectedAccountId);
        if (!match) {
          sendFriendlyError(res, 409, "CTRADER_ACCOUNT_NOT_AUTHORISED");
          return;
        }
        if (environment === "demo" && match.isLive) {
          sendFriendlyError(res, 409, "CTRADER_ACCOUNT_TYPE_MISMATCH");
          return;
        }
        if (environment === "live" && !match.isLive) {
          sendFriendlyError(res, 409, "CTRADER_ACCOUNT_TYPE_MISMATCH");
          return;
        }
      }
      // Never accept client-supplied Live activation bypass
      if (environment === "demo") {
        patch.liveActivationPhraseConfirmed = false;
        patch.liveActivationConfirmedAt = null;
      }
      const settings = await saveUserAutoTradeSettings(uid, environment, patch);
      res.json({
        settings,
        recommended: recommendedAutoTradeSettings(),
        orderSubmissionEnabled: false,
        autoTrade: "OFF"
      });
    } catch (e) {
      sendFriendlyError(res, statusFor(codeOf(e)), codeOf(e));
    }
  });

  router.post("/v1/ctrader/live-activation/confirm", requireAuth, ...brokerGate, async (req, res) => {
    const uid = requireUid(req, res);
    if (!uid) return;
    const phrase = String((req.body as { phrase?: string })?.phrase ?? "");
    try {
      const settings = await confirmLiveActivation(uid, phrase);
      res.json({
        settings,
        confirmed: true,
        orderSubmissionEnabled: false,
        autoTrade: "OFF",
        message:
          "Live activation phrase accepted. Live AutoTrade still requires a separate enable step and remains OFF while order submission is disabled."
      });
    } catch (e) {
      sendFriendlyError(res, statusFor(codeOf(e)), codeOf(e));
    }
  });

  router.post("/v1/ctrader/emergency-stop", requireAuth, ...brokerGate, async (req, res) => {
    const uid = requireUid(req, res);
    if (!uid) return;
    const environment = parseEnvironment((req.body as { environment?: string })?.environment) ?? "demo";
    const active = (req.body as { active?: boolean })?.active !== false;
    try {
      const settings = await setEmergencyStop(uid, environment, active);
      res.json({
        settings,
        emergencyStopActive: settings.emergencyStopActive,
        environment,
        orderSubmissionEnabled: false,
        autoTrade: "OFF",
        message: active
          ? `Emergency STOP active for your ${environment === "live" ? "Live" : "Demo"} automation only.`
          : `Emergency STOP cleared for your ${environment === "live" ? "Live" : "Demo"} automation.`
      });
    } catch (e) {
      sendFriendlyError(res, statusFor(codeOf(e)), codeOf(e));
    }
  });

  router.post("/v1/ctrader/preview", requireAuth, ...brokerGate, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const useFixture = Boolean(body.useDemonstrationFixture);
    const uid = getAuthenticatedUserId(req);

    if (!useFixture) {
      if (!uid) {
        sendFriendlyError(res, 401, "UNAUTHENTICATED");
        return;
      }
      try {
        const live = await buildLiveDemoPreview({
          ownerUid: uid,
          decision: String(body.decision ?? "BUY"),
          decisionId: typeof body.decisionId === "string" ? body.decisionId : undefined,
          confidence: typeof body.confidence === "number" ? body.confidence : undefined,
          stopLoss: typeof body.stopLoss === "number" ? body.stopLoss : undefined,
          takeProfits: Array.isArray(body.takeProfits)
            ? (body.takeProfits as number[])
            : undefined,
          candleConfirmed: body.candleConfirmed !== false
        });
        res.json({
          preview: live.preview,
          quote: live.quote,
          label: live.label,
          previewOnly: true,
          dispatchable: false,
          orderSubmissionEnabled: false,
          autoTrade: "OFF",
          notice: "Preview only — no order will be submitted."
        });
      } catch (e) {
        sendFriendlyError(res, statusFor(codeOf(e)), codeOf(e));
      }
      return;
    }

    const symbol = fixtureXauUsdSymbol();
    const quote = fixtureQuote("OPEN");
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
    res.json({
      preview,
      orderSubmissionEnabled: false,
      autoTrade: "OFF",
      previewOnly: true,
      dispatchable: false,
      notice: "Preview only — no order will be submitted."
    });
  });

  router.post("/v1/ctrader/preview/approve", requireAuth, ...brokerGate, async (req, res) => {
    const body = (req.body ?? {}) as {
      previewId?: string;
      useDemonstrationFixture?: boolean;
      decision?: string;
    };
    if (!body.useDemonstrationFixture && !body.previewId) {
      res.status(400).json({
        error: "SERVER_PREVIEW_REQUIRED",
        message:
          "Approval requires server-side preview rebuild. Client preview payloads are rejected.",
        submitted: false,
        orderSubmissionEnabled: false
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
      dispatchable: false,
      message: "PREVIEW_APPROVED does not submit an order and cannot transition to SUBMITTING."
    });
  });

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

  router.post("/v1/ctrader/orders/market", requireAuth, ...brokerGate, deny("market"));
  router.post("/v1/ctrader/orders/close", requireAuth, ...brokerGate, deny("close"));
  router.post("/v1/ctrader/orders/cancel", requireAuth, ...brokerGate, deny("cancel"));
  router.post("/v1/ctrader/positions/close", requireAuth, ...brokerGate, deny("closePosition"));

  router.post("/v1/ctrader/automation/mode", requireAuth, ...brokerGate, async (req, res) => {
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
