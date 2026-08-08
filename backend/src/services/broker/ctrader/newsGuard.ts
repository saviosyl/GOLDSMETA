/**
 * Economic news guard — provider abstraction.
 * Uses static high-impact USD template windows when no live feed is configured.
 * Never fabricates specific CPI/NFP events without a configured provider.
 */

export type NewsImpact = "HIGH" | "MEDIUM" | "OFF";

export type NewsGuardConfig = {
  mode: NewsImpact;
  minutesBefore: number;
  minutesAfter: number;
};

export type NewsBlackoutStatus = {
  configured: boolean;
  provider: "NONE" | "STATIC_TEMPLATE" | "EXTERNAL";
  active: boolean;
  reason: string | null;
  nextEventLabel: string | null;
  nextEventAt: string | null;
  blackoutFrom: string | null;
  blackoutTo: string | null;
};

/** Optional env: CTRADER_NEWS_PROVIDER=static|none */
export function loadNewsProviderKind(): "NONE" | "STATIC_TEMPLATE" {
  const v = (process.env.CTRADER_NEWS_PROVIDER ?? "static").trim().toLowerCase();
  if (v === "none" || v === "off") return "NONE";
  return "STATIC_TEMPLATE";
}

/**
 * Static template: block around typical US data release minutes (13:30 UTC and 15:00 UTC)
 * on weekdays — NOT a live calendar. UI must label as template when used.
 */
function staticTemplateBlackout(
  cfg: NewsGuardConfig,
  now = new Date()
): NewsBlackoutStatus {
  if (cfg.mode === "OFF") {
    return {
      configured: true,
      provider: "STATIC_TEMPLATE",
      active: false,
      reason: null,
      nextEventLabel: null,
      nextEventAt: null,
      blackoutFrom: null,
      blackoutTo: null
    };
  }
  const day = now.getUTCDay(); // 0 Sun
  if (day === 0 || day === 6) {
    return {
      configured: true,
      provider: "STATIC_TEMPLATE",
      active: false,
      reason: null,
      nextEventLabel: "Next weekday US data window",
      nextEventAt: null,
      blackoutFrom: null,
      blackoutTo: null
    };
  }

  const windows = [
    { label: "US data window (template)", hour: 13, minute: 30 },
    { label: "US data window (template)", hour: 15, minute: 0 }
  ];

  for (const w of windows) {
    const center = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      w.hour,
      w.minute,
      0,
      0
    );
    const from = center - cfg.minutesBefore * 60_000;
    const to = center + cfg.minutesAfter * 60_000;
    const t = now.getTime();
    if (t >= from && t <= to) {
      return {
        configured: true,
        provider: "STATIC_TEMPLATE",
        active: true,
        reason: "NEWS_GUARD",
        nextEventLabel: w.label,
        nextEventAt: new Date(center).toISOString(),
        blackoutFrom: new Date(from).toISOString(),
        blackoutTo: new Date(to).toISOString()
      };
    }
  }

  // Next upcoming today
  let next: { label: string; at: number } | null = null;
  for (const w of windows) {
    const center = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      w.hour,
      w.minute,
      0,
      0
    );
    if (center > now.getTime()) {
      next = { label: w.label, at: center };
      break;
    }
  }

  return {
    configured: true,
    provider: "STATIC_TEMPLATE",
    active: false,
    reason: null,
    nextEventLabel: next?.label ?? "US data window (template)",
    nextEventAt: next ? new Date(next.at).toISOString() : null,
    blackoutFrom: null,
    blackoutTo: null
  };
}

export function evaluateNewsGuard(
  cfg: NewsGuardConfig,
  now = new Date()
): NewsBlackoutStatus {
  const kind = loadNewsProviderKind();
  if (kind === "NONE") {
    return {
      configured: false,
      provider: "NONE",
      active: false,
      reason: null,
      nextEventLabel: null,
      nextEventAt: null,
      blackoutFrom: null,
      blackoutTo: null
    };
  }
  return staticTemplateBlackout(cfg, now);
}
