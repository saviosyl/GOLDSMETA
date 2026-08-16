/**
 * GOLD HUNTER Admin API — ADMIN ONLY + DEMO_ONLY execution.
 * Mounted under /v1/gold-hunter/*
 */

import { Router } from "express";
import { requireAuth, requireAdmin, getAuthenticatedUserId } from "../middleware/auth";
import {
  appendGoldHunterAudit,
  GH_ADMIN_ALLOCATION_PRESETS_EUR,
  loadGoldHunterConfig,
  saveGoldHunterConfig
} from "../services/goldHunterAdmin/configStore";
import {
  evaluateGoldHunterArmingReadiness,
  resetGoldHunterAccountSnapshotCache
} from "../services/goldHunterAdmin/accountSnapshot";
import {
  assembleGoldHunterStatus
} from "../services/goldHunterAdmin/statusAssembler";
import {
  computeDemoPerformance,
  listGoldHunterDemoTrades
} from "../services/goldHunterAdmin/tradeStore";
import {
  plannedDailyLossBudgetEur,
  plannedRiskBudgetEur
} from "../services/goldHunterAdmin/riskSizing";
import {
  GH_ADMIN_EXECUTION_MODE,
  GH_ADMIN_STRATEGY_ID,
  type GoldHunterAdminConfig
} from "../services/goldHunterAdmin/types";
import { assertGoldHunterDemoOnlyEnvironment } from "../services/goldHunterAdmin/orderGates";

const adminGate = [requireAuth, requireAdmin] as const;

export const buildGoldHunterAdminRouter = (): Router => {
  const router = Router();

  router.get("/v1/gold-hunter/status", ...adminGate, async (req, res) => {
    const uid = getAuthenticatedUserId(req);
    if (!uid) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED" } });
      return;
    }
    try {
      const force = String(req.query.refresh ?? "") === "1";
      const status = await assembleGoldHunterStatus(uid, true, {
        forceAccountRefresh: force
      });
      res.status(200).json(status);
    } catch (e) {
      res.status(500).json({
        error: {
          code: "GH_STATUS_FAILED",
          message: e instanceof Error ? e.message : "status_failed"
        }
      });
    }
  });

  /** Read-only broker account refresh — clears soft cache then returns status. */
  router.post("/v1/gold-hunter/account/refresh", ...adminGate, async (req, res) => {
    const uid = getAuthenticatedUserId(req);
    if (!uid) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED" } });
      return;
    }
    resetGoldHunterAccountSnapshotCache();
    try {
      const status = await assembleGoldHunterStatus(uid, true, {
        forceAccountRefresh: true
      });
      res.status(200).json(status);
    } catch (e) {
      res.status(500).json({
        error: {
          code: "GH_ACCOUNT_REFRESH_FAILED",
          message: e instanceof Error ? e.message : "refresh_failed"
        }
      });
    }
  });

  router.get("/v1/gold-hunter/config", ...adminGate, async (req, res) => {
    const uid = getAuthenticatedUserId(req);
    if (!uid) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED" } });
      return;
    }
    const config = await loadGoldHunterConfig(uid);
    res.status(200).json({
      config,
      presetsEur: GH_ADMIN_ALLOCATION_PRESETS_EUR,
      executionMode: GH_ADMIN_EXECUTION_MODE,
      liveExecutionEnabled: false,
      strategy: GH_ADMIN_STRATEGY_ID,
      riskBudgetEur: plannedRiskBudgetEur(config),
      dailyLossBudgetEur: plannedDailyLossBudgetEur(config)
    });
  });

  router.put("/v1/gold-hunter/config", ...adminGate, async (req, res) => {
    const uid = getAuthenticatedUserId(req);
    if (!uid) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED" } });
      return;
    }
    const body = (req.body ?? {}) as Partial<GoldHunterAdminConfig> & {
      confirmDemoAutoTrade?: boolean;
    };

    // Strip forbidden live fields.
    if (
      (body as { liveExecutionEnabled?: unknown }).liveExecutionEnabled === true ||
      (body.mode as string) === "LIVE"
    ) {
      res.status(403).json({
        error: {
          code: "LIVE_EXECUTION_DISABLED",
          message: "Gold Hunter Live execution is permanently disabled.",
          executionMode: GH_ADMIN_EXECUTION_MODE,
          liveExecutionEnabled: false
        }
      });
      return;
    }

    const prev = await loadGoldHunterConfig(uid);
    const patch: Partial<GoldHunterAdminConfig> = {};

    if (typeof body.allocatedCapitalEur === "number") {
      patch.allocatedCapitalEur = body.allocatedCapitalEur;
    }
    if (typeof body.riskPerTradePct === "number") {
      patch.riskPerTradePct = body.riskPerTradePct;
    }
    if (typeof body.dailyLossLimitPct === "number") {
      patch.dailyLossLimitPct = body.dailyLossLimitPct;
    }
    if (typeof body.maxOpenTrades === "number") {
      patch.maxOpenTrades = body.maxOpenTrades;
    }
    if (typeof body.pauseNewEntries === "boolean") {
      patch.pauseNewEntries = body.pauseNewEntries;
    }
    if (typeof body.emergencyStopActive === "boolean") {
      patch.emergencyStopActive = body.emergencyStopActive;
    }
    if (typeof body.demoAutoTradeEnabled === "boolean") {
      if (body.demoAutoTradeEnabled === true && body.confirmDemoAutoTrade !== true) {
        res.status(400).json({
          error: {
            code: "CONFIRMATION_REQUIRED",
            message:
              "Enabling Gold Hunter Demo AutoTrade requires confirmDemoAutoTrade=true."
          }
        });
        return;
      }
      if (body.demoAutoTradeEnabled === true) {
        // Ensure selected broker is DEMO + account snapshot valid before arming.
        try {
          resetGoldHunterAccountSnapshotCache();
          const status = await assembleGoldHunterStatus(uid, true, {
            forceAccountRefresh: true
          });
          assertGoldHunterDemoOnlyEnvironment(status.broker.environment);
          if (!status.broker.connected || status.broker.environment !== "DEMO") {
            res.status(403).json({
              error: {
                code: "DEMO_ACCOUNT_REQUIRED",
                message: "Gold Hunter AutoTrade requires a connected cTrader DEMO account."
              }
            });
            return;
          }
          const arm = evaluateGoldHunterArmingReadiness({
            snapshot: {
              provider: "cTrader",
              environment: status.broker.environment,
              authState: status.broker.authState,
              authorised: status.broker.authorised,
              accountMasked: status.broker.accountMasked,
              brokerName: status.broker.brokerName,
              currency: status.broker.currency,
              balance: status.broker.balance,
              equity: status.broker.equity,
              marginUsed: status.broker.marginUsed,
              freeMargin: status.broker.freeMargin,
              openPositionCount: status.broker.openPositionCount,
              capturedAt: status.broker.lastSyncAt,
              ageMs: status.broker.snapshotAgeMs,
              source: status.broker.snapshotSource,
              notes: [],
              demoOrderSubmissionEnabled: status.broker.demoOrderSubmissionEnabled,
              validForRisk: status.broker.validForRisk
            },
            allocatedCapitalEur: status.config.allocatedCapitalEur,
            riskPerTradePct: status.config.riskPerTradePct,
            strategySelectorConnected: status.arming.strategySelectorConnected,
            protectionGeometryConnected:
              status.strategyPipeline.protectionGeometryConnected
          });
          if (!arm.ok) {
            res.status(403).json({
              error: {
                code: "ARMING_BLOCKED",
                message:
                  "Gold Hunter Demo AutoTrade cannot be armed until all readiness gates pass.",
                blockers: arm.blockers,
                executionMode: GH_ADMIN_EXECUTION_MODE,
                liveExecutionEnabled: false
              }
            });
            return;
          }
        } catch {
          res.status(403).json({
            error: {
              code: "LIVE_OR_NON_DEMO_REFUSED",
              message: "Cannot arm Gold Hunter on a non-DEMO broker environment.",
              executionMode: GH_ADMIN_EXECUTION_MODE,
              liveExecutionEnabled: false
            }
          });
          return;
        }
      }
      patch.demoAutoTradeEnabled = body.demoAutoTradeEnabled;
    }

    try {
      const config = await saveGoldHunterConfig(uid, patch, uid);
      const details: string[] = [];
      if (
        patch.allocatedCapitalEur != null &&
        patch.allocatedCapitalEur !== prev.allocatedCapitalEur
      ) {
        details.push(
          `Allocation changed €${prev.allocatedCapitalEur} → €${patch.allocatedCapitalEur}`
        );
      }
      if (patch.demoAutoTradeEnabled === true) details.push("Demo AutoTrade enabled");
      if (patch.demoAutoTradeEnabled === false) details.push("Demo AutoTrade disabled");
      if (patch.pauseNewEntries === true) details.push("Pause New Entries activated");
      if (patch.pauseNewEntries === false) details.push("Pause New Entries cleared");
      if (patch.emergencyStopActive === true) details.push("Emergency Stop activated");
      if (patch.emergencyStopActive === false) details.push("Emergency Stop cleared");
      if (details.length) {
        await appendGoldHunterAudit(uid, {
          at: new Date().toISOString(),
          byUid: uid,
          action: "CONFIG_UPDATE",
          detail: details.join("; ")
        });
      }
      res.status(200).json({
        config,
        executionMode: GH_ADMIN_EXECUTION_MODE,
        liveExecutionEnabled: false,
        riskBudgetEur: plannedRiskBudgetEur(config),
        dailyLossBudgetEur: plannedDailyLossBudgetEur(config)
      });
    } catch (e) {
      const code =
        e && typeof e === "object" && "code" in e
          ? String((e as { code: unknown }).code)
          : "CONFIG_SAVE_FAILED";
      res.status(400).json({
        error: {
          code,
          message: e instanceof Error ? e.message : "config_save_failed"
        }
      });
    }
  });

  router.get("/v1/gold-hunter/trades", ...adminGate, async (req, res) => {
    const uid = getAuthenticatedUserId(req);
    if (!uid) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED" } });
      return;
    }
    const trades = await listGoldHunterDemoTrades(uid, { limit: 100 });
    res.status(200).json({
      trades,
      strategy: GH_ADMIN_STRATEGY_ID,
      environment: "DEMO"
    });
  });

  router.get("/v1/gold-hunter/performance", ...adminGate, async (req, res) => {
    const uid = getAuthenticatedUserId(req);
    if (!uid) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED" } });
      return;
    }
    const rangeRaw = String(req.query.range ?? "today");
    const range =
      rangeRaw === "week" || rangeRaw === "month" || rangeRaw === "all"
        ? rangeRaw
        : "today";
    const trades = await listGoldHunterDemoTrades(uid, { limit: 500 });
    const demo = computeDemoPerformance(trades, range);
    res.status(200).json({
      range,
      demo,
      // Paper kept separate — empty until reference paper store is attached.
      paper: null,
      paperNote: "Reference paper performance is separate and not combined with Demo P/L.",
      strategy: GH_ADMIN_STRATEGY_ID,
      environment: "DEMO"
    });
  });

  /** Explicit Live arm attempt — always refuse (proof endpoint). */
  router.post("/v1/gold-hunter/live/arm", ...adminGate, (_req, res) => {
    res.status(403).json({
      error: {
        code: "LIVE_EXECUTION_DISABLED",
        message: "Gold Hunter Live execution is permanently disabled. DEMO_ONLY.",
        executionMode: GH_ADMIN_EXECUTION_MODE,
        liveExecutionEnabled: false
      }
    });
  });

  return router;
};
