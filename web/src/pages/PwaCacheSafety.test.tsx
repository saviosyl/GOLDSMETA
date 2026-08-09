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
    expect(viteConfig).toMatch(/cacheId:\s*"goldmeta-premium-ui-v8"/);
    expect(viteConfig).not.toMatch(/goldmeta-hold-lean-v4/);
    expect(viteConfig).toMatch(/sw-cache-migrate\.js/);
    expect(viteConfig).toMatch(/navigateFallbackDenylist/);
    expect(viteConfig).toMatch(/\/\^\\\/gmv7\\\//);
  });

  it("SPA redirects keep client routes on the app shell", () => {
    expect(redirects).toMatch(/\/\*\s+\/index\.html\s+200/);
    expect(redirects).toMatch(/gmv7/);
  });

  it("HTML / SW headers force revalidation", () => {
    expect(headers).toMatch(/\/index\.html[\s\S]*Cache-Control: no-cache/);
    expect(headers).toMatch(/\/sw\.js[\s\S]*Cache-Control: no-cache[\s\S]*CDN-Cache-Control: no-store/);
  });

  it("hashed /gm and /gmv7 assets use browser-immutable cache without CDN immutable", () => {
    expect(headers).toMatch(/\/gm\/\*[\s\S]*Cache-Control: public, max-age=31536000, immutable/);
    expect(headers).toMatch(/\/gmv7\/\*[\s\S]*Cache-Control: public, max-age=31536000, immutable/);
    // CDN-Cache-Control: immutable on /gmv7/* poisons missing-chunk 404s at the edge.
    const gmv7Block = headers.split("/gmv7/*")[1]?.split("\n/")[0] ?? "";
    expect(gmv7Block).not.toMatch(/CDN-Cache-Control:\s*public,\s*max-age=31536000,\s*immutable/);
    const gmBlock = headers.split("/gm/*")[1]?.split("\n/")[0] ?? "";
    expect(gmBlock).not.toMatch(/CDN-Cache-Control:\s*public,\s*max-age=31536000,\s*immutable/);
  });
});
