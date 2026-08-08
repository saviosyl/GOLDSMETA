/** Current production web build identity — injected at Vite build time. */
export const GOLD_META_BUILD_STAMP =
  import.meta.env.VITE_GOLD_META_BUILD_STAMP || "premium-ui-v5-dev";

export const GOLD_META_COMMIT_SHA =
  import.meta.env.VITE_GOLD_META_COMMIT_SHA || "dev";
