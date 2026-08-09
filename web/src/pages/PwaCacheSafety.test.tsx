import { describe, expect, it } from "vitest";
import viteConfig from "../../vite.config.ts?raw";
import redirects from "../../public/_redirects?raw";
import headers from "../../public/_headers?raw";

describe("PWA cache safety", () => {
  it("does not runtime-cache private /v1/decisions API responses", () => {
    expect(viteConfig).not.toMatch(/url\.pathname\.includes\("\/v1\/decisions"\)/);
    expect(viteConfig).toMatch(/runtimeCaching:\s*\[\s*\]/);
    expect(viteConfig).toMatch(/cleanupOutdatedCaches:\s*true/);
    expect(viteConfig).toMatch(/clientsClaim:\s*true/);
    expect(viteConfig).toMatch(/skipWaiting:\s*true/);
  });

  it("uses a fresh premium UI Workbox cache namespace", () => {
    expect(viteConfig).toMatch(/cacheId:\s*"goldmeta-premium-ui-v6"/);
    expect(viteConfig).not.toMatch(/goldmeta-hold-lean-v4/);
    expect(viteConfig).toMatch(/sw-cache-migrate\.js/);
  });

  it("SPA redirects keep client routes on the app shell", () => {
    expect(redirects).toMatch(/\/\*\s+\/index\.html\s+200/);
  });

  it("HTML / SW headers force revalidation", () => {
    expect(headers).toMatch(/\/index\.html[\s\S]*Cache-Control: no-cache/);
    expect(headers).toMatch(/\/sw\.js[\s\S]*Cache-Control: no-cache[\s\S]*CDN-Cache-Control: no-store/);
  });

  it("hashed /gm and /gmv7 assets use immutable long-cache headers", () => {
    expect(headers).toMatch(/\/gm\/\*[\s\S]*immutable/);
    expect(headers).toMatch(/\/gmv7\/\*[\s\S]*immutable/);
  });
});
