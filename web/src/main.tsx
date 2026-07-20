import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./styles/global.css";

registerSW({
  immediate: true,
  onNeedRefresh() {
    // Prompt-style update: reload when a new SW is waiting.
    if (confirm("A new GoldMeta version is available. Reload now?")) {
      window.location.reload();
    }
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
