import { describe, expect, it, vi } from "vitest";
import {
  dispatchPasswordResetEmail,
  GENERIC_PASSWORD_RESET_MESSAGE,
  passwordResetContinueUrl,
  resolveFirebaseWebApiKey
} from "../../../src/services/auth/passwordResetSend";

describe("passwordResetSend", () => {
  it("uses production continue URL by default", () => {
    expect(passwordResetContinueUrl({})).toBe("https://goldmeta.metamechsolutions.com/login");
  });

  it("resolves web API key from env", () => {
    expect(resolveFirebaseWebApiKey({ FIREBASE_WEB_API_KEY: "abc" })).toBe("abc");
    expect(resolveFirebaseWebApiKey({})).toBeNull();
  });

  it("dispatches sendOobCode and never requires generatePasswordResetLink", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ kind: "identitytoolkit#GetOobConfirmationCodeResponse" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    const result = await dispatchPasswordResetEmail({
      email: "user@example.com",
      source: { FIREBASE_WEB_API_KEY: "test-key" },
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    expect(result).toEqual({ ok: true, dispatched: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain("accounts:sendOobCode");
    expect(String(url)).not.toContain("oobLink");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.requestType).toBe("PASSWORD_RESET");
    expect(body.email).toBe("user@example.com");
    expect(body.continueUrl).toBe("https://goldmeta.metamechsolutions.com/login");
    expect(body).not.toHaveProperty("oobLink");
    expect(body).not.toHaveProperty("oobCode");
  });

  it("treats EMAIL_NOT_FOUND as enumeration-safe success", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ error: { message: "EMAIL_NOT_FOUND" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    });
    const result = await dispatchPasswordResetEmail({
      email: "missing@example.com",
      source: { FIREBASE_WEB_API_KEY: "test-key" },
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.dispatched).toBe(false);
  });

  it("fails closed when API key missing", async () => {
    const result = await dispatchPasswordResetEmail({
      email: "user@example.com",
      source: {},
      fetchImpl: vi.fn() as unknown as typeof fetch
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PASSWORD_RESET_SEND_UNAVAILABLE");
      expect(result.message).toBe(GENERIC_PASSWORD_RESET_MESSAGE);
    }
  });
});
