import { describe, expect, it } from "vitest";
import {
  GOLD_META_STANDARD_V1,
  getActiveStandardTemplate,
  normalizeSymbolAlias,
  publicTemplateSummary,
  publishStandardTemplateVersion,
  STANDARD_TEMPLATE_ID
} from "../../../src/services/tradingview/standardTemplate";
import {
  applyCustomFieldMappings,
  defaultUserTradingViewConnection,
  hashWebhookToken,
  validateCustomMappings,
  verifyWebhookToken
} from "../../../src/services/tradingview/userTradingViewConnection";

describe("GoldMeta Standard TradingView Template", () => {
  it("defaults new users to goldmeta-standard-v1", () => {
    const profile = defaultUserTradingViewConnection("user-aaa-bbbbbbbb");
    expect(profile.templateMode).toBe("standard");
    expect(profile.templateId).toBe(STANDARD_TEMPLATE_ID);
    expect(profile.templateId).toBe(GOLD_META_STANDARD_V1.id);
  });

  it("matches approved admin schemaVersion 1.0 contract without admin secrets", () => {
    const tpl = getActiveStandardTemplate();
    expect(tpl.schemaVersion).toBe("1.0");
    expect(tpl.requiredFields).toContain("schemaVersion");
    expect(tpl.requiredFields).toContain("symbol");
    expect(tpl.supportedSymbols).toContain("XAUUSD");
    // Template may list optional payload field names, but must not embed secrets/credentials
    expect(JSON.stringify(tpl)).not.toMatch(/saviosyl|password|access_token|Bearer /i);
    expect(tpl.releaseNotes).not.toMatch(/secret|token/i);
    expect(publicTemplateSummary().description).toMatch(/private webhook/i);
  });

  it("normalises symbol aliases", () => {
    expect(normalizeSymbolAlias("OANDA:XAUUSD")).toBe("XAUUSD");
    expect(normalizeSymbolAlias("CAPITALCOM:GOLD")).toBe("XAUUSD");
    expect(normalizeSymbolAlias("BTCUSD")).toBeNull();
  });

  it("hashes webhook tokens and verifies without storing plaintext", () => {
    const token = "super-secret-token-value";
    const hash = hashWebhookToken(token);
    expect(hash).not.toContain(token);
    expect(verifyWebhookToken(token, hash)).toBe(true);
    expect(verifyWebhookToken("wrong", hash)).toBe(false);
  });

  it("applies custom field mappings into standard paths", () => {
    const mapped = applyCustomFieldMappings(
      { trend_value: 82, confirmation: true, symbol: "XAUUSD" },
      [
        {
          tradingViewField: "trend_value",
          goldMetaField: "trendMeter",
          required: false
        },
        {
          tradingViewField: "confirmation",
          goldMetaField: "confirmationCandle",
          required: false
        }
      ]
    );
    expect((mapped.trend as { strength?: number })?.strength).toBe(82);
    expect((mapped.confirmationCandle as { confirmed?: boolean })?.confirmed).toBe(true);
    expect(mapped.uid).toBeUndefined();
    expect(mapped.autoTrade).toBeUndefined();
  });

  it("rejects invalid custom mappings", () => {
    expect(validateCustomMappings([], 100).ok).toBe(false);
    expect(validateCustomMappings([{ tradingViewField: "x", goldMetaField: "poc", required: false }], 10).ok).toBe(
      false
    );
  });

  it("template upgrade does not clear custom mode on prior profile object", () => {
    const before = defaultUserTradingViewConnection("user-custom-1");
    before.templateMode = "custom";
    before.customMappingId = "custom-abc";
    publishStandardTemplateVersion({
      ...getActiveStandardTemplate(),
      id: "goldmeta-standard-v2-test",
      version: "2",
      releaseNotes: "Test bump"
    });
    // Custom profile fields remain caller-owned; publish only updates registry
    expect(before.templateMode).toBe("custom");
    expect(before.customMappingId).toBe("custom-abc");
    // restore active for other tests
    publishStandardTemplateVersion({
      ...GOLD_META_STANDARD_V1,
      id: STANDARD_TEMPLATE_ID,
      version: "1",
      releaseNotes: GOLD_META_STANDARD_V1.releaseNotes
    });
  });
});
