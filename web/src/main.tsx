export const GOLD_META_BUILD_STAMP = "v6.0.0-autotrade-hardening-2026-07-22";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { UpdateBanner } from "./components/UpdateBanner";
import { ScrollToTop } from "./components/ScrollToTop";
import "./styles/global.css";
import "./styles/redesign.css";
import "./styles/premium-dashboard.css";
import "./styles/gm-v2.css";
import "./styles/premium-broker-autotrade.css";

const UPDATE_EVENT = "goldmeta:sw-update";

type UpdateDetail = { update: (reloadPage?: boolean) => Promise<void> };

function Root() {
  const [updateFn, setUpdateFn] = useState<((reloadPage?: boolean) => Promise<void>) | null>(
    null
  );

  useEffect(() => {
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

void GOLD_META_BUILD_STAMP;
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
document.documentElement.dataset.build = GOLD_META_BUILD_STAMP;
document.documentElement.dataset.scrollHotfix = "1";
document.documentElement.dataset.uiRedesign = "1";
