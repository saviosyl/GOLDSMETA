import { isSetupBarUpdateAllowed, setupLifecycleConfig } from "../../config/setupLifecycleConfig";
import type { SetupRecord, SetupResolution, SetupStatus } from "../../models/setup";
import { isActiveSetupStatus } from "../../models/setup";
import { nowIso } from "../../utils/time";
import type { GoldMetaStore } from "../storage/types";
import { logger } from "../logging/logger";
import { sendSetupLifecycleNotification } from "../notifications/setupNotifications";

export interface BarUpdateInput {
  eventId: string;
  barTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  isConfirmedBar: boolean;
}

const pushStatus = (
  setup: SetupRecord,
  to: SetupStatus,
  barTime: string,
  eventId: string,
  reason: string
): void => {
  const from = setup.status;
  if (from === to) {
    return;
  }
  setup.statusHistory.push({
    at: nowIso(),
    from,
    to,
    barTime,
    eventId,
    reason
  });
  setup.status = to;
};

const realisedR = (setup: SetupRecord, exitPrice: number): number | null => {
  if (!setup.levels.entryPrice || !setup.initialRisk || setup.initialRisk <= 0) {
    return null;
  }
  const entry = setup.levels.entryPrice;
  const raw =
    setup.direction === "BUY" ? (exitPrice - entry) / setup.initialRisk : (entry - exitPrice) / setup.initialRisk;
  return Math.round(raw * 100) / 100;
};

const closeSetup = (
  setup: SetupRecord,
  status: SetupStatus,
  resolution: SetupResolution,
  exitPrice: number | null,
  barTime: string,
  eventId: string,
  reason: string,
  ambiguous = false
): void => {
  pushStatus(setup, status, barTime, eventId, reason);
  if (ambiguous) {
    pushStatus(setup, "CLOSED", barTime, eventId, "Resolved after AMBIGUOUS_INTRABAR via WORST_CASE_SL_FIRST");
  } else if (status !== "CLOSED") {
    pushStatus(setup, "CLOSED", barTime, eventId, reason);
  }
  setup.resolvedAt = nowIso();
  setup.resolution = resolution;
  setup.barsToResolution = setup.barsOpen;
  const r = exitPrice != null ? realisedR(setup, exitPrice) : null;
  setup.outcome.rawResolution = resolution;
  setup.outcome.rawRealisedR = r;
  // Modelled outcome is stored separately and never mixed into raw.
  setup.outcome.modelledResolution = resolution;
  setup.outcome.modelledRealisedR = r;
  const partialPct = setupLifecycleConfig.management.atTp1PartialClosePct;
  const partial = partialPct / 100;
  if (
    (resolution === "WIN_TP2" || resolution === "WIN_TP3") &&
    partial > 0 &&
    partial < 1 &&
    setup.levels.tp1 != null
  ) {
    const rTp1 = realisedR(setup, setup.levels.tp1) ?? 0;
    const rFinal = r ?? 0;
    setup.outcome.modelledRealisedR =
      Math.round((partial * rTp1 + (1 - partial) * rFinal) * 100) / 100;
    setup.outcome.managementNotes.push(
      `Model: ${partialPct}% at TP1 (R=${rTp1}), ${100 - partialPct}% at final (R=${rFinal}); modelled R=${setup.outcome.modelledRealisedR}`
    );
  }
  if (
    setupLifecycleConfig.management.atTp1MoveStopToBreakeven &&
    (resolution === "WIN_TP1" ||
      resolution === "WIN_TP2" ||
      resolution === "WIN_TP3" ||
      resolution === "BREAKEVEN")
  ) {
    setup.outcome.managementNotes.push(
      "Model: at TP1 move SL to breakeven (analysis-only; does not alter raw outcome)"
    );
  }
};

const touchesSl = (setup: SetupRecord, high: number, low: number): boolean => {
  const sl = setup.levels.stopLoss;
  if (sl == null) return false;
  return setup.direction === "BUY" ? low <= sl : high >= sl;
};

const touchesTp = (setup: SetupRecord, level: number | null, high: number, low: number): boolean => {
  if (level == null) return false;
  return setup.direction === "BUY" ? high >= level : low <= level;
};

const entryTouched = (setup: SetupRecord, high: number, low: number): boolean => {
  const entry = setup.levels.entryPrice;
  if (entry == null) return false;
  // MARKET entries: treat bar that includes entry or closes through as fill on confirmed bar.
  if (setup.levels.entryType === "MARKET") {
    return setup.direction === "BUY" ? low <= entry && high >= entry : low <= entry && high >= entry;
  }
  return low <= entry && high >= entry;
};

/**
 * Update active setups with a confirmed XAUUSD 15m bar.
 * Idempotent per eventId. Same-candle SL+TP → AMBIGUOUS_INTRABAR → WORST_CASE_SL_FIRST.
 */
export const updateSetupsFromBar = async (
  store: GoldMetaStore,
  userId: string,
  bar: BarUpdateInput,
  environment: "LIVE" | "TEST" = "LIVE"
): Promise<SetupRecord[]> => {
  if (!isSetupBarUpdateAllowed(environment)) {
    return [];
  }
  if (!bar.isConfirmedBar) {
    return [];
  }
  if (!(bar.high >= bar.low) || !(bar.open > 0) || !(bar.close > 0)) {
    logger.warn("Bar follow-up skipped — malformed OHLC", { eventId: bar.eventId });
    return [];
  }

  const active = (await store.listActiveSetups(userId, environment)).filter((s) =>
    isActiveSetupStatus(s.status)
  );
  const updated: SetupRecord[] = [];

  for (const setup of active) {
    if (setup.appliedBarEventIds.includes(bar.eventId)) {
      continue;
    }
    // Ignore bars at or before signal bar for follow-up progression (entry may use same bar only if MARKET and configured — we require subsequent bars for entry clarity except MARKET fill on first follow-up bar).
    if (bar.barTime <= setup.barTime) {
      continue;
    }

    setup.appliedBarEventIds.push(bar.eventId);
    setup.barsOpen += 1;
    setup.updatedAt = nowIso();

    const hi = bar.high;
    const lo = bar.low;
    setup.excursion.highestPriceSeen = Math.max(setup.excursion.highestPriceSeen ?? hi, hi);
    setup.excursion.lowestPriceSeen = Math.min(setup.excursion.lowestPriceSeen ?? lo, lo);

    if (setup.levels.entryPrice && setup.initialRisk) {
      const entry = setup.levels.entryPrice;
      if (setup.direction === "BUY") {
        setup.excursion.mfe =
          Math.round(((setup.excursion.highestPriceSeen - entry) / setup.initialRisk) * 100) / 100;
        setup.excursion.mae =
          Math.round(((entry - setup.excursion.lowestPriceSeen) / setup.initialRisk) * 100) / 100;
      } else {
        setup.excursion.mfe =
          Math.round(((entry - setup.excursion.lowestPriceSeen) / setup.initialRisk) * 100) / 100;
        setup.excursion.mae =
          Math.round(((setup.excursion.highestPriceSeen - entry) / setup.initialRisk) * 100) / 100;
      }
    }

    // Expiry before entry
    if (
      (setup.status === "WAITING_FOR_ENTRY" || setup.status === "SIGNAL_CREATED") &&
      setup.barsOpen > setupLifecycleConfig.limits.setupExpiryBars
    ) {
      closeSetup(setup, "EXPIRED", "EXPIRED", null, bar.barTime, bar.eventId, "Entry window expired");
      await store.saveSetup(setup);
      await sendSetupLifecycleNotification(store, setup, "setup_expired");
      updated.push(setup);
      continue;
    }

    // Entry
    if (setup.status === "WAITING_FOR_ENTRY" || setup.status === "SIGNAL_CREATED") {
      const slBeforeEntry = touchesSl(setup, hi, lo);
      const tpBeforeEntry =
        touchesTp(setup, setup.levels.tp1, hi, lo) ||
        touchesTp(setup, setup.levels.tp2, hi, lo) ||
        touchesTp(setup, setup.levels.tp3, hi, lo);
      if (slBeforeEntry && !entryTouched(setup, hi, lo)) {
        closeSetup(
          setup,
          "INVALIDATED",
          "INVALIDATED",
          setup.levels.stopLoss,
          bar.barTime,
          bar.eventId,
          "SL touched before entry"
        );
        await store.saveSetup(setup);
        updated.push(setup);
        continue;
      }
      if (tpBeforeEntry && !entryTouched(setup, hi, lo)) {
        closeSetup(
          setup,
          "INVALIDATED",
          "INVALIDATED",
          null,
          bar.barTime,
          bar.eventId,
          "Target reached before entry — no entry"
        );
        await store.saveSetup(setup);
        updated.push(setup);
        continue;
      }
      if (entryTouched(setup, hi, lo)) {
        // If entry candle also hits SL and TP — ambiguous
        const slHit = touchesSl(setup, hi, lo);
        const anyTp =
          touchesTp(setup, setup.levels.tp1, hi, lo) ||
          touchesTp(setup, setup.levels.tp2, hi, lo) ||
          touchesTp(setup, setup.levels.tp3, hi, lo);
        pushStatus(setup, "ENTRY_TRIGGERED", bar.barTime, bar.eventId, "Entry level reached");
        setup.entryTriggeredAt = nowIso();
        setup.barsToEntry = setup.barsOpen;
        if (slHit && anyTp) {
          closeSetup(
            setup,
            "AMBIGUOUS_INTRABAR",
            "AMBIGUOUS_WORST_CASE_SL",
            setup.levels.stopLoss,
            bar.barTime,
            bar.eventId,
            "Same candle touched SL and TP after/with entry — WORST_CASE_SL_FIRST",
            true
          );
          await store.saveSetup(setup);
          await sendSetupLifecycleNotification(store, setup, "stop_loss_hit");
          updated.push(setup);
          continue;
        }
        if (slHit) {
          closeSetup(
            setup,
            "STOP_LOSS_HIT",
            "LOSS_SL",
            setup.levels.stopLoss,
            bar.barTime,
            bar.eventId,
            "SL on entry bar"
          );
          await store.saveSetup(setup);
          await sendSetupLifecycleNotification(store, setup, "stop_loss_hit");
          updated.push(setup);
          continue;
        }
        await sendSetupLifecycleNotification(store, setup, "entry_triggered");
        // Fall through to check TPs on same bar after entry if only TP (no SL)
        if (anyTp) {
          // process TP ladder below
        } else {
          await store.saveSetup(setup);
          updated.push(setup);
          continue;
        }
      } else {
        await store.saveSetup(setup);
        updated.push(setup);
        continue;
      }
    }

    // Post-entry management
    if (
      setup.status === "ENTRY_TRIGGERED" ||
      setup.status === "TP1_HIT" ||
      setup.status === "TP2_HIT" ||
      setup.status === "BREAKEVEN"
    ) {
      const slHit = touchesSl(setup, hi, lo);
      const tp1 = touchesTp(setup, setup.levels.tp1, hi, lo);
      const tp2 = touchesTp(setup, setup.levels.tp2, hi, lo);
      const tp3 = touchesTp(setup, setup.levels.tp3, hi, lo);
      const anyTp = tp1 || tp2 || tp3;

      if (slHit && anyTp) {
        closeSetup(
          setup,
          "AMBIGUOUS_INTRABAR",
          "AMBIGUOUS_WORST_CASE_SL",
          setup.levels.stopLoss,
          bar.barTime,
          bar.eventId,
          "Same candle touched SL and TP — WORST_CASE_SL_FIRST",
          true
        );
        await store.saveSetup(setup);
        await sendSetupLifecycleNotification(store, setup, "stop_loss_hit");
        updated.push(setup);
        continue;
      }
      if (slHit) {
        closeSetup(
          setup,
          "STOP_LOSS_HIT",
          "LOSS_SL",
          setup.levels.stopLoss,
          bar.barTime,
          bar.eventId,
          "Stop loss hit"
        );
        await store.saveSetup(setup);
        await sendSetupLifecycleNotification(store, setup, "stop_loss_hit");
        updated.push(setup);
        continue;
      }
      if (tp3 && setup.levels.tp3 != null) {
        if (setup.status === "ENTRY_TRIGGERED") {
          pushStatus(setup, "TP1_HIT", bar.barTime, bar.eventId, "TP1 reached");
          pushStatus(setup, "TP2_HIT", bar.barTime, bar.eventId, "TP2 reached");
        } else if (setup.status === "TP1_HIT") {
          pushStatus(setup, "TP2_HIT", bar.barTime, bar.eventId, "TP2 reached");
        }
        closeSetup(setup, "TP3_HIT", "WIN_TP3", setup.levels.tp3, bar.barTime, bar.eventId, "TP3 hit");
        await store.saveSetup(setup);
        await sendSetupLifecycleNotification(store, setup, "tp3_hit");
        updated.push(setup);
        continue;
      }
      if (tp2 && setup.levels.tp2 != null && setup.status !== "TP2_HIT") {
        if (setup.status === "ENTRY_TRIGGERED") {
          pushStatus(setup, "TP1_HIT", bar.barTime, bar.eventId, "TP1 reached");
          if (setupLifecycleConfig.management.atTp1MoveStopToBreakeven) {
            pushStatus(setup, "BREAKEVEN", bar.barTime, bar.eventId, "Model: SL to breakeven after TP1");
            setup.outcome.managementNotes.push("Modelled breakeven stop after TP1");
          }
        }
        pushStatus(setup, "TP2_HIT", bar.barTime, bar.eventId, "TP2 reached");
        // Remain open for TP3 unless no TP3
        if (setup.levels.tp3 == null) {
          closeSetup(setup, "TP2_HIT", "WIN_TP2", setup.levels.tp2, bar.barTime, bar.eventId, "TP2 final");
          await sendSetupLifecycleNotification(store, setup, "tp2_hit");
        } else {
          await sendSetupLifecycleNotification(store, setup, "tp2_hit");
        }
        await store.saveSetup(setup);
        updated.push(setup);
        continue;
      }
      if (tp1 && setup.levels.tp1 != null && setup.status === "ENTRY_TRIGGERED") {
        pushStatus(setup, "TP1_HIT", bar.barTime, bar.eventId, "TP1 reached");
        if (setupLifecycleConfig.management.atTp1MoveStopToBreakeven) {
          pushStatus(setup, "BREAKEVEN", bar.barTime, bar.eventId, "Model: SL to breakeven after TP1");
          setup.outcome.managementNotes.push("Modelled breakeven stop after TP1");
        }
        if (setup.levels.tp2 == null && setup.levels.tp3 == null) {
          closeSetup(setup, "TP1_HIT", "WIN_TP1", setup.levels.tp1, bar.barTime, bar.eventId, "TP1 final");
        }
        await store.saveSetup(setup);
        await sendSetupLifecycleNotification(store, setup, "tp1_hit");
        updated.push(setup);
        continue;
      }
    }

    await store.saveSetup(setup);
    updated.push(setup);
  }

  return updated;
};
