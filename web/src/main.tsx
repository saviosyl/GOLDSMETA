import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { UpdateBanner } from "./components/UpdateBanner";
import { ScrollToTop } from "./components/ScrollToTop";
import { GOLD_META_BUILD_STAMP, GOLD_META_COMMIT_SHA } from "./lib/buildIdentity";
import "./styles/global.css";
import "./styles/redesign.css";
import "./styles/premium-dashboard.css";
import "./styles/gm-v2.css";
import "./styles/premium-broker-autotrade.css";
import "./styles/learn.css";

export { GOLD_META_BUILD_STAMP, GOLD_META_COMMIT_SHA };

const UPDATE_EVENT = "goldmeta:sw-update";

type UpdateDetail = { update: (reloadPage?: boolean) => Promise<void> };

function purgeObsoleteUiCaches() {
  if (!("caches" in window)) return;
  void caches.keys().then((keys) => {
    for (const key of keys) {
      if (
        /goldmeta-hold-lean|goldmeta-v[0-4]|goldmeta-premium-ui-v[0-7]\b|workbox-precache.*hold-lean|goldmeta-autotrade-hardening/i.test(
          key
        )
      ) {
        void caches.delete(key);
      }
    }
  });
}

function Root() {
  const [updateFn, setUpdateFn] = useState<((reloadPage?: boolean) => Promise<void>) | null>(
    null
  );

  useEffect(() => {
    purgeObsoleteUiCaches();
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<UpdateDetail>).detail;
      if (detail?.update) setUpdateFn(() => detail.update);
    };
    window.addEventListener(UPDATE_EVENT, onUpdate);
    return () => window.removeEventListener(UPDATE_EVENT, onUpdate);
  }, []);

  return (
    <>
      {updateFn && (
        <UpdateBanner
          onUpdate={() => {
            void updateFn(true);
          }}
          onDismiss={() => setUpdateFn(null)}
        />
      )}
      <BrowserRouter>
        <ScrollToTop />
        <App />
      </BrowserRouter>
    </>
  );
}

const updateSW = registerSW({
  immediate: true,
  // autoUpdate still fires onNeedRefresh in some browsers — keep the banner
  // as a fallback, but skipWaiting means most clients refresh themselves.
  onNeedRefresh() {
    window.dispatchEvent(
      new CustomEvent<UpdateDetail>(UPDATE_EVENT, {
        detail: { update: updateSW }
      })
    );
  },
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    // Poll for a new sw.js frequently — custom-domain edges have cached sw.js
    // aggressively before, which left STATUS stuck on "Blocked".
    window.setInterval(() => {
      void registration.update();
    }, 60_000);
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
document.documentElement.dataset.build = GOLD_META_BUILD_STAMP;
document.documentElement.dataset.commit = GOLD_META_COMMIT_SHA;
document.documentElement.dataset.scrollHotfix = "1";
document.documentElement.dataset.uiRedesign = "1";
document.documentElement.dataset.premiumUi = "v5";
