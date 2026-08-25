/**
 * Registration feature flags — env-driven, fail-closed for broker/autotrade.
 */

export type RegistrationConfig = {
  registrationEnabled: boolean;
  approvalRequired: boolean;
  inviteOnly: boolean;
  newUserDefaultRole: "USER_PENDING";
  newUserBrokerAccess: false;
  newUserAutoTrade: false;
  verificationContinueUrl: string | null;
  policyVersions: {
    terms: string;
    privacy: string;
    risk: string;
  };
};

function envFlag(source: NodeJS.ProcessEnv, key: string, defaultValue: boolean): boolean {
  const raw = (source[key] ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw !== "false" && raw !== "0" && raw !== "off";
}

export function loadRegistrationConfig(
  source: NodeJS.ProcessEnv = process.env
): RegistrationConfig {
  const inviteOnly = envFlag(source, "REGISTRATION_INVITE_ONLY", false);
  const baseEnabled = envFlag(
    source,
    "REGISTRATION_ENABLED",
    envFlag(source, "PUBLIC_REGISTRATION_ENABLED", true)
  );
  // Invite-only keeps the feature code path but closes public registration
  // until invite tokens are implemented.
  const registrationEnabled = baseEnabled && !inviteOnly;
  // Default OPEN: verified users auto-activate basic app access (not broker).
  // Set REGISTRATION_APPROVAL_REQUIRED=true to restore manual approval.
  const approvalRequired = envFlag(source, "REGISTRATION_APPROVAL_REQUIRED", false);

  const continueRaw = (
    source.REGISTRATION_VERIFICATION_CONTINUE_URL ??
    "https://goldmeta.metamechsolutions.com"
  ).trim();
  const continueUrl = `${continueRaw.replace(/\/$/, "")}/verify-email`;

  return {
    registrationEnabled,
    approvalRequired,
    inviteOnly,
    newUserDefaultRole: "USER_PENDING",
    newUserBrokerAccess: false,
    newUserAutoTrade: false,
    verificationContinueUrl: isAllowedVerificationContinueUrl(continueUrl) ? continueUrl : null,
    policyVersions: {
      terms: (source.POLICY_VERSION_TERMS ?? "2026-07-24").trim(),
      privacy: (source.POLICY_VERSION_PRIVACY ?? "2026-07-24").trim(),
      risk: (source.POLICY_VERSION_RISK ?? "2026-07-24").trim()
    }
  };
}

const ALLOWED_CONTINUE_HOSTS = new Set([
  "goldmeta.metamechsolutions.com",
  "goldmeta-web.pages.dev",
  "localhost",
  "127.0.0.1"
]);

export function isAllowedVerificationContinueUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const localOk =
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
      (parsed.protocol === "http:" || parsed.protocol === "https:");
    if (localOk) return true;
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname.endsWith(".pages.dev") && parsed.hostname.includes("goldmeta")) {
      return true;
    }
    return ALLOWED_CONTINUE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}
