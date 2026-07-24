/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
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
        cacheId: "goldmeta-v543-auth-layout",
        navigateFallback: "/index.html",
        // Do not cache API responses — private user / auth / admin / LIVE data
        // must not enter a public or shared SW cache. Offline shell uses
        // precached static assets only; decision freshness uses localStorage
        // envelopes with explicit timestamps (see offlineCache.ts).
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"]
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
    // React 19 only exports act() from the development build.
    env: {
      NODE_ENV: "test"
    }
  }
});
