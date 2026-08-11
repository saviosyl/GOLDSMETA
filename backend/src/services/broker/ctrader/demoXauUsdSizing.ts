/**
 * Pepperstone cTrader Demo XAUUSD cash-risk sizing (proven 1 lot = 1 oz).
 * Fail-closed on missing FX, margin, daily-loss capacity, or exposure caps.
 * Never silently increases volume.
 */

import { roundDownLotsToStep, lotsToOrderVolumeUnits } from "./volumeUnits";
import {
  PEPPERSTONE_CTRADER_XAUUSD_DEMO,
  estimateXauUsdGrossPnlDeposit
} from "./brokerUnitMappings";
import { DEMO_HARD_CAPS } from "./liveRiskCaps";

export type DemoXauUsdSizingInput = {
  riskAmountDeposit: number;
  entryPrice: number | null;
  stopLoss: number | null;
  /** USD → deposit currency (e.g. EUR). Must be > 0. */
  quoteToDepositRate: number | null;
  ozPerLot?: number;
  minLots: number | null;
  stepLots: number | null;
  maxLots: number | null;
  freeMargin: number | null;
  leverage: number | null;
  /** Remaining daily loss capacity in deposit currency. */
  remainingDailyLossCapacity: number;
  /** Configured exposure cap (lots); null → Demo hard cap only. */
  maxPositionExposureLots: number | null;
  sizingMode?: "automatic_risk" | "manual_lots";
  manualLotSize?: number | null;
};

export type DemoXauUsdSizingResult = {
  ok: boolean;
  volumeLots: number | null;
  protocolVolume: number | null;
  ozPerLot: number;
  stopDistance: number | null;
  riskPerLotDeposit: number | null;
  estimatedMaxLossDeposit: number | null;
  estimatedMarginDeposit: number | null;
  rejectionReason: string | null;
  notes: string[];
};

function reject(
  reason: string,
  notes: string[],
  partial?: Partial<DemoXauUsdSizingResult>
): DemoXauUsdSizingResult {
  return {
    ok: false,
    volumeLots: null,
    protocolVolume: null,
    ozPerLot: partial?.ozPerLot ?? PEPPERSTONE_CTRADER_XAUUSD_DEMO.ozPerLot,
    stopDistance: partial?.stopDistance ?? null,
    riskPerLotDeposit: partial?.riskPerLotDeposit ?? null,
    estimatedMaxLossDeposit: partial?.estimatedMaxLossDeposit ?? null,
    estimatedMarginDeposit: partial?.estimatedMarginDeposit ?? null,
    rejectionReason: reason,
    notes
  };
}

export function estimateMarginDeposit(args: {
  lots: number;
  ozPerLot: number;
  entryPrice: number;
  quoteToDepositRate: number;
  leverage: number;
}): number {
  // Notional in deposit ≈ lots × oz × price(quote) × quoteToDeposit
  const notionalDeposit =
    args.lots * args.ozPerLot * args.entryPrice * args.quoteToDepositRate;
  return notionalDeposit / args.leverage;
}

/**
 * Effective exposure ceiling: never exceed Demo hard cap; honour tighter user cap.
 */
export function resolveExposureCapLots(
  configured: number | null | undefined
): number {
  const hard = DEMO_HARD_CAPS.maxPositionExposureLotsMax;
  if (configured == null || !(configured > 0)) return hard;
  return Math.min(configured, hard);
}

/**
 * Pure sizing + safety gates for Pepperstone Demo XAUUSD.
 */
export function calculatePepperstoneXauUsdDemoVolume(
  input: DemoXauUsdSizingInput
): DemoXauUsdSizingResult {
  const notes: string[] = [
    "Pepperstone Demo XAUUSD economic sizing (1 lot = 1 oz proven)"
  ];
  const ozPerLot =
    input.ozPerLot ?? PEPPERSTONE_CTRADER_XAUUSD_DEMO.ozPerLot;

  if (input.quoteToDepositRate == null || !(input.quoteToDepositRate > 0)) {
    return reject("CURRENCY_CONVERSION_UNAVAILABLE", [
      ...notes,
      "quoteToDepositRate missing/invalid — fail closed"
    ]);
  }
  if (input.entryPrice == null || !(input.entryPrice > 0)) {
    return reject("ENTRY_PRICE_UNAVAILABLE", notes, { ozPerLot });
  }
  if (input.stopLoss == null || !(input.stopLoss > 0)) {
    return reject("STOP_LOSS_REQUIRED", notes, { ozPerLot });
  }
  const stopDistance = Math.abs(input.entryPrice - input.stopLoss);
  if (!(stopDistance > 0)) {
    return reject("STOP_DISTANCE_INVALID", notes, { ozPerLot, stopDistance: 0 });
  }
  if (
    input.minLots == null ||
    input.stepLots == null ||
    input.maxLots == null ||
    !(input.minLots > 0) ||
    !(input.stepLots > 0) ||
    !(input.maxLots > 0)
  ) {
    return reject("SYMBOL_METADATA_INCOMPLETE", notes, {
      ozPerLot,
      stopDistance
    });
  }

  const riskAmount = Math.max(0, input.riskAmountDeposit);
  if (!(riskAmount > 0) && input.sizingMode !== "manual_lots") {
    return reject("RISK_AMOUNT_INVALID", notes, { ozPerLot, stopDistance });
  }

  // Automatic risk: requested single-trade risk must fit remaining daily-loss capacity.
  // Do not auto-adjust settings — fail closed when inconsistent (e.g. €300 risk vs €50 daily).
  if (
    input.sizingMode !== "manual_lots" &&
    riskAmount > input.remainingDailyLossCapacity + 1e-9
  ) {
    return reject(
      "RISK_EXCEEDS_DAILY_LOSS_REMAINING",
      [
        ...notes,
        `Requested risk ${riskAmount} exceeds remaining daily loss capacity ${input.remainingDailyLossCapacity}`
      ],
      { ozPerLot, stopDistance }
    );
  }

  // riskPerLotDeposit = stopDistance × ozPerLot × quoteToDepositRate
  const riskPerLotDeposit =
    stopDistance * ozPerLot * input.quoteToDepositRate;
  if (!(riskPerLotDeposit > 0)) {
    return reject("RISK_PER_LOT_INVALID", notes, {
      ozPerLot,
      stopDistance,
      riskPerLotDeposit
    });
  }

  let volumeLots: number;
  if (input.sizingMode === "manual_lots") {
    const requested = input.manualLotSize;
    if (requested == null || !(requested > 0)) {
      return reject("MANUAL_LOT_SIZE_REQUIRED", notes, {
        ozPerLot,
        stopDistance,
        riskPerLotDeposit
      });
    }
    const rounded = roundDownLotsToStep(requested, input.stepLots);
    if (Math.abs(rounded - requested) > 1e-9) {
      return reject(
        "VOLUME_STEP_MISMATCH",
        [
          ...notes,
          `Requested ${requested} does not match step ${input.stepLots}`
        ],
        { ozPerLot, stopDistance, riskPerLotDeposit }
      );
    }
    volumeLots = requested;
  } else {
    const rawLots = riskAmount / riskPerLotDeposit;
    volumeLots = roundDownLotsToStep(rawLots, input.stepLots);
    notes.push(
      `rawLots=${rawLots.toFixed(6)} roundedDown=${volumeLots} (step ${input.stepLots})`
    );
  }

  if (!(volumeLots > 0)) {
    return reject(
      "VOLUME_BELOW_MINIMUM_AFTER_ROUNDING",
      [
        ...notes,
        "Calculated volume rounds below broker step/minimum — will not upsize"
      ],
      { ozPerLot, stopDistance, riskPerLotDeposit }
    );
  }
  if (volumeLots < input.minLots) {
    return reject(
      "VOLUME_BELOW_MINIMUM",
      [
        ...notes,
        `Calculated ${volumeLots} < broker min ${input.minLots} — will not upsize`
      ],
      { ozPerLot, stopDistance, riskPerLotDeposit }
    );
  }
  if (volumeLots > input.maxLots) {
    return reject(
      "VOLUME_ABOVE_MAXIMUM",
      [
        ...notes,
        `Calculated ${volumeLots} exceeds broker max ${input.maxLots}`
      ],
      { ozPerLot, stopDistance, riskPerLotDeposit }
    );
  }

  const exposureCap = resolveExposureCapLots(input.maxPositionExposureLots);
  if (volumeLots > exposureCap + 1e-9) {
    return reject(
      "RISK_SIZE_EXCEEDS_EXPOSURE_CAP",
      [
        ...notes,
        `Calculated ${volumeLots} lots exceeds exposure cap ${exposureCap}`
      ],
      {
        ozPerLot,
        stopDistance,
        riskPerLotDeposit,
        estimatedMaxLossDeposit: Number(
          (volumeLots * riskPerLotDeposit).toFixed(2)
        )
      }
    );
  }

  const estimatedMaxLossDeposit = Number(
    estimateXauUsdGrossPnlDeposit({
      lots: volumeLots,
      priceMove: stopDistance,
      ozPerLot,
      quoteToDepositRate: input.quoteToDepositRate
    }).toFixed(2)
  );

  // Manual lots: block when estimated stop loss exceeds remaining daily capacity.
  if (
    input.sizingMode === "manual_lots" &&
    estimatedMaxLossDeposit > input.remainingDailyLossCapacity + 1e-9
  ) {
    return reject(
      "RISK_EXCEEDS_DAILY_LOSS_REMAINING",
      [
        ...notes,
        `Estimated max loss ${estimatedMaxLossDeposit} exceeds remaining daily loss capacity ${input.remainingDailyLossCapacity}`
      ],
      {
        ozPerLot,
        stopDistance,
        riskPerLotDeposit,
        estimatedMaxLossDeposit
      }
    );
  }

  // Margin: require freeMargin + leverage; fail closed if unknown.
  if (input.leverage == null || !(input.leverage > 0)) {
    return reject(
      "LEVERAGE_UNAVAILABLE",
      [...notes, "Account leverage required for margin check — fail closed"],
      {
        ozPerLot,
        stopDistance,
        riskPerLotDeposit,
        estimatedMaxLossDeposit
      }
    );
  }
  if (input.freeMargin == null || !Number.isFinite(input.freeMargin)) {
    return reject(
      "MARGIN_UNAVAILABLE",
      [...notes, "freeMargin required for margin check — fail closed"],
      {
        ozPerLot,
        stopDistance,
        riskPerLotDeposit,
        estimatedMaxLossDeposit
      }
    );
  }

  const estimatedMarginDeposit = Number(
    estimateMarginDeposit({
      lots: volumeLots,
      ozPerLot,
      entryPrice: input.entryPrice,
      quoteToDepositRate: input.quoteToDepositRate,
      leverage: input.leverage
    }).toFixed(2)
  );

  if (estimatedMarginDeposit > input.freeMargin + 1e-6) {
    return reject(
      "RISK_SIZE_EXCEEDS_MARGIN",
      [
        ...notes,
        `Estimated margin ${estimatedMarginDeposit} > freeMargin ${input.freeMargin}`
      ],
      {
        ozPerLot,
        stopDistance,
        riskPerLotDeposit,
        estimatedMaxLossDeposit,
        estimatedMarginDeposit
      }
    );
  }

  // Hard-cap on configured fixed risk amount (Demo).
  if (riskAmount > DEMO_HARD_CAPS.fixedRiskAmountMax + 1e-9) {
    return reject(
      "RISK_SIZE_EXCEEDS_DEMO_HARD_CAP",
      notes,
      {
        ozPerLot,
        stopDistance,
        riskPerLotDeposit,
        estimatedMaxLossDeposit,
        estimatedMarginDeposit
      }
    );
  }

  return {
    ok: true,
    volumeLots,
    protocolVolume: lotsToOrderVolumeUnits(volumeLots),
    ozPerLot,
    stopDistance,
    riskPerLotDeposit: Number(riskPerLotDeposit.toFixed(8)),
    estimatedMaxLossDeposit,
    estimatedMarginDeposit,
    rejectionReason: null,
    notes
  };
}
