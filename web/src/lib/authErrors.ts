/** Map Firebase / auth failures to safe user-facing copy (no raw codes). */

export function friendlyAuthError(error: unknown): string {
  const code =
    typeof error === "object" &&
    error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";
  const message = error instanceof Error ? error.message : String(error ?? "");

  if (
    code === "auth/invalid-credential" ||
    code === "auth/wrong-password" ||
    code === "auth/user-not-found" ||
    code === "auth/invalid-email" ||
    /invalid-credential|wrong-password|user-not-found/i.test(message)
  ) {
    return "Email address or password is incorrect. Please try again or reset your password.";
  }
  if (
    code === "auth/too-many-requests" ||
    /too-many-requests|PASSWORD_RESET_RATE_LIMIT|Too many password-reset/i.test(message)
  ) {
    return "Too many attempts. Please wait and try again.";
  }
  if (code === "auth/network-request-failed" || /network unavailable|Network error/i.test(message)) {
    return "Network unavailable. Check your connection and try again.";
  }
  if (code === "auth/user-disabled" || /user-disabled|account disabled/i.test(message)) {
    return "This account is disabled. Contact support if you need help.";
  }
  if (code === "auth/expired-action-code" || /expired-action-code|reset link expired/i.test(message)) {
    return "This password-reset link has expired. Request a new one from Sign In.";
  }
  if (
    code === "auth/invalid-action-code" ||
    /invalid-action-code|already used|reset link already used/i.test(message)
  ) {
    return "This password-reset link is invalid or was already used. Request a new one.";
  }
  if (/awaiting approval|AWAITING_APPROVAL/i.test(message)) {
    return "Your email is verified. An administrator must approve your account before full access.";
  }
  if (/suspended|USER_SUSPENDED|account-suspended/i.test(message)) {
    return "This account is suspended. Contact support if you need help.";
  }
  if (/email not verified|VERIFY_EMAIL|requiresEmailVerification/i.test(message)) {
    return "Please verify your email before continuing. Check your inbox for a verification link.";
  }
  if (/Account registration is currently closed/i.test(message)) {
    return message;
  }
  if (/This account already exists/i.test(message)) {
    return "This account already exists. Please use Sign In or Forgot Password.";
  }
  // Never surface raw Firebase error codes to users.
  if (/auth\//i.test(message) || /Firebase:\s*Error/i.test(message)) {
    return "Sign-in failed. Please try again or reset your password.";
  }
  return message || "Authentication failed";
}
