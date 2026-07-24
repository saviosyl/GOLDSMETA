/**
 * cTrader Open API configuration validation.
 * Never invent secrets — report CTRADER_SETUP_REQUIRED when missing.
 */

export interface CTraderConfig {
  configured: boolean;
  setupRequired: boolean;
  clientIdPresent: boolean;
  clientSecretPresent: boolean;
  redirectUri: string | null;
  environment: "DEMO";
  authUrl: string;
  tokenUrl: string;
  missing: string[];
  notes: string[];
}

const DEMO_AUTH = "https://id.ctrader.com/my/settings/openapi/grantingaccess/";
const DEMO_TOKEN = "https://openapi.ctrader.com/apps/token";

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

  const configured = missing.length === 0;
  return {
    configured,
    setupRequired: !configured,
    clientIdPresent: Boolean(clientId),
    clientSecretPresent: Boolean(clientSecret),
    redirectUri,
    environment: "DEMO",
    authUrl: DEMO_AUTH,
    tokenUrl: DEMO_TOKEN,
    missing,
    notes: configured
      ? notes
      : [...notes, "Pepperstone connection required — register Open API app and set secrets in Secret Manager."]
  };
}
