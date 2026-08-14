/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __GOLD_META_BUILD_STAMP__: string;
declare const __GOLD_META_COMMIT_SHA__: string;

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_CTRADER_API_BASE_URL?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_V5_SCREENSHOT_COMPARISON_ENABLED?: string;
  /** Set to "true" only for non-production ui-review builds (`npm run build:ui-review`). */
  readonly VITE_ENABLE_UI_REVIEW?: string;
  readonly VITE_GOLD_META_BUILD_STAMP?: string;
  readonly VITE_GOLD_META_COMMIT_SHA?: string;
  readonly VITE_BUILD_SHA?: string;
  /** Isolated gold-hunter-fast-shadow Cloud Run health URL (preview only). */
  readonly VITE_GOLD_HUNTER_FAST_HEALTH_URL?: string;
  /** Set "true" for noindex/nofollow FAST live-shadow preview deploys. */
  readonly VITE_GOLD_HUNTER_FAST_PREVIEW?: string;
  /** Isolated gold-hunter-fast-research-collector health URL. */
  readonly VITE_GOLD_HUNTER_FAST_RESEARCH_HEALTH_URL?: string;
  /** Set "true" for noindex research-monitor preview deploys. */
  readonly VITE_GOLD_HUNTER_FAST_RESEARCH_PREVIEW?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*?raw" {
  const content: string;
  export default content;
}
