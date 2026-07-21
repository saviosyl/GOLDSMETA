import { describe, expect, it } from "vitest";
import viteConfig from "../../vite.config.ts?raw";
import indexHtml from "../../index.html?raw";
import logoOfficialUrl from "../../public/brand/logo-official.png?url";
import logoFullOfficialUrl from "../../public/brand/logo-full-official.png?url";
import markOfficialUrl from "../../public/brand/mark-official.png?url";
import markAppOfficialUrl from "../../public/brand/mark-app-official.png?url";
import fav16Url from "../../public/favicon-16x16.png?url";
import fav32Url from "../../public/favicon-32x32.png?url";
import faviconIcoUrl from "../../public/favicon.ico?url";
import appleUrl from "../../public/icons/apple-touch-icon.png?url";
import pwa192Url from "../../public/icons/pwa-192x192.png?url";
import pwa512Url from "../../public/icons/pwa-512x512.png?url";
import mask192Url from "../../public/icons/pwa-maskable-192x192.png?url";
import mask512Url from "../../public/icons/pwa-maskable-512x512.png?url";

describe("GoldMeta V5.4 branding assets", () => {
  it("uses the official GitHub-uploaded logo PNG assets", () => {
    expect(logoOfficialUrl).toMatch(/logo-official\.png/);
    expect(logoFullOfficialUrl).toMatch(/logo-full-official\.png/);
    expect(markOfficialUrl).toMatch(/mark-official\.png/);
    expect(markAppOfficialUrl).toMatch(/mark-app-official\.png/);
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
    expect(indexHtml).toContain("/brand/mark-official.png");
  });
});
