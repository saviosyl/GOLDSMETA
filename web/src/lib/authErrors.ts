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
  if (code === "auth/too-many-requests" || /too-many-requests/i.test(message)) {
    return "Too many attempts. Please wait and try again.";
  }
  if (code === "auth/network-request-failed") {
    return "Network error. Check your connection and try again.";
  }
  if (/Account registration is currently closed/i.test(message)) {
    return message;
  }
  if (/This account already exists/i.test(message)) {
    return message;
  }
  // Never surface raw Firebase error codes to users.
  if (/auth\//i.test(message) || /Firebase:\s*Error/i.test(message)) {
    return "Sign-in failed. Please try again or reset your password.";
  }
  return message || "Authentication failed";
}
