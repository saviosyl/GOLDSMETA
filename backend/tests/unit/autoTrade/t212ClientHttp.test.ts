/**
 * Trading 212 HTTP client — status mapping + malformed payload tests.
 * Never contacts live Trading 212.
 */

import { describe, expect, it } from "vitest";
import {
  T212InvestClient,
  T212ApiError,
  T212_ORDER_CREATE_PATHS
} from "../../../src/services/autoTrade/t212/client";

function clientWith(fetchImpl: typeof fetch): T212InvestClient {
  return new T212InvestClient(
    "PRACTICE",
    { apiKey: "k", apiSecret: "s" },
    { fetchImpl }
  );
}

describe("T212InvestClient HTTP mapping", () => {
  it.each([
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [429, "RATE_LIMITED"],
    [500, "SERVER_ERROR"]
  ] as const)("maps HTTP %s to %s", async (status, code) => {
    let attempts = 0;
    const client = clientWith(async () => {
      attempts += 1;
      // Exhaust retries for 429/5xx
      return new Response(JSON.stringify({ message: "fail" }), {
        status,
        headers: { "Content-Type": "application/json" }
      });
    });
    await expect(client.getAccountSummary()).rejects.toMatchObject({
      name: "T212ApiError",
      status,
      code
    } satisfies Partial<T212ApiError>);
    if (status === 429 || status >= 500) {
      expect(attempts).toBeGreaterThan(1);
    }
  });

  it("rejects malformed JSON success bodies", async () => {
    const client = clientWith(async () => {
      return new Response("not-json{", {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    await expect(client.getAccountSummary()).rejects.toMatchObject({
      code: "MALFORMED_RESPONSE"
    });
  });

  it("blocks order-create paths without network I/O", async () => {
    let called = false;
    const client = clientWith(async () => {
      called = true;
      return new Response("{}", { status: 200 });
    });
    for (const path of T212_ORDER_CREATE_PATHS) {
      await expect(
        (client as unknown as { request: (p: string) => Promise<unknown> }).request(path)
      ).rejects.toMatchObject({ code: "ORDER_ENDPOINT_BLOCKED", status: 403 });
    }
    expect(called).toBe(false);
  });
});
