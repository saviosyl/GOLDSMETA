import type { Message } from "firebase-admin/messaging";
import type { DecisionRecord, NotificationPreferences } from "../../models/types";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../../models/types";
import type { SessionPlanRecord } from "../decision/sessionPlanTypes";
import { sendFirebaseMessages } from "../firebaseAdmin";
import { logger } from "../logging/logger";
import type { GoldMetaStore } from "../storage/types";
import { canAccessApprovedApp } from "../auth/roles";
import { getUserProfileStore } from "../auth/userProfileStore";
import { sendWebPushToUser } from "./webPush";

export type PlanLifecycleNotificationEvent =
  | "VALID_PLAN_CREATED"
  | "ENTRY_ZONE_APPROACHING"
  | "ENTRY_ZONE_REACHED"
  | "CONFIRM_5M_PASSED"
  | "CONFIRM_5M_FAILED"
  | "PLAN_INVALIDATED"
  | "PLAN_EXPIRED"
  | "TP1_REACHED"
  | "TP2_REACHED";

const APPROACHING_COOLDOWN_MS = 15 * 60 * 1000;
const APPROACHING_DISTANCE_POINTS = 5;

export interface PlanLifecycleNotificationInput {
  store: GoldMetaStore;
  previousPlan: SessionPlanRecord | null;
  plan: SessionPlanRecord;
  decision: DecisionRecord;
  sourceEventId: string;
  now?: number;
}

export interface PlanLifecycleNotificationResult {
  event: PlanLifecycleNotificationEvent | null;
  recipients: number;
  inAppWritten: number;
  fcmSent: number;
  webSent: number;
}

const actionablePlan = (plan: SessionPlanRecord): boolean =>
  plan.geometryValid !== false &&
  plan.direction !== null &&
  plan.direction !== "WAIT" &&
  plan.lifecycleState !== "NO_VALID_PLAN" &&
  plan.lifecycleState !== "NO_TRADE" &&
  plan.planQuality.grade !== "NO_PLAN" &&
  plan.planQuality.grade !== "C";

const positive = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

const changedPrice = (left: number | null, right: number | null): boolean => {
  if (left == null || right == null) return left !== right;
  return Math.abs(left - right) >= 0.01;
};

const strategyChanged = (
  previous: SessionPlanRecord | null,
  plan: SessionPlanRecord
): boolean => {
  if (!previous || !actionablePlan(previous)) return true;
  return (
    previous.direction !== plan.direction ||
    changedPrice(positive(previous.entry?.price), positive(plan.entry?.price)) ||
    changedPrice(positive(previous.entry?.zoneLow), positive(plan.entry?.zoneLow)) ||
    changedPrice(positive(previous.entry?.zoneHigh), positive(plan.entry?.zoneHigh)) ||
    changedPrice(positive(previous.stopLoss?.price), positive(plan.stopLoss?.price))
  );
};

const confirmationPassed = (state: string | null): boolean =>
  /BREAKOUT_CONFIRMED|REJECTION_CONFIRMED|RETEST_HELD/i.test(state ?? "");

const confirmationFailed = (state: string | null): boolean =>
  /CONFIRMATION_FAILED|FAILED|INVALID|REJECTED/i.test(state ?? "");

const transitionedTo = (
  previous: SessionPlanRecord | null,
  plan: SessionPlanRecord,
  states: SessionPlanRecord["lifecycleState"][]
): boolean => states.includes(plan.lifecycleState) && previous?.lifecycleState !== plan.lifecycleState;

export const mapPlanLifecycleNotificationEvent = (
  previous: SessionPlanRecord | null,
  plan: SessionPlanRecord
): PlanLifecycleNotificationEvent | null => {
  if (!actionablePlan(plan)) {
    if (transitionedTo(previous, plan, ["INVALIDATED"])) return "PLAN_INVALIDATED";
    if (transitionedTo(previous, plan, ["EXPIRED"])) return "PLAN_EXPIRED";
    return null;
  }

  if (
    (plan.planMutation === "CREATED" || plan.planMutation === "REPLACED") &&
    strategyChanged(previous, plan)
  ) {
    return "VALID_PLAN_CREATED";
  }

  if (transitionedTo(previous, plan, ["TP2_REACHED"])) return "TP2_REACHED";
  if (transitionedTo(previous, plan, ["TP1_REACHED"])) return "TP1_REACHED";
  if (transitionedTo(previous, plan, ["INVALIDATED"])) return "PLAN_INVALIDATED";
  if (transitionedTo(previous, plan, ["EXPIRED"])) return "PLAN_EXPIRED";

  if (
    plan.planMutation === "STATUS_UPDATED" &&
    plan.confirmationState !== previous?.confirmationState
  ) {
    if (confirmationPassed(plan.confirmationState)) return "CONFIRM_5M_PASSED";
    if (confirmationFailed(plan.confirmationState)) return "CONFIRM_5M_FAILED";
  }

  if (
    (plan.lifecycleState === "ARMED" || plan.lifecycleState === "CONFIRMED") &&
    previous?.lifecycleState !== "ARMED" &&
    previous?.lifecycleState !== "CONFIRMED" &&
    previous?.lifecycleState !== "IN_PROGRESS"
  ) {
    return "ENTRY_ZONE_REACHED";
  }

  if (
    plan.lifecycleState === "WAITING_FOR_ENTRY_ZONE" &&
    plan.distanceToEntryPoints != null &&
    plan.distanceToEntryPoints <= APPROACHING_DISTANCE_POINTS
  ) {
    return "ENTRY_ZONE_APPROACHING";
  }

  return null;
};

const preferenceKeyForEvent = (
  event: PlanLifecycleNotificationEvent
): keyof NotificationPreferences => {
  switch (event) {
    case "VALID_PLAN_CREATED":
      return "VALID_PLAN_CREATED";
    case "ENTRY_ZONE_APPROACHING":
      return "ENTRY_ZONE_APPROACHING";
    case "ENTRY_ZONE_REACHED":
      return "ENTRY_ZONE_REACHED";
    case "CONFIRM_5M_PASSED":
    case "CONFIRM_5M_FAILED":
      return "CONFIRM_5M";
    case "PLAN_INVALIDATED":
    case "PLAN_EXPIRED":
      return "PLAN_INVALIDATED";
    case "TP1_REACHED":
    case "TP2_REACHED":
      return "TARGETS_REACHED";
  }
};

const formatPrice = (value: number | null | undefined): string =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "n/a";

const contentForEvent = (
  event: PlanLifecycleNotificationEvent,
  plan: SessionPlanRecord
): { title: string; message: string } => {
  const direction = plan.direction ?? "manual";
  const tp1 = plan.quickTarget.tp1 ?? plan.takeProfits.find((target) => target.label === "TP1")?.price;
  switch (event) {
    case "VALID_PLAN_CREATED":
      return {
        title: `GoldMeta — New ${direction} plan`,
        message: `Entry ${formatPrice(plan.entry?.price ?? plan.entry?.zoneLow)} | Stop ${formatPrice(
          plan.stopLoss?.price
        )} | TP1 ${formatPrice(tp1)}. Waiting for 5-minute confirmation.`
      };
    case "ENTRY_ZONE_APPROACHING":
      return {
        title: "GoldMeta — Entry zone approaching",
        message: `${direction} plan is near the entry zone. Review the plan before taking any manual action.`
      };
    case "ENTRY_ZONE_REACHED":
      return {
        title: "GoldMeta — Entry zone reached",
        message: `${direction} plan has reached the entry zone. Wait for confirmation and review risk.`
      };
    case "CONFIRM_5M_PASSED":
      return {
        title: "GoldMeta — 5M confirmation passed",
        message: `Manual ${direction} plan is ready for review.`
      };
    case "CONFIRM_5M_FAILED":
      return {
        title: "GoldMeta — 5M confirmation failed",
        message: `${direction} plan did not pass 5-minute confirmation.`
      };
    case "PLAN_INVALIDATED":
      return {
        title: "GoldMeta — Plan invalidated",
        message: "The current manual plan is no longer valid under its safety rules."
      };
    case "PLAN_EXPIRED":
      return {
        title: "GoldMeta — Plan expired",
        message: "The current manual plan has expired. Wait for a fresh shared-feed plan."
      };
    case "TP1_REACHED":
      return {
        title: "GoldMeta — TP1 reached",
        message: "The current manual plan reached TP1. Review risk before making any decision."
      };
    case "TP2_REACHED":
      return {
        title: "GoldMeta — TP2 reached",
        message: "The current manual plan reached TP2. Review the plan status."
      };
  }
};

const approvedRecipientIds = async (): Promise<string[]> => {
  try {
    const profiles = await getUserProfileStore().listProfiles();
    return profiles
      .filter((profile) => canAccessApprovedApp(profile.role))
      .map((profile) => profile.uid);
  } catch (error: unknown) {
    logger.warn("Unable to list notification recipients", {
      error: error instanceof Error ? error.message : "unknown"
    });
    return [];
  }
};

const userOptedIn = async (
  store: GoldMetaStore,
  userId: string,
  event: PlanLifecycleNotificationEvent
): Promise<boolean> => {
  const settings = await store.getSettings(userId);
  const preferences = {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...settings.notificationPreferences
  };
  return settings.notificationsEnabled === true || preferences[preferenceKeyForEvent(event)] === true;
};

const markCooldown = async (
  store: GoldMetaStore,
  userId: string,
  planId: string,
  event: PlanLifecycleNotificationEvent,
  nowMs: number
): Promise<boolean> => {
  if (event !== "ENTRY_ZONE_APPROACHING") return true;
  const bucket = Math.floor(nowMs / APPROACHING_COOLDOWN_MS);
  return store.markNotification(userId, `${userId}:${planId}:${event}:cooldown:${bucket}`);
};

export const sendPlanLifecycleNotifications = async (
  input: PlanLifecycleNotificationInput
): Promise<PlanLifecycleNotificationResult> => {
  const event = mapPlanLifecycleNotificationEvent(input.previousPlan, input.plan);
  if (!event) {
    return { event: null, recipients: 0, inAppWritten: 0, fcmSent: 0, webSent: 0 };
  }

  const recipientIds = await approvedRecipientIds();
  const content = contentForEvent(event, input.plan);
  const nowMs = input.now ?? Date.now();
  let recipients = 0;
  let inAppWritten = 0;
  let fcmSent = 0;
  let webSent = 0;

  for (const uid of recipientIds) {
    if (!(await userOptedIn(input.store, uid, event))) {
      continue;
    }
    const planId = input.plan.planId;
    if (!(await markCooldown(input.store, uid, planId, event, nowMs))) {
      continue;
    }
    const dedupeKey = `${uid}:${planId}:${event}:${input.sourceEventId}`;
    if (!(await input.store.markNotification(uid, dedupeKey))) {
      continue;
    }

    recipients += 1;
    const data = {
      event,
      planId,
      sourceEventId: input.sourceEventId,
      direction: input.plan.direction ?? "",
      decisionId: input.decision.decisionId
    };
    if (input.store.createInAppNotification) {
      await input.store.createInAppNotification(uid, {
        event,
        direction: input.plan.direction,
        title: content.title,
        message: content.message,
        planId,
        data
      });
      inAppWritten += 1;
    }
    const devices = await input.store.listDevices(uid);
    const messages: Message[] = devices.map((device) => ({
      token: device.fcmToken,
      notification: { title: content.title, body: content.message },
      data
    }));
    fcmSent += await sendFirebaseMessages(messages);
    webSent += await sendWebPushToUser(input.store, uid, {
      title: content.title,
      body: content.message,
      data
    });
  }

  return { event, recipients, inAppWritten, fcmSent, webSent };
};

export const __constantsForTests = {
  APPROACHING_COOLDOWN_MS,
  APPROACHING_DISTANCE_POINTS
};
