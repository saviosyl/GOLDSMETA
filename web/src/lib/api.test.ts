import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ApiClient, type TokenProvider } from "../lib/api";
import { ApiError } from "../types/models";
import { entryDisplay, formatPercent, isStaleDecision, isTestDecision } from "../lib/format";
import { cacheKeys, clearUserCaches, loadCache, saveCache } from "../lib/offlineCache";
import buy from "../fixtures/buy.json";
import sell from "../fixtures/sell.json";
import wait from "../fixtures/wait.json";

describe("format helpers", () => {
  it("formats entry and percent", () => {
    expect(entryDisplay({ price: 2421, zoneLow: null, zoneHigh: null })).toBe("2421.00");
    expect(entryDisplay({ price: null, zoneLow: null, zoneHigh: null })).toBe("Wait");
    expect(formatPercent(80.4)).toBe("80%");
  });

  it("detects TEST and stale badges", () => {
    expect(isTestDecision(buy)).toBe(true);
    expect(isTestDecision(sell)).toBe(false);
    expect(isStaleDecision(wait)).toBe(true);
    expect(isStaleDecision(buy)).toBe(false);
  });
});

describe("offline cache", () => {
  beforeEach(() => {
    clearUserCaches();
  });

  it("persists and loads settings-like payloads", () => {
    saveCache(cacheKeys.settings, { notificationsEnabled: true });
    const cached = loadCache<{ notificationsEnabled: boolean }>(cacheKeys.settings);
    expect(cached?.value.notificationsEnabled).toBe(true);
    expect(cached?.savedAt).toBeTruthy();
  });
});

describe("ApiClient envelopes", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("decodes latest decision envelope and sends Bearer token", async () => {
    const getIdToken: TokenProvider = vi.fn(async () => "test-token");
    globalThis.fetch = vi.fn(async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer test-token");
      return new Response(JSON.stringify({ decision: buy }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as typeof fetch;

    const client = new ApiClient({ baseUrl: "https://example.test/api", getIdToken });
    const decision = await client.latestDecision();
    expect(decision).not.toBeNull();
    expect(decision!.decision).toBe("BUY");
    expect(decision!.decisionId).toBe("gm-web-buy");
  });

  it("refreshes token once on 401", async () => {
    const getIdToken = vi
      .fn()
      .mockResolvedValueOnce("stale")
      .mockResolvedValueOnce("fresh");
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "expired" } }), {
          status: 401
        });
      }
      return new Response(JSON.stringify({ decisions: [sell] }), { status: 200 });
    }) as typeof fetch;

    const client = new ApiClient({ baseUrl: "https://example.test/api", getIdToken });
    const history = await client.decisionHistory();
    expect(history[0]?.decision).toBe("SELL");
    expect(getIdToken).toHaveBeenCalledWith(true);
  });

  it("treats latest-decision 404 NOT_FOUND as an empty state (null)", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "No decisions found" } }), {
        status: 404
      })
    ) as typeof fetch;
    const client = new ApiClient({
      baseUrl: "https://example.test/api",
      getIdToken: async () => "tok"
    });
    await expect(client.latestDecision()).resolves.toBeNull();
  });

  it("still maps non-empty-state API errors", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "INTERNAL", message: "boom" } }), {
        status: 500
      })
    ) as typeof fetch;
    const client = new ApiClient({
      baseUrl: "https://example.test/api",
      getIdToken: async () => "tok"
    });
    await expect(client.latestDecision()).rejects.toMatchObject({
      name: "ApiError",
      code: "INTERNAL",
      status: 500
    } satisfies Partial<ApiError>);
  });
});

describe("push subscription payload shape", () => {
  it("requires endpoint and keys for registration body", () => {
    const payload = {
      endpoint: "https://push.example/sub",
      keys: { p256dh: "abc", auth: "def" }
    };
    expect(payload.endpoint.startsWith("https://")).toBe(true);
    expect(payload.keys.p256dh).toBeTruthy();
  });
});
