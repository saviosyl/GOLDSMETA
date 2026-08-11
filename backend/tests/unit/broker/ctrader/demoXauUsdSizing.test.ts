/**
 * Pepperstone Demo XAUUSD economic sizing — fail-closed risk path.
 * Scope: unit conversion + cash-risk sizing only (no UI / Decision Engine).
 */
import { describe, expect, it } from "vitest";
import {
  PEPPERSTONE_CTRADER_XAUUSD_DEMO,
  estimateXauUsdGrossPnlDeposit,
  lotsFromProtocolVolume,
  protocolVolumeFromLots,
  resolvePepperstoneXauUsdDemoMapping
} from "../../../../src/services/broker/ctrader/brokerUnitMappings";
import {
  calculatePepperstoneXauUsdDemoVolume,
  estimateMarginDeposit,
  resolveExposureCapLots
} from "../../../../src/services/broker/ctrader/demoXauUsdSizing";
import {
  assessFxQuoteFreshness,
  resolveQuoteToDepositFx,
  usdToDepositFromEurUsdMid
} from "../../../../src/services/broker/ctrader/quoteToDepositFx";
import { createMockOpenApiClient } from "../../../../src/services/broker/ctrader/openApiClient";
import { calculateCTraderVolume } from "../../../../src/services/broker/ctrader/sizing";
import { parseCTraderVolumeRules } from "../../../../src/services/broker/ctrader/volumeUnits";
import { isCTraderLiveEnabled } from "../../../../src/services/broker/ctrader/flags";
import { evaluateArmedCandidateLifecycle } from "../../../../src/services/broker/ctrader/armedCandidate";
import { DEMO_HARD_CAPS } from "../../../../src/services/broker/ctrader/liveRiskCaps";

/** Proven Demo FX from PID53870324 reconstruction. */
const PROVEN_QUOTE_TO_DEPOSIT = 0.86624336;
const PROVEN_STOP = 0.26;
const PROVEN_ENTRY = 4376.63;
const PROVEN_LEVERAGE = 30;

const PEPPERSTONE_VOLUME_RULES = parseCTraderVolumeRules({
  minVolume: "100",
  maxVolume: "500000",
  stepVolume: "100",
  lotSize: "10000"
});

function baseSizing(
  overrides: Partial<Parameters<typeof calculatePepperstoneXauUsdDemoVolume>[0]> = {}
) {
  return calculatePepperstoneXauUsdDemoVolume({
    riskAmountDeposit: 20,
    entryPrice: PROVEN_ENTRY,
    stopLoss: PROVEN_ENTRY - PROVEN_STOP,
    quoteToDepositRate: PROVEN_QUOTE_TO_DEPOSIT,
    ozPerLot: 1,
    minLots: PEPPERSTONE_VOLUME_RULES.minLots,
    stepLots: PEPPERSTONE_VOLUME_RULES.stepLots,
    maxLots: PEPPERSTONE_VOLUME_RULES.maxLots,
    freeMargin: 50_000,
    leverage: PROVEN_LEVERAGE,
    remainingDailyLossCapacity: 50,
    maxPositionExposureLots: null,
    sizingMode: "automatic_risk",
    ...overrides
  });
}

describe("Pepperstone Demo XAUUSD economic sizing", () => {
  it("A: protocol 1300 = 13 lots / 13 oz", () => {
    expect(lotsFromProtocolVolume(1300)).toBe(13);
    expect(protocolVolumeFromLots(13)).toBe(1300);
    expect(PEPPERSTONE_CTRADER_XAUUSD_DEMO.ozPerLot).toBe(1);
    expect(13 * PEPPERSTONE_CTRADER_XAUUSD_DEMO.ozPerLot).toBe(13);
  });

  it("B: 13 × 0.26 × 0.86624336 ≈ €2.93", () => {
    const pnl = estimateXauUsdGrossPnlDeposit({
      lots: 13,
      priceMove: 0.26,
      ozPerLot: 1,
      quoteToDepositRate: PROVEN_QUOTE_TO_DEPOSIT
    });
    expect(pnl).toBeCloseTo(2.93, 2);
  });

  it("C: XAUUSD Pepperstone sizing does NOT use contractSize=100 as oz/lot", () => {
    expect(PEPPERSTONE_VOLUME_RULES.contractSize).toBe(100);
    const mapping = resolvePepperstoneXauUsdDemoMapping({
      pepperstoneConfirmed: true,
      selectedAccountIsLive: false,
      symbolName: "XAUUSD"
    });
    expect(mapping?.ozPerLot).toBe(1);
    expect(mapping?.ozPerLot).not.toBe(PEPPERSTONE_VOLUME_RULES.contractSize);

    // Legacy buggy path with contractSize=100 understates lots vs economic model.
    const legacy = calculateCTraderVolume({
      equity: 50_000,
      freeMargin: 50_000,
      accountCurrency: "EUR",
      riskAmountEur: 300,
      entryPrice: PROVEN_ENTRY,
      stopLoss: PROVEN_ENTRY - PROVEN_STOP,
      lotSize: PEPPERSTONE_VOLUME_RULES.contractSize,
      tickSize: 0.01,
      minVolume: PEPPERSTONE_VOLUME_RULES.minLots,
      volumeStep: PEPPERSTONE_VOLUME_RULES.stepLots,
      maxVolume: PEPPERSTONE_VOLUME_RULES.maxLots,
      marginPerLot: null,
      eurToAccountRate: 1,
      sizingMode: "automatic_risk"
    });
    expect(legacy.ok).toBe(true);
    expect(legacy.volume).toBe(11); // risk/(100*0.26) ≈ 11.5 → 11

    // Economic model requires ~1331 lots for €300; Demo hard exposure cap fail-closes.
    const economic = baseSizing({
      riskAmountDeposit: 300,
      remainingDailyLossCapacity: 10_000,
      maxPositionExposureLots: null,
      freeMargin: 1_000_000
    });
    expect(economic.ok).toBe(false);
    expect(economic.ozPerLot).toBe(1);
    expect(economic.rejectionReason).toBe("RISK_SIZE_EXCEEDS_EXPOSURE_CAP");
    const rawNote = economic.notes.find((n) => n.startsWith("rawLots=")) ?? "";
    expect(rawNote).toMatch(/roundedDown=133[12]/);
    expect(legacy.volume).toBe(11);
  });

  it("D: FX conversion included in risk sizing", () => {
    const withFx = baseSizing({ riskAmountDeposit: 20, remainingDailyLossCapacity: 50 });
    const withoutFxAsOne = baseSizing({
      riskAmountDeposit: 20,
      remainingDailyLossCapacity: 50,
      quoteToDepositRate: 1
    });
    expect(withFx.ok).toBe(true);
    expect(withoutFxAsOne.ok).toBe(true);
    expect(withFx.volumeLots).toBeGreaterThan(withoutFxAsOne.volumeLots!);
    expect(withFx.riskPerLotDeposit).toBeCloseTo(
      PROVEN_STOP * 1 * PROVEN_QUOTE_TO_DEPOSIT,
      6
    );
  });

  it("E: €20 risk produces approximately correct lot size with rounding", () => {
    const r = baseSizing({
      riskAmountDeposit: 20,
      remainingDailyLossCapacity: 50,
      maxPositionExposureLots: 100
    });
    // raw ≈ 20 / (0.26 * 0.86624336) ≈ 88.8 → floor step 1 → ~88–89
    expect(r.ok).toBe(true);
    expect(r.volumeLots).toBeGreaterThanOrEqual(88);
    expect(r.volumeLots).toBeLessThanOrEqual(89);
    expect(r.protocolVolume).toBe(protocolVolumeFromLots(r.volumeLots!));
  });

  it("F: €50 risk calculation produces approximately correct lot size with rounding", () => {
    const riskPerLot = PROVEN_STOP * PROVEN_QUOTE_TO_DEPOSIT;
    expect(50 / riskPerLot).toBeCloseTo(222, 0);
    // ~222 lots fits Demo hard exposure cap (250) and is margin-safe here.
    const r = baseSizing({
      riskAmountDeposit: 50,
      remainingDailyLossCapacity: 50,
      maxPositionExposureLots: null,
      freeMargin: 200_000
    });
    expect(r.ok).toBe(true);
    expect(r.volumeLots).toBeGreaterThanOrEqual(221);
    expect(r.volumeLots).toBeLessThanOrEqual(222);
    expect(r.protocolVolume).toBe(protocolVolumeFromLots(r.volumeLots!));
    expect(r.volumeLots!).toBeLessThanOrEqual(
      DEMO_HARD_CAPS.maxPositionExposureLotsMax
    );
  });

  it("G: €100 risk calculation", () => {
    const riskPerLot = PROVEN_STOP * PROVEN_QUOTE_TO_DEPOSIT;
    expect(100 / riskPerLot).toBeCloseTo(444, 0);
    const r = baseSizing({
      riskAmountDeposit: 100,
      remainingDailyLossCapacity: 100,
      maxPositionExposureLots: null,
      freeMargin: 500_000
    });
    expect(r.ok).toBe(false);
    expect(r.rejectionReason).toBe("RISK_SIZE_EXCEEDS_EXPOSURE_CAP");
    const rawNote = r.notes.find((n) => n.startsWith("rawLots=")) ?? "";
    const rounded = Number(/roundedDown=(\d+)/.exec(rawNote)?.[1] ?? NaN);
    expect(rounded).toBeGreaterThanOrEqual(443);
    expect(rounded).toBeLessThanOrEqual(444);
    expect(protocolVolumeFromLots(rounded)).toBe(rounded * 100);
  });

  it("H: €300 calculation identifies required large volume", () => {
    const riskPerLot = PROVEN_STOP * PROVEN_QUOTE_TO_DEPOSIT;
    expect(300 / riskPerLot).toBeCloseTo(1332, 0);
    const r = baseSizing({
      riskAmountDeposit: 300,
      remainingDailyLossCapacity: 10_000,
      maxPositionExposureLots: null,
      freeMargin: 1_000_000
    });
    // Far above legacy ~11–13; blocked by exposure hard cap (fail closed).
    expect(r.ok).toBe(false);
    expect(r.rejectionReason).toBe("RISK_SIZE_EXCEEDS_EXPOSURE_CAP");
    const rawNote = r.notes.find((n) => n.startsWith("rawLots=")) ?? "";
    const rounded = Number(/roundedDown=(\d+)/.exec(rawNote)?.[1] ?? NaN);
    expect(rounded).toBeGreaterThan(1000);
    expect(rounded).toBeGreaterThanOrEqual(1331);
    expect(rounded).toBeLessThanOrEqual(1332);
    expect(protocolVolumeFromLots(rounded)).toBe(rounded * 100);
  });

  it("I: trade blocked when required margin exceeds available margin", () => {
    // €20 → ~88 lots fits Demo exposure hard cap but needs ~€11k margin at 30x.
    const r = baseSizing({
      riskAmountDeposit: 20,
      remainingDailyLossCapacity: 50,
      maxPositionExposureLots: null,
      freeMargin: 5_000,
      leverage: PROVEN_LEVERAGE
    });
    expect(r.ok).toBe(false);
    expect(r.rejectionReason).toBe("RISK_SIZE_EXCEEDS_MARGIN");
    expect(r.estimatedMarginDeposit).not.toBeNull();
    expect(r.estimatedMarginDeposit!).toBeGreaterThan(5_000);
  });

  it("J: single-trade requested risk exceeding remaining daily-loss capacity is blocked", () => {
    const r = baseSizing({
      riskAmountDeposit: 300,
      remainingDailyLossCapacity: 50,
      maxPositionExposureLots: 5_000,
      freeMargin: 1_000_000
    });
    expect(r.ok).toBe(false);
    expect(r.rejectionReason).toBe("RISK_EXCEEDS_DAILY_LOSS_REMAINING");
  });

  it("K: exposure cap blocks unsafe size", () => {
    expect(resolveExposureCapLots(null)).toBe(
      DEMO_HARD_CAPS.maxPositionExposureLotsMax
    );
    expect(DEMO_HARD_CAPS.maxPositionExposureLotsMax).toBe(250);
    const r = baseSizing({
      riskAmountDeposit: 300,
      remainingDailyLossCapacity: 10_000,
      maxPositionExposureLots: null, // Demo hard cap 250 — €300 still far above
      freeMargin: 1_000_000
    });
    expect(r.ok).toBe(false);
    expect(r.rejectionReason).toBe("RISK_SIZE_EXCEEDS_EXPOSURE_CAP");
  });

  it("Demo hard exposure cap raised for oz-model; Live exposure cap unchanged", async () => {
    const { LIVE_HARD_CAPS } = await import(
      "../../../../src/services/broker/ctrader/liveRiskCaps"
    );
    expect(LIVE_HARD_CAPS.maxPositionExposureLotsMax).toBe(2);
    expect(DEMO_HARD_CAPS.maxPositionExposureLotsMax).toBe(250);
  });

  it("L: missing/stale FX conversion fails closed", () => {
    const missing = baseSizing({ quoteToDepositRate: null });
    expect(missing.ok).toBe(false);
    expect(missing.rejectionReason).toBe("CURRENCY_CONVERSION_UNAVAILABLE");

    const stale = assessFxQuoteFreshness({
      asOfMs: Date.now() - 10 * 60_000,
      nowMs: Date.now(),
      maxAgeMs: 5 * 60_000
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe("CURRENCY_CONVERSION_STALE");

    // Do not hardcode EURUSD=1
    expect(usdToDepositFromEurUsdMid(1.15441)).toBeCloseTo(PROVEN_QUOTE_TO_DEPOSIT, 5);
  });

  it("M: broker min/step applied correctly (round down, never upsize)", () => {
    const belowMin = baseSizing({
      riskAmountDeposit: 0.1,
      remainingDailyLossCapacity: 50,
      // tiny risk → raw lots << 1
      maxPositionExposureLots: 100
    });
    expect(belowMin.ok).toBe(false);
    expect(
      ["VOLUME_BELOW_MINIMUM_AFTER_ROUNDING", "VOLUME_BELOW_MINIMUM"].includes(
        belowMin.rejectionReason ?? ""
      )
    ).toBe(true);

    const stepOk = baseSizing({
      riskAmountDeposit: 20,
      remainingDailyLossCapacity: 50,
      maxPositionExposureLots: 100,
      stepLots: 1,
      minLots: 1
    });
    expect(stepOk.ok).toBe(true);
    expect(Number.isInteger(stepOk.volumeLots)).toBe(true);
  });

  it("N: open-close / reconcile unit surface still importable (PR #101 base intact on this branch)", async () => {
    // This branch is based on production-connection (pre-#101 merge). Ensure
    // existing reconcile + lifecycle modules still load and Live stays locked.
    const reconcile = await import(
      "../../../../src/services/broker/ctrader/openPositionReconcile"
    );
    expect(typeof reconcile.reconcileDemoOpenPositionCounters).toBe("function");
    const life = await import(
      "../../../../src/services/broker/ctrader/demoPositionLifecycle"
    );
    expect(typeof life.createDemoPositionLifecycle).toBe("function");
  });

  it("O: Armed Candidate behaviour unchanged (pure engine)", () => {
    const r = evaluateArmedCandidateLifecycle({
      uid: "sizing-test-uid",
      nowIso: "2026-08-11T12:00:00.000Z",
      autoTradePermitted: true,
      existing: null,
      qualifiedSetup: {
        direction: "BUY",
        signalId: "sig-1",
        planSourceKey: "plan_1",
        entry: 4376,
        stopLoss: 4375,
        takeProfit: 4380,
        confidence: 90,
        setupScore: 80
      },
      confirmationRequired: true,
      confirmationState: "OUTSIDE_ZONE"
    });
    expect(r.action).toBe("ARM");
    expect(r.candidate?.signalId).toBe("sig-1");
  });

  it("P: Live trading remains LOCKED", () => {
    expect(isCTraderLiveEnabled()).toBe(false);
    expect(
      isCTraderLiveEnabled({ CTRADER_LIVE_ENABLED: "true" } as NodeJS.ProcessEnv)
    ).toBe(false);
    expect(
      resolvePepperstoneXauUsdDemoMapping({
        pepperstoneConfirmed: true,
        selectedAccountIsLive: true,
        symbolName: "XAUUSD"
      })
    ).toBeNull();
  });

  it("FX resolver uses broker EURUSD mid (mock) and fails closed when stale", async () => {
    const api = createMockOpenApiClient();
    const ok = await resolveQuoteToDepositFx({
      openApiClient: api,
      accessToken: "t",
      clientId: "c",
      clientSecret: "s",
      ctidTraderAccountId: "48014710",
      quoteCurrency: "USD",
      depositCurrency: "EUR"
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.source).toBe("broker_eurusd_mid_inverse");
      expect(ok.rate).toBeCloseTo(PROVEN_QUOTE_TO_DEPOSIT, 4);
    }

    const staleApi = createMockOpenApiClient({
      eurusdQuote: {
        symbolId: "1",
        symbolName: "EURUSD",
        bid: 1.1543,
        ask: 1.15452,
        spread: 0.00022,
        timestamp: new Date(Date.now() - 60 * 60_000).toISOString(),
        marketStatus: "OPEN",
        stale: false,
        source: "LIVE"
      }
    });
    const stale = await resolveQuoteToDepositFx({
      openApiClient: staleApi,
      accessToken: "t",
      clientId: "c",
      clientSecret: "s",
      ctidTraderAccountId: "48014710",
      quoteCurrency: "USD",
      depositCurrency: "EUR"
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe("CURRENCY_CONVERSION_STALE");
  });

  it("margin estimate matches notional/leverage model", () => {
    const m = estimateMarginDeposit({
      lots: 13,
      ozPerLot: 1,
      entryPrice: PROVEN_ENTRY,
      quoteToDepositRate: PROVEN_QUOTE_TO_DEPOSIT,
      leverage: PROVEN_LEVERAGE
    });
    // 13 * 4376.63 * 0.86624336 / 30 ≈ 1642.86
    expect(m).toBeCloseTo(1642.86, 1);
  });

  it("mapping applies only to proven Pepperstone Demo XAUUSD", () => {
    expect(
      resolvePepperstoneXauUsdDemoMapping({
        pepperstoneConfirmed: false,
        selectedAccountIsLive: false,
        symbolName: "XAUUSD"
      })
    ).toBeNull();
    expect(
      resolvePepperstoneXauUsdDemoMapping({
        pepperstoneConfirmed: true,
        selectedAccountIsLive: false,
        symbolName: "EURUSD"
      })
    ).toBeNull();
  });
});
