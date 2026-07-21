import { describe, expect, it } from "vitest";
import viteConfig from "../../vite.config.ts?raw";
import indexHtml from "../../index.html?raw";
import markV54 from "../../public/brand/mark-v54.svg?raw";
import logoV54 from "../../public/brand/logo-full-v54.svg?raw";
import faviconSvg from "../../public/favicon.svg?raw";
import faviconIcoUrl from "../../public/favicon.ico?url";
import fav16Url from "../../public/favicon-16x16.png?url";
import fav32Url from "../../public/favicon-32x32.png?url";
import appleUrl from "../../public/icons/apple-touch-icon.png?url";
import pwa192Url from "../../public/icons/pwa-192x192.png?url";
import pwa512Url from "../../public/icons/pwa-512x512.png?url";
import mask192Url from "../../public/icons/pwa-maskable-192x192.png?url";
import mask512Url from "../../public/icons/pwa-maskable-512x512.png?url";

describe("GoldMeta V5.4 branding assets", () => {
  it("approved mark uses navy and gold palette", () => {
    expect(markV54).toContain("#11284A");
    expect(markV54).toContain("#D8A33D");
    expect(markV54.toLowerCase()).not.toContain("bitcoin");
    expect(logoV54).toContain("GOLD");
    expect(logoV54).toContain("META");
    expect(logoV54).toContain("MetaMech Solutions");
    expect(faviconSvg).toContain("#11284A");
  });

  it("required icon asset URLs resolve", () => {
    expect(faviconIcoUrl).toMatch(/favicon\.ico/);
    expect(fav16Url).toMatch(/favicon-16x16/);
    expect(fav32Url).toMatch(/favicon-32x32/);
    expect(appleUrl).toMatch(/apple-touch-icon/);
    expect(pwa192Url).toMatch(/pwa-192x192/);
    expect(pwa512Url).toMatch(/pwa-512x512/);
    expect(mask192Url).toMatch(/pwa-maskable-192x192/);
    expect(mask512Url).toMatch(/pwa-maskable-512x512/);
  });

  it("manifest naming and light theme colours are correct", () => {
    expect(viteConfig).toContain('name: "GoldMeta — Gold Market Intelligence"');
    expect(viteConfig).toContain('short_name: "GoldMeta"');
    expect(viteConfig).toContain('purpose: "maskable"');
    expect(viteConfig).toContain("icons/pwa-192x192.png");
    expect(viteConfig).toMatch(/theme_color:\s*"#F7F8FA"/);
    expect(viteConfig).toMatch(/background_color:\s*"#F7F8FA"/);
    expect(viteConfig).not.toMatch(/guaranteed profit|guaranteed profitability/i);
  });

  it("index.html has iOS PWA metadata and Apple touch icon", () => {
    expect(indexHtml).toContain('name="apple-mobile-web-app-capable"');
    expect(indexHtml).toContain('name="apple-mobile-web-app-title" content="GoldMeta"');
    expect(indexHtml).toContain('href="/icons/apple-touch-icon.png"');
    expect(indexHtml).toContain("<title>GoldMeta — Gold Market Intelligence</title>");
    expect(indexHtml).toContain('name="theme-color" content="#F7F8FA"');
    expect(indexHtml).toContain('name="color-scheme" content="light"');
    expect(indexHtml).toContain("viewport-fit=cover");
  });
});
