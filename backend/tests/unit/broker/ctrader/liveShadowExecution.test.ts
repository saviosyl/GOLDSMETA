import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  isCTraderLiveEnabled,
  isCTraderLiveExecutionOwnerApproved,
  isCTraderLiveShadowEnabled
} from "../../../../src/services/broker/ctrader/flags";
import { buildIntentKey } from "../../../../src/services/broker/ctrader/preview";
import { lotsToOrderVolumeUnits } from "../../../../src/services/broker/ctrader/volumeUnits";

vi.mock("firebase-admin/firestore", () => {
  const store = new Map<string, Record<string, unknown>>();
  return {
    getFirestore: () => ({
      doc: (path: string) => ({
        get: async () => ({
          exists: store.has(path),
          data: () => store.get(path)
        }),
        set: async (data: Record<string, unknown>) => {
          store.set(path, { ...(store.get(path) ?? {}), ...data });
        }
      }),
      collection: (path: string) => ({
        doc: () => ({
          set: async (data: Record<string, unknown>) => {
            store.set(`${path}/${Math.random()}`, data);
          }
        }),
        orderBy: () => ({
          limit: () => ({
            get: async () => ({ docs: [] })
          })
        })
      }),
      runTransaction: async (
        fn: (tx: {
          get: (ref: { path?: string }) => Promise<{
            exists: boolean;
            data: () => Record<string, unknown> | undefined;
          }>;
          set: (ref: { path?: string }, data: Record<string, unknown>) => void;
        }) => Promise<unknown>
      ) => {
        const tx = {
          get: async (ref: { path?: string }) => {
            const path = String((ref as { _path?: string })._path ?? "");
            return {
              exists: store.has(path),
              data: () => store.get(path)
            };
          },
          set: (ref: { path?: string }, data: Record<string, unknown>) => {
            const path = String((ref as { _path?: string })._path ?? Math.random());
            store.set(path, data);
          }
        };
        return fn(tx as never);
      }
    }),
    FieldValue: { serverTimestamp: () => "SERVER_TS" }
  };
});

describe("LIVE shadow flags / hard locks", () => {
  beforeEach(() => {
    delete process.env.CTRADER_LIVE_SHADOW_ENABLED;
    delete process.env.CTRADER_LIVE_ENABLED;
  });

  it("keeps isCTraderLiveEnabled hard-false even when env tries true", () => {
    expect(isCTraderLiveEnabled()).toBe(false);
    expect(
      isCTraderLiveEnabled({ CTRADER_LIVE_ENABLED: "true" } as NodeJS.ProcessEnv)
    ).toBe(false);
  });

  it("keeps owner-approval latch hard-false", () => {
    expect(isCTraderLiveExecutionOwnerApproved()).toBe(false);
    expect(
      isCTraderLiveExecutionOwnerApproved({
        CTRADER_LIVE_EXECUTION_OWNER_APPROVED: "true"
      } as NodeJS.ProcessEnv)
    ).toBe(false);
  });

  it("enables shadow only via CTRADER_LIVE_SHADOW_ENABLED", () => {
    expect(isCTraderLiveShadowEnabled()).toBe(false);
    expect(
      isCTraderLiveShadowEnabled({
        CTRADER_LIVE_SHADOW_ENABLED: "true"
      } as NodeJS.ProcessEnv)
    ).toBe(true);
  });
});

describe("LIVE shadow order payload math", () => {
  it("converts lots to protocol volume units (100 cents = 1.00 lot)", () => {
    expect(lotsToOrderVolumeUnits(0.01)).toBe(1);
    expect(lotsToOrderVolumeUnits(1)).toBe(100);
  });

  it("builds stable intent keys for duplicate prevention", () => {
    const a = buildIntentKey({
      ownerUid: "u1",
      broker: "pepperstone_ctrader",
      accountId: "12345606",
      environment: "LIVE",
      decisionId: "d1",
      symbolId: "41",
      action: "BUY"
    });
    const b = buildIntentKey({
      ownerUid: "u1",
      broker: "pepperstone_ctrader",
      accountId: "12345606",
      environment: "LIVE",
      decisionId: "d1",
      symbolId: "41",
      action: "BUY"
    });
    const c = buildIntentKey({
      ownerUid: "u1",
      broker: "pepperstone_ctrader",
      accountId: "12345606",
      environment: "LIVE",
      decisionId: "d2",
      symbolId: "41",
      action: "BUY"
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("stop/TP ordering helpers via preview", async () => {
  const { buildTradePreview } = await import(
    "../../../../src/services/broker/ctrader/preview"
  );
  const { fixtureXauUsdSymbol } = await import(
    "../../../../src/services/broker/ctrader/fixtures"
  );

  it("BUY with inverted stop is blocked by sizing/gates path", () => {
    const symbol = fixtureXauUsdSymbol();
    const preview = buildTradePreview({
      decisionId: "d-buy",
      decision: "BUY",
      confidence: 90,
      generatedAt: new Date().toISOString(),
      candleConfirmed: true,
      stopLoss: 4300,
      takeProfits: [4280],
      symbol,
      quote: {
        symbolId: symbol.symbolId,
        symbolName: "XAUUSD",
        bid: 4290,
        ask: 4290.2,
        spread: 0.2,
        timestamp: new Date().toISOString(),
        marketStatus: "OPEN",
        stale: false,
        source: "LIVE"
      },
      position: null,
      pendingOrdersCount: 0,
      equity: 5000,
      freeMargin: 4500,
      accountCurrency: "EUR",
      riskAmountEur: 20,
      maxSpread: 2
    });
    // inverted levels still produce a preview; shadow layer adds STOP_ORDERING_INVALID
    expect(preview.intendedEntry).toBe(4290.2);
    expect(preview.orderSubmissionEnabled).toBe(false);
  });
});
