import { describe, expect, it } from "vitest";
import { classifyConflictCodes } from "../../src/services/decision/conflictClassification";
import {
  alertDedupeKey,
  buildCandidateId,
  deriveFormingState
} from "../../src/services/decision/formingOpportunity";
import {
  buildAuthoritativeSnapshot,
  buildSnapshotId,
  classifyQuoteFreshness
} from "../../src/services/decision/decisionSnapshot";
import { validateStopDistance } from "../../src/services/decision/stopDistanceValidation";
import { validateTargetOrdering } from "../../src/services/decision/targetOrdering";
import { validateTradePlanGeometry } from "../../src/services/decision/tradePlanGeometry";
import { evaluateDataQuality } from "../../src/services/snapshot/dataQuality";
import type { MarketSnapshot } from "../../src/models/types";

const baseSnapshot = (over: Partial<MarketSnapshot> = {}): MarketSnapshot =>
  ({
    symbol: "XAUUSD",
    price: 4270,
    marketDataTime: new Date().toISOString(),
    isConfirmedBar: true,
    timeframe: "15",
    trend: { direction: "BULLISH", strength: 70, components: [] },
    confirmationCandle: {
      confirmed: true,
      direction: "BEARISH",
      classification: "REJECTION"
    },
    ohlcv: { open: 4268, high: 4272, low: 4267, close: 4270 },
    levels: { pocAll: 4265, vahAll: 4275, valAll: 4255 },
    sessionVolumeProfile: { poc: 4265, vah: 4275, val: 4255 },
    ...over
  }) as MarketSnapshot;

describe("excessive WAIT — snapshot & freshness", () => {
  it("builds snapshot ids and classifies quote freshness", () => {
    expect(buildSnapshotId("XAUUSD", "2026-08-06T12:30:00.000Z")).toBe("XAUUSD-20260806-123000");
    expect(classifyQuoteFreshness(30_000)).toBe("fresh");
    expect(classifyQuoteFreshness(120_000)).toBe("delayed");
    expect(classifyQuoteFreshness(200_000)).toBe("stale");
  });

  it("flags confirm from a different 15M window as incompatible", () => {
    const snap = buildAuthoritativeSnapshot({
      symbol: "XAUUSD",
      planSourceKey: "XAUUSD|LONDON|100|PLAN_15M",
      confirmationSourceKey: "XAUUSD|LONDON|200|PLAN_15M",
      plan15mTimestamp: new Date().toISOString(),
      confirmation5mTimestamp: new Date().toISOString(),
      quoteTimestamp: new Date().toISOString()
    });
    expect(snap.windowCompatible).toBe(false);
    expect(snap.incompatibilityReasons).toContain("CONFIRM_PLAN_SOURCE_KEY_MISMATCH");
  });
});

describe("excessive WAIT — conflict classification", () => {
  it("treats soft disagreement as forming-allowed", () => {
    const c = classifyConflictCodes(["SOFT_DISAGREEMENT", "AWAITING_5M_CONFIRMATION"]);
    expect(c.class).toBe("SOFT_DISAGREEMENT");
    expect(c.hardBlock).toBe(false);
    expect(c.formingAllowed).toBe(true);
  });

  it("treats price-source mismatch as hard conflict", () => {
    const c = classifyConflictCodes(["PRICE_SOURCE_MISMATCH", "CONFLICTED_DATA"]);
    expect(c.hardBlock).toBe(true);
    expect(c.class).toBe("HARD_CONFLICT");
  });

  it("treats confirm key mismatch as out-of-order", () => {
    const c = classifyConflictCodes(["CONFIRM_PLAN_SOURCE_KEY_MISMATCH"]);
    expect(c.class).toBe("OUT_OF_ORDER_DATA");
    expect(c.hardBlock).toBe(true);
  });

  it("does not hard-block on missing optional data", () => {
    const c = classifyConflictCodes(["MISSING_VOLUME_PROFILE", "MISSING_OPTIONAL_DATA"]);
    expect(c.class).toBe("MISSING_OPTIONAL_DATA");
    expect(c.hardBlock).toBe(false);
  });
});

describe("excessive WAIT — data quality soft disagreement", () => {
  it("does not mark trend vs candle conflict as CONFLICTED quality", () => {
    const dq = evaluateDataQuality(baseSnapshot());
    expect(dq.quality).not.toBe("CONFLICTED");
    expect(dq.warnings.some((w) => /SOFT_DISAGREEMENT/i.test(w))).toBe(true);
  });
});

describe("excessive WAIT — target ordering", () => {
  it("rejects BUY when TP2/TP3 are below TP1", () => {
    const r = validateTargetOrdering({
      direction: "BUY",
      entry: 4270.92,
      stop: 4268.78,
      tp1: 4282.06,
      tp2: 4275.2,
      tp3: 4277.34
    });
    expect(r.ok).toBe(false);
    expect(r.reasonCodes).toContain("INVALID_TARGET_ORDER");
  });

  it("accepts valid BUY ordering", () => {
    const r = validateTargetOrdering({
      direction: "BUY",
      entry: 4270,
      stop: 4265,
      tp1: 4280,
      tp2: 4285,
      tp3: 4290
    });
    expect(r.ok).toBe(true);
  });

  it("rejects SELL when TP2 is above TP1", () => {
    const r = validateTargetOrdering({
      direction: "SELL",
      entry: 4270,
      stop: 4275,
      tp1: 4260,
      tp2: 4265
    });
    expect(r.ok).toBe(false);
  });

  it("geometry hard-blocks invalid BUY target order", () => {
    const g = validateTradePlanGeometry({
      direction: "BUY",
      entryPrice: 4270.92,
      stop: 4268.78,
      tp1: 4282.06,
      tp2: 4275.2,
      tp3: 4277.34
    });
    expect(g.hardReasonCodes).toContain("INVALID_TARGET_ORDER");
    expect(g.actionable).toBe(false);
  });
});

describe("excessive WAIT — stop distance", () => {
  it("flags too-tight stops vs ATR", () => {
    const r = validateStopDistance({
      entry: 4270.92,
      stop: 4268.78,
      atr: 12,
      spreadPoints: 0.4
    });
    expect(r.class).toBe("TOO_TIGHT");
    expect(r.blocksReady).toBe(true);
  });

  it("accepts wider stops", () => {
    const r = validateStopDistance({
      entry: 4270,
      stop: 4260,
      atr: 12,
      spreadPoints: 0.3
    });
    expect(r.class).toBe("ACCEPTABLE");
    expect(r.blocksReady).toBe(false);
  });
});

describe("excessive WAIT — forming lifecycle", () => {
  it("keeps candidate id stable for same planSourceKey", () => {
    const a = buildCandidateId("XAUUSD", "BUY", "XAUUSD|L|1|PLAN_15M", 4270);
    const b = buildCandidateId("XAUUSD", "BUY", "XAUUSD|L|1|PLAN_15M", 4271);
    expect(a).toBe(b);
  });

  it("maps confirmation pending and ready states", () => {
    expect(
      deriveFormingState({
        hasDirection: true,
        approachingTrigger: true,
        hasLevels: true,
        confirmationPending: true,
        confirmationPassed: false,
        hardBlocked: false,
        invalidated: false,
        expired: false
      })
    ).toBe("CONFIRMATION_PENDING");
    expect(
      deriveFormingState({
        hasDirection: true,
        approachingTrigger: false,
        hasLevels: true,
        confirmationPending: false,
        confirmationPassed: true,
        hardBlocked: false,
        invalidated: false,
        expired: false
      })
    ).toBe("READY");
  });

  it("dedupes alerts by candidate/state/trigger/window", () => {
    const k1 = alertDedupeKey("cand_1", "PREPARE", 4270, "win1");
    const k2 = alertDedupeKey("cand_1", "PREPARE", 4270, "win1");
    const k3 = alertDedupeKey("cand_1", "READY", 4270, "win1");
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
  });
});
