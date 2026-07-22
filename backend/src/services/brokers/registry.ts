import type { BrokerAdapter } from "./types";
import { DemoSimulatedAdapter } from "./demoSimulatedAdapter";
import { Trading212ManualAdapter } from "./trading212ManualAdapter";

const trading212 = new Trading212ManualAdapter();
const demo = new DemoSimulatedAdapter();

export const resolveBrokerAdapter = (brokerId: string): BrokerAdapter => {
  switch (brokerId) {
    case "demo_simulated":
      return demo;
    case "trading212_manual":
    case "none":
    default:
      return trading212;
  }
};

export const listBrokerAdapters = (): BrokerAdapter[] => [trading212, demo];
