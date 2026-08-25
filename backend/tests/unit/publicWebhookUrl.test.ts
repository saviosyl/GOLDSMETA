import { describe, expect, it } from "vitest";
import {
  buildTradingViewWebhookUrlFromConfig,
  isMalformedCloudFunctionsWebhookUrl,
  resolveWebhookPublicBaseUrlFromConfig
} from "../../src/services/webhook/publicWebhookUrl";

const cloudHostReq = {
  protocol: "https",
  get: (header: string) =>
    header.toLowerCase() === "host" ? "us-central1-goldmeta-web.cloudfunctions.net" : undefined
};

describe("publicWebhookUrl", () => {
  it("uses WEBHOOK_PUBLIC_BASE_URL and normalizes trailing slashes", () => {
    const url = buildTradingViewWebhookUrlFromConfig("wh_example_id_12345678", {
      appEnv: "test",
      webhookPublicBaseUrl: "https://us-central1-goldmeta-web.cloudfunctions.net/api/"
    });
    expect(url).toBe(
      "https://us-central1-goldmeta-web.cloudfunctions.net/api/webhooks/tradingview/wh_example_id_12345678"
    );
    expect(url).toContain("/api/webhooks/tradingview/");
    expect(isMalformedCloudFunctionsWebhookUrl(url)).toBe(false);
  });

  it("never emits cloudfunctions.net/webhooks/tradingview/ without /api", () => {
    const url = buildTradingViewWebhookUrlFromConfig("wh_example_id_12345678", {
      appEnv: "test",
      // Misconfigured base missing /api — must still be corrected.
      webhookPublicBaseUrl: "https://us-central1-goldmeta-web.cloudfunctions.net"
    });
    expect(url).toContain("/api/webhooks/tradingview/");
    expect(url).not.toMatch(/cloudfunctions\.net\/webhooks\/tradingview\//);
    expect(isMalformedCloudFunctionsWebhookUrl(url)).toBe(false);
  });

  it("supports custom non-Cloud-Functions WEBHOOK_PUBLIC_BASE_URL", () => {
    expect(
      buildTradingViewWebhookUrlFromConfig("abc12345", {
        appEnv: "test",
        webhookPublicBaseUrl: "https://hooks.example.test/goldmeta/"
      })
    ).toBe("https://hooks.example.test/goldmeta/webhooks/tradingview/abc12345");
  });

  it("production without explicit env uses deterministic .../api base", () => {
    const url = buildTradingViewWebhookUrlFromConfig(
      "wh_live_id_abcdefghij",
      {
        appEnv: "production",
        firebaseProjectId: "goldmeta-web",
        firebaseRegion: "us-central1"
      },
      cloudHostReq
    );
    expect(url).toBe(
      "https://us-central1-goldmeta-web.cloudfunctions.net/api/webhooks/tradingview/wh_live_id_abcdefghij"
    );
  });

  it("request-host fallback on cloudfunctions.net still inserts /api", () => {
    const url = buildTradingViewWebhookUrlFromConfig(
      "wh_fallback_id_123456",
      { appEnv: "test" },
      cloudHostReq
    );
    expect(url).toContain("/api/webhooks/tradingview/");
    expect(isMalformedCloudFunctionsWebhookUrl(url)).toBe(false);
    expect(
      isMalformedCloudFunctionsWebhookUrl(
        "https://us-central1-goldmeta-web.cloudfunctions.net/webhooks/tradingview/wh_x"
      )
    ).toBe(true);
  });

  it("existing active connections resolve the corrected URL dynamically (no rotation)", () => {
    const existingWebhookId = "existing_active_webhook_id_01";
    const before = resolveWebhookPublicBaseUrlFromConfig({
      appEnv: "production",
      firebaseProjectId: "goldmeta-web",
      firebaseRegion: "us-central1",
      // Simulate older misconfigured env that omitted /api
      webhookPublicBaseUrl: "https://us-central1-goldmeta-web.cloudfunctions.net"
    });
    expect(before).toBe("https://us-central1-goldmeta-web.cloudfunctions.net/api");
    const url = buildTradingViewWebhookUrlFromConfig(existingWebhookId, {
      appEnv: "production",
      firebaseProjectId: "goldmeta-web",
      firebaseRegion: "us-central1",
      webhookPublicBaseUrl: "https://us-central1-goldmeta-web.cloudfunctions.net"
    });
    expect(url).toBe(
      `https://us-central1-goldmeta-web.cloudfunctions.net/api/webhooks/tradingview/${existingWebhookId}`
    );
  });
});
