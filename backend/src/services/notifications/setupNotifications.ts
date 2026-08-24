import type { SetupRecord } from "../../models/setup";
import { setupLifecycleConfig } from "../../config/setupLifecycleConfig";
import type { GoldMetaStore } from "../storage/types";
import { logger } from "../logging/logger";

export type SetupNotificationKind =
  | "entry_triggered"
  | "tp1_hit"
  | "tp2_hit"
  | "tp3_hit"
  | "stop_loss_hit"
  | "setup_expired";

/**
 * Lifecycle notifications — best-effort. Failures must never fail setup processing.
 * Uses notificationEvents dedupe keys. Full FCM payload left to existing push path when devices exist.
 */
export const sendSetupLifecycleNotification = async (
  store: GoldMetaStore,
  setup: SetupRecord,
  kind: SetupNotificationKind
): Promise<boolean> => {
  try {
    if (!setupLifecycleConfig.notifications.enabled) {
      return false;
    }
    const key = `setup:${setup.setupId}:${kind}`;
    const first = await store.markNotification(setup.userId, key);
    if (!first) {
      return false;
    }
    const testLabel =
      setupLifecycleConfig.notifications.labelTestAlerts && setup.isTestSetup ? "[TEST] " : "";
    logger.info("Setup lifecycle notification recorded", {
      kind,
      setupId: setup.setupId,
      title: `${testLabel}${kind}`,
      environment: setup.environment
    });
    return true;
  } catch (error: unknown) {
    logger.warn("Setup notification failed (non-fatal)", {
      setupId: setup.setupId,
      kind,
      error: error instanceof Error ? error.message : "unknown"
    });
    return false;
  }
};
