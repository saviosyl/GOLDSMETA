/**
 * Host allow-list for the non-production UI-review shell.
 * Production domains (e.g. goldmeta.metamechsolutions.com) must never qualify.
 */
export function isUiReviewHost(hostname = typeof window !== "undefined" ? window.location.hostname : ""): boolean {
  if (!hostname) return false;
  const host = hostname.toLowerCase();
  if (host === "goldmeta.metamechsolutions.com") return false;
  if (host.endsWith(".metamechsolutions.com") && !host.includes("preview")) return false;
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".pages.dev") ||
    host.includes("preview")
  );
}

/**
 * Compile-time flag — Vite replaces `import.meta.env.VITE_ENABLE_UI_REVIEW`.
 * Enabled only when explicitly set to "true" (`npm run dev`, `build:ui-review`, vitest).
 * Default production `npm run build` leaves this false so UiReviewApp is not in the graph.
 */
export const UI_REVIEW_BUILD_ENABLED = import.meta.env.VITE_ENABLE_UI_REVIEW === "true";
