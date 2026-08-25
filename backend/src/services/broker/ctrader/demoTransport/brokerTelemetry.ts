/**
 * Sanitize broker failure details before persisting evaluation telemetry.
 * Never persist tokens, secrets, or raw auth payloads.
 */

const SECRET_PATTERN =
  /access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|bearer\s+[a-z0-9._-]+|eyJ[a-zA-Z0-9._-]*/gi;

export function sanitizeBrokerFailure(error: unknown): {
  code: string;
  message: string;
} {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : "unknown";
  const codeRaw =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : raw.split(/[:\s]/)[0] || "BROKER_ERROR";
  return {
    code: redactSecretMaterial(codeRaw).slice(0, 64) || "BROKER_ERROR",
    message: redactSecretMaterial(raw).slice(0, 160)
  };
}

export function sanitizeBrokerErrorCode(code: string | null | undefined): string {
  if (code == null || String(code).trim() === "") return "BROKER_REJECTED";
  return redactSecretMaterial(String(code)).slice(0, 64) || "BROKER_REJECTED";
}

function redactSecretMaterial(value: string): string {
  return value.replace(SECRET_PATTERN, "[REDACTED]");
}
