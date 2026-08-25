/**
 * Live Auto activation requires reliable economic-calendar protection
 * when the user's news filter is enabled.
 */

import { loadNewsProviderKind } from "./newsGuard";
import type { UserAutoTradeSettings } from "./userAutoTradeSettings";

export function newsProtectionBlocksLiveActivation(
  settings: Pick<UserAutoTradeSettings, "newsFilterEnabled" | "newsImpactMode">,
  env: NodeJS.ProcessEnv = process.env
): { blocked: boolean; reason: string | null } {
  if (!settings.newsFilterEnabled || settings.newsImpactMode === "OFF") {
    return { blocked: false, reason: null };
  }
  const kind = loadNewsProviderKind(env);
  if (kind === "NONE") {
    return {
      blocked: true,
      reason:
        "Economic calendar protection must be configured before Live Auto."
    };
  }
  return { blocked: false, reason: null };
}
