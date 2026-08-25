/**
 * cTrader Open API configuration validation.
 * Never invent secrets — report CTRADER_SETUP_REQUIRED when missing.
 * Never return secret values — only presence + safe public redirect metadata.
 */

export interface CTraderConfig {
  configured: boolean;
  setupRequired: boolean;
  clientIdPresent: boolean;
  clientSecretPresent: boolean;
  redirectUri: string | null;
  /** Hostname + pathname only — never query/fragment, never secrets. */
  redirectUriPublic: { hostname: string; pathname: string } | null;
  environment: "DEMO";
  authUrl: string;
  tokenUrl: string;
  /** Machine codes (env names) — never values. */
  missing: string[];
  /** Human-readable, non-secret missing items for UI. */
  missingConfigurationItems: string[];
  notes: string[];
}

const DEMO_AUTH = "https://id.ctrader.com/my/settings/openapi/grantingaccess/";
const DEMO_TOKEN = "https://openapi.ctrader.com/apps/token";

const MISSING_LABELS: Record<string, string> = {
  CTRADER_CLIENT_ID: "cTrader Client ID missing",
  CTRADER_CLIENT_SECRET: "cTrader Client Secret unavailable to function",
  CTRADER_REDIRECT_URI: "Redirect URI not configured",
  CTRADER_TOKEN_ENCRYPTION_KEY: "Encryption key unavailable",
  CTRADER_ENVIRONMENT_MUST_BE_DEMO: "cTrader environment must be DEMO",
  OAUTH_CALLBACK_MISMATCH: "OAuth callback mismatch"
};

export function labelMissingConfiguration(codes: string[]): string[] {
  return codes.map((code) => MISSING_LABELS[code] ?? code.replace(/_/g, " "));
}

export function publicRedirectUriMeta(
  redirectUri: string | null
): { hostname: string; pathname: string } | null {
  if (!redirectUri) return null;
  try {
    const u = new URL(redirectUri);
    return { hostname: u.hostname, pathname: u.pathname };
  } catch {
    return null;
  }
}

export function loadCTraderConfig(
  source: NodeJS.ProcessEnv = process.env
): CTraderConfig {
  const clientId = (source.CTRADER_CLIENT_ID ?? "").trim();
  const clientSecret = (source.CTRADER_CLIENT_SECRET ?? "").trim();
  const redirectUri = (source.CTRADER_REDIRECT_URI ?? "").trim() || null;
  const env = (source.CTRADER_ENVIRONMENT ?? "DEMO").trim().toUpperCase();
  const missing: string[] = [];
  const notes: string[] = [];

  if (!clientId) missing.push("CTRADER_CLIENT_ID");
  if (!clientSecret) missing.push("CTRADER_CLIENT_SECRET");
  if (!redirectUri) missing.push("CTRADER_REDIRECT_URI");
  if (env !== "DEMO") {
    notes.push("Only DEMO environment is allowed in this phase.");
    missing.push("CTRADER_ENVIRONMENT_MUST_BE_DEMO");
  }

  const redirectUriPublic = publicRedirectUriMeta(redirectUri);
  if (
    redirectUri &&
    redirectUriPublic &&
    (redirectUriPublic.hostname.includes("localhost") ||
      redirectUriPublic.hostname === "127.0.0.1" ||
      /preview/i.test(redirectUriPublic.hostname))
  ) {
    missing.push("OAUTH_CALLBACK_MISMATCH");
    notes.push(
      "Redirect URI must be the production Cloud Functions callback, not localhost or a preview host."
    );
  }

  const configured = missing.length === 0;
  return {
    configured,
    setupRequired: !configured,
    clientIdPresent: Boolean(clientId),
    clientSecretPresent: Boolean(clientSecret),
    redirectUri,
    redirectUriPublic,
    environment: "DEMO",
    authUrl: DEMO_AUTH,
    tokenUrl: DEMO_TOKEN,
    missing,
    missingConfigurationItems: labelMissingConfiguration(missing),
    notes: configured
      ? notes
      : [
          ...notes,
          "Pepperstone connection required — register Open API app and set secrets in Secret Manager."
        ]
  };
}
