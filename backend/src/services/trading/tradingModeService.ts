import { createHash, randomUUID } from "crypto";
import {
  DEFAULT_DEMO_REQUIRED_CLOSED_TRADES,
  DEFAULT_DEMO_REQUIRED_DAYS,
  DEFAULT_DEMO_STARTING_EQUITY,
  DEFAULT_RISK_CONTROLS,
  type DemoOrderRecord,
  type DemoPerformanceSnapshot,
  type ProposeOrderRequest,
  type ProposedOrder,
  type TradingControls,
  type TradingControlsPatch
} from "../../models/trading";
import { resolveBrokerAdapter } from "../brokers/registry";
import { brokerSecretVault } from "../brokers/secretVault";
import { nowIso } from "../../utils/time";
import { evaluateSubmissionGuards, mergeRiskControls } from "./riskControls";

export interface TradingStorePort {
  getTradingControls(userId: string): Promise<TradingControls>;
  saveTradingControls(controls: TradingControls): Promise<TradingControls>;
  listDemoOrders(userId: string): Promise<DemoOrderRecord[]>;
  saveDemoOrder(order: DemoOrderRecord): Promise<DemoOrderRecord>;
  getDemoPerformance(userId: string): Promise<DemoPerformanceSnapshot>;
  saveDemoPerformance(snapshot: DemoPerformanceSnapshot): Promise<DemoPerformanceSnapshot>;
  saveEncryptedBrokerSecret(userId: string, brokerId: string, ciphertext: string): Promise<void>;
  getEncryptedBrokerSecret(userId: string, brokerId: string): Promise<string | undefined>;
  rememberSignalKey(userId: string, signalKey: string): Promise<boolean>;
  listSignalKeys(userId: string): Promise<string[]>;
  saveProposedOrder(order: ProposedOrder): Promise<ProposedOrder>;
  getProposedOrder(userId: string, proposalId: string): Promise<ProposedOrder | undefined>;
}

const defaultControls = (userId: string): TradingControls => ({
  userId,
  mode: "MANUAL",
  autoTradingEnabled: false,
  emergencyStopActive: false,
  liveAutoUnlocked: false,
  liveAutoEnabledByUser: false,
  selectedBrokerId: "trading212_manual",
  riskControls: { ...DEFAULT_RISK_CONTROLS },
  demoTesting: {
    requiredClosedTrades: DEFAULT_DEMO_REQUIRED_CLOSED_TRADES,
    closedTrades: 0,
    requiredDays: DEFAULT_DEMO_REQUIRED_DAYS,
    startedAt: null,
    completedAt: null
  },
  disclaimerAcknowledged: false,
  updatedAt: nowIso()
});

const defaultPerformance = (userId: string): DemoPerformanceSnapshot => ({
  userId,
  equity: DEFAULT_DEMO_STARTING_EQUITY,
  startingEquity: DEFAULT_DEMO_STARTING_EQUITY,
  peakEquity: DEFAULT_DEMO_STARTING_EQUITY,
  drawdownPercent: 0,
  closedTrades: 0,
  wins: 0,
  losses: 0,
  winRate: 0,
  averageR: 0,
  expectancyR: 0,
  updatedAt: nowIso()
});

export class TradingModeService {
  constructor(private readonly store: TradingStorePort) {}

  async getControls(userId: string): Promise<TradingControls> {
    const existing = await this.store.getTradingControls(userId);
    return this.refreshUnlockState(existing);
  }

  async patchControls(userId: string, patch: TradingControlsPatch): Promise<TradingControls> {
    const current = await this.getControls(userId);
    let next: TradingControls = {
      ...current,
      ...patch,
      riskControls: patch.riskControls
        ? mergeRiskControls(current.riskControls, patch.riskControls)
        : current.riskControls,
      updatedAt: nowIso()
    };

    if (patch.mode === "DEMO_AUTO" && !next.demoTesting.startedAt) {
      next = {
        ...next,
        demoTesting: { ...next.demoTesting, startedAt: nowIso() },
        selectedBrokerId: "demo_simulated",
        autoTradingEnabled: patch.autoTradingEnabled ?? true
      };
    }

    if (patch.mode === "MANUAL" || patch.mode === "CONFIRM") {
      next = {
        ...next,
        autoTradingEnabled: false,
        liveAutoEnabledByUser: false,
        selectedBrokerId: patch.selectedBrokerId ?? "trading212_manual"
      };
    }

    if (patch.mode === "LIVE_AUTO") {
      if (!next.liveAutoUnlocked) {
        throw Object.assign(new Error("Live Auto is locked until demo testing is complete."), {
          code: "LIVE_LOCKED"
        });
      }
      if (patch.liveAutoEnabledByUser === true || patch.autoTradingEnabled === true) {
        if (!next.disclaimerAcknowledged && !patch.disclaimerAcknowledged) {
          throw Object.assign(new Error("Acknowledge the no-guaranteed-profits disclaimer before Live Auto."), {
            code: "DISCLAIMER_REQUIRED"
          });
        }
      }
      // Live Auto cannot use Trading 212 for XAUUSD CFD automation.
      if (next.selectedBrokerId === "trading212_manual") {
        throw Object.assign(
          new Error(
            "Trading 212 Public API does not support XAUUSD CFD automation. Keep Trading 212 for manual execution or connect a compatible CFD broker adapter."
          ),
          { code: "BROKER_UNSUPPORTED" }
        );
      }
    }

    if (patch.emergencyStopActive === true) {
      next = {
        ...next,
        emergencyStopActive: true,
        autoTradingEnabled: false,
        liveAutoEnabledByUser: false
      };
    }

    if (patch.emergencyStopActive === false) {
      next = { ...next, emergencyStopActive: false };
    }

    next = this.refreshUnlockState(next);
    return this.store.saveTradingControls(next);
  }

  async emergencyStop(userId: string): Promise<{
    controls: TradingControls;
    cancelResult: { cancelled: number; message: string };
  }> {
    const controls = await this.patchControls(userId, {
      emergencyStopActive: true,
      autoTradingEnabled: false,
      liveAutoEnabledByUser: false
    });
    const adapter = resolveBrokerAdapter(
      controls.mode === "DEMO_AUTO" ? "demo_simulated" : controls.selectedBrokerId
    );
    const cancelResult = await adapter.cancelPendingOrders();
    return { controls, cancelResult };
  }

  async proposeOrExecute(
    userId: string,
    request: ProposeOrderRequest
  ): Promise<{
    proposal: ProposedOrder;
    execution?: { status: string; message: string; brokerOrderId?: string };
  }> {
    const controls = await this.getControls(userId);
    const orders = await this.store.listDemoOrders(userId);
    const tradesToday = orders.filter((o) => o.createdAt.slice(0, 10) === nowIso().slice(0, 10)).length;
    const performance = await this.store.getDemoPerformance(userId);
    const realizedDailyLossPercent = Math.max(
      0,
      ((performance.peakEquity - performance.equity) / performance.peakEquity) * 100
    );
    const seen = new Set(await this.store.listSignalKeys(userId));

    const draftingConfirm = controls.mode === "CONFIRM" && !request.confirmationToken;
    const guard = evaluateSubmissionGuards({
      controls,
      request,
      tradesToday,
      realizedDailyLossPercent,
      seenSignalKeys: seen,
      allowConfirmProposal: draftingConfirm
    });

    const proposalId = `prop-${randomUUID()}`;
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const brokerId =
      controls.mode === "DEMO_AUTO" ? "demo_simulated" : controls.selectedBrokerId;

    const baseProposal: ProposedOrder = {
      proposalId,
      decisionId: request.decisionId,
      symbol: "XAUUSD",
      side: request.side,
      orderType: request.orderType,
      quantity: request.quantity,
      entryPrice: request.entryPrice ?? null,
      stopLoss: request.stopLoss ?? null,
      takeProfits: request.takeProfits,
      riskPercent: request.riskPercent,
      confidence: request.confidence,
      mode: controls.mode,
      brokerId,
      status: "PROPOSED",
      createdAt,
      expiresAt,
      instructions: [
        "GoldMeta does not guarantee profits.",
        "Position size is never increased to recover losses.",
        "Martingale, grid recovery, and averaging down are disabled."
      ],
      blockedReasons: guard.blocks.map((b) => b.message)
    };

    if (controls.mode === "MANUAL" || !guard.allowed) {
      const adapter = resolveBrokerAdapter(brokerId);
      const manual = await adapter.placeEntry({
        decisionId: request.decisionId,
        side: request.side,
        orderType: request.orderType,
        quantity: request.quantity,
        entryPrice: request.entryPrice ?? null,
        stopLoss: request.stopLoss ?? null,
        takeProfits: request.takeProfits,
        clientOrderKey: proposalId
      });
      const proposal = await this.store.saveProposedOrder({
        ...baseProposal,
        status: controls.mode === "MANUAL" ? "PROPOSED" : "BLOCKED",
        instructions: [...baseProposal.instructions, ...(manual.instructions ?? [])],
        blockedReasons:
          controls.mode === "MANUAL"
            ? ["Manual mode — instructions only, no submission."]
            : guard.blocks.map((b) => b.message)
      });
      return { proposal };
    }

    if (controls.mode === "CONFIRM" && !request.confirmationToken) {
      const proposal = await this.store.saveProposedOrder({
        ...baseProposal,
        status: "PROPOSED",
        instructions: [
          ...baseProposal.instructions,
          "Confirm with Face ID or explicit confirmation to submit this proposed order."
        ]
      });
      return { proposal };
    }

    if (controls.mode === "CONFIRM" && request.confirmationToken) {
      // Token proves client-side biometric/explicit confirm; do not log the token.
      if (request.confirmationToken.length < 8) {
        const proposal = await this.store.saveProposedOrder({
          ...baseProposal,
          status: "BLOCKED",
          blockedReasons: ["Invalid confirmation token."]
        });
        return { proposal };
      }
    }

    const adapter = resolveBrokerAdapter(brokerId);
    if (!adapter.supports("ENTER") || !adapter.capabilities().automatedSubmission) {
      const manual = await adapter.placeEntry({
        decisionId: request.decisionId,
        side: request.side,
        orderType: request.orderType,
        quantity: request.quantity,
        entryPrice: request.entryPrice ?? null,
        stopLoss: request.stopLoss ?? null,
        takeProfits: request.takeProfits,
        clientOrderKey: proposalId
      });
      const proposal = await this.store.saveProposedOrder({
        ...baseProposal,
        status: "BLOCKED",
        instructions: [...baseProposal.instructions, ...(manual.instructions ?? [])],
        blockedReasons: [
          "Selected broker adapter does not support automated XAUUSD entry.",
          manual.message
        ]
      });
      return { proposal };
    }

    if (request.signalKey) {
      await this.store.rememberSignalKey(userId, request.signalKey);
    }

    const result = await adapter.placeEntry({
      decisionId: request.decisionId,
      side: request.side,
      orderType: request.orderType,
      quantity: request.quantity,
      entryPrice: request.entryPrice ?? null,
      stopLoss: request.stopLoss ?? null,
      takeProfits: request.takeProfits,
      clientOrderKey: proposalId
    });

    const proposal = await this.store.saveProposedOrder({
      ...baseProposal,
      status: result.accepted ? "EXECUTED" : "BLOCKED",
      instructions: [...baseProposal.instructions, ...(result.instructions ?? [])],
      blockedReasons: result.accepted ? [] : [result.message]
    });

    if (result.accepted && controls.mode === "DEMO_AUTO") {
      await this.recordDemoFill(userId, request, proposal, result.fillPrice ?? request.entryPrice ?? 0);
    }

    return {
      proposal,
      execution: {
        status: result.status,
        message: result.message,
        brokerOrderId: result.brokerOrderId
      }
    };
  }

  async storeBrokerCredentials(
    userId: string,
    brokerId: string,
    apiKey: string,
    apiSecret: string
  ): Promise<{ stored: true; brokerId: string }> {
    if (!brokerSecretVault.isConfigured()) {
      throw Object.assign(new Error("Broker secret encryption key is not configured on the backend."), {
        code: "SECRETS_NOT_CONFIGURED"
      });
    }
    // Never log apiKey/apiSecret.
    const payload = JSON.stringify({
      apiKey,
      apiSecret,
      storedAt: nowIso(),
      fingerprint: createHash("sha256").update(`${brokerId}:${apiKey}`).digest("hex").slice(0, 12)
    });
    const ciphertext = brokerSecretVault.encrypt(payload);
    await this.store.saveEncryptedBrokerSecret(userId, brokerId, ciphertext);
    return { stored: true, brokerId };
  }

  async getDemoPerformance(userId: string): Promise<DemoPerformanceSnapshot> {
    return this.store.getDemoPerformance(userId);
  }

  async listDemoOrders(userId: string): Promise<DemoOrderRecord[]> {
    return this.store.listDemoOrders(userId);
  }

  private refreshUnlockState(controls: TradingControls): TradingControls {
    const demo = controls.demoTesting;
    const startedAt = demo.startedAt ? new Date(demo.startedAt).getTime() : null;
    const daysElapsed =
      startedAt == null ? 0 : Math.floor((Date.now() - startedAt) / (24 * 60 * 60 * 1000));
    const requirementsMet =
      demo.closedTrades >= demo.requiredClosedTrades && daysElapsed >= demo.requiredDays;
    const liveAutoUnlocked = requirementsMet;
    const completedAt = requirementsMet ? demo.completedAt ?? nowIso() : demo.completedAt;
    return {
      ...controls,
      liveAutoUnlocked,
      demoTesting: { ...demo, completedAt },
      // Safety: if still locked, force live flags off.
      liveAutoEnabledByUser: liveAutoUnlocked ? controls.liveAutoEnabledByUser : false,
      autoTradingEnabled:
        controls.mode === "LIVE_AUTO"
          ? liveAutoUnlocked && controls.liveAutoEnabledByUser && controls.autoTradingEnabled
          : controls.autoTradingEnabled
    };
  }

  private async recordDemoFill(
    userId: string,
    request: ProposeOrderRequest,
    proposal: ProposedOrder,
    fillPrice: number
  ): Promise<void> {
    const timestamp = nowIso();
    const order: DemoOrderRecord = {
      orderId: `demo-ord-${randomUUID()}`,
      userId,
      proposalId: proposal.proposalId,
      decisionId: request.decisionId,
      symbol: "XAUUSD",
      side: request.side,
      status: "FILLED",
      quantity: request.quantity,
      filledQuantity: request.quantity,
      entryPrice: fillPrice,
      stopLoss: request.stopLoss ?? null,
      takeProfits: request.takeProfits.map((tp) => ({ ...tp, filled: false })),
      realizedR: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      closedAt: null
    };
    await this.store.saveDemoOrder(order);

    const controls = await this.getControls(userId);
    if (!controls.demoTesting.startedAt) {
      await this.store.saveTradingControls({
        ...controls,
        demoTesting: { ...controls.demoTesting, startedAt: timestamp },
        updatedAt: timestamp
      });
    }
  }

  /** Test/helper: close a demo trade and update performance + unlock progress. */
  async closeDemoTrade(userId: string, orderId: string, realizedR: number): Promise<DemoPerformanceSnapshot> {
    const orders = await this.store.listDemoOrders(userId);
    const order = orders.find((o) => o.orderId === orderId);
    if (!order) {
      throw Object.assign(new Error("Demo order not found"), { code: "NOT_FOUND" });
    }
    const closed: DemoOrderRecord = {
      ...order,
      status: "FILLED",
      realizedR,
      closedAt: nowIso(),
      updatedAt: nowIso()
    };
    await this.store.saveDemoOrder(closed);

    const performance = await this.store.getDemoPerformance(userId);
    const equityDelta = (realizedR * performance.startingEquity * DEFAULT_RISK_CONTROLS.maxRiskPerTradePercent) / 100;
    const equity = performance.equity + equityDelta;
    const peakEquity = Math.max(performance.peakEquity, equity);
    const closedTrades = performance.closedTrades + 1;
    const wins = performance.wins + (realizedR > 0 ? 1 : 0);
    const losses = performance.losses + (realizedR < 0 ? 1 : 0);
    const averageR =
      (performance.averageR * performance.closedTrades + realizedR) / closedTrades;
    const snapshot: DemoPerformanceSnapshot = {
      userId,
      equity,
      startingEquity: performance.startingEquity,
      peakEquity,
      drawdownPercent: peakEquity === 0 ? 0 : Number((((peakEquity - equity) / peakEquity) * 100).toFixed(4)),
      closedTrades,
      wins,
      losses,
      winRate: closedTrades === 0 ? 0 : wins / closedTrades,
      averageR,
      expectancyR: averageR,
      updatedAt: nowIso()
    };
    await this.store.saveDemoPerformance(snapshot);

    const controls = await this.getControls(userId);
    await this.store.saveTradingControls(
      this.refreshUnlockState({
        ...controls,
        demoTesting: {
          ...controls.demoTesting,
          closedTrades: controls.demoTesting.closedTrades + 1,
          startedAt: controls.demoTesting.startedAt ?? nowIso()
        },
        updatedAt: nowIso()
      })
    );

    return snapshot;
  }
}

export const createDefaultTradingControls = defaultControls;
export const createDefaultDemoPerformance = defaultPerformance;
