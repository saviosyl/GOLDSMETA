/**
 * Password-reset email dispatch.
 *
 * Firebase Admin `generatePasswordResetLink` does NOT send email — it only
 * returns a link. Production GoldMeta must call Identity Toolkit sendOobCode
 * (same path Firebase Console uses) so users receive mail.
 *
 * Never logs the OOB link or codes.
 */

import { normalizeEmail } from "./ownerAuthConfig";

export const GENERIC_PASSWORD_RESET_MESSAGE =
  "If an account exists for that email, a reset link has been sent.";

const DEFAULT_CONTINUE_URL = "https://goldmeta.metamechsolutions.com/login";

export function passwordResetContinueUrl(
  source: NodeJS.ProcessEnv = process.env
): string {
  const configured = (source.PASSWORD_RESET_CONTINUE_URL ?? "").trim();
  if (configured.startsWith("https://")) return configured;
  return DEFAULT_CONTINUE_URL;
}

export function resolveFirebaseWebApiKey(
  source: NodeJS.ProcessEnv = process.env
): string | null {
  const key = (
    source.FIREBASE_WEB_API_KEY ??
    source.GCLOUD_WEB_API_KEY ??
    source.VITE_FIREBASE_API_KEY ??
    ""
  ).trim();
  return key || null;
}

export type PasswordResetSendResult =
  | { ok: true; dispatched: boolean; reason?: string }
  | { ok: false; status: number; code: string; message: string };

/**
 * Dispatch Firebase password-reset email via Identity Toolkit REST.
 * Treats missing/unknown accounts as success (no enumeration).
 */
export async function dispatchPasswordResetEmail(args: {
  email: string;
  source?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<PasswordResetSendResult> {
  const source = args.source ?? process.env;
  const email = normalizeEmail(args.email);
  if (!email) {
    return { ok: true, dispatched: false, reason: "EMPTY_EMAIL" };
  }

  const apiKey = resolveFirebaseWebApiKey(source);
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      code: "PASSWORD_RESET_SEND_UNAVAILABLE",
      message: GENERIC_PASSWORD_RESET_MESSAGE
    };
  }

  const continueUrl = passwordResetContinueUrl(source);
  const fetchImpl = args.fetchImpl ?? fetch;
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        requestType: "PASSWORD_RESET",
        email,
        continueUrl,
        canHandleCodeInApp: false
      })
    });
  } catch {
    return {
      ok: false,
      status: 503,
      code: "PASSWORD_RESET_NETWORK",
      message: GENERIC_PASSWORD_RESET_MESSAGE
    };
  }

  if (response.ok) {
    return { ok: true, dispatched: true };
  }

  let code = "PASSWORD_RESET_FAILED";
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    code = (body.error?.message ?? code).replace(/[^A-Z0-9_]/gi, "_").slice(0, 64);
  } catch {
    // ignore parse errors
  }

  // Enumeration-safe: unknown email / disabled still look like success to clients.
  if (
    /EMAIL_NOT_FOUND|USER_NOT_FOUND|INVALID_EMAIL/i.test(code) ||
    response.status === 400
  ) {
    return { ok: true, dispatched: false, reason: code };
  }

  if (response.status === 429 || /TOO_MANY_ATTEMPTS/i.test(code)) {
    return {
      ok: false,
      status: 429,
      code: "PASSWORD_RESET_RATE_LIMIT",
      message: "Too many password-reset requests. Please wait and try again."
    };
  }

  return {
    ok: false,
    status: 503,
    code,
    message: GENERIC_PASSWORD_RESET_MESSAGE
  };
}
