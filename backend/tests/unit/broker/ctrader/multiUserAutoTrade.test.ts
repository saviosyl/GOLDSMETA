/**
 * Multi-user broker isolation, Demo/Live settings separation, sizing modes,
 * Emergency STOP scoping, and no-order guarantees for UI-development phase.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type DocData = Record<string, unknown>;

const store = vi.hoisted(() => {
  const oauthStates = new Map<string, DocData>();
  const docs = new Map<string, DocData>();
  return {
    oauthStates,
    docs,
    reset() {
      oauthStates.clear();
      docs.clear();
    }
  };
});

vi.mock("firebase-admin/firestore", () => {
  function oauthDoc(id: string) {
    return {
      id,
      async set(data: DocData) {
        store.oauthStates.set(id, { ...data });
      },
      async get() {
        const data = store.oauthStates.get(id);
        return { exists: Boolean(data), data: () => data };
      },
      async update(data: DocData) {
        const prev = store.oauthStates.get(id) ?? {};
        store.oauthStates.set(id, { ...prev, ...data });
      }
    };
  }

  function plainDoc(path: string) {
    return {
      path,
      id: path,
      async set(data: DocData, opts?: { merge?: boolean }) {
        const prev = store.docs.get(path) ?? {};
        store.docs.set(path, opts?.merge ? { ...prev, ...data } : { ...data });
      },
      async get() {
        const data = store.docs.get(path);
        return { exists: Boolean(data), data: () => data };
      }
    };
  }

  return {
    getFirestore: () => ({
      collection(name: string) {
        if (name !== "ctraderOAuthStates") {
          throw new Error(`unexpected collection ${name}`);
        }
        return {
          doc(id: string) {
            return oauthDoc(id);
          }
        };
      },
      doc(path: string) {
        return plainDoc(path);
      },
      async runTransaction<T>(
        fn: (tx: {
          get: (ref: ReturnType<typeof oauthDoc>) => Promise<{
            exists: boolean;
            data: () => unknown;
          }>;
          update: (ref: ReturnType<typeof oauthDoc>, data: DocData) => void;
        }) => Promise<T>
      ) {
        return fn({
          get: async (ref) => ref.get(),
          update: (ref, data) => {
            const prev = store.oauthStates.get(ref.id) ?? {};
            store.oauthStates.set(ref.id, { ...prev, ...data });
          }
        });
      }
    })
  };
});

vi.mock("../../../../src/services/auth/ownerAuthConfig", () => ({
  loadOwnerAuthConfig: () => ({
    ownerEmail: "owner@example.com",
    pinnedOwnerUid: "owner-uid-aaaaaaaa"
  })
}));

import {
  completeOAuthCallback,
  listAuthorisedAccountsForUser,
  selectBrokerAccountForUser,
  startOAuthForOwner
} from "../../../../src/services/broker/ctrader/connectionService";
import { getConnection } from "../../../../src/services/broker/ctrader/connectionStore";
import { createMockOpenApiClient } from "../../../../src/services/broker/ctrader/openApiClient";
import {
  confirmLiveActivation,
  getUserAutoTradeSettings,
  saveUserAutoTradeSettings,
  setEmergencyStop
} from "../../../../src/services/broker/ctrader/userAutoTradeSettings";
import {
  calculateCTraderVolume,
  calculateManualLotVolume
} from "../../../../src/services/broker/ctrader/sizing";
import { snapshotCTraderFlags } from "../../../../src/services/broker/ctrader/flags";
import { cTraderOrderApi } from "../../../../src/services/broker/ctrader/cTraderService";
import { maskAccountId } from "../../../../src/services/broker/ctrader/tokenCrypto";

const USER_A = "user-aaaa-11111111";
const USER_B = "user-bbbb-22222222";

function setCredEnv() {
  process.env.CTRADER_CLIENT_ID = "test-client";
  process.env.CTRADER_CLIENT_SECRET = "test-secret";
  process.env.CTRADER_REDIRECT_URI = "https://example.test/v1/ctrader/oauth/callback";
  process.env.CTRADER_ENVIRONMENT = "DEMO";
  process.env.CTRADER_TOKEN_ENCRYPTION_KEY = "unit-test-encryption-key-32b";
  process.env.CTRADER_OPENAPI_TRANSPORT = "mock";
}

async function connectUser(uid: string) {
  const started = await startOAuthForOwner(uid);
  await completeOAuthCallback({
    code: `code-${uid}`,
    state: started.state,
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({
          accessToken: `access-${uid}`,
          refreshToken: `refresh-${uid}`,
          expiresIn: 3600
        }),
        { status: 200 }
      )) as unknown as typeof fetch
  });
}

describe("multi-user broker isolation", () => {
  beforeEach(() => {
    store.reset();
    setCredEnv();
  });

  it("lets two users connect separate broker accounts under their own UID", async () => {
    await connectUser(USER_A);
    await connectUser(USER_B);

    const connA = await getConnection(USER_A);
    const connB = await getConnection(USER_B);
    expect(connA?.ownerUid).toBe(USER_A);
    expect(connB?.ownerUid).toBe(USER_B);
    expect(connA?.tokens.ciphertext).toBeTruthy();
    expect(connB?.tokens.ciphertext).toBeTruthy();
    expect(connA?.tokens.ciphertext).not.toBe(connB?.tokens.ciphertext);

    expect(store.docs.has(`users/${USER_A}/ctraderConnection/current`)).toBe(true);
    expect(store.docs.has(`users/${USER_B}/ctraderConnection/current`)).toBe(true);
  });

  it("rejects selecting another user's account ID against this user's OAuth list", async () => {
    await connectUser(USER_A);
    const api = createMockOpenApiClient({
      accounts: [
        {
          ctidTraderAccountId: "acct-a-demo",
          isLive: false,
          brokerNameTitle: "Pepperstone - Europe",
          depositCurrency: "EUR",
          leverage: 100,
          accountIdMasked: maskAccountId("acct-a-demo"),
          accountKeyHash: "ha"
        }
      ]
    });

    await expect(
      selectBrokerAccountForUser({
        ownerUid: USER_A,
        ctidTraderAccountId: "acct-b-foreign",
        api
      })
    ).rejects.toThrow(/CTRADER_ACCOUNT_NOT_AUTHORISED/);
  });

  it("allows Demo and Live selection from OAuth-returned accounts", async () => {
    await connectUser(USER_A);
    const api = createMockOpenApiClient({
      accounts: [
        {
          ctidTraderAccountId: "48…10",
          isLive: false,
          brokerNameTitle: "Pepperstone - Europe",
          depositCurrency: "EUR",
          leverage: 100,
          accountIdMasked: maskAccountId("48123410"),
          accountKeyHash: "hd"
        },
        {
          ctidTraderAccountId: "72…45",
          isLive: true,
          brokerNameTitle: "Pepperstone - Europe",
          depositCurrency: "EUR",
          leverage: 30,
          accountIdMasked: maskAccountId("72123445"),
          accountKeyHash: "hl"
        }
      ]
    });

    const listed = await listAuthorisedAccountsForUser(USER_A, api);
    expect(listed).toHaveLength(2);
    expect(listed.some((a) => a.isLive)).toBe(true);
    expect(listed.some((a) => !a.isLive)).toBe(true);

    const demo = await selectBrokerAccountForUser({
      ownerUid: USER_A,
      ctidTraderAccountId: "48…10",
      confirmPepperstone: true,
      api
    });
    expect(demo.account.isDemo).toBe(true);

    await expect(
      selectBrokerAccountForUser({
        ownerUid: USER_A,
        ctidTraderAccountId: "72…45",
        api
      })
    ).rejects.toThrow(/CTRADER_LIVE_SELECTION_CONFIRMATION_REQUIRED/);

    const live = await selectBrokerAccountForUser({
      ownerUid: USER_A,
      ctidTraderAccountId: "72…45",
      confirmPepperstone: true,
      confirmLiveSelection: true,
      api
    });
    expect(live.account.isDemo).toBe(false);
    const conn = await getConnection(USER_A);
    expect(conn?.environment).toBe("LIVE");
    expect(conn?.selectedAccountIsLive).toBe(true);
  });
});

describe("Demo/Live settings separation", () => {
  beforeEach(() => {
    store.reset();
    setCredEnv();
  });

  it("stores Demo and Live settings separately and persists user inputs", async () => {
    const demo = await saveUserAutoTradeSettings(USER_A, "demo", {
      fixedRiskAmount: 35,
      maxTradesPerDay: 5,
      minConfidence: 70,
      sizingMode: "manual_lots",
      manualLotSize: 0.05,
      autoTradeEnabledIntent: true
    });
    expect(demo.fixedRiskAmount).toBe(35);
    expect(demo.autoTradeEnabledIntent).toBe(true);
    expect(demo.liveActivationPhraseConfirmed).toBe(false);

    const live = await getUserAutoTradeSettings(USER_A, "live");
    expect(live.fixedRiskAmount).toBe(20);
    expect(live.autoTradeEnabledIntent).toBe(false);

    await saveUserAutoTradeSettings(USER_A, "live", {
      fixedRiskAmount: 50,
      maxDailyLoss: 120
    });
    const demoAgain = await getUserAutoTradeSettings(USER_A, "demo");
    expect(demoAgain.fixedRiskAmount).toBe(35);
    const liveAgain = await getUserAutoTradeSettings(USER_A, "live");
    expect(liveAgain.fixedRiskAmount).toBe(50);
    expect(liveAgain.maxDailyLoss).toBe(120);
  });

  it("does not let Demo activation enable Live", async () => {
    await saveUserAutoTradeSettings(USER_A, "demo", { autoTradeEnabledIntent: true });
    await expect(
      saveUserAutoTradeSettings(USER_A, "live", { autoTradeEnabledIntent: true })
    ).rejects.toThrow(/LIVE_ACTIVATION_REQUIRED|Confirm Live/);

    await confirmLiveActivation(USER_A, "ENABLE LIVE");
    const live = await saveUserAutoTradeSettings(USER_A, "live", {
      autoTradeEnabledIntent: true
    });
    expect(live.liveActivationPhraseConfirmed).toBe(true);
    expect(live.autoTradeEnabledIntent).toBe(true);

    const demo = await getUserAutoTradeSettings(USER_A, "demo");
    expect(demo.liveActivationPhraseConfirmed).toBe(false);
  });

  it("rejects invalid settings with friendly validation", async () => {
    await expect(
      saveUserAutoTradeSettings(USER_A, "demo", { fixedRiskAmount: -5 })
    ).rejects.toThrow(/SETTINGS_VALIDATION_FAILED|between/);
  });

  it("scopes Emergency STOP to the correct user/environment", async () => {
    await setEmergencyStop(USER_A, "demo", true);
    await setEmergencyStop(USER_B, "live", true);

    const aDemo = await getUserAutoTradeSettings(USER_A, "demo");
    const aLive = await getUserAutoTradeSettings(USER_A, "live");
    const bDemo = await getUserAutoTradeSettings(USER_B, "demo");
    const bLive = await getUserAutoTradeSettings(USER_B, "live");

    expect(aDemo.emergencyStopActive).toBe(true);
    expect(aLive.emergencyStopActive).toBe(false);
    expect(bDemo.emergencyStopActive).toBe(false);
    expect(bLive.emergencyStopActive).toBe(true);
  });
});

describe("lot sizing modes", () => {
  const base = {
    equity: 10000,
    freeMargin: 9500,
    accountCurrency: "EUR",
    riskAmountEur: 20,
    entryPrice: 2350,
    stopLoss: 2340,
    lotSize: 100,
    tickSize: 0.01,
    minVolume: 0.01,
    volumeStep: 0.01,
    maxVolume: 100,
    marginPerLot: 200,
    eurToAccountRate: 1 as number | null
  };

  it("calculates automatic risk-based volume", () => {
    const result = calculateCTraderVolume({ ...base, sizingMode: "automatic_risk" });
    expect(result.ok).toBe(true);
    expect(result.volume).toBeGreaterThan(0);
    expect(result.rejectionReason).toBeNull();
  });

  it("supports manual lot size and estimates loss/margin", () => {
    const result = calculateManualLotVolume({
      ...base,
      sizingMode: "manual_lots",
      manualLotSize: 0.05
    });
    expect(result.ok).toBe(true);
    expect(result.volume).toBe(0.05);
    expect(result.estimatedMaxLoss).toBeGreaterThan(0);
    expect(result.estimatedMargin).toBe(10);
  });

  it("rejects broker-incompatible volume without silently changing lots", () => {
    const below = calculateManualLotVolume({
      ...base,
      minVolume: 1,
      volumeStep: 1,
      sizingMode: "manual_lots",
      manualLotSize: 0.05
    });
    expect(below.ok).toBe(false);
    expect(below.rejectionReason).toBe("VOLUME_BELOW_MINIMUM");
    expect(below.volume).toBeNull();

    const step = calculateManualLotVolume({
      ...base,
      volumeStep: 0.1,
      sizingMode: "manual_lots",
      manualLotSize: 0.05
    });
    expect(step.ok).toBe(false);
    expect(step.rejectionReason).toBe("VOLUME_STEP_MISMATCH");
  });
});

describe("preview phase safety", () => {
  it("keeps Live hard-disabled; Demo submission stays env-gated", () => {
    const prev = process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
    delete process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
    const flags = snapshotCTraderFlags();
    expect(flags.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED).toBe(false);
    expect(flags.CTRADER_LIVE_ENABLED).toBe(false);
    expect(flags.BROKER_EXECUTION_ENABLED).toBe(false);
    expect(flags.mutationFlagsHardFalse).toBe(true);
    expect(() => cTraderOrderApi.placeMarketBuy()).toThrow();
    if (prev === undefined) delete process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
    else process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = prev;
  });
});
