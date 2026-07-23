import type { Request } from "express";
import { env } from "../../config/env";

const CLOUDFUNCTIONS_HOST = /\.cloudfunctions\.net$/i;

export type WebhookPublicUrlConfig = {
  webhookPublicBaseUrl?: string;
  appEnv: string;
  firebaseProjectId?: string;
  firebaseRegion?: string;
};

/**
 * Resolve the public base URL that prefixes `/webhooks/tradingview/:id`.
 *
 * Production Firebase HTTPS functions are mounted at `.../api`, so a bare
 * `req.protocol://req.host` base would generate a 404-prone URL:
 *   https://REGION-PROJECT.cloudfunctions.net/webhooks/tradingview/<id>
 * instead of:
 *   https://REGION-PROJECT.cloudfunctions.net/api/webhooks/tradingview/<id>
 */
export const normalizeWebhookPublicBaseUrl = (raw: string): string =>
  raw.trim().replace(/\/+$/, "");

export const ensureCloudFunctionsApiBase = (baseUrl: string): string => {
  const normalized = normalizeWebhookPublicBaseUrl(baseUrl);
  try {
    const url = new URL(normalized);
    if (!CLOUDFUNCTIONS_HOST.test(url.hostname)) {
      return normalized;
    }
    // Always use the `api` Cloud Function path on cloudfunctions.net hosts.
    return `${url.origin}/api`;
  } catch {
    return normalized;
  }
};

export const resolveWebhookPublicBaseUrlFromConfig = (
  config: WebhookPublicUrlConfig,
  req?: Pick<Request, "protocol" | "get">
): string => {
  const configured = config.webhookPublicBaseUrl?.trim();
  if (configured) {
    return ensureCloudFunctionsApiBase(configured);
  }

  // Deterministic production default — do not depend on request host alone.
  if (config.appEnv === "production" && config.firebaseProjectId) {
    const region = config.firebaseRegion || "us-central1";
    return `https://${region}-${config.firebaseProjectId}.cloudfunctions.net/api`;
  }

  const protocol = req?.protocol ?? "http";
  const host = req?.get("host") ?? "localhost";
  return ensureCloudFunctionsApiBase(`${protocol}://${host}`);
};

export const buildTradingViewWebhookUrlFromConfig = (
  webhookId: string,
  config: WebhookPublicUrlConfig,
  req?: Pick<Request, "protocol" | "get">
): string => {
  const base = resolveWebhookPublicBaseUrlFromConfig(config, req);
  return `${base}/webhooks/tradingview/${webhookId.trim()}`;
};

export const resolveWebhookPublicBaseUrl = (req?: Pick<Request, "protocol" | "get">): string =>
  resolveWebhookPublicBaseUrlFromConfig(
    {
      webhookPublicBaseUrl: env.WEBHOOK_PUBLIC_BASE_URL,
      appEnv: env.APP_ENV,
      firebaseProjectId: env.FIREBASE_PROJECT_ID,
      firebaseRegion: env.FIREBASE_REGION
    },
    req
  );

export const buildTradingViewWebhookUrl = (
  webhookId: string,
  req?: Pick<Request, "protocol" | "get">
): string => buildTradingViewWebhookUrlFromConfig(webhookId, {
  webhookPublicBaseUrl: env.WEBHOOK_PUBLIC_BASE_URL,
  appEnv: env.APP_ENV,
  firebaseProjectId: env.FIREBASE_PROJECT_ID,
  firebaseRegion: env.FIREBASE_REGION
}, req);

/** True when a URL is the known broken Cloud Functions pattern (missing /api). */
export const isMalformedCloudFunctionsWebhookUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    if (!CLOUDFUNCTIONS_HOST.test(parsed.hostname)) return false;
    return /^\/webhooks\/tradingview\//i.test(parsed.pathname);
  } catch {
    return false;
  }
};
