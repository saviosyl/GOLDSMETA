import {
  type DemoOrderRecord,
  type DemoPerformanceSnapshot,
  type ProposedOrder,
  type TradingControls
} from "../../models/trading";
import {
  createDefaultDemoPerformance,
  createDefaultTradingControls,
  type TradingStorePort
} from "../trading/tradingModeService";

export class InMemoryTradingStore implements TradingStorePort {
  private controls = new Map<string, TradingControls>();
  private demoOrders = new Map<string, DemoOrderRecord[]>();
  private performance = new Map<string, DemoPerformanceSnapshot>();
  private secrets = new Map<string, string>();
  private signalKeys = new Map<string, Set<string>>();
  private proposals = new Map<string, ProposedOrder>();

  getTradingControls(userId: string): Promise<TradingControls> {
    const existing = this.controls.get(userId);
    if (existing) return Promise.resolve(existing);
    const created = createDefaultTradingControls(userId);
    this.controls.set(userId, created);
    return Promise.resolve(created);
  }

  saveTradingControls(controls: TradingControls): Promise<TradingControls> {
    this.controls.set(controls.userId, controls);
    return Promise.resolve(controls);
  }

  listDemoOrders(userId: string): Promise<DemoOrderRecord[]> {
    return Promise.resolve([...(this.demoOrders.get(userId) ?? [])]);
  }

  saveDemoOrder(order: DemoOrderRecord): Promise<DemoOrderRecord> {
    const list = this.demoOrders.get(order.userId) ?? [];
    const idx = list.findIndex((o) => o.orderId === order.orderId);
    if (idx >= 0) list[idx] = order;
    else list.unshift(order);
    this.demoOrders.set(order.userId, list);
    return Promise.resolve(order);
  }

  getDemoPerformance(userId: string): Promise<DemoPerformanceSnapshot> {
    const existing = this.performance.get(userId);
    if (existing) return Promise.resolve(existing);
    const created = createDefaultDemoPerformance(userId);
    this.performance.set(userId, created);
    return Promise.resolve(created);
  }

  saveDemoPerformance(snapshot: DemoPerformanceSnapshot): Promise<DemoPerformanceSnapshot> {
    this.performance.set(snapshot.userId, snapshot);
    return Promise.resolve(snapshot);
  }

  saveEncryptedBrokerSecret(userId: string, brokerId: string, ciphertext: string): Promise<void> {
    this.secrets.set(`${userId}:${brokerId}`, ciphertext);
    return Promise.resolve();
  }

  getEncryptedBrokerSecret(userId: string, brokerId: string): Promise<string | undefined> {
    return Promise.resolve(this.secrets.get(`${userId}:${brokerId}`));
  }

  rememberSignalKey(userId: string, signalKey: string): Promise<boolean> {
    const set = this.signalKeys.get(userId) ?? new Set<string>();
    const isNew = !set.has(signalKey);
    set.add(signalKey);
    this.signalKeys.set(userId, set);
    return Promise.resolve(isNew);
  }

  listSignalKeys(userId: string): Promise<string[]> {
    return Promise.resolve([...(this.signalKeys.get(userId) ?? [])]);
  }

  saveProposedOrder(order: ProposedOrder): Promise<ProposedOrder> {
    this.proposals.set(order.proposalId, order);
    return Promise.resolve(order);
  }

  getProposedOrder(_userId: string, proposalId: string): Promise<ProposedOrder | undefined> {
    return Promise.resolve(this.proposals.get(proposalId));
  }
}
