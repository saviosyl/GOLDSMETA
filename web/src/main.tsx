export const GOLD_META_BUILD_STAMP = "v5.4-official-logo-preview-2026-07-21";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { UpdateBanner } from "./components/UpdateBanner";
import { ScrollToTop } from "./components/ScrollToTop";
import "./styles/global.css";
import "./styles/redesign.css";

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
  onNeedRefresh() {
    window.dispatchEvent(
      new CustomEvent<UpdateDetail>(UPDATE_EVENT, {
        detail: { update: updateSW }
      })
    );
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
