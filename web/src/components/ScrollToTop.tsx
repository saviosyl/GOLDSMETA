import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Ensure each client-side route starts at the top of the document scrollport.
 * Does not fight browser restoration for back/forward when scrollRestoration is auto
 * and the navigation is POP — still resets for PUSH/REPLACE so pages feel intentional.
 */
export function ScrollToTop() {
  const { pathname, search, hash, key } = useLocation();

  useEffect(() => {
    if (hash) {
      const id = hash.replace(/^#/, "");
      const el = id ? document.getElementById(id) : null;
      if (el) {
        el.scrollIntoView({ block: "start" });
        return;
      }
    }
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname, search, hash, key]);

  return null;
}
