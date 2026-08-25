/**
 * Map machine missing-config codes / labels to owner-facing copy.
 * Never display secret values.
 */

const CODE_TO_LABEL: Record<string, string> = {
  CTRADER_CLIENT_ID: "cTrader Client ID missing",
  CTRADER_CLIENT_SECRET: "cTrader Client Secret unavailable to function",
  CTRADER_REDIRECT_URI: "Redirect URI not configured",
  CTRADER_TOKEN_ENCRYPTION_KEY: "Encryption key unavailable",
  CTRADER_ENVIRONMENT_MUST_BE_DEMO: "cTrader environment must be DEMO",
  OAUTH_CALLBACK_MISMATCH: "OAuth callback mismatch"
};

/** Normalise server missing items into safe display labels (deduped). */
export function formatMissingConfigurationItems(
  items: string[] | null | undefined
): string[] {
  if (!items?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const key = String(raw ?? "").trim();
    if (!key) continue;
    const label = CODE_TO_LABEL[key] ?? (/^[A-Z0-9_]+$/.test(key) ? key.replace(/_/g, " ") : key);
    // Never echo values that look like secrets.
    if (/AIza|ya29|-----BEGIN|client_secret=/i.test(label)) continue;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}
