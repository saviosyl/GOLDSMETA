import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { Navigate } from "react-router-dom";
import { isUiReviewHost, UI_REVIEW_BUILD_ENABLED } from "./uiReviewHost";

/**
 * Thin production-safe gate for `/ui-review`.
 *
 * The dynamic import of UiReviewApp is only present when
 * `VITE_ENABLE_UI_REVIEW === "true"` at build time. Production Cloudflare builds
 * omit that env var, so Rollup drops the preview module (and Issue #50 fixtures)
 * from the asset graph entirely.
 */
type ReviewApp = ComponentType<object>;

function loadReviewApp(): LazyExoticComponent<ReviewApp> | null {
  // Keep the dynamic import inside a compile-time-constant branch so production
  // builds never emit the UiReviewApp chunk.
  if (import.meta.env.VITE_ENABLE_UI_REVIEW === "true") {
    return lazy(() => import("./UiReviewApp"));
  }
  return null;
}

const LazyUiReviewApp = loadReviewApp();

export function UiReviewGate() {
  if (typeof window !== "undefined" && !isUiReviewHost()) {
    return <Navigate to="/" replace />;
  }
  if (!UI_REVIEW_BUILD_ENABLED || !LazyUiReviewApp) {
    return <Navigate to="/" replace />;
  }
  return (
    <Suspense
      fallback={
        <div className="gm-meta" data-testid="ui-review-loading" role="status">
          Loading preview…
        </div>
      }
    >
      <LazyUiReviewApp />
    </Suspense>
  );
}

export { isUiReviewHost, UI_REVIEW_BUILD_ENABLED } from "./uiReviewHost";
