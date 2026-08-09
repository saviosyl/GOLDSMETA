/// <reference types="vitest/config" />
import { execSync } from "node:child_process";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

function resolveBuildIdentity() {
  const fromEnv =
    process.env.CF_PAGES_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.VITE_BUILD_SHA ||
    "";
  let full = fromEnv.trim();
  if (!full) {
    try {
      full = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    } catch {
      full = "unknown";
    }
  }
  const short = full.slice(0, 7);
  // August premium UI delivery stamp — must change whenever the shell cache bumps.
  const stamp = `premium-ui-v5-${short}-2026-08-08`;
  return { full, short, stamp };
}

const BUILD = resolveBuildIdentity();
process.env.VITE_GOLD_META_BUILD_STAMP = BUILD.stamp;
process.env.VITE_GOLD_META_COMMIT_SHA = BUILD.short;

/** Drop any leftover Issue #50 / UiReview chunks from production builds. */
function stripUiReviewFromProduction(): Plugin {
  const uiReviewEnabled = process.env.VITE_ENABLE_UI_REVIEW === "true";
  return {
    name: "strip-ui-review-from-production",
    apply: "build",
    generateBundle(_options, bundle) {
      if (uiReviewEnabled) return;
      for (const fileName of Object.keys(bundle)) {
        if (/UiReviewApp|issue50PreviewMatrix|issue50-preview/i.test(fileName)) {
          delete bundle[fileName];
        }
      }
    }
  };
}

export default defineConfig({
  define: {
    __GOLD_META_BUILD_STAMP__: JSON.stringify(BUILD.stamp),
    __GOLD_META_COMMIT_SHA__: JSON.stringify(BUILD.short),
    "import.meta.env.VITE_GOLD_META_BUILD_STAMP": JSON.stringify(BUILD.stamp),
    "import.meta.env.VITE_GOLD_META_COMMIT_SHA": JSON.stringify(BUILD.short)
  },
  build: {
    // Custom-domain edge can cache 404s for missing hashed assets (max-age=14400).
    // /assets and /gm were previously poisoned; bump the directory on recovery deploys.
    assetsDir: "gmv7"
  },
  plugins: [
    react(),
    stripUiReviewFromProduction(),
    VitePWA({
      // Auto-apply deploys so wording/status fixes (e.g. HOLD vs BLOCKED) are not
      // stuck behind a dismissed "Update now" banner or a cached old sw.js.
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.svg",
        "favicon.ico",
        "favicon-16x16.png",
        "favicon-32x32.png",
        "apple-touch-icon.png",
        "icons/icon-192.png",
        "icons/icon-512.png",
        "icons/apple-touch-icon.png",
        "icons/pwa-192x192.png",
        "icons/pwa-512x512.png",
        "icons/maskable-icon-192.png",
        "icons/maskable-icon-512.png",
        "icons/pwa-maskable-192x192.png",
        "icons/pwa-maskable-512x512.png",
        "brand/mark-dark.svg",
        "brand/mark-mono.svg",
        "brand/logo-horizontal-dark.svg"
      ],
      manifest: {
        name: "GoldMeta — Gold Market Intelligence",
        short_name: "GoldMeta",
        description:
          "GoldMeta XAUUSD decision support — analysis only, not an executed trade. Broker execution disabled.",
        theme_color: "#F7F8FA",
        background_color: "#F7F8FA",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: "/",
        scope: "/",
        lang: "en",
        categories: ["finance", "productivity"],
        icons: [
          {
            src: "icons/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "icons/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "icons/pwa-maskable-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable"
          },
          {
            src: "icons/pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          },
          {
            src: "icons/maskable-icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable"
          },
          {
            src: "icons/maskable-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        // Bump on layout-critical deploys so outdated precaches are cleaned.
        // Bump when hashed chunk layout changes so stale PWA shells recover.
        // v7: retain gmv7 assets + push-handler without regressing premium PWA.
        // v8: gmv7 nearest-404 + navigateFallback denylist (stale-chunk safety).
        cacheId: "goldmeta-premium-ui-v8",
        navigateFallback: "/index.html",
        // Never treat hashed assets / static files as SPA navigations.
        navigateFallbackDenylist: [
          /^\/gmv7\//,
          /^\/gm\//,
          /^\/assets\//,
          /^\/learn-audio\//,
          /\/[^/?]+\.(?:js|css|map|mjs|json|webmanifest|png|jpe?g|gif|svg|webp|ico|woff2?|mp3|m4a|wav)(?:$|\?)/i
        ],
        // Do not cache API responses — private user / auth / admin / LIVE data
        // must not enter a public or shared SW cache. Offline shell uses
        // precached static assets only; decision freshness uses localStorage
        // envelopes with explicit timestamps (see offlineCache.ts).
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        importScripts: ["sw-cache-migrate.js", "push-handler.js"]
      },
      devOptions: {
        enabled: false
      }
    })
  ],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    globals: true,
    css: true,
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
    // GitHub Actions runners (~7GB) OOM when multiple Vitest forks each approach
    // the default ~4GB heap. Keep CI serial; local stays parallel.
    pool: "forks",
    maxWorkers: process.env.CI ? 1 : undefined,
    fileParallelism: process.env.CI ? false : undefined,
    // React 19 only exports act() from the development build.
    env: {
      NODE_ENV: "test",
      VITE_ENABLE_UI_REVIEW: "true"
    }
  }
});
