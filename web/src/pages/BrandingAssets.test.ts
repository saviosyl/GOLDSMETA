import { describe, expect, it } from "vitest";
import viteConfig from "../../vite.config.ts?raw";
import indexHtml from "../../index.html?raw";
import markDark from "../../public/brand/mark-dark.svg?raw";
import logoDark from "../../public/brand/logo-horizontal-dark.svg?raw";
import faviconSvg from "../../public/favicon.svg?raw";
import faviconIcoUrl from "../../public/favicon.ico?url";
import fav16Url from "../../public/favicon-16x16.png?url";
import fav32Url from "../../public/favicon-32x32.png?url";
import appleUrl from "../../public/icons/apple-touch-icon.png?url";
import pwa192Url from "../../public/icons/pwa-192x192.png?url";
import pwa512Url from "../../public/icons/pwa-512x512.png?url";
import mask192Url from "../../public/icons/pwa-maskable-192x192.png?url";
import mask512Url from "../../public/icons/pwa-maskable-512x512.png?url";

describe("GoldMeta V5.2 branding assets", () => {
  it("SVG mark is a GM monogram with charcoal/gold palette", () => {
    expect(markDark).toContain(">GM</text>");
    expect(markDark).toContain("#0A0B0D");
    expect(markDark).toContain("#C9A227");
    expect(markDark.toLowerCase()).not.toContain("bitcoin");
    expect(markDark).not.toMatch(/fill="#FFD700"/);
    expect(logoDark).toContain("GoldMeta");
    expect(logoDark).toContain("Gold Market Intelligence");
    expect(faviconSvg).toContain("GM");
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

  it("manifest naming and icon purposes are correct", () => {
    expect(viteConfig).toContain('name: "GoldMeta — Gold Market Intelligence"');
    expect(viteConfig).toContain('short_name: "GoldMeta"');
    expect(viteConfig).toContain('purpose: "maskable"');
    expect(viteConfig).toContain("icons/pwa-192x192.png");
    expect(viteConfig).toContain("icons/pwa-maskable-512x512.png");
    expect(viteConfig).toMatch(/theme_color:\s*"#0A0B0D"/);
    expect(viteConfig).toMatch(/background_color:\s*"#0A0B0D"/);
    expect(viteConfig).not.toMatch(/guaranteed profit|guaranteed profitability/i);
  });

  it("index.html has iOS PWA metadata and Apple touch icon", () => {
    expect(indexHtml).toContain('name="apple-mobile-web-app-capable"');
    expect(indexHtml).toContain('name="apple-mobile-web-app-title" content="GoldMeta"');
    expect(indexHtml).toContain('name="apple-mobile-web-app-status-bar-style"');
    expect(indexHtml).toContain('href="/icons/apple-touch-icon.png"');
    expect(indexHtml).toContain("<title>GoldMeta — Gold Market Intelligence</title>");
    expect(indexHtml).toContain('name="theme-color" content="#0B0D10"');
    expect(indexHtml).toContain("viewport-fit=cover");
    expect(indexHtml).toContain('property="og:title"');
  });
});
